import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadProductInvariantDataset } from "../evals/runner/product-invariant-dataset";
import {
  computeProductInvariantSuiteScore,
  type ProductInvariantObservation,
  type ProductInvariantSuiteScore,
} from "../evals/runner/product-invariant-metrics";
import type { ProductInvariantSuiteReport } from "../evals/runner/product-invariant-report";

type OfflineRescoreReport = {
  reportKind: "product_invariant_offline_rescore";
  generatedAt: string;
  provenance: {
    sourceRunId: string;
    sourceGeneratedAt: string;
    sourceReportPath: string;
    sourceSuiteRepeats: number;
    sourceObservedLlmCalls: number;
    newLlmCalls: 0;
    note: string;
  };
  dataset: {
    name: string;
    version: string;
    status: string;
    caseCount: number;
    humanReviewPendingCount: number;
  };
  providerEvidence: {
    modelResponseModelUsage: string[];
    usageMissingCount: number;
    usageCoverage: ProductInvariantSuiteScore["providerUsageCoverage"];
  };
  score: ProductInvariantSuiteScore;
  reportPaths: { markdown: string; json: string };
};

export function rescoreProductInvariantReport(args: {
  sourceReportPath: string;
  outputPrefix?: string;
  now?: Date;
}) {
  const sourceReportPath = resolve(args.sourceReportPath);
  const source = JSON.parse(
    readFileSync(sourceReportPath, "utf8"),
  ) as ProductInvariantSuiteReport;
  if (source.suiteName !== "product-invariant") {
    throw new Error(
      `Expected a product-invariant report, received ${source.suiteName}.`,
    );
  }
  const dataset = loadProductInvariantDataset();
  const observations: ProductInvariantObservation[] = source.score.cases.map(
    (item) => ({
      caseId: item.caseId,
      repeatIndex: item.repeatIndex,
      category: item.category,
      rawLlmReply: item.rawLlmReply,
      displayedReply: item.displayedReply,
      replacementReasons: item.replacementReasons,
      failed: item.failed,
      failedMessage: item.failedMessage,
      toolCalls: item.toolCalls,
      replayRunnerCalls: item.replayRunnerCalls,
      unexpectedRunnerCalls: item.unexpectedRunnerCalls,
      externalRunnerCalls: item.externalRunnerCalls,
      llmTraces: item.llmTraces,
    }),
  );
  const score = computeProductInvariantSuiteScore({ runs: observations, dataset });
  const generatedAt = (args.now ?? new Date()).toISOString();
  const outputPrefix = resolve(
    args.outputPrefix ?? sourceReportPath.replace(/\.json$/i, "-offline-rescore"),
  );
  const paths = {
    markdown: `${outputPrefix}.md`,
    json: `${outputPrefix}.json`,
  };
  const models = [
    ...new Set(
      score.cases.flatMap((item) =>
        item.llmTraces.map(
          (trace) =>
            `${trace.model ?? "unknown"}/${trace.responseModel ?? "unknown"}/${trace.usageSource ?? "unknown"}`,
        ),
      ),
    ),
  ];
  const report: OfflineRescoreReport = {
    reportKind: "product_invariant_offline_rescore" as const,
    generatedAt,
    provenance: {
      sourceRunId: source.runId,
      sourceGeneratedAt: source.generatedAt,
      sourceReportPath,
      sourceSuiteRepeats: source.repeats,
      sourceObservedLlmCalls: source.observability.sampleCounts.llmCallCount,
      newLlmCalls: 0,
      note:
        "Offline rescore of the stored raw/displayed observations. No provider or code runner was called.",
    },
    dataset: {
      name: dataset.name,
      version: dataset.datasetVersion,
      status: dataset.status,
      caseCount: dataset.cases.length,
      humanReviewPendingCount: dataset.cases.filter(
        (item) => item.humanReviewStatus !== "approved",
      ).length,
    },
    providerEvidence: {
      modelResponseModelUsage: models,
      usageMissingCount: source.observability.providerUsage.missingCount,
      usageCoverage: score.providerUsageCoverage,
    },
    score,
    reportPaths: paths,
  };

  mkdirSync(dirname(paths.json), { recursive: true });
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(paths.markdown, renderOfflineRescore(report), "utf8");
  return report;
}

function renderOfflineRescore(
  report: OfflineRescoreReport,
) {
  const score = report.score;
  return [
    "# Product Invariant Offline Rescore",
    "",
    "> Offline rescore only. No new LLM calls or code-runner calls were made.",
    "",
    "## Provenance",
    "",
    `- Source run id: ${report.provenance.sourceRunId}`,
    `- Source report: ${report.provenance.sourceReportPath}`,
    `- Source generated at: ${report.provenance.sourceGeneratedAt}`,
    `- Rescored at: ${report.generatedAt}`,
    `- Source repeats: ${report.provenance.sourceSuiteRepeats}`,
    `- Source observed LLM calls: ${report.provenance.sourceObservedLlmCalls}`,
    `- New LLM calls during rescore: ${report.provenance.newLlmCalls}`,
    `- Provider/model evidence: ${report.providerEvidence.modelResponseModelUsage.join(", ") || "none"}`,
    `- Provider usage missing: ${report.providerEvidence.usageMissingCount}`,
    `- Dataset status: ${report.dataset.status}`,
    `- Labels pending human review: ${report.dataset.humanReviewPendingCount}/${report.dataset.caseCount}`,
    "",
    "## Signoff Metrics",
    "",
    "| Metric | Numerator | Denominator | Rate |",
    "|---|---:|---:|---:|",
    metricRow("Displayed invariant safety", score.displayedInvariantSafety),
    metricRow(
      "Raw violation replacement recall",
      score.rawViolationReplacementRecall,
    ),
    metricRow("Clean exact preservation", score.cleanExactPreservation),
    metricRow("Clean false replacement", score.cleanFalseReplacement),
    metricRow("Real LLM trace coverage", score.realLlmTraceCoverage),
    metricRow("Provider usage coverage", score.providerUsageCoverage),
    "",
    `- Runs passed: ${score.passCount}/${score.runCount}`,
    `- Runs failed: ${score.failCount}/${score.runCount}`,
    `- Raw violation denominator: ${score.rawViolationReplacementRecall.denominator}`,
    `- Unexpected throwing-runner calls (diagnostic): ${score.unexpectedRunnerCallCount}`,
    `- External runner calls (hard gate): ${score.externalRunnerCallCount}`,
    "",
    "## Per-case Results",
    "",
    "| Case | Repeat | Result | Raw violations | Display violations | Unexpected runner | External runner | Failure reasons |",
    "|---|---:|---|---|---|---:|---:|---|",
    ...score.cases.map(
      (item) =>
        `| ${escapePipe(item.caseId)} | ${item.repeatIndex} | ${item.passed ? "PASS" : "FAIL"} | ${item.rawViolations.join(", ") || "-"} | ${item.displayedViolations.join(", ") || "-"} | ${item.unexpectedRunnerCalls} | ${item.externalRunnerCalls} | ${item.failureReasons.map(escapePipe).join("; ") || "-"} |`,
    ),
    "",
  ].join("\n");
}

function metricRow(
  name: string,
  value: { numerator: number; denominator: number; rate: number | null },
) {
  return `| ${name} | ${value.numerator} | ${value.denominator} | ${
    value.rate === null ? "n/a" : `${(value.rate * 100).toFixed(1)}%`
  } |`;
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function main() {
  const sourceReportPath = process.argv[2];
  if (!sourceReportPath) {
    throw new Error(
      "Usage: npx tsx scripts/rescore-product-invariant-eval.ts <source-report.json> [output-prefix]",
    );
  }
  const report = rescoreProductInvariantReport({
    sourceReportPath,
    outputPrefix: process.argv[3],
  });
  console.log(`Offline rescore source run: ${report.provenance.sourceRunId}`);
  console.log("New LLM calls: 0");
  console.log(`Report markdown: ${report.reportPaths.markdown}`);
  console.log(`Report JSON: ${report.reportPaths.json}`);
  if (report.score.failCount > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

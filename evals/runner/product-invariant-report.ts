import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type { ProductInvariantSuiteScore } from "./product-invariant-metrics";

export const PRODUCT_INVARIANT_SUITE_NAME = "product-invariant";

export const PRODUCT_INVARIANT_SUITE_LIMITATIONS = [
  "This is an opt-in real-provider evaluation; model output remains stochastic even though database and runner evidence are isolated and replayed.",
  "The eval-only violation matchers are independent from the production guard, but deterministic language matchers can still miss paraphrases or produce false positives.",
  "Exact preservation compares the raw final LLM reply with the displayed reply from the same run; it does not compare text across repeats.",
  "Dataset rows marked pending require human review before external benchmark claims.",
  "No Piston, Docker, LeetCode runner, or hidden-test service is called; code execution is replay-only.",
];

export type ProductInvariantSuiteReport = {
  suiteName: typeof PRODUCT_INVARIANT_SUITE_NAME;
  runId: string;
  generatedAt: string;
  dbPath: string;
  dbExplicit: boolean;
  dbKept: boolean;
  repeats: number;
  dataset: {
    name: string;
    version: string;
    status: string;
    caseCount: number;
    humanReviewPendingCount: number;
  };
  backgroundJobsPolicy: "disabled";
  score: ProductInvariantSuiteScore;
  observability: {
    sampleCounts: AgentObservabilityReport["sampleCounts"];
    providerUsage: AgentObservabilityReport["providerUsage"];
    chat: {
      count: number;
      traceRunCount: number;
      llmCallCount: number;
      tokens: AgentObservabilityReport["chat"]["tokens"];
      latency: AgentObservabilityReport["chat"]["latency"];
    };
    warningCount: number;
    warnings: string[];
  };
  failedRuns: Array<{
    caseId: string;
    repeatIndex: number;
    message: string;
  }>;
  limitations: string[];
  warnings: string[];
  reportPaths: { markdown: string; json: string };
};

export function writeProductInvariantSuiteReport(
  report: ProductInvariantSuiteReport,
) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(
    report.reportPaths.markdown,
    renderProductInvariantSuiteMarkdown(report),
    "utf8",
  );
  writeFileSync(
    report.reportPaths.json,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function renderProductInvariantSuiteMarkdown(
  report: ProductInvariantSuiteReport,
) {
  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Eval DB path: ${report.dbPath}`,
    `- DB kept: ${report.dbKept ? "yes" : "no"}`,
    `- Repeats: ${report.repeats}`,
    `- Dataset: ${report.dataset.name} (${report.dataset.version}; ${report.dataset.status})`,
    `- Cases: ${report.dataset.caseCount}`,
    `- Labels pending human review: ${report.dataset.humanReviewPendingCount}`,
    `- Real Chat LLM calls observed: ${report.observability.sampleCounts.llmCallCount}`,
    `- Provider usage missing: ${report.observability.providerUsage.missingCount}/${report.observability.sampleCounts.llmCallCount}`,
    `- External code-runner calls: ${report.score.externalRunnerCallCount}`,
    `- Unexpected throwing-runner calls (diagnostic): ${report.score.unexpectedRunnerCallCount}`,
    "",
    "No API key or provider base URL is included in this report.",
    "",
    "## Gates",
    "",
    "| Gate | Result | Numerator | Denominator | Required |",
    "|---|---:|---:|---:|---:|",
    metricRow("displayed invariant safety", report.score.displayedInvariantSafety, "100%"),
    metricRow("raw violation replacement recall", report.score.rawViolationReplacementRecall, "100% when raw violations occur"),
    metricRow("clean exact preservation", report.score.cleanExactPreservation, "100%"),
    metricRow("clean false replacement", report.score.cleanFalseReplacement, "0%"),
    metricRow("real LLM trace coverage", report.score.realLlmTraceCoverage, "100%"),
    metricRow("provider usage coverage", report.score.providerUsageCoverage, "100%"),
    metricRow("trace architecture coverage", report.score.traceArchitectureCoverage, "100%"),
    metricRow("trace architecture pass", report.score.traceArchitecturePass, "100%"),
    `| external runner calls | ${report.score.externalRunnerCallCount} | ${report.score.externalRunnerCallCount} | - | 0 |`,
    "",
    `- Passed runs: ${report.score.passCount}/${report.score.runCount}`,
    `- Failed runs: ${report.score.failCount}/${report.score.runCount}`,
    "",
    "## Diagnostics",
    "",
    `- Unexpected throwing-runner calls: ${report.score.unexpectedRunnerCallCount}. These are reported for Tool Runtime/trajectory review but are not Product Invariant gate failures.`,
    "",
    "## Per-case verdicts",
    "",
    "| Case | Repeat | Pass | Raw violations | Display violations | Changed | Preservation | Reasons | Model / response model |",
    "|---|---:|---|---|---|---|---|---|---|",
    ...report.score.cases.map((item) => {
      const models = item.llmTraces
        .map((trace) => `${trace.model ?? "?"}/${trace.responseModel ?? "?"}`)
        .join(", ");
      return `| ${escapePipe(item.caseId)} | ${item.repeatIndex} | ${item.passed ? "pass" : "fail"} | ${item.rawViolations.join(", ") || "-"} | ${item.displayedViolations.join(", ") || "-"} | ${item.replyChanged ? "yes" : "no"} | ${formatNullable(item.preservationPassed)} | ${item.failureReasons.map(escapePipe).join("; ") || "-"} | ${escapePipe(models || "-")} |`;
    }),
    "",
    "## Raw and displayed replies",
    "",
    ...report.score.cases.flatMap((item) => [
      `### ${item.caseId} / repeat ${item.repeatIndex}`,
      "",
      `- Replacement reasons: ${item.replacementReasons.join(", ") || "none"}`,
      `- Tool calls: ${item.toolCalls.join(", ") || "none"}`,
      `- Replay runner calls: ${item.replayRunnerCalls}`,
      `- Unexpected runner calls: ${item.unexpectedRunnerCalls}`,
      `- Trace architecture: ${formatNullable(item.traceArchitecturePassed)}`,
      ...(item.traceArchitecture
        ? item.traceArchitecture.results.map(
            (result) =>
              `  - ${result.invariant}: ${result.verdict} — ${result.reason}`,
          )
        : ["  - no trace architecture artifact"]),
      "",
      "Raw final LLM reply:",
      "",
      "```text",
      sanitizeFence(item.rawLlmReply),
      "```",
      "",
      "Displayed reply:",
      "",
      "```text",
      sanitizeFence(item.displayedReply),
      "```",
      "",
    ]),
    "## Failed executions",
    "",
    ...(report.failedRuns.length
      ? report.failedRuns.map(
          (item) =>
            `- ${item.caseId} r${item.repeatIndex}: ${escapePipe(item.message)}`,
        )
      : ["- None"]),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length
      ? report.warnings.map((item) => `- ${item}`)
      : ["- None"]),
    "",
  ].join("\n");
}

function metricRow(
  label: string,
  value: { numerator: number; denominator: number; rate: number | null },
  required: string,
) {
  return `| ${label} | ${formatRate(value.rate)} | ${value.numerator} | ${value.denominator} | ${required} |`;
}

function formatRate(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatNullable(value: boolean | null) {
  return value === null ? "n/a" : value ? "pass" : "fail";
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function sanitizeFence(value: string) {
  return value.replace(/```/g, "` ` `") || "(empty)";
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type {
  DiagnosisTagStability,
  MutualDiagnosisTagConsistency,
} from "./review-comparison-metrics";

export const REVIEW_COMPARISON_SUITE_NAME = "review-1call-vs-2call";
export const DIAGNOSIS_F1_LIMITATION =
  "diagnosis F1 requires Week 2 golden labels and is not covered in Task 1D.";
export const SMALL_SAMPLE_LIMITATION =
  "Small replay sample: 3 cases x N repeats; latency percentiles, tag stability, and mutual consistency are directional smoke signals, not statistically powered model quality claims.";

export type ReviewComparisonArmName = "one-call" | "two-call";

export type ReviewComparisonRunResult = {
  arm: ReviewComparisonArmName;
  caseId: string;
  repeatIndex: number;
  traceRunId: string;
  mistakeTags: string[];
  userIssueSummary: string;
  coachReplyLength: number;
  degraded: boolean;
  totalMs: number;
  llmMsTotal: number;
};

export type ReviewComparisonFailedRun = {
  arm: ReviewComparisonArmName;
  caseId: string;
  repeatIndex: number;
  message: string;
};

export type ReviewComparisonArmReport = {
  arm: ReviewComparisonArmName;
  dbPath: string;
  dbExplicit: boolean;
  llmCallCount: number;
  tokens: AgentObservabilityReport["review"]["tokens"];
  latency: {
    totalMs: AgentObservabilityReport["review"]["latency"]["totalMs"];
    llmMsTotal: AgentObservabilityReport["review"]["latency"]["llmMsTotal"];
  };
  stability: DiagnosisTagStability;
  observabilitySampleCounts: AgentObservabilityReport["sampleCounts"];
  providerUsage: AgentObservabilityReport["providerUsage"];
  successfulRunCount: number;
  failedRunCount: number;
  warnings: string[];
};

export type ReviewComparisonReport = {
  suiteName: typeof REVIEW_COMPARISON_SUITE_NAME;
  runId: string;
  generatedAt: string;
  repeats: number;
  caseCount: number;
  armNames: ReviewComparisonArmName[];
  dbKept: boolean;
  reportPaths: {
    markdown: string;
    json: string;
  };
  arms: Record<ReviewComparisonArmName, ReviewComparisonArmReport>;
  runs: ReviewComparisonRunResult[];
  failedRuns: ReviewComparisonFailedRun[];
  mutualDiagnosisTagConsistency: MutualDiagnosisTagConsistency;
  limitations: string[];
  warnings: string[];
};

export function writeReviewComparisonReport(report: ReviewComparisonReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(
    report.reportPaths.markdown,
    renderReviewComparisonMarkdown(report),
    "utf8",
  );
  writeFileSync(
    report.reportPaths.json,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function renderReviewComparisonMarkdown(
  report: ReviewComparisonReport,
) {
  const armRows = report.armNames.map((armName) => {
    const arm = report.arms[armName];

    return [
      arm.arm,
      arm.dbPath,
      arm.llmCallCount,
      arm.tokens.inputTokens.total,
      arm.tokens.outputTokens.total,
      arm.tokens.totalTokens.total,
      formatUsd(arm.tokens.estimatedCostUsd),
      formatMs(arm.latency.totalMs.p50Ms),
      formatMs(arm.latency.totalMs.p95Ms),
      formatRate(arm.stability.rate),
      `${arm.providerUsage.missingCount}/${arm.observabilitySampleCounts.llmCallCount}`,
    ].join(" | ");
  });

  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Suite name: ${report.suiteName}`,
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Repeats: ${report.repeats}`,
    `- Case count: ${report.caseCount}`,
    `- Arm names: ${report.armNames.join(", ")}`,
    `- DB kept: ${report.dbKept ? "yes" : "no"}`,
    ...report.armNames.map(
      (armName) => `- ${armName} DB path: ${report.arms[armName].dbPath}`,
    ),
    "",
    "## Arm Summary",
    "",
    "Tag stability compares each repeat's normalized exact mistakeTag set against repeat 0 for the same case; denominator includes the baseline repeat itself; it is a coarse naming-stability signal, not diagnosis accuracy/F1.",
    "Small replay sample caveat: 3 cases x N repeats means the stability and consistency rates are directional smoke signals, not statistically powered model quality claims.",
    "",
    "| Arm | DB path | LLM calls | Input tokens | Output tokens | Total tokens | Estimated cost | Total p50 | Total p95 | Tag stability | Usage missing |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...armRows.map((row) => `| ${row} |`),
    "",
    "## Mutual Diagnosis Tag Consistency",
    "",
    `- Rate: ${formatRate(report.mutualDiagnosisTagConsistency.rate)}`,
    `- Comparisons: ${report.mutualDiagnosisTagConsistency.matchingComparisons}/${report.mutualDiagnosisTagConsistency.totalComparisons}`,
    "",
    "| Case | Matching | Total | Rate |",
    "|---|---:|---:|---:|",
    ...report.mutualDiagnosisTagConsistency.perCase.map(
      (item) =>
        `| ${item.caseId} | ${item.matchingComparisons} | ${item.totalComparisons} | ${formatRate(item.rate)} |`,
    ),
    "",
    "## Observability Sample Counts",
    "",
    "| Arm | Review paths | Chat paths | LLM calls | Tool calls | Warnings |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.armNames.map((armName) => {
      const arm = report.arms[armName];
      const counts = arm.observabilitySampleCounts;
      return `| ${armName} | ${counts.reviewPathCount} | ${counts.chatPathCount} | ${counts.llmCallCount} | ${counts.toolCallCount} | ${arm.warnings.length} |`;
    }),
    "",
    "## Failed Runs",
    "",
    ...(report.failedRuns.length > 0
      ? [
          "| Arm | Case | Repeat | Message |",
          "|---|---|---:|---|",
          ...report.failedRuns.map(
            (run) =>
              `| ${run.arm} | ${run.caseId} | ${run.repeatIndex} | ${escapePipe(run.message)} |`,
          ),
        ]
      : ["- None"]),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length > 0
      ? report.warnings.map((warning) => `- ${warning}`)
      : ["- None"]),
    "",
  ].join("\n");
}

function formatMs(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)} ms` : "n/a";
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|");
}

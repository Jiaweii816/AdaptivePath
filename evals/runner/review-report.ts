import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type { ReviewSuiteScore } from "./review-metrics";

export const REVIEW_SUITE_NAME = "review";

export const REVIEW_SUITE_LIMITATIONS = [
  "Review datasets use replay-backed visible execution evidence; they do not claim hidden-test acceptance or LeetCode Accepted.",
  "Golden labels were agent-drafted and must be human-reviewed before being treated as final ground truth.",
  "Evidence-grounded reply scoring is deterministic substring matching against marked evidence fields; it is not an LLM judge.",
  "Results should be interpreted with the dataset's stated case count, source mix, bucket sizes, and limitations.",
];

export type ReviewSuiteRunResult = {
  caseId: string;
  repeatIndex: number;
  traceRunId: string;
  bugCategory: string;
  predictedTags: string[];
  goldenTags: string[];
  coachReplyLength: number;
  degraded: boolean;
  totalMs: number;
  llmMsTotal: number;
  evidenceGrounded: boolean;
  matchedEvidenceMarkers: string[];
};

export type ReviewSuiteFailedRun = {
  caseId: string;
  repeatIndex: number;
  message: string;
};

export type ReviewSuiteReport = {
  suiteName: typeof REVIEW_SUITE_NAME;
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
    sources: Record<string, number>;
    bucketCaseCounts: Record<string, number>;
    humanApprovedCount: number;
    humanReviewPendingCount: number;
    humanRejectedCount: number;
  };
  backgroundJobsPolicy: string;
  traceOptions: {
    enabled: boolean;
  };
  successfulRunCount: number;
  failedRunCount: number;
  score: ReviewSuiteScore;
  observability: {
    sampleCounts: AgentObservabilityReport["sampleCounts"];
    providerUsage: AgentObservabilityReport["providerUsage"];
    review: {
      count: number;
      traceRunCount: number;
      llmCallCount: number;
      tokens: AgentObservabilityReport["review"]["tokens"];
      latency: AgentObservabilityReport["review"]["latency"];
    };
    warningCount: number;
    warnings: string[];
  };
  runs: ReviewSuiteRunResult[];
  failedRuns: ReviewSuiteFailedRun[];
  limitations: string[];
  warnings: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function writeReviewSuiteReport(report: ReviewSuiteReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(report.reportPaths.markdown, renderReviewSuiteMarkdown(report), "utf8");
  writeFileSync(report.reportPaths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderReviewSuiteMarkdown(report: ReviewSuiteReport) {
  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Suite name: ${report.suiteName}`,
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Eval DB path: ${report.dbPath}`,
    `- Explicit --db: ${report.dbExplicit ? "yes" : "no"}`,
    `- DB kept: ${report.dbKept ? "yes" : "no"}`,
    `- Repeats: ${report.repeats}`,
    `- Case count: ${report.dataset.caseCount}`,
    `- Successful run count: ${report.successfulRunCount}`,
    `- Failed run count: ${report.failedRunCount}`,
    `- Provider usage missing rate: ${formatUsageMissing(report)}`,
    `- Dataset: ${report.dataset.name} (${report.dataset.version}; ${report.dataset.status})`,
    `- Source counts: ${formatRecord(report.dataset.sources)}`,
    `- Human-approved cases: ${report.dataset.humanApprovedCount}/${report.dataset.caseCount}`,
    `- Golden labels pending human review: ${report.dataset.humanReviewPendingCount}`,
    `- Rejected cases: ${report.dataset.humanRejectedCount}`,
    "",
    "## Diagnosis Tag Micro-F1",
    "",
    report.dataset.humanReviewPendingCount > 0
      ? "This is an agent-drafted baseline: some or all golden labels are still pending human review, and tag canonicalization must remain audit-owned."
      : "This report is using human-approved Review labels. Tag canonicalization is still deterministic and audit-owned.",
    "",
    "| Precision | Recall | F1 | TP | FP | FN | Scored runs |",
    "|---:|---:|---:|---:|---:|---:|---:|",
    `| ${formatRate(report.score.micro.precision)} | ${formatRate(report.score.micro.recall)} | ${formatRate(report.score.micro.f1)} | ${report.score.micro.truePositives} | ${report.score.micro.falsePositives} | ${report.score.micro.falseNegatives} | ${report.score.scoredRunCount} |`,
    "",
    "## Per Bug Category",
    "",
    "| Bug category | Runs | Precision | Recall | F1 | TP | FP | FN |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.score.perBugCategory.map(
      (item) =>
        `| ${item.bugCategory} | ${item.runCount} | ${formatRate(item.precision)} | ${formatRate(item.recall)} | ${formatRate(item.f1)} | ${item.truePositives} | ${item.falsePositives} | ${item.falseNegatives} |`,
    ),
    "",
    "## Bucket Sample Sizes",
    "",
    "| Bug category | Cases | Repeated runs | Limitations |",
    "|---|---:|---:|---|",
    ...Object.entries(report.dataset.bucketCaseCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bugCategory, caseCount]) => {
        const runCount =
          report.score.perBugCategory.find((item) => item.bugCategory === bugCategory)
            ?.runCount ?? 0;
        return `| ${bugCategory} | ${caseCount} | ${runCount} | replay evidence only; labels pending human review; bucket is diagnostic until approved |`;
      }),
    "",
    "## Evidence-Grounded Reply Rate",
    "",
    `- Rate: ${formatRate(report.score.evidenceGrounded.rate)}`,
    `- Grounded replies: ${report.score.evidenceGrounded.groundedCount}/${report.score.evidenceGrounded.total}`,
    "- Scoring: deterministic marker matching against case `expectedEvidenceMarkers`; no LLM judge.",
    "",
    "## Per Case Runs",
    "",
    "| Case | Repeat | Bug category | Golden tags | Raw predicted tags | Canonical predicted tags | F1 | Evidence grounded | Matched evidence markers |",
    "|---|---:|---|---|---|---|---:|---|---|",
    ...report.score.cases.map(
      (item) =>
        `| ${item.caseId} | ${item.repeatIndex} | ${item.bugCategory} | ${item.goldenTags.join(", ")} | ${item.rawPredictedTags.join(", ") || "-"} | ${item.predictedTags.join(", ") || "-"} | ${formatRate(item.f1)} | ${item.evidenceGrounded ? "yes" : "no"} | ${item.matchedEvidenceMarkers.join(", ") || "-"} |`,
    ),
    "",
    "## Observability",
    "",
    `- Review path count: ${report.observability.sampleCounts.reviewPathCount}`,
    `- LLM call count: ${report.observability.sampleCounts.llmCallCount}`,
    `- Total input tokens: ${report.observability.review.tokens.inputTokens.total}`,
    `- Total output tokens: ${report.observability.review.tokens.outputTokens.total}`,
    `- Estimated provider cost: ${formatUsd(report.observability.review.tokens.estimatedCostUsd)}`,
    `- Total latency p50/p95: ${formatMs(report.observability.review.latency.totalMs.p50Ms)} / ${formatMs(report.observability.review.latency.totalMs.p95Ms)}`,
    "",
    "## Failed Runs",
    "",
    ...(report.failedRuns.length > 0
      ? [
          "| Case | Repeat | Message |",
          "|---|---:|---|",
          ...report.failedRuns.map(
            (run) =>
              `| ${run.caseId} | ${run.repeatIndex} | ${escapePipe(run.message)} |`,
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

function formatUsageMissing(report: ReviewSuiteReport) {
  const total = report.observability.sampleCounts.llmCallCount;
  const missing = report.observability.providerUsage.missingCount;
  return `${missing}/${total} (${formatRate(report.observability.providerUsage.missingRate)})`;
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function formatMs(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)} ms` : "n/a";
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|");
}

function formatRecord(value: Record<string, number>) {
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return entries.length > 0
    ? entries.map(([key, count]) => `${key}=${count}`).join(", ")
    : "none";
}

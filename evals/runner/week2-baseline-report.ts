import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const WEEK2_BASELINE_SUITE_NAME = "week2-baseline";

export type RollupSourceStatus = "present" | "missing" | "deferred";

export type RollupMetric = {
  label: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  status: "core" | "diagnostic" | "deferred" | "missing";
  note?: string;
};

export type RollupSuiteSummary = {
  suiteName: string;
  status: RollupSourceStatus;
  reportPath?: string;
  jsonPath?: string;
  generatedAt?: string;
  caseCount?: number;
  repeats?: number;
  failedRunCount?: number;
  metrics: RollupMetric[];
  notes: string[];
};

export type WorstBucket = {
  suiteName: string;
  bucket: string;
  metric: string;
  value: number | null;
  sampleSize: number;
  note: string;
};

export type Week2BaselineReport = {
  suiteName: typeof WEEK2_BASELINE_SUITE_NAME;
  runId: string;
  generatedAt: string;
  reportDir: string;
  dbKept: false;
  summaries: {
    review: RollupSuiteSummary;
    trajectory: RollupSuiteSummary;
    safety: RollupSuiteSummary;
    reviewComparison: RollupSuiteSummary;
  };
  worstBuckets: WorstBucket[];
  limitations: string[];
  warnings: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function writeWeek2BaselineReport(report: Week2BaselineReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(
    report.reportPaths.markdown,
    renderWeek2BaselineMarkdown(report),
    "utf8",
  );
  writeFileSync(
    report.reportPaths.json,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function renderWeek2BaselineMarkdown(report: Week2BaselineReport) {
  return [
    `# Eval Suite: ${report.suiteName}`,
    "",
    "## Header",
    "",
    `- Suite name: ${report.suiteName}`,
    `- Run id: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Report dir: ${report.reportDir}`,
    "",
    "## Suite Summaries",
    "",
    ...renderSummary("Review", report.summaries.review),
    "",
    ...renderSummary("Trajectory", report.summaries.trajectory),
    "",
    ...renderSummary("Safety", report.summaries.safety),
    "",
    ...renderSummary("1-call vs 2-call", report.summaries.reviewComparison),
    "",
    "## Worst Buckets",
    "",
    ...(report.worstBuckets.length > 0
      ? [
          "| Suite | Bucket | Metric | Value | Sample size | Note |",
          "|---|---|---|---:|---:|---|",
          ...report.worstBuckets.map(
            (bucket) =>
              `| ${bucket.suiteName} | ${bucket.bucket} | ${bucket.metric} | ${formatRate(bucket.value)} | ${bucket.sampleSize} | ${escapePipe(bucket.note)} |`,
          ),
        ]
      : ["- No scored bucket reports found."]),
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

function renderSummary(title: string, summary: RollupSuiteSummary) {
  return [
    `### ${title}`,
    "",
    `- Status: ${summary.status}`,
    summary.reportPath ? `- Report: ${summary.reportPath}` : "- Report: n/a",
    summary.generatedAt ? `- Generated at: ${summary.generatedAt}` : "- Generated at: n/a",
    typeof summary.caseCount === "number"
      ? `- Case count: ${summary.caseCount}`
      : "- Case count: n/a",
    typeof summary.repeats === "number" ? `- Repeats: ${summary.repeats}` : "- Repeats: n/a",
    typeof summary.failedRunCount === "number"
      ? `- Failed runs: ${summary.failedRunCount}`
      : "- Failed runs: n/a",
    "",
    "| Metric | Value | Numerator | Denominator | Status | Note |",
    "|---|---:|---:|---:|---|---|",
    ...(summary.metrics.length > 0
      ? summary.metrics.map(
          (metric) =>
            `| ${metric.label} | ${formatRate(metric.value)} | ${formatOptionalNumber(metric.numerator)} | ${formatOptionalNumber(metric.denominator)} | ${metric.status} | ${escapePipe(metric.note ?? "")} |`,
        )
      : ["| n/a | n/a | n/a | n/a | missing | No report found. |"]),
    "",
    ...(summary.notes.length > 0
      ? summary.notes.map((note) => `- ${note}`)
      : ["- No additional notes."]),
  ];
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatOptionalNumber(value: number | undefined) {
  return typeof value === "number" ? String(value) : "n/a";
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|");
}

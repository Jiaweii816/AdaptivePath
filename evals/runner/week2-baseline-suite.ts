import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { evalReportPaths } from "./report";
import {
  WEEK2_BASELINE_SUITE_NAME,
  type RollupMetric,
  type RollupSuiteSummary,
  type Week2BaselineReport,
  type WorstBucket,
  writeWeek2BaselineReport,
} from "./week2-baseline-report";

export type Week2BaselineSuiteOptions = {
  outputDir?: string;
  now?: Date;
  cwd?: string;
};

type LatestReport = {
  jsonPath: string;
  markdownPath: string;
  data: Record<string, unknown>;
};

export async function runWeek2BaselineSuite(
  options: Week2BaselineSuiteOptions = {},
): Promise<Week2BaselineReport> {
  const timestamp = options.now ?? new Date();
  const reportDir = options.outputDir ?? resolve(options.cwd ?? process.cwd(), "evals", "reports");
  const reports = loadLatestSuiteReports(reportDir);
  const review = buildReviewSummary(reports.review);
  const trajectory = buildTrajectorySummary(reports.trajectory);
  const safety = buildSafetySummary(reports.safety);
  const reviewComparison = buildReviewComparisonSummary(reports.reviewComparison);
  const worstBuckets = [
    ...worstReviewBuckets(reports.review),
    ...worstTrajectoryBuckets(reports.trajectory),
    ...worstSafetyBuckets(reports.safety),
  ].slice(0, 8);
  const warnings = [
    ...missingWarning("review", review),
    ...missingWarning("trajectory", trajectory),
    ...missingWarning("safety", safety),
    ...missingWarning("review-1call-vs-2call", reviewComparison),
    ...(worstBuckets.some((bucket) => bucket.sampleSize < 10)
      ? ["Some worst buckets have sample size < 10 and are diagnostic only."]
      : []),
  ];
  const report: Week2BaselineReport = {
    suiteName: WEEK2_BASELINE_SUITE_NAME,
    runId: `eval-${WEEK2_BASELINE_SUITE_NAME}-${randomUUID()}`,
    generatedAt: timestamp.toISOString(),
    reportDir,
    dbKept: false,
    summaries: {
      review,
      trajectory,
      safety,
      reviewComparison,
    },
    worstBuckets,
    limitations: [
      "Rollup reads the latest suite JSON reports; it does not rerun Review, Trajectory, or Safety.",
      "Missing suite reports are marked missing/deferred and no numbers are fabricated.",
      "Small v1 seed datasets are diagnostic baselines, not statistically powered product claims.",
      "1-call vs 2-call diagnosis F1 remains deferred unless the comparison suite is explicitly rescored against Review golden labels.",
      "Worst buckets with small samples are Week4 investigation inputs, not proven population-level weaknesses.",
    ],
    warnings: [...new Set(warnings)],
    reportPaths: evalReportPaths({
      suiteName: WEEK2_BASELINE_SUITE_NAME,
      timestamp,
      outputDir: options.outputDir,
    }),
  };

  writeWeek2BaselineReport(report);
  return report;
}

export function loadLatestSuiteReports(reportDir: string) {
  return {
    review: readLatestReport(reportDir, /^eval-review-\d{8}-\d{6}\.json$/),
    trajectory: readLatestReport(
      reportDir,
      /^eval-trajectory-\d{8}-\d{6}\.json$/,
    ),
    safety: readLatestReport(reportDir, /^eval-safety-\d{8}-\d{6}\.json$/),
    reviewComparison: readLatestReport(
      reportDir,
      /^eval-review-1call-vs-2call-\d{8}-\d{6}\.json$/,
    ),
  };
}

export function buildReviewSummary(report: LatestReport | null): RollupSuiteSummary {
  if (!report) {
    return missingSummary("review", "Review diagnosis F1 is missing/deferred.");
  }

  const score = asRecord(report.data.score);
  const micro = asRecord(score.micro);
  const evidence = asRecord(score.evidenceGrounded);

  return {
    suiteName: "review",
    status: "present",
    reportPath: report.markdownPath,
    jsonPath: report.jsonPath,
    generatedAt: asString(report.data.generatedAt),
    caseCount: asNumber(asRecord(report.data.dataset).caseCount),
    repeats: asNumber(report.data.repeats),
    failedRunCount: asNumber(report.data.failedRunCount),
    metrics: [
      rateMetric("diagnosis tag micro-F1", micro.f1, {
        note: "v1 seed baseline; golden labels pending human review.",
      }),
      rateMetric("diagnosis tag precision", micro.precision),
      rateMetric("diagnosis tag recall", micro.recall),
      rateMetric("evidence-grounded reply rate", evidence.rate, {
        numerator: asNumber(evidence.groundedCount),
        denominator: asNumber(evidence.total),
      }),
    ],
    notes: [
      "Review labels are agent-drafted and still require human audit before final claims.",
    ],
  };
}

export function buildTrajectorySummary(
  report: LatestReport | null,
): RollupSuiteSummary {
  if (!report) {
    return missingSummary("trajectory", "Chat trajectory metrics are missing/deferred.");
  }

  const score = asRecord(report.data.score);

  return {
    suiteName: "trajectory",
    status: "present",
    reportPath: report.markdownPath,
    jsonPath: report.jsonPath,
    generatedAt: asString(report.data.generatedAt),
    caseCount: asNumber(asRecord(report.data.dataset).caseCount),
    repeats: asNumber(report.data.repeats),
    failedRunCount: asNumber(report.data.failedRunCount),
    metrics: [
      metricFromRateCount("expected tool match rate", score.expectedToolMatch),
      rateMetric(
        "unnecessary tool-call rate",
        asRecord(score.unnecessaryToolCalls).rate,
        {
          numerator: asNumber(asRecord(score.unnecessaryToolCalls).unnecessaryCount),
          denominator: asNumber(asRecord(score.unnecessaryToolCalls).totalToolCallCount),
        },
      ),
      rateMetric("invalid args rate", asRecord(score.invalidArgs).rate, {
        numerator: asNumber(asRecord(score.invalidArgs).invalidArgsCount),
        denominator: asNumber(asRecord(score.invalidArgs).totalToolResultCount),
      }),
      metricFromRateCount(
        "multi-step subsequence match rate",
        score.multiStepSubsequenceMatch,
      ),
      metricFromRateCount("wrong-order rate", score.wrongOrder),
      metricFromRateCount(
        "tool-result integration rate",
        score.toolResultIntegration,
      ),
    ],
    notes: [
      "Trajectory truth is agent-drafted and still requires human audit.",
    ],
  };
}

export function buildSafetySummary(report: LatestReport | null): RollupSuiteSummary {
  if (!report) {
    return missingSummary("safety", "Safety metrics are missing/deferred.");
  }

  const score = asRecord(report.data.score);
  const prohibited = asRecord(score.prohibitedClaims);
  const leakage = asRecord(score.unrequestedFullCode);

  return {
    suiteName: "safety",
    status: "present",
    reportPath: report.markdownPath,
    jsonPath: report.jsonPath,
    generatedAt: asString(report.data.generatedAt),
    caseCount: asNumber(asRecord(report.data.dataset).caseCount),
    repeats: asNumber(report.data.repeats),
    failedRunCount: asNumber(report.data.failedRunCount),
    metrics: [
      rateMetric("prohibited claim rate", prohibited.rate, {
        numerator: asNumber(prohibited.claimCount),
        denominator: asNumber(prohibited.totalRunCount),
      }),
      metricFromRateCount("injection pass rate", score.injectionPass),
      metricFromRateCount(
        "code-disclosure adherence",
        score.codeDisclosureAdherence,
      ),
      rateMetric("unrequested full-code leakage rate", leakage.rate, {
        numerator: asNumber(leakage.leakageCount),
        denominator: asNumber(leakage.guidedRunCount),
        status: "core",
        note: "deterministic fenced target-implementation scorer",
      }),
    ],
    notes: [
      "Safety truth is agent-drafted and still requires human audit.",
    ],
  };
}

export function buildReviewComparisonSummary(
  report: LatestReport | null,
): RollupSuiteSummary {
  if (!report) {
    return missingSummary(
      "review-1call-vs-2call",
      "1-call vs 2-call comparison report is missing.",
    );
  }

  const consistency = asRecord(report.data.mutualDiagnosisTagConsistency);

  return {
    suiteName: "review-1call-vs-2call",
    status: "present",
    reportPath: report.markdownPath,
    jsonPath: report.jsonPath,
    generatedAt: asString(report.data.generatedAt),
    caseCount: asNumber(report.data.caseCount),
    repeats: asNumber(report.data.repeats),
    failedRunCount: asArray(report.data.failedRuns).length,
    metrics: [
      rateMetric("mutual diagnosis tag consistency", consistency.rate, {
        numerator: asNumber(consistency.matchingComparisons),
        denominator: asNumber(consistency.totalComparisons),
        status: "diagnostic",
        note: "stability/consistency only, not accuracy",
      }),
      {
        label: "1-call vs 2-call diagnosis F1",
        value: null,
        status: "deferred",
        note: "requires rescoring both arms against Review golden labels",
      },
    ],
    notes: [
      "Quality F1 comparison is deferred; Task1D report did not include golden-label scoring.",
    ],
  };
}

function readLatestReport(reportDir: string, pattern: RegExp): LatestReport | null {
  if (!existsSync(reportDir)) {
    return null;
  }

  const candidates = readdirSync(reportDir)
    .filter((name) => pattern.test(name))
    .map((name) => resolve(reportDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  for (const jsonPath of candidates) {
    try {
      const data = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      return {
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
        data,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function worstReviewBuckets(report: LatestReport | null): WorstBucket[] {
  const categories = asArray(asRecord(report?.data.score).perBugCategory);
  return categories
    .map((item) => {
      const value = asRecord(item);
      const runCount = asNumber(value.runCount) ?? 0;
      return {
        suiteName: "review",
        bucket: asString(value.bugCategory) ?? "unknown",
        metric: "bug-category F1",
        value: asNumber(value.f1) ?? null,
        sampleSize: runCount,
        note: smallSampleNote(runCount),
      };
    })
    .sort(compareWorstBuckets)
    .slice(0, 3);
}

function worstTrajectoryBuckets(report: LatestReport | null): WorstBucket[] {
  const categories = asArray(asRecord(report?.data.score).perCategory);
  return categories
    .map((item) => {
      const value = asRecord(item);
      const match = asRecord(value.expectedToolMatch);
      const runCount = asNumber(value.runCount) ?? 0;
      return {
        suiteName: "trajectory",
        bucket: asString(value.category) ?? "unknown",
        metric: "expected tool match",
        value: asNumber(match.rate) ?? null,
        sampleSize: runCount,
        note: smallSampleNote(runCount),
      };
    })
    .sort(compareWorstBuckets)
    .slice(0, 3);
}

function worstSafetyBuckets(report: LatestReport | null): WorstBucket[] {
  const categories = asArray(asRecord(report?.data.score).perCategory);
  return categories
    .map((item) => {
      const value = asRecord(item);
      const pass = asRecord(value.safetyPass);
      const runCount = asNumber(value.runCount) ?? 0;
      return {
        suiteName: "safety",
        bucket: asString(value.category) ?? "unknown",
        metric: "safety pass",
        value: asNumber(pass.rate) ?? null,
        sampleSize: runCount,
        note: smallSampleNote(runCount),
      };
    })
    .sort(compareWorstBuckets)
    .slice(0, 3);
}

function missingSummary(suiteName: string, note: string): RollupSuiteSummary {
  return {
    suiteName,
    status: "missing",
    metrics: [],
    notes: [note],
  };
}

function missingWarning(name: string, summary: RollupSuiteSummary) {
  return summary.status === "present" ? [] : [`${name} report is ${summary.status}.`];
}

function rateMetric(
  label: string,
  value: unknown,
  options: {
    numerator?: number;
    denominator?: number;
    status?: RollupMetric["status"];
    note?: string;
  } = {},
): RollupMetric {
  return {
    label,
    value: asNumber(value) ?? null,
    numerator: options.numerator,
    denominator: options.denominator,
    status: options.status ?? "core",
    note: options.note,
  };
}

function metricFromRateCount(label: string, value: unknown): RollupMetric {
  const record = asRecord(value);
  return rateMetric(label, record.rate, {
    numerator: asNumber(record.numerator),
    denominator: asNumber(record.denominator),
  });
}

function compareWorstBuckets(left: WorstBucket, right: WorstBucket) {
  const leftValue = left.value ?? Number.POSITIVE_INFINITY;
  const rightValue = right.value ?? Number.POSITIVE_INFINITY;
  return leftValue - rightValue || left.sampleSize - right.sampleSize;
}

function smallSampleNote(sampleSize: number) {
  return sampleSize < 10 ? "sample too small / diagnostic only" : "candidate Week4 optimization input";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type { TrajectorySuiteScore } from "./trajectory-metrics";

export const TRAJECTORY_SUITE_NAME = "trajectory";

export const TRAJECTORY_SUITE_LIMITATIONS = [
  "The default trajectory-v2 dataset is a human-approved P2 natural-intent benchmark; check the report header for any pending review labels when using an overridden dataset.",
  "When overriding the suite with trajectory-v1, treat it as an explicit-instruction seed baseline rather than an intent-routing benchmark.",
  "Trajectory scores measure PatternCoach's bounded Chat system behavior: deterministic intent policy plus real LLM tool loop, not raw model-only ability.",
  "Explicit-instruction and natural-intent cases are reported separately because explicit tool naming tests instruction following more than intent routing.",
  "run_current_code uses replayed CodeRunResult fixtures in eval; it does not prove Piston or LeetCode runner availability.",
  "Integration markers are deterministic string/regex checks and do not measure full semantic understanding.",
  "The default trajectory-v2 dataset scores past_mistake_recall and past_problem_recall as separate atomic intents; only an explicit compound history case requires both.",
];

export type TrajectorySuiteFailedRun = {
  caseId: string;
  repeatIndex: number;
  category: string;
  message: string;
};

export type TrajectorySuiteRunResult = {
  caseId: string;
  repeatIndex: number;
  category: string;
  chatSessionId: string;
  traceRunId: string | null;
  toolCalls: string[];
  toolResults: Array<{
    toolName: string;
    status: string;
    errorKind: string | null;
  }>;
  finalReplyLength: number;
  failed: boolean;
};

export type TrajectorySuiteReport = {
  suiteName: typeof TRAJECTORY_SUITE_NAME;
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
    categoryCounts: Record<string, number>;
    intentStyleCounts: Record<string, number>;
    humanReviewPendingCount: number;
  };
  backgroundJobsPolicy: string;
  traceOptions: {
    enabled: boolean;
  };
  successfulRunCount: number;
  failedRunCount: number;
  score: TrajectorySuiteScore;
  observability: {
    sampleCounts: AgentObservabilityReport["sampleCounts"];
    providerUsage: AgentObservabilityReport["providerUsage"];
    chat: {
      count: number;
      traceRunCount: number;
      llmCallCount: number;
      tokens: AgentObservabilityReport["chat"]["tokens"];
      latency: AgentObservabilityReport["chat"]["latency"];
      toolCallsPerChat: number | null | undefined;
    };
    toolCalls: AgentObservabilityReport["toolCalls"];
    warningCount: number;
    warnings: string[];
  };
  runs: TrajectorySuiteRunResult[];
  failedRuns: TrajectorySuiteFailedRun[];
  limitations: string[];
  warnings: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function writeTrajectorySuiteReport(report: TrajectorySuiteReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(
    report.reportPaths.markdown,
    renderTrajectorySuiteMarkdown(report),
    "utf8",
  );
  writeFileSync(
    report.reportPaths.json,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function renderTrajectorySuiteMarkdown(report: TrajectorySuiteReport) {
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
    `- Trajectory labels pending human review: ${report.dataset.humanReviewPendingCount}`,
    `- Intent style counts: ${Object.entries(report.dataset.intentStyleCounts).map(([name, count]) => `${name}=${count}`).join(", ") || "n/a"}`,
    "",
    "## Core Metrics",
    "",
    "These metrics measure the bounded PatternCoach Chat system: deterministic intent policy plus the real LLM tool loop. Use the natural-intent bucket for intent-routing claims; explicit-instruction cases are instruction-following baselines.",
    "",
    "| Metric | Value | Numerator | Denominator |",
    "|---|---:|---:|---:|",
    metricRow("expected tool match rate", report.score.expectedToolMatch),
    `| unnecessary tool-call rate | ${formatRateNumber(report.score.unnecessaryToolCalls.rate)} | ${report.score.unnecessaryToolCalls.unnecessaryCount} | ${report.score.unnecessaryToolCalls.totalToolCallCount} |`,
    `| invalid args rate | ${formatRateNumber(report.score.invalidArgs.rate)} | ${report.score.invalidArgs.invalidArgsCount} | ${report.score.invalidArgs.totalToolResultCount} |`,
    metricRow("multi-step subsequence match rate", report.score.multiStepSubsequenceMatch),
    metricRow("multi-step exact match rate", report.score.multiStepExactMatch),
    metricRow("wrong-order rate", report.score.wrongOrder),
    metricRow("tool-result integration rate", report.score.toolResultIntegration),
    "",
    "## Per Category",
    "",
    "| Category | Runs | Expected match | Integration | Unnecessary tools | Invalid args |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.score.perCategory.map(
      (item) =>
        `| ${item.category} | ${item.runCount} | ${formatRate(item.expectedToolMatch.rate)} | ${formatRate(item.toolResultIntegration.rate)} | ${formatRateNumber(item.unnecessaryToolCallRate)} | ${formatRateNumber(item.invalidArgsRate)} |`,
    ),
    "",
    "## Per Intent Style",
    "",
    "| Intent style | Runs | Expected match | Integration | Unnecessary tools | Invalid args |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.score.perIntentStyle.map(
      (item) =>
        `| ${item.intentStyle} | ${item.runCount} | ${formatRate(item.expectedToolMatch.rate)} | ${formatRate(item.toolResultIntegration.rate)} | ${formatRateNumber(item.unnecessaryToolCallRate)} | ${formatRateNumber(item.invalidArgsRate)} |`,
    ),
    "",
    "## Per Case Runs",
    "",
    "| Case | Repeat | Category | Intent style | Expected | Either-or groups | Optional | Forbidden | Ordered | Actual calls | Match | Integrated | Markers |",
    "|---|---:|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.score.cases.map(
      (item) =>
        `| ${item.caseId} | ${item.repeatIndex} | ${item.category} | ${item.intentStyle} | ${item.expectedTools.join(", ") || "-"} | ${item.expectedToolGroups.map((group) => `${group.label}=${group.anyOf.join("/")}`).join(", ") || "-"} | ${item.optionalTools.join(", ") || "-"} | ${item.forbiddenTools.join(", ") || "-"} | ${item.orderedSubsequenceLabels.join(" -> ") || "-"} | ${item.toolCalls.join(" -> ") || "-"} | ${item.expectedToolMatch ? "yes" : "no"} | ${item.integrationEligible ? (item.toolResultIntegrated ? "yes" : "no") : "n/a"} | ${item.matchedIntegrationMarkers.join(", ") || "-"} |`,
    ),
    "",
    "## Observability",
    "",
    `- Chat path count: ${report.observability.sampleCounts.chatPathCount}`,
    `- LLM call count: ${report.observability.sampleCounts.llmCallCount}`,
    `- Tool call count: ${report.observability.sampleCounts.toolCallCount}`,
    `- Avg tool calls per linked chat: ${formatNullableNumber(report.observability.chat.toolCallsPerChat)}`,
    `- Total input tokens: ${report.observability.chat.tokens.inputTokens.total}`,
    `- Total output tokens: ${report.observability.chat.tokens.outputTokens.total}`,
    `- Estimated provider cost: ${formatUsd(report.observability.chat.tokens.estimatedCostUsd)}`,
    `- Total latency p50/p95: ${formatMs(report.observability.chat.latency.totalMs.p50Ms)} / ${formatMs(report.observability.chat.latency.totalMs.p95Ms)}`,
    "",
    "## Failed Runs",
    "",
    ...(report.failedRuns.length > 0
      ? [
          "| Case | Repeat | Category | Message |",
          "|---|---:|---|---|",
          ...report.failedRuns.map(
            (run) =>
              `| ${run.caseId} | ${run.repeatIndex} | ${run.category} | ${escapePipe(run.message)} |`,
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

function metricRow(label: string, value: { numerator: number; denominator: number; rate: number | null }) {
  return `| ${label} | ${formatRate(value.rate)} | ${value.numerator} | ${value.denominator} |`;
}

function formatUsageMissing(report: TrajectorySuiteReport) {
  const total = report.observability.sampleCounts.llmCallCount;
  const missing = report.observability.providerUsage.missingCount;
  return `${missing}/${total} (${formatRate(report.observability.providerUsage.missingRate)})`;
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}

function formatRateNumber(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function formatMs(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)} ms` : "n/a";
}

function formatNullableNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(2) : "n/a";
}

function escapePipe(value: string) {
  return value.replace(/\|/g, "\\|");
}

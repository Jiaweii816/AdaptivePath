import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import type { SafetySuiteScore } from "./safety-metrics";

export const SAFETY_SUITE_NAME = "safety";

export const SAFETY_SUITE_LIMITATIONS = [
  "Dataset scope and human-review status are reported in the header; agent-drafted rows must be human-reviewed before final use.",
  "Default execution evidence is replayed; the suite does not depend on Piston, Docker, LeetCode submit, or live hidden tests.",
  "Deterministic forbidden-claim patterns can false-positive or miss paraphrases.",
  "The code-disclosure scorer inspects fenced Python/C++ target implementations; unfenced code or unusually formatted signatures can escape detection.",
  "This report does not represent complete online safety coverage.",
];

export type SafetySuiteFailedRun = {
  caseId: string;
  repeatIndex: number;
  category: string;
  path: "review" | "chat";
  injectionChannel: string;
  message: string;
};

export type SafetySuiteRunResult = {
  caseId: string;
  repeatIndex: number;
  category: string;
  path: "review" | "chat";
  injectionChannel: string;
  chatSessionId: string | null;
  traceRunId: string | null;
  toolCalls: string[];
  toolResults: Array<{
    toolName: string;
    status: string;
    errorKind: string | null;
  }>;
  finalReplyLength: number;
  replySafetyReplaced: boolean;
  failed: boolean;
};

export type SafetySuiteReport = {
  suiteName: typeof SAFETY_SUITE_NAME;
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
    injectionChannelCounts: Record<string, number>;
    codeDisclosureCounts: Record<string, number>;
    humanReviewPendingCount: number;
  };
  backgroundJobsPolicy: string;
  traceOptions: {
    enabled: boolean;
  };
  successfulRunCount: number;
  failedRunCount: number;
  score: SafetySuiteScore;
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
  runs: SafetySuiteRunResult[];
  failedRuns: SafetySuiteFailedRun[];
  limitations: string[];
  warnings: string[];
  reportPaths: {
    markdown: string;
    json: string;
  };
};

export function writeSafetySuiteReport(report: SafetySuiteReport) {
  mkdirSync(dirname(report.reportPaths.markdown), { recursive: true });
  writeFileSync(report.reportPaths.markdown, renderSafetySuiteMarkdown(report), "utf8");
  writeFileSync(report.reportPaths.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function renderSafetySuiteMarkdown(report: SafetySuiteReport) {
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
    `- Safety labels pending human review: ${report.dataset.humanReviewPendingCount}`,
    `- Code disclosure cases: ${Object.entries(report.dataset.codeDisclosureCounts).map(([level, count]) => `${level}=${count}`).join(", ")}`,
    "",
    "## Core Metrics",
    "",
    "| Metric | Value | Numerator | Denominator | Status |",
    "|---|---:|---:|---:|---|",
    `| prohibited claim rate | ${formatRateNumber(report.score.prohibitedClaims.rate)} | ${report.score.prohibitedClaims.claimCount} | ${report.score.prohibitedClaims.totalRunCount} | deterministic |`,
    metricRow("injection pass rate", report.score.injectionPass, "deterministic"),
    metricRow(
      "code-disclosure adherence",
      report.score.codeDisclosureAdherence,
      "deterministic_structural_v1",
    ),
    `| unrequested full-code leakage rate | ${formatRateNumber(report.score.unrequestedFullCode.rate)} | ${report.score.unrequestedFullCode.leakageCount} | ${report.score.unrequestedFullCode.guidedRunCount} | deterministic_structural_v1 |`,
    metricRow("evidence-boundary adherence", report.score.evidenceBoundaryAdherence, "deterministic"),
    "",
    "## Injection Pass By Channel",
    "",
    "| Channel | Pass rate | Passing | Total |",
    "|---|---:|---:|---:|",
    ...report.score.injectionPassByChannel.map(
      (item) =>
        `| ${item.channel} | ${formatRate(item.pass.rate)} | ${item.pass.numerator} | ${item.pass.denominator} |`,
    ),
    "",
    "## Per Category",
    "",
    "| Category | Runs | Safety pass | Injection pass | Prohibited claims | Unrequested full code |",
    "|---|---:|---:|---:|---:|---:|",
    ...report.score.perCategory.map(
      (item) =>
        `| ${item.category} | ${item.runCount} | ${formatRate(item.safetyPass.rate)} | ${formatRate(item.injectionPass.rate)} | ${formatRateNumber(item.prohibitedClaimRate)} | ${formatRateNumber(item.unrequestedFullCodeRate)} |`,
    ),
    "",
    "## Per Case Verdicts",
    "",
    "| Case | Repeat | Path | Category | Channel | Disclosure | Safety | Injection | Prohibited | Unrequested full code | Boundary | Tools | Markers | Reasons |",
    "|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...report.score.cases.map(
      (item) =>
        `| ${item.caseId} | ${item.repeatIndex} | ${item.path} | ${item.category} | ${item.injectionChannel} | ${item.codeDisclosure} | ${item.safetyPassed ? "pass" : "fail"} | ${formatNullableBool(item.injectionPassed)} | ${item.prohibitedClaim ? "yes" : "no"} | ${item.unrequestedFullCode ? "yes" : "no"} | ${item.evidenceBoundaryAdhered ? "yes" : "no"} | ${item.expectedToolCalls.join(", ") || "-"} | ${item.matchedAllowedEvidenceMarkers.join(", ") || "-"} | ${item.failureReasons.map(escapePipe).join("; ") || "-"} |`,
    ),
    "",
    "## Observability",
    "",
    `- Review path count: ${report.observability.sampleCounts.reviewPathCount}`,
    `- Chat path count: ${report.observability.sampleCounts.chatPathCount}`,
    `- LLM call count: ${report.observability.sampleCounts.llmCallCount}`,
    `- Tool call count: ${report.observability.sampleCounts.toolCallCount}`,
    `- Reply safety replacements observed: ${report.runs.filter((run) => run.replySafetyReplaced).length}`,
    `- Review total input/output tokens: ${report.observability.review.tokens.inputTokens.total} / ${report.observability.review.tokens.outputTokens.total}`,
    `- Chat total input/output tokens: ${report.observability.chat.tokens.inputTokens.total} / ${report.observability.chat.tokens.outputTokens.total}`,
    `- Estimated provider cost: ${formatUsd(report.observability.review.tokens.estimatedCostUsd + report.observability.chat.tokens.estimatedCostUsd)}`,
    `- Review total latency p50/p95: ${formatMs(report.observability.review.latency.totalMs.p50Ms)} / ${formatMs(report.observability.review.latency.totalMs.p95Ms)}`,
    `- Chat total latency p50/p95: ${formatMs(report.observability.chat.latency.totalMs.p50Ms)} / ${formatMs(report.observability.chat.latency.totalMs.p95Ms)}`,
    "",
    "## Failed Runs",
    "",
    ...(report.failedRuns.length > 0
      ? [
          "| Case | Repeat | Path | Category | Channel | Message |",
          "|---|---:|---|---|---|---|",
          ...report.failedRuns.map(
            (run) =>
              `| ${run.caseId} | ${run.repeatIndex} | ${run.path} | ${run.category} | ${run.injectionChannel} | ${escapePipe(run.message)} |`,
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

function metricRow(
  label: string,
  value: { numerator: number; denominator: number; rate: number | null },
  status: string,
) {
  return `| ${label} | ${formatRate(value.rate)} | ${value.numerator} | ${value.denominator} | ${status} |`;
}

function formatUsageMissing(report: SafetySuiteReport) {
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

function formatNullableBool(value: boolean | null) {
  if (value === null) {
    return "n/a";
  }

  return value ? "pass" : "fail";
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

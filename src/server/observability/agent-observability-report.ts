import type {
  AgentObservabilityReport,
  LatencySummary,
  NumericTotalAvg,
  PathSummary,
} from "./agent-observability";

export function renderAgentObservabilityMarkdown(
  report: AgentObservabilityReport,
): string {
  return [
    "# Agent Observability Report",
    "",
    "## Header",
    "",
    `- DB path: ${report.db.path}`,
    `- Explicit --db: ${report.db.explicit ? "yes" : "no"}`,
    `- Time window: ${formatTimeWindow(report.timeWindow.start, report.timeWindow.end)}`,
    `- Review path count: ${report.sampleCounts.reviewPathCount}`,
    `- Chat path count: ${report.sampleCounts.chatPathCount}`,
    `- LLM call count: ${report.sampleCounts.llmCallCount}`,
    `- Tool call count: ${report.sampleCounts.toolCallCount}`,
    `- Provider usage missing rate: ${formatCountRate(
      report.providerUsage.missingCount,
      report.providerUsage.missingRate,
      report.sampleCounts.llmCallCount,
    )}`,
    `- Generated at: ${report.generatedAt}`,
    "",
    renderWarnings(report.warnings),
    renderPathSummary(report.review),
    renderPathSummary(report.chat),
    renderLlmGroups(report),
    renderToolGroups(report),
    renderPricing(report),
  ].join("\n");
}

export function renderAgentObservabilityJson(
  report: AgentObservabilityReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function renderWarnings(warnings: string[]) {
  if (warnings.length === 0) {
    return "## Warnings\n\n- None\n";
  }

  return ["## Warnings", "", ...warnings.map((warning) => `- ${warning}`), ""].join(
    "\n",
  );
}

function renderPathSummary(summary: PathSummary) {
  const runnerOrTool = summary.path === "review" ? "runnerMs" : "toolMsTotal";
  const runnerOrToolLatency =
    summary.path === "review"
      ? summary.latency.runnerMs
      : summary.latency.toolMsTotal;

  return [
    `## ${capitalize(summary.path)} Path`,
    "",
    `- Count: ${summary.count}`,
    `- Trace runs linked: ${summary.traceRunCount}`,
    `- Missing traceRunId rows: ${summary.missingTraceRunIdCount}`,
    `- LLM calls linked by traceRunId: ${summary.llmCallCount}`,
    ...(summary.path === "chat"
      ? [
          `- Avg tool calls per linked chat: ${formatNumber(summary.toolCallsPerChat)}`,
        ]
      : []),
    "",
    "| Metric | p50 | p95 | Missing |",
    "|---|---:|---:|---:|",
    latencyRow("totalMs", summary.latency.totalMs),
    latencyRow("llmMsTotal", summary.latency.llmMsTotal),
    latencyRow(runnerOrTool, runnerOrToolLatency),
    "",
    "| Tokens/Cost | Total | Avg per usage-present LLM call |",
    "|---|---:|---:|",
    tokenRow("inputTokens", summary.tokens.inputTokens),
    tokenRow("outputTokens", summary.tokens.outputTokens),
    tokenRow("totalTokens", summary.tokens.totalTokens),
    `| estimatedCostUsd | ${formatUsd(summary.tokens.estimatedCostUsd)} | |`,
    `| usageMissing | ${summary.tokens.usageMissingCount}/${summary.tokens.usagePresentCount + summary.tokens.usageMissingCount} | ${formatPercent(summary.tokens.usageMissingRate)} |`,
    `| unpricedUsageCalls | ${summary.tokens.unpricedUsageCount} | |`,
    "",
  ].join("\n");
}

function renderLlmGroups(report: AgentObservabilityReport) {
  const rows = report.llmCalls.map((group) =>
    [
      group.path,
      group.task,
      group.model,
      group.responseModel,
      group.status,
      String(group.count),
      formatMs(group.latencyMs.p50Ms),
      formatMs(group.latencyMs.p95Ms),
      String(group.tokens.inputTokens.total),
      String(group.tokens.outputTokens.total),
      String(group.tokens.totalTokens.total),
      formatPercent(group.tokens.usageMissingRate),
      JSON.stringify(group.usageSourceBreakdown),
      String(group.errorCount),
      group.topErrors.map((error) => `${error.key} (${error.count})`).join("; ") || "-",
    ].join(" | "),
  );

  return [
    "## LLM Calls",
    "",
    "| path | task | model | responseModel | status | count | p50 latency | p95 latency | input | output | total tokens | usage missing | usageSource | errors | top errors |",
    "|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|",
    ...rows.map((row) => `| ${row} |`),
    ...(rows.length === 0 ? ["| - | - | - | - | - | 0 | - | - | 0 | 0 | 0 | - | {} | 0 | - |"] : []),
    "",
  ].join("\n");
}

function renderToolGroups(report: AgentObservabilityReport) {
  const rows = report.toolCalls.map((group) =>
    [
      group.toolName,
      String(group.callCount),
      String(group.successCount),
      String(group.errorCount),
      JSON.stringify(group.errorKindBreakdown),
      formatMs(group.latencyMs.p50Ms),
      formatMs(group.latencyMs.p95Ms),
      formatNumber(group.avgApproxResultTokens),
      `${group.invalidArgsCount} (${formatPercent(group.invalidArgsRate)})`,
    ].join(" | "),
  );

  return [
    "## Tool Calls/Results",
    "",
    "| toolName | calls | success | error | errorKind | p50 latency | p95 latency | avg approxResultTokens | invalid args |",
    "|---|---:|---:|---:|---|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row} |`),
    ...(rows.length === 0 ? ["| - | 0 | 0 | 0 | {} | - | - | - | 0 (-) |"] : []),
    "",
  ].join("\n");
}

function renderPricing(report: AgentObservabilityReport) {
  return [
    "## Pricing Constants",
    "",
    "| provider | models | input USD/1M | output USD/1M | basis |",
    "|---|---|---:|---:|---|",
    ...report.pricing.map(
      (pricing) =>
        `| ${pricing.provider} | ${pricing.modelIds.join(", ")} | ${pricing.inputUsdPerMillion} | ${pricing.outputUsdPerMillion} | ${pricing.pricingBasis} |`,
    ),
    "",
  ].join("\n");
}

function latencyRow(label: string, latency: LatencySummary | undefined) {
  if (!latency) {
    return `| ${label} | - | - | - |`;
  }

  return `| ${label} | ${formatMs(latency.p50Ms)} | ${formatMs(latency.p95Ms)} | ${latency.missingCount} |`;
}

function tokenRow(label: string, value: NumericTotalAvg) {
  return `| ${label} | ${formatInteger(value.total)} | ${formatNumber(value.avg)} |`;
}

function formatTimeWindow(start: string | null, end: string | null) {
  if (!start || !end) {
    return "no matching L1 rows";
  }

  return `${start} to ${end}`;
}

function formatCountRate(count: number, rate: number | null, denominator: number) {
  return `${count}/${denominator} (${formatPercent(rate)})`;
}

function formatMs(value: number | null) {
  return value === null ? "-" : `${Math.round(value)} ms`;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "-";
}

function formatInteger(value: number) {
  return Math.round(value).toString();
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number) {
  return `$${value.toFixed(6)}`;
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

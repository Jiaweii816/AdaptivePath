export type RuntimeTracePricingStatus =
  | "priced"
  | "partial"
  | "unpriced"
  | "not_applicable";

export type RuntimeTracePayloadState =
  | "captured"
  | "full"
  | "summary_only"
  | "partially_pruned"
  | "pruned"
  | "unavailable";

export type RuntimeTraceMetricsSession = {
  startedAt: string;
  foregroundEndedAt: string | null;
  lastActivityAt?: string | null;
};

export type RuntimeTraceMetricsRun = {
  id: string;
  path: string;
  actionKind: string | null;
  turnOrdinal: number | null;
  originatingTurnOrdinal: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerCachedTokens: number | null;
  providerReasoningTokens: number | null;
  estimatedCostUsd: number | null;
  pricingStatus: RuntimeTracePricingStatus;
  unpricedLlmCallCount: number;
  llmCallCount: number;
  toolCallCount: number;
  errorCount: number;
  traceOverheadMs: number | null;
  traceCompleteness: string;
  status: string;
};

export type RuntimeTraceMetricsEvent = {
  eventId: string;
  traceRunId: string;
  turnOrdinal: number | null;
  kind: string;
  status: string;
  memoryDelta?: unknown;
  metadata?: unknown;
  memoryRssBytes?: number | null;
  memoryHeapUsedBytes?: number | null;
  resourceScope?: "process_sample" | "unavailable" | null;
};

export type RuntimeTraceRawEvent = {
  eventId: string;
  seq: number | null;
  title: string;
  kind: string;
  status: string;
  occurredAt: string;
  payloadState: Exclude<RuntimeTracePayloadState, "full" | "partially_pruned">;
  detailLevel: "summary" | "full";
  redactedFields: string[];
  truncatedFields: string[];
  unavailableFields: string[];
  normalized: unknown;
};

export type RuntimeTraceHistorySession = {
  id: string;
  problemTitle?: string | null;
  startedAt: string;
  foregroundEndedAt: string | null;
  settledAt: string | null;
  startTrigger: string;
  foregroundStatus: "active" | "closed" | "abandoned";
  backgroundStatus: "idle" | "pending" | "settled" | "failed";
  turnCount?: number | null;
  runCount: number;
  eventCount: number;
  payloadState?: RuntimeTracePayloadState | null;
  traceCompleteness?: "complete" | "degraded" | "incomplete" | "open" | null;
};

export type RuntimeTraceTokenLedger = {
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerCachedTokens: number | null;
  providerReasoningTokens: number | null;
  usageMissingCallCount: number;
  cachedBreakdownMissingCallCount: number;
  reasoningBreakdownMissingCallCount: number;
  integrityWarnings: string[];
};

export type RuntimeTraceCostLedger = {
  knownCostUsd: number | null;
  unpricedLlmCallCount: number;
  coverage: RuntimeTracePricingStatus;
  label: string;
};

export type RuntimeTraceMemoryLedger = {
  changedStepCount: number;
  durableRowCount: number;
  addedCount: number;
  removedCount: number;
};

export type RuntimeTraceProcessSample = {
  eventId: string;
  rssBytes: number | null;
  heapUsedBytes: number | null;
};

export type RuntimeTraceMetricRow = {
  key: string;
  turnOrdinal: number | null;
  label: string;
  path: string;
  durationMs: number;
  tokens: RuntimeTraceTokenLedger;
  cost: RuntimeTraceCostLedger;
  llmCallCount: number;
  toolCallCount: number;
  errorCount: number;
  traceOverheadMs: number;
  memory: RuntimeTraceMemoryLedger;
  completeness: string;
  status: string;
};

export type RuntimeTraceMetricsViewModel = {
  visitElapsedMs: number;
  agentBusyMs: number;
  totalWorkMs: number;
  showTotalWork: boolean;
  turns: number;
  totals: RuntimeTraceMetricRow;
  turnRows: RuntimeTraceMetricRow[];
  processSamples: RuntimeTraceProcessSample[];
};

export function buildRuntimeTraceMetricsViewModel(input: {
  session: RuntimeTraceMetricsSession;
  runs: readonly RuntimeTraceMetricsRun[];
  events: readonly RuntimeTraceMetricsEvent[];
  nowMs?: number;
}): RuntimeTraceMetricsViewModel {
  const nowMs = input.nowMs ?? Date.now();
  const visitStart = timestampMs(input.session.startedAt);
  const visitEnd = input.session.foregroundEndedAt
    ? timestampMs(input.session.foregroundEndedAt)
    : nowMs;
  const foregroundRuns = input.runs.filter((run) => run.turnOrdinal !== null);
  const foregroundIntervals = foregroundRuns.map((run) => ({
    startMs: timestampMs(run.startedAt),
    endMs: run.endedAt ? timestampMs(run.endedAt) : nowMs,
  }));
  const agentBusyMs = unionIntervalDurationMs(foregroundIntervals);
  const totalWorkMs = foregroundIntervals.reduce(
    (total, interval) => total + Math.max(0, interval.endMs - interval.startMs),
    0,
  );
  const turnOrdinals = Array.from(
    new Set(foregroundRuns.map((run) => run.turnOrdinal!)),
  ).sort((left, right) => left - right);

  return {
    visitElapsedMs: Math.max(0, visitEnd - visitStart),
    agentBusyMs,
    totalWorkMs,
    showTotalWork: Math.abs(totalWorkMs - agentBusyMs) >= 1,
    turns: turnOrdinals.length,
    totals: buildMetricRow({
      key: "session",
      turnOrdinal: null,
      label: "Session total",
      path: "all paths",
      runs: input.runs,
      events: input.events,
      durationMs: totalWorkMs,
    }),
    turnRows: turnOrdinals.map((turnOrdinal) => {
      const runs = input.runs.filter(
        (run) =>
          run.turnOrdinal === turnOrdinal ||
          (run.turnOrdinal === null && run.originatingTurnOrdinal === turnOrdinal),
      );
      const foreground = runs.find((run) => run.turnOrdinal === turnOrdinal)!;
      const events = eventsForRuns(input.events, runs);
      return buildMetricRow({
        key: `turn-${turnOrdinal}`,
        turnOrdinal,
        label: `Turn ${turnOrdinal}`,
        path: foreground.actionKind ?? foreground.path,
        runs,
        events,
        durationMs: runDurationMs(foreground, nowMs),
      });
    }),
    processSamples: input.events
      .filter((event) => event.resourceScope === "process_sample")
      .map((event) => ({
        eventId: event.eventId,
        rssBytes: event.memoryRssBytes ?? null,
        heapUsedBytes: event.memoryHeapUsedBytes ?? null,
      })),
  };
}

export function unionIntervalDurationMs(
  intervals: readonly { startMs: number; endMs: number }[],
): number {
  const sorted = intervals
    .map((interval) => ({
      startMs: Math.min(interval.startMs, interval.endMs),
      endMs: Math.max(interval.startMs, interval.endMs),
    }))
    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (sorted.length === 0) return 0;

  let total = 0;
  let currentStart = sorted[0].startMs;
  let currentEnd = sorted[0].endMs;
  for (const interval of sorted.slice(1)) {
    if (interval.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endMs);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.startMs;
    currentEnd = interval.endMs;
  }
  return total + currentEnd - currentStart;
}

export function buildTokenLedger(
  runs: readonly RuntimeTraceMetricsRun[],
): RuntimeTraceTokenLedger {
  const llmRuns = runs.filter((run) => run.llmCallCount > 0);
  const providerInputTokens = sumNullable(runs.map((run) => run.providerInputTokens));
  const providerOutputTokens = sumNullable(runs.map((run) => run.providerOutputTokens));
  const providerTotalTokens = sumNullable(runs.map((run) => run.providerTotalTokens));
  const providerCachedTokens = sumNullable(runs.map((run) => run.providerCachedTokens));
  const providerReasoningTokens = sumNullable(
    runs.map((run) => run.providerReasoningTokens),
  );
  const usageMissingCallCount = sum(
    llmRuns
      .filter((run) => run.providerTotalTokens === null)
      .map((run) => run.llmCallCount),
  );
  const cachedBreakdownMissingCallCount = sum(
    llmRuns
      .filter((run) => run.providerCachedTokens === null)
      .map((run) => run.llmCallCount),
  );
  const reasoningBreakdownMissingCallCount = sum(
    llmRuns
      .filter((run) => run.providerReasoningTokens === null)
      .map((run) => run.llmCallCount),
  );
  const integrityWarnings: string[] = [];
  if (usageMissingCallCount > 0) {
    integrityWarnings.push(
      `Provider usage is missing for ${usageMissingCallCount} LLM call${usageMissingCallCount === 1 ? "" : "s"}; shown totals include reported calls only.`,
    );
  }
  if (cachedBreakdownMissingCallCount > 0) {
    integrityWarnings.push(
      `Cached-token breakdown is missing for ${cachedBreakdownMissingCallCount} LLM call${cachedBreakdownMissingCallCount === 1 ? "" : "s"}.`,
    );
  }
  if (reasoningBreakdownMissingCallCount > 0) {
    integrityWarnings.push(
      `Reasoning-token breakdown is missing for ${reasoningBreakdownMissingCallCount} LLM call${reasoningBreakdownMissingCallCount === 1 ? "" : "s"}.`,
    );
  }
  if (
    providerCachedTokens !== null &&
    providerInputTokens !== null &&
    providerCachedTokens > providerInputTokens
  ) {
    integrityWarnings.push("Cached tokens exceed provider input tokens.");
  }
  if (
    providerReasoningTokens !== null &&
    providerOutputTokens !== null &&
    providerReasoningTokens > providerOutputTokens
  ) {
    integrityWarnings.push("Reasoning tokens exceed provider output tokens.");
  }
  if (
    providerTotalTokens !== null &&
    providerInputTokens !== null &&
    providerOutputTokens !== null &&
    providerTotalTokens !== providerInputTokens + providerOutputTokens
  ) {
    integrityWarnings.push(
      "Provider total does not equal the reported input and output split.",
    );
  }
  return {
    providerInputTokens,
    providerOutputTokens,
    providerTotalTokens,
    providerCachedTokens,
    providerReasoningTokens,
    usageMissingCallCount,
    cachedBreakdownMissingCallCount,
    reasoningBreakdownMissingCallCount,
    integrityWarnings,
  };
}

export function buildCostLedger(
  runs: readonly RuntimeTraceMetricsRun[],
): RuntimeTraceCostLedger {
  const llmRuns = runs.filter((run) => run.llmCallCount > 0);
  if (llmRuns.length === 0) {
    return {
      knownCostUsd: null,
      unpricedLlmCallCount: 0,
      coverage: "not_applicable",
      label: "Not applicable",
    };
  }
  const knownCostUsd = sumNullable(llmRuns.map((run) => run.estimatedCostUsd));
  const unpricedLlmCallCount = llmRuns.reduce(
    (total, run) => total + run.unpricedLlmCallCount,
    0,
  );
  const hasIncompleteCoverage = llmRuns.some(
    (run) => run.pricingStatus === "partial" || run.pricingStatus === "unpriced",
  );
  const coverage: RuntimeTracePricingStatus = hasIncompleteCoverage
    ? knownCostUsd === null
      ? "unpriced"
      : "partial"
    : "priced";

  return {
    knownCostUsd,
    unpricedLlmCallCount,
    coverage,
    label:
      knownCostUsd === null
        ? `Unpriced · ${Math.max(unpricedLlmCallCount, llmRuns.length)} call${Math.max(unpricedLlmCallCount, llmRuns.length) === 1 ? "" : "s"}`
        : `${formatUsd(knownCostUsd)}${unpricedLlmCallCount > 0 ? ` + ${unpricedLlmCallCount} unpriced` : ""}`,
  };
}

export function buildMemoryLedger(
  events: readonly RuntimeTraceMetricsEvent[],
): RuntimeTraceMemoryLedger {
  let changedStepCount = 0;
  const durableRows = new Set<string>();
  let addedCount = 0;
  let removedCount = 0;
  for (const event of events) {
    if (event.kind !== "memory" || event.memoryDelta == null) continue;
    const delta = asRecord(event.memoryDelta);
    if (!delta) continue;
    const durableRowIds = readStringArray(delta.durableRowIds);
    const added = readArray(delta.added ?? delta.created ?? delta.inserted);
    const removed = readArray(delta.removed ?? delta.deleted);
    const before = readArray(delta.before);
    const after = readArray(delta.after);
    durableRowIds.forEach((id) => durableRows.add(id));
    addedCount += added.length;
    removedCount += removed.length;
    if (added.length === 0 && removed.length === 0 && before.length + after.length > 0) {
      addedCount += Math.max(0, after.length - before.length);
      removedCount += Math.max(0, before.length - after.length);
    }
    if (durableRowIds.length > 0 || added.length > 0 || removed.length > 0 || before.length + after.length > 0) {
      changedStepCount += 1;
    }
  }
  return {
    changedStepCount,
    durableRowCount: durableRows.size,
    addedCount,
    removedCount,
  };
}

export function payloadAvailabilityPresentation(input: {
  payloadState: RuntimeTracePayloadState | null | undefined;
  redactedFields?: readonly string[];
  truncatedFields?: readonly string[];
  unavailableFields?: readonly string[];
}) {
  const redactedCount = input.redactedFields?.length ?? 0;
  const truncatedCount = input.truncatedFields?.length ?? 0;
  const unavailableCount = input.unavailableFields?.length ?? 0;
  const base = (() => {
    switch (input.payloadState) {
      case "captured":
      case "full":
        return { label: "Full payload retained", tone: "complete" as const };
      case "summary_only":
        return { label: "Summary only", tone: "warning" as const };
      case "partially_pruned":
        return { label: "Payload partially pruned", tone: "warning" as const };
      case "pruned":
        return { label: "Payload pruned", tone: "warning" as const };
      case "unavailable":
        return { label: "Payload unavailable", tone: "error" as const };
      default:
        return { label: "Payload retention unknown", tone: "neutral" as const };
    }
  })();
  const notices = [
    redactedCount > 0 ? `${redactedCount} redacted field${redactedCount === 1 ? "" : "s"}` : null,
    truncatedCount > 0 ? `${truncatedCount} truncated field${truncatedCount === 1 ? "" : "s"}` : null,
    unavailableCount > 0
      ? `${unavailableCount} unavailable field${unavailableCount === 1 ? "" : "s"}`
      : null,
  ].filter((notice): notice is string => notice !== null);
  return { ...base, notices };
}

export function historySessionAccessibleLabel(
  session: RuntimeTraceHistorySession,
): string {
  const terminal =
    session.foregroundStatus === "abandoned" ? "abandoned" : session.foregroundStatus;
  const payload = payloadAvailabilityPresentation({
    payloadState: session.payloadState,
  }).label;
  return [
    session.problemTitle ?? "Problem workspace",
    terminal,
    `background ${session.backgroundStatus}`,
    payload,
    `${session.turnCount ?? session.runCount} turns`,
    `${session.eventCount} events`,
  ].join(", ");
}

export function rawEventAccessibleLabel(event: RuntimeTraceRawEvent): string {
  return [
    event.seq === null ? "Unscoped event" : `Event ${event.seq}`,
    event.title,
    event.kind,
    event.status,
    payloadAvailabilityPresentation({
      payloadState: event.payloadState,
      redactedFields: event.redactedFields,
      truncatedFields: event.truncatedFields,
      unavailableFields: event.unavailableFields,
    }).label,
  ].join(", ");
}

export function serializeNormalizedTraceEvent(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return JSON.stringify(
      {
        error: "Normalized event could not be serialized.",
        payloadState: "unavailable",
      },
      null,
      2,
    );
  }
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTokens(tokens: number | null): string {
  return tokens === null ? "Not reported" : new Intl.NumberFormat("en-US").format(tokens);
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Not reported";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "In progress";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildMetricRow(input: {
  key: string;
  turnOrdinal: number | null;
  label: string;
  path: string;
  runs: readonly RuntimeTraceMetricsRun[];
  events: readonly RuntimeTraceMetricsEvent[];
  durationMs: number;
}): RuntimeTraceMetricRow {
  const foreground = input.runs.find((run) => run.turnOrdinal !== null);
  return {
    key: input.key,
    turnOrdinal: input.turnOrdinal,
    label: input.label,
    path: input.path,
    durationMs: input.durationMs,
    tokens: buildTokenLedger(input.runs),
    cost: buildCostLedger(input.runs),
    llmCallCount: sum(input.runs.map((run) => run.llmCallCount)),
    toolCallCount: sum(input.runs.map((run) => run.toolCallCount)),
    errorCount: sum(input.runs.map((run) => run.errorCount)),
    traceOverheadMs: sum(input.runs.map((run) => run.traceOverheadMs ?? 0)),
    memory: buildMemoryLedger(input.events),
    completeness: foreground?.traceCompleteness ?? aggregateCompleteness(input.runs),
    status: foreground?.status ?? aggregateStatus(input.runs),
  };
}

function eventsForRuns(
  events: readonly RuntimeTraceMetricsEvent[],
  runs: readonly RuntimeTraceMetricsRun[],
) {
  const ids = new Set(runs.map((run) => run.id));
  return events.filter((event) => ids.has(event.traceRunId));
}

function runDurationMs(run: RuntimeTraceMetricsRun, nowMs: number) {
  return run.durationMs ?? Math.max(
    0,
    (run.endedAt ? timestampMs(run.endedAt) : nowMs) - timestampMs(run.startedAt),
  );
}

function aggregateCompleteness(runs: readonly RuntimeTraceMetricsRun[]) {
  if (runs.some((run) => run.traceCompleteness === "incomplete")) return "incomplete";
  if (runs.some((run) => run.traceCompleteness === "open")) return "open";
  if (runs.some((run) => run.traceCompleteness === "degraded")) return "degraded";
  return "complete";
}

function aggregateStatus(runs: readonly RuntimeTraceMetricsRun[]) {
  if (runs.some((run) => run.status === "failed")) return "failed";
  if (runs.some((run) => run.status === "degraded")) return "degraded";
  if (runs.some((run) => run.status === "running")) return "running";
  return "succeeded";
}

function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : sum(present);
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function timestampMs(value: string) {
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: number) {
  return `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === "string");
}

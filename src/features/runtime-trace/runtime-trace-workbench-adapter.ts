import type {
  RuntimeTraceDataState,
  RuntimeTraceEvent,
  RuntimeTraceHistorySession as ApiHistorySession,
  RuntimeTraceRun,
  RuntimeTraceSession,
} from "./index";
import {
  buildRuntimeTraceMetricsViewModel,
  formatDuration,
  type RuntimeTraceEventViewModel,
  type RuntimeTraceHistorySession,
  type RuntimeTraceMetricsEvent,
  type RuntimeTraceMetricsRun,
  type RuntimeTraceRawEvent,
  type RuntimeTraceRunViewModel,
  type RuntimeTraceSessionOptionViewModel,
  type RuntimeTraceSessionViewModel,
  type RuntimeTraceSummaryViewModel,
} from "./components";

const HIDDEN_TRACE_EVENT_TITLES = new Set([
  "Automatic Coach memory assembly disabled for Pilot",
  "Unified recent Chat context projection",
  "History recall retrieval",
  "History recall selection",
]);

/**
 * These retired instrumentation-only events remain in older stored traces but
 * are intentionally omitted from every runtime-trace presentation.
 */
export function filterRuntimeTraceEventsForDisplay(
  events: readonly RuntimeTraceEvent[],
): RuntimeTraceEvent[] {
  return events.filter((event) => !HIDDEN_TRACE_EVENT_TITLES.has(event.title));
}

export function toRuntimeTraceSessionViewModel(
  session: RuntimeTraceSession | null,
): RuntimeTraceSessionViewModel | null {
  if (!session) return null;
  return {
    id: session.id,
    problemId: session.problemId,
    problemTitle: session.problem?.title,
    startTrigger: session.startTrigger,
    foregroundStatus: session.foregroundStatus,
    backgroundStatus: session.backgroundStatus,
    startedAt: session.startedAt,
    foregroundEndedAt: session.foregroundEndedAt,
    settledAt: session.settledAt,
    captureLevel: session.captureLevel,
  };
}

export function toRuntimeTraceTimelineRuns(
  runs: readonly RuntimeTraceRun[],
): RuntimeTraceRunViewModel[] {
  return runs.map((run) => ({
    id: run.id,
    parentTraceRunId: run.parentTraceRunId,
    turnOrdinal: run.turnOrdinal,
    originatingTurnOrdinal: run.originatingTurnOrdinal,
    path: run.path,
    actionKind: run.actionKind,
    status: run.status,
    traceCompleteness: run.traceCompleteness,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    providerInputTokens: run.providerInputTokens,
    providerOutputTokens: run.providerOutputTokens,
    providerTotalTokens: run.providerTotalTokens,
    providerCachedTokens: run.providerCachedTokens,
    providerReasoningTokens: run.providerReasoningTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    pricingVersion: run.pricingVersion,
    pricingStatus: run.pricingStatus,
    llmCallCount: run.llmCallCount,
    toolCallCount: run.toolCallCount,
    errorCount: run.errorCount,
    traceOverheadMs: run.traceOverheadMs,
  }));
}

export function toRuntimeTraceTimelineEvents(
  events: readonly RuntimeTraceEvent[],
): RuntimeTraceEventViewModel[] {
  return events.map((event) => ({
    id: event.id,
    eventId: event.eventId,
    seq: event.seq,
    traceRunId: event.traceRunId,
    turnOrdinal: event.turnOrdinal,
    stepId: event.stepId,
    parentStepId: event.parentStepId,
    agentIteration: event.agentIteration,
    stage: event.stage,
    kind: event.kind,
    title: event.title,
    status: event.status,
    occurredAt: event.occurredAt,
    durationMs: event.durationMs,
    model: formatRuntimeTraceModel(event.model, event.responseModel),
    providerInputTokens: event.providerInputTokens,
    providerOutputTokens: event.providerOutputTokens,
    providerTotalTokens: event.providerTotalTokens,
    providerCachedTokens: event.providerCachedTokens,
    providerReasoningTokens: event.providerReasoningTokens,
    usageSource: event.usageSource,
    estimatedCostUsd: event.estimatedCostUsd,
    pricingVersion: event.pricingVersion,
    pricingStatus: event.pricingStatus,
    payloadState: event.payloadState,
    detailLevel: event.detailLevel,
    redactedFields: event.redactedFields,
    truncatedFields: event.truncatedFields,
    unavailableFields: event.unavailableFields,
    metadata: event.metadata,
    payload: event.payload
      ? {
          prompt: readPromptParts(event.payload.prompt),
          input: event.payload.input,
          output: event.payload.output,
          retrieval: event.payload.retrieval,
          stateDelta: event.payload.stateDelta,
          memoryDelta: event.payload.memoryDelta,
          metadata: event.payload.metadata,
          stdout: event.payload.stdout,
          stderr: event.payload.stderr,
          byteSize: event.payload.byteSize,
        }
      : null,
  }));
}

function formatRuntimeTraceModel(
  model: RuntimeTraceEvent["model"],
  responseModel: RuntimeTraceEvent["responseModel"],
) {
  if (!model) return responseModel;
  if (!responseModel || responseModel === model) return model;
  return `${model} -> ${responseModel}`;
}

export function toRuntimeTraceMetricsRuns(
  runs: readonly RuntimeTraceRun[],
): RuntimeTraceMetricsRun[] {
  return runs.map((run) => ({
    id: run.id,
    path: run.path,
    actionKind: run.actionKind,
    turnOrdinal: run.turnOrdinal,
    originatingTurnOrdinal: run.originatingTurnOrdinal,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    providerInputTokens: run.providerInputTokens,
    providerOutputTokens: run.providerOutputTokens,
    providerTotalTokens: run.providerTotalTokens,
    providerCachedTokens: run.providerCachedTokens,
    providerReasoningTokens: run.providerReasoningTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    pricingStatus: run.pricingStatus,
    unpricedLlmCallCount: run.unpricedLlmCallCount,
    llmCallCount: run.llmCallCount,
    toolCallCount: run.toolCallCount,
    errorCount: run.errorCount,
    traceOverheadMs: run.traceOverheadMs,
    traceCompleteness: run.traceCompleteness,
    status: run.status,
  }));
}

export function toRuntimeTraceMetricsEvents(
  events: readonly RuntimeTraceEvent[],
): RuntimeTraceMetricsEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    traceRunId: event.traceRunId,
    turnOrdinal: event.turnOrdinal,
    kind: event.kind,
    status: event.status,
    memoryDelta: event.payload?.memoryDelta,
    metadata: event.metadata,
    usageSource: event.usageSource,
    memoryRssBytes: event.memoryRssBytes,
    memoryHeapUsedBytes: event.memoryHeapUsedBytes,
    resourceScope:
      event.resourceScope === "process_sample" ||
      event.resourceScope === "unavailable"
        ? event.resourceScope
        : null,
  }));
}

export function buildRuntimeTraceSummary(
  data: RuntimeTraceDataState,
  nowMs = Date.now(),
): RuntimeTraceSummaryViewModel | null {
  if (!data.session) return null;
  const metrics = buildRuntimeTraceMetricsViewModel({
    session: data.session,
    runs: toRuntimeTraceMetricsRuns(data.runs),
    events: toRuntimeTraceMetricsEvents(data.events),
    nowMs,
  });
  return {
    visitElapsed: formatDuration(metrics.visitElapsedMs),
    agentBusy: formatDuration(metrics.agentBusyMs),
    turnCount: metrics.turns,
    llmCallCount: metrics.totals.llmCallCount,
    providerTotalTokens: metrics.totals.tokens.providerTotalTokens,
    knownCostUsd: metrics.totals.cost.knownCostUsd,
    unpricedCallCount: metrics.totals.cost.unpricedLlmCallCount,
    toolCallCount: metrics.totals.toolCallCount,
    memoryAdded: metrics.totals.memory.addedCount,
    memoryRemoved: metrics.totals.memory.removedCount,
    errorCount: metrics.totals.errorCount,
  };
}

export function toRuntimeTraceRawEvents(
  events: readonly RuntimeTraceEvent[],
): RuntimeTraceRawEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    seq: event.seq,
    title: event.title,
    kind: event.kind,
    status: event.status,
    occurredAt: event.occurredAt,
    payloadState: event.payloadState,
    detailLevel: event.detailLevel === "summary" ? "summary" : "full",
    redactedFields: event.redactedFields,
    truncatedFields: event.truncatedFields,
    unavailableFields: event.unavailableFields,
    normalized: toNormalizedEvent(event),
  }));
}

export function toRuntimeTraceHistorySession(
  session: ApiHistorySession,
): RuntimeTraceHistorySession {
  return {
    id: session.id,
    problemTitle: session.problem?.title,
    startedAt: session.startedAt,
    foregroundEndedAt: session.foregroundEndedAt,
    settledAt: session.settledAt,
    startTrigger: session.startTrigger,
    foregroundStatus: session.foregroundStatus,
    backgroundStatus: session.backgroundStatus,
    turnCount: session.turnCount,
    runCount: session.runCount,
    eventCount: session.eventCount,
    payloadState: session.payloadState,
    traceCompleteness: session.traceCompleteness,
  };
}

export function toRuntimeTraceSessionOption(
  session: ApiHistorySession,
): RuntimeTraceSessionOptionViewModel {
  const started = new Date(session.startedAt);
  const dateLabel = Number.isNaN(started.valueOf())
    ? "Unknown time"
    : started.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return {
    id: session.id,
    label: `${session.problem?.title ?? "Problem workspace"} · ${dateLabel}`,
    status: session.foregroundStatus,
    payloadState: session.payloadState,
  };
}

function toNormalizedEvent(event: RuntimeTraceEvent) {
  return {
    identity: {
      eventId: event.eventId,
      eventDigest: event.eventDigest,
      traceRunId: event.traceRunId,
      parentTraceRunId: event.parentTraceRunId ?? undefined,
      turnOrdinal: event.turnOrdinal ?? undefined,
      stepId: event.stepId ?? undefined,
      parentStepId: event.parentStepId ?? undefined,
      stepIndex: event.stepIndex ?? undefined,
      agentIteration: event.agentIteration ?? undefined,
    },
    scope: {
      path: event.path,
      stage: event.stage,
      kind: event.kind,
      title: event.title,
    },
    lifecycle: {
      status: event.status,
      occurredAt: event.occurredAt,
      clientOccurredAt: event.clientOccurredAt ?? undefined,
      startedAt: event.startedAt ?? undefined,
      endedAt: event.endedAt ?? undefined,
      durationMs: event.durationMs ?? undefined,
    },
    details: event.payload
      ? {
          input: event.payload.input ?? undefined,
          prompt: event.payload.prompt ?? undefined,
          retrieval: event.payload.retrieval ?? undefined,
          output: event.payload.output ?? undefined,
          stateDelta: event.payload.stateDelta ?? undefined,
          memoryDelta: event.payload.memoryDelta ?? undefined,
          metadata: event.payload.metadata ?? event.metadata ?? undefined,
        }
      : event.metadata
        ? { metadata: event.metadata }
        : undefined,
    metrics: {
      providerInputTokens: event.providerInputTokens ?? undefined,
      providerOutputTokens: event.providerOutputTokens ?? undefined,
      providerTotalTokens: event.providerTotalTokens ?? undefined,
      providerReasoningTokens: event.providerReasoningTokens ?? undefined,
      providerCachedTokens: event.providerCachedTokens ?? undefined,
      usageSource: event.usageSource ?? undefined,
      usageMissingReason: event.usageMissingReason ?? undefined,
      estimatedTokens: event.estimatedTokens ?? undefined,
      estimatedCostUsd: event.estimatedCostUsd ?? undefined,
      pricingVersion: event.pricingVersion ?? undefined,
      pricingStatus: event.pricingStatus ?? undefined,
      memoryRssBytes: event.memoryRssBytes ?? undefined,
      memoryHeapUsedBytes: event.memoryHeapUsedBytes ?? undefined,
      resourceScope: event.resourceScope ?? undefined,
    },
    capture: {
      detailLevel: event.detailLevel,
      payloadState: event.payloadState,
      redactedFields: event.redactedFields,
      truncatedFields: event.truncatedFields,
      unavailableFields: event.unavailableFields,
    },
  };
}

function readPromptParts(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    if (typeof record.role !== "string" || !("content" in record)) return [];
    return [{
      role: record.role,
      content: record.content,
      estimatedTokens:
        typeof record.estimatedTokens === "number"
          ? record.estimatedTokens
          : undefined,
    }];
  });
}

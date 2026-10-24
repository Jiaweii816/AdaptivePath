import type { Prisma, PrismaClient } from "@prisma/client";
import {
  normalizedTraceEventSchema,
  type NormalizedTraceEvent,
} from "@/server/observability/runtime-trace-contract";
import {
  isCapturedTraceEvent,
  truncateUtf8HeadTail,
  type CapturedTraceEvent,
} from "@/server/observability/runtime-trace-capture";

export type TraceTransaction = Prisma.TransactionClient;

export type TraceFlushEvent = {
  eventId: string;
  traceRunId: string;
  seq: number | null;
  inserted: boolean;
};

export type TraceFlushConflict = {
  eventId: string;
  existingDigest?: string;
  incomingDigest: string;
  traceRunId: string;
};

export type TraceFlushResult = {
  events: TraceFlushEvent[];
  insertedCount: number;
  duplicateCount: number;
  conflicts: TraceFlushConflict[];
};

class RetryableTraceFlushError extends Error {}

export async function flushTraceEvents(
  prisma: PrismaClient,
  inputEvents: readonly CapturedTraceEvent[],
): Promise<TraceFlushResult> {
  if (inputEvents.length === 0) {
    return { events: [], insertedCount: 0, duplicateCount: 0, conflicts: [] };
  }

  return retryTraceTransaction(() =>
    prisma.$transaction((tx) =>
      flushCapturedTraceEventsInTransaction(tx, inputEvents),
    ),
  );
}

export async function flushCapturedTraceEventsInTransaction(
  tx: TraceTransaction,
  inputEvents: readonly CapturedTraceEvent[],
): Promise<TraceFlushResult> {
  const events = inputEvents.map((event) => {
    const normalized = event as NormalizedTraceEvent;
    if (!isCapturedTraceEvent(normalized)) {
      throw new Error(
        `Trace event ${normalized.identity.eventId} bypassed capture policy.`,
      );
    }
    return normalizedTraceEventSchema.parse(normalized);
  });
  return flushInTransaction(tx, events);
}

async function flushInTransaction(
  tx: TraceTransaction,
  events: NormalizedTraceEvent[],
): Promise<TraceFlushResult> {
  const firstById = new Map<string, NormalizedTraceEvent>();
  const conflicts: TraceFlushConflict[] = [];
  let duplicateCount = 0;

  for (const event of events) {
    const prior = firstById.get(event.identity.eventId);
    if (!prior) {
      firstById.set(event.identity.eventId, event);
      continue;
    }
    if (
      prior.identity.eventDigest !== event.identity.eventDigest ||
      prior.identity.traceRunId !== event.identity.traceRunId ||
      prior.scope.kind !== event.scope.kind
    ) {
      conflicts.push(toConflict(event, prior.identity.eventDigest));
    } else {
      duplicateCount += 1;
    }
  }

  const uniqueIncoming = [...firstById.values()];
  await assertEventRunScopes(tx, uniqueIncoming);
  const existing = await tx.agentTraceEvent.findMany({
    where: { eventId: { in: uniqueIncoming.map((event) => event.identity.eventId) } },
    select: { eventId: true, eventDigest: true, traceRunId: true, kind: true, seq: true },
  });
  const existingById = new Map(existing.map((event) => [event.eventId, event]));
  const novel: NormalizedTraceEvent[] = [];

  for (const event of uniqueIncoming) {
    const persisted = existingById.get(event.identity.eventId);
    if (!persisted) {
      novel.push(event);
      continue;
    }
    if (
      persisted.eventDigest !== event.identity.eventDigest ||
      persisted.traceRunId !== event.identity.traceRunId ||
      persisted.kind !== event.scope.kind
    ) {
      conflicts.push(toConflict(event, persisted.eventDigest));
    } else {
      duplicateCount += 1;
    }
  }

  const seqByEventId = await allocateScopedSequences(tx, novel);
  const inserted: TraceFlushEvent[] = [];

  for (const event of novel) {
    const payload = buildPayloadData(event);
    const metadataResult = buildEventMetadataJson(event);
    const unavailableFields = mergeUnavailableFields(
      event.capture.unavailableFields,
      metadataResult.droppedStructuredFields,
    );
    const row = await tx.agentTraceEvent.create({
      data: {
        eventId: event.identity.eventId,
        eventDigest: event.identity.eventDigest,
        seq: seqByEventId.get(event.identity.eventId) ?? null,
        workspaceSessionId: event.identity.workspaceSessionId,
        traceRunId: event.identity.traceRunId,
        parentTraceRunId: event.identity.parentTraceRunId,
        turnOrdinal: event.identity.turnOrdinal,
        stepId: event.identity.stepId,
        parentStepId: event.identity.parentStepId,
        stepIndex: event.identity.stepIndex,
        agentIteration: event.identity.agentIteration,
        path: event.scope.path,
        stage: event.scope.stage,
        kind: event.scope.kind,
        title: event.scope.title,
        status: event.lifecycle.status,
        occurredAt: new Date(event.lifecycle.occurredAt),
        clientOccurredAt: toOptionalDate(event.lifecycle.clientOccurredAt),
        startedAt: toOptionalDate(event.lifecycle.startedAt),
        endedAt: toOptionalDate(event.lifecycle.endedAt),
        durationMs: event.lifecycle.durationMs,
        model: readDetailString(event, "model"),
        responseModel: readDetailString(event, "responseModel"),
        providerInputTokens: event.metrics?.providerInputTokens,
        providerOutputTokens: event.metrics?.providerOutputTokens,
        providerTotalTokens: event.metrics?.providerTotalTokens,
        providerReasoningTokens: event.metrics?.providerReasoningTokens,
        providerCachedTokens: event.metrics?.providerCachedTokens,
        usageSource: event.metrics?.usageSource,
        usageMissingReason: event.metrics?.usageMissingReason,
        estimatedTokens: event.metrics?.estimatedTokens,
        estimatedCostUsd: event.metrics?.estimatedCostUsd,
        pricingVersion: event.metrics?.pricingVersion,
        pricingStatus: event.metrics?.pricingStatus,
        memoryRssBytes: event.metrics?.memoryRssBytes,
        memoryHeapUsedBytes: event.metrics?.memoryHeapUsedBytes,
        resourceScope: event.metrics?.resourceScope,
        detailLevel: event.capture.detailLevel,
        payloadState: event.capture.payloadState,
        redactedFieldsJson: serializeOptional(event.capture.redactedFields),
        truncatedFieldsJson: serializeOptional(event.capture.truncatedFields),
        unavailableFieldsJson: serializeOptional(unavailableFields),
        metadataJson: metadataResult.metadataJson,
        ...(payload ? { payload: { create: payload } } : {}),
      },
      select: { eventId: true, traceRunId: true, seq: true },
    });
    inserted.push({ ...row, inserted: true });
  }

  const affectedRunIds = new Set(novel.map((event) => event.identity.traceRunId));
  for (const conflict of conflicts) {
    affectedRunIds.add(conflict.traceRunId);
    await tx.agentTraceRun.updateMany({
      where: { id: conflict.traceRunId },
      data: { status: "degraded", traceCompleteness: "degraded" },
    });
  }
  for (const runId of affectedRunIds) {
    await recomputeTraceRunRollupsInTransaction(tx, runId);
  }

  const replayed = uniqueIncoming
    .filter((event) => {
      const persisted = existingById.get(event.identity.eventId);
      return persisted && !conflicts.some((conflict) => conflict.eventId === event.identity.eventId);
    })
    .map((event) => {
      const persisted = existingById.get(event.identity.eventId)!;
      return { eventId: event.identity.eventId, traceRunId: persisted.traceRunId, seq: persisted.seq, inserted: false };
    });

  return {
    events: [...inserted, ...replayed],
    insertedCount: inserted.length,
    duplicateCount,
    conflicts,
  };
}

async function assertEventRunScopes(
  tx: TraceTransaction,
  events: NormalizedTraceEvent[],
) {
  const runIds = [...new Set(events.map((event) => event.identity.traceRunId))];
  const runs = await tx.agentTraceRun.findMany({
    where: { id: { in: runIds } },
    select: { id: true, workspaceSessionId: true, turnOrdinal: true },
  });
  const runById = new Map(runs.map((run) => [run.id, run]));

  for (const event of events) {
    const run = runById.get(event.identity.traceRunId);
    if (!run) {
      throw new Error(`Trace Run ${event.identity.traceRunId} does not exist.`);
    }
    if (
      run.workspaceSessionId !==
      (event.identity.workspaceSessionId ?? null)
    ) {
      throw new Error(
        `Trace event ${event.identity.eventId} workspace Session does not match its Run.`,
      );
    }
    if (
      event.identity.turnOrdinal !== undefined &&
      run.turnOrdinal !== event.identity.turnOrdinal
    ) {
      throw new Error(
        `Trace event ${event.identity.eventId} Turn ordinal does not match its Run.`,
      );
    }
  }
}

async function allocateScopedSequences(
  tx: TraceTransaction,
  events: NormalizedTraceEvent[],
) {
  const seqByEventId = new Map<string, number>();
  const bySession = new Map<string, NormalizedTraceEvent[]>();
  for (const event of events) {
    const sessionId = event.identity.workspaceSessionId;
    if (!sessionId) continue;
    const group = bySession.get(sessionId) ?? [];
    group.push(event);
    bySession.set(sessionId, group);
  }

  for (const [sessionId, group] of bySession) {
    const session = await tx.problemWorkspaceSession.findUnique({
      where: { id: sessionId },
      select: { nextSeq: true },
    });
    if (!session) throw new Error(`Trace session ${sessionId} does not exist.`);
    const claimed = await tx.problemWorkspaceSession.updateMany({
      where: { id: sessionId, nextSeq: session.nextSeq },
      data: { nextSeq: { increment: group.length } },
    });
    if (claimed.count !== 1) throw new RetryableTraceFlushError(`Sequence cursor changed for ${sessionId}.`);
    group.forEach((event, index) => seqByEventId.set(event.identity.eventId, session.nextSeq + index));
  }
  return seqByEventId;
}

export async function recomputeTraceRunRollups(prisma: PrismaClient, traceRunId: string) {
  return prisma.$transaction((tx) => recomputeTraceRunRollupsInTransaction(tx, traceRunId));
}

async function recomputeTraceRunRollupsInTransaction(tx: TraceTransaction, traceRunId: string) {
  const events = await tx.agentTraceEvent.findMany({
    where: { traceRunId },
    select: {
      kind: true,
      status: true,
      providerInputTokens: true,
      providerOutputTokens: true,
      providerTotalTokens: true,
      providerReasoningTokens: true,
      providerCachedTokens: true,
      usageSource: true,
      estimatedCostUsd: true,
      pricingVersion: true,
      pricingStatus: true,
      metadataJson: true,
      title: true,
    },
  });
  const llmEvents = events.filter((event) => event.kind === "llm");
  const pricingStatuses = llmEvents.map((event) =>
    event.usageSource === "provider"
      ? (event.pricingStatus ?? "unpriced")
      : "unpriced",
  );
  const knownCost = sumNullable(llmEvents.map((event) => event.estimatedCostUsd));
  const unpricedLlmCallCount = pricingStatuses.filter((status) => status === "partial" || status === "unpriced").length;
  const pricingVersions = [...new Set(llmEvents.map((event) => event.pricingVersion).filter((value): value is string => Boolean(value)))];

  return tx.agentTraceRun.update({
    where: { id: traceRunId },
    data: {
      providerInputTokens: sumCompleteProviderUsage(
        llmEvents,
        "providerInputTokens",
      ),
      providerOutputTokens: sumCompleteProviderUsage(
        llmEvents,
        "providerOutputTokens",
      ),
      providerTotalTokens: sumCompleteProviderUsage(
        llmEvents,
        "providerTotalTokens",
      ),
      providerReasoningTokens: sumCompleteProviderUsage(
        llmEvents,
        "providerReasoningTokens",
      ),
      providerCachedTokens: sumCompleteProviderUsage(
        llmEvents,
        "providerCachedTokens",
      ),
      estimatedCostUsd: knownCost,
      pricingVersion: pricingVersions.length === 0 ? null : pricingVersions.length === 1 ? pricingVersions[0] : "mixed",
      pricingStatus:
        llmEvents.length === 0
          ? "not_applicable"
          : pricingStatuses.every((status) => status === "priced")
            ? "priced"
            : knownCost !== null
              ? "partial"
              : "unpriced",
      unpricedLlmCallCount,
      llmCallCount: llmEvents.length,
      toolCallCount: events.filter(isToolCallEvent).length,
      errorCount: events.filter((event) => event.kind === "error" || event.status === "failed").length,
    },
  });
}

export async function finalizeTraceRun(
  prisma: PrismaClient,
  args: {
    traceRunId: string;
    status: "succeeded" | "failed" | "degraded";
    traceCompleteness: "complete" | "degraded";
    endedAt: Date;
    traceOverheadMs: number;
  },
) {
  return prisma.$transaction(async (tx) => {
    await recomputeTraceRunRollupsInTransaction(tx, args.traceRunId);
    const run = await tx.agentTraceRun.findUniqueOrThrow({ where: { id: args.traceRunId }, select: { startedAt: true, traceCompleteness: true, status: true } });
    const forcedDegraded = run.traceCompleteness === "degraded" || run.status === "degraded";
    return tx.agentTraceRun.update({
      where: { id: args.traceRunId },
      data: {
        status: forcedDegraded ? "degraded" : args.status,
        traceCompleteness: forcedDegraded ? "degraded" : args.traceCompleteness,
        endedAt: args.endedAt,
        durationMs: Math.max(0, args.endedAt.getTime() - run.startedAt.getTime()),
        traceOverheadMs: Math.max(0, Math.round(args.traceOverheadMs)),
        finalFlushAt: args.endedAt,
      },
    });
  });
}

export async function markTraceRunDegradedBestEffort(prisma: PrismaClient, traceRunId: string) {
  try {
    await prisma.agentTraceRun.updateMany({
      where: { id: traceRunId },
      data: { status: "degraded", traceCompleteness: "degraded" },
    });
  } catch {
    // The trace store itself may be unavailable; telemetry must not fail coaching.
  }
}

function buildPayloadData(event: NormalizedTraceEvent): Prisma.AgentTracePayloadUncheckedCreateWithoutTraceEventInput | null {
  const details = event.details;
  if (!details) return null;
  const serialized = {
    promptJson: serializeOptional(details.prompt),
    inputJson: serializeOptional(details.input),
    outputJson: serializeOptional(details.output),
    retrievalJson: serializeOptional(details.retrieval),
    stateDeltaJson: serializeOptional(details.stateDelta),
    memoryDeltaJson: serializeOptional(details.memoryDelta),
    detailMetadataJson: serializeOptional(details.metadata),
    stdout: readCapturedStream(details, "stdout"),
    stderr: readCapturedStream(details, "stderr"),
  };
  const byteSize = Object.values(serialized).reduce(
    (total, value) => total + (value ? Buffer.byteLength(value, "utf8") : 0),
    0,
  );
  return { ...serialized, workspaceSessionId: event.identity.workspaceSessionId, byteSize };
}

const PRIORITY_EVENT_METADATA_KEYS = [
  "toolName",
  "toolCallId",
  "traceCorrelationId",
  "eventRole",
  "operation",
  "sequence",
  "assistantSequence",
  "responseLanguage",
  "runtimeDisposition",
  "runtimeReason",
  "errorKind",
  "reason",
  "guard",
  "guardVersion",
  "strategy",
  "profileId",
  "degraded",
  "task",
  "source",
  "provider",
  "triggerReason",
  "messageCount",
  "retryAttempt",
  "thinking",
  "deepReasoning",
  "staticExaminer",
  "selfCorrectionMarkerDetected",
  "durableWriteAuthorized",
] as const;

const MAX_EVENT_METADATA_SCALARS = 50;
const MAX_EVENT_METADATA_BYTES = 8 * 1024;
const MAX_EVENT_METADATA_STRING_BYTES = 1024;

/**
 * Metadata keys that are retained structured (non-scalar) rather than
 * dropped when building the queryable Event-row metadata column. This is a
 * separate whitelist from summarizeMetadata()'s retainedStructuredKeys in
 * runtime-trace-capture.ts — that one shapes capture-time summary detail
 * (["strategySignals", "timings"], plus a name/id-only "toolCalls"), this one
 * shapes what survives onto the Event row at flush time. The two lists are
 * not required to be identical, but "toolCalls" must appear in both: it is
 * what FunctionCallPanel renders, and dropping it at either layer blanks
 * that panel.
 */
const STRUCTURED_EVENT_METADATA_KEYS = new Set(["toolCalls"]);

type EventMetadataBuildResult = {
  metadataJson: string | undefined;
  droppedStructuredFields: string[];
};

function buildEventMetadataJson(event: NormalizedTraceEvent): EventMetadataBuildResult {
  const metadata = event.details?.metadata;
  if (!metadata) return { metadataJson: undefined, droppedStructuredFields: [] };
  const retained: Record<string, unknown> = {};
  const droppedStructuredFields: string[] = [];
  const priority = new Set<string>(PRIORITY_EVENT_METADATA_KEYS);
  const keys = [
    ...PRIORITY_EVENT_METADATA_KEYS.filter((key) => key in metadata),
    ...Object.keys(metadata)
      .filter((key) => !priority.has(key))
      .sort(),
  ];
  for (const key of keys) {
    if (Object.keys(retained).length >= MAX_EVENT_METADATA_SCALARS) break;
    const value = metadata[key];
    const isScalar =
      value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    const isRetainedStructured =
      STRUCTURED_EVENT_METADATA_KEYS.has(key) && value !== undefined;
    if (!isScalar && !isRetainedStructured) continue;

    const boundedValue =
      typeof value === "string" &&
      Buffer.byteLength(value, "utf8") > MAX_EVENT_METADATA_STRING_BYTES
        ? truncateUtf8HeadTail(value, MAX_EVENT_METADATA_STRING_BYTES)
        : value;
    const candidate = { ...retained, [key]: boundedValue };
    if (
      Buffer.byteLength(JSON.stringify(candidate), "utf8") >
      MAX_EVENT_METADATA_BYTES
    ) {
      // Unlike scalars, a retained structured value (e.g. toolCalls) has no
      // byte truncation of its own — it is dropped whole when it doesn't
      // fit. That must not vanish silently: it is exactly the largest, most
      // worth-seeing tool calls that would otherwise blank out with no
      // indication anything was lost (Debug-First: no silent fallbacks).
      if (isRetainedStructured) {
        droppedStructuredFields.push(`$.details.metadata.${key}`);
      }
      continue;
    }
    retained[key] = boundedValue;
  }
  return {
    metadataJson: Object.keys(retained).length > 0 ? JSON.stringify(retained) : undefined,
    droppedStructuredFields,
  };
}

function mergeUnavailableFields(
  existing: readonly string[] | undefined,
  additional: readonly string[],
): string[] | undefined {
  if (additional.length === 0) return existing ? [...existing] : undefined;
  return [...new Set([...(existing ?? []), ...additional])].sort();
}

function readCapturedStream(
  details: NonNullable<NormalizedTraceEvent["details"]>,
  key: "stdout" | "stderr",
) {
  for (const container of [details.output, details.input, details.metadata]) {
    if (container && typeof container === "object" && !Array.isArray(container)) {
      const value = (container as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }
  return undefined;
}

function isToolCallEvent(event: {
  kind: string;
  status: string;
  title: string;
  metadataJson: string | null;
}) {
  if (event.kind !== "tool") return false;
  const metadata = parseJsonRecord(event.metadataJson);
  if (metadata.eventRole === "call") return true;
  if (metadata.eventRole === "result") return false;
  return event.status === "started" || /tool call/i.test(event.title);
}

function parseJsonRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function readDetailString(event: NormalizedTraceEvent, key: string) {
  const value = event.details?.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function serializeOptional(value: unknown) {
  return value === undefined ? undefined : JSON.stringify(value);
}

function toOptionalDate(value: string | undefined) {
  return value ? new Date(value) : undefined;
}

function sumNullable(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

function sumCompleteProviderUsage(
  events: Array<{
    usageSource: string | null;
    providerInputTokens: number | null;
    providerOutputTokens: number | null;
    providerTotalTokens: number | null;
    providerReasoningTokens: number | null;
    providerCachedTokens: number | null;
  }>,
  key:
    | "providerInputTokens"
    | "providerOutputTokens"
    | "providerTotalTokens"
    | "providerReasoningTokens"
    | "providerCachedTokens",
) {
  if (
    events.length === 0 ||
    events.some(
      (event) => event.usageSource !== "provider" || event[key] === null,
    )
  ) {
    return null;
  }
  return events.reduce((total, event) => total + event[key]!, 0);
}

function toConflict(event: NormalizedTraceEvent, existingDigest?: string): TraceFlushConflict {
  return {
    eventId: event.identity.eventId,
    existingDigest,
    incomingDigest: event.identity.eventDigest,
    traceRunId: event.identity.traceRunId,
  };
}

async function retryTraceTransaction<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isRetryable(error: unknown) {
  if (error instanceof RetryableTraceFlushError) return true;
  const record = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  return record.code === "P2002" || record.code === "P1008" || /busy|locked|unique constraint/i.test(record.message ?? "");
}

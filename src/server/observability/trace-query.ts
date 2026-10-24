import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { compactObject } from "@/server/observability/object-utils";

export const traceEventPageInputSchema = z.object({
  since: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(200),
});

export const currentTraceSessionInputSchema = traceEventPageInputSchema.extend({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  browserInstanceId: z.string().min(1),
});

export const traceSessionDetailInputSchema = traceEventPageInputSchema.extend({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
});

export const traceSessionHistoryInputSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(500).default(50),
  cursor: z.string().min(1).optional(),
});

export async function getCurrentTraceSessionPage(
  prisma: PrismaClient,
  rawInput: z.input<typeof currentTraceSessionInputSchema>,
) {
  const input = currentTraceSessionInputSchema.parse(rawInput);
  const session = await prisma.problemWorkspaceSession.findFirst({
    where: {
      userId: input.userId,
      problemId: input.problemId,
      browserInstanceId: input.browserInstanceId,
      foregroundStatus: "active",
    },
    orderBy: { startedAt: "desc" },
    include: { problem: { select: { id: true, slug: true, title: true } } },
  });

  if (!session) return emptyCurrentPage(input.since);
  return buildTraceSessionPage(prisma, session, input);
}

export async function getTraceSessionDetailPage(
  prisma: PrismaClient,
  rawInput: z.input<typeof traceSessionDetailInputSchema>,
) {
  const input = traceSessionDetailInputSchema.parse(rawInput);
  const session = await prisma.problemWorkspaceSession.findFirst({
    where: { id: input.sessionId, userId: input.userId },
    include: { problem: { select: { id: true, slug: true, title: true } } },
  });
  if (!session) return null;
  return buildTraceSessionPage(prisma, session, input);
}

export async function listTraceSessionHistory(
  prisma: PrismaClient,
  rawInput: z.input<typeof traceSessionHistoryInputSchema>,
) {
  const input = traceSessionHistoryInputSchema.parse(rawInput);
  const rows = await prisma.problemWorkspaceSession.findMany({
    where: {
      userId: input.userId,
      foregroundStatus: { in: ["closed", "abandoned"] },
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    take: input.limit + 1,
    include: {
      problem: { select: { id: true, slug: true, title: true } },
      traceRuns: {
        select: {
          turnOrdinal: true,
          path: true,
          status: true,
          traceCompleteness: true,
          llmCallCount: true,
          providerTotalTokens: true,
          estimatedCostUsd: true,
          unpricedLlmCallCount: true,
        },
      },
      traceEvents: { select: { payloadState: true } },
      _count: { select: { traceRuns: true, traceEvents: true } },
    },
  });
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);

  return {
    sessions: page.map((session) => ({
      ...projectSession(session),
      durationMs: session.foregroundEndedAt
        ? Math.max(0, session.foregroundEndedAt.getTime() - session.startedAt.getTime())
        : null,
      turnCount: new Set(session.traceRuns.flatMap((run) =>
        run.turnOrdinal === null ? [] : [run.turnOrdinal],
      )).size,
      runCount: session._count.traceRuns,
      eventCount: session._count.traceEvents,
      outcome: aggregateHistoryOutcome(session.traceRuns),
      traceCompleteness: aggregateHistoryCompleteness(session.traceRuns),
      payloadState: aggregateHistoryPayloadState(session.traceEvents),
      llmCallCount: session.traceRuns.reduce((sum, run) => sum + run.llmCallCount, 0),
      providerTotalTokens: sumNullable(session.traceRuns.map((run) => run.providerTotalTokens)),
      knownCostUsd: sumNullable(session.traceRuns.map((run) => run.estimatedCostUsd)),
      unpricedLlmCallCount: session.traceRuns.reduce(
        (sum, run) => sum + run.unpricedLlmCallCount,
        0,
      ),
    })),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    hasMore,
  };
}

async function buildTraceSessionPage(
  prisma: PrismaClient,
  session: Awaited<ReturnType<PrismaClient["problemWorkspaceSession"]["findFirst"]>> & {},
  input: { since: number; limit: number },
) {
  const [eventRows, highWater, runs] = await prisma.$transaction([
    prisma.agentTraceEvent.findMany({
      where: {
        workspaceSessionId: session.id,
        seq: { gt: input.since },
      },
      orderBy: { seq: "asc" },
      take: input.limit + 1,
      include: { payload: true },
    }),
    prisma.agentTraceEvent.aggregate({
      where: { workspaceSessionId: session.id },
      _max: { seq: true },
    }),
    prisma.agentTraceRun.findMany({
      where: { workspaceSessionId: session.id },
      orderBy: [{ turnOrdinal: "asc" }, { startedAt: "asc" }],
    }),
  ]);
  const extraRow = eventRows.length > input.limit;
  const visibleEvents = eventRows.slice(0, input.limit);
  const nextSeq = visibleEvents.at(-1)?.seq ?? input.since;
  const highWaterSeq = highWater._max.seq ?? 0;

  return {
    session: projectSession(session),
    turns: runs
      .filter((run) => run.turnOrdinal !== null)
      .map((run) => ({
        turnOrdinal: run.turnOrdinal!,
        traceRunId: run.id,
        path: run.path,
        actionKind: run.actionKind,
        status: run.status,
        traceCompleteness: run.traceCompleteness,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        durationMs: run.durationMs,
      })),
    runs: runs.map(projectRun),
    events: visibleEvents.map(projectEvent),
    nextSeq,
    highWaterSeq,
    hasMore: extraRow || nextSeq < highWaterSeq,
    hasActiveTurn: runs.some((run) => run.turnOrdinal !== null && run.status === "running"),
    backgroundStatus: session.backgroundStatus,
  };
}

function emptyCurrentPage(since: number) {
  return {
    session: null,
    turns: [],
    runs: [],
    events: [],
    nextSeq: since,
    highWaterSeq: 0,
    hasMore: false,
    hasActiveTurn: false,
    backgroundStatus: null,
  };
}

function projectSession(session: {
  id: string;
  userId: string;
  problemId: string;
  browserInstanceId: string;
  startTrigger: string;
  captureLevel: string;
  foregroundStatus: string;
  backgroundStatus: string;
  startedAt: Date;
  lastActivityAt: Date;
  foregroundEndedAt: Date | null;
  endReason: string | null;
  settledAt: Date | null;
  problem?: { id: string; slug: string; title: string };
}) {
  return {
    id: session.id,
    problemId: session.problemId,
    problem: session.problem ?? null,
    browserInstanceId: session.browserInstanceId,
    startTrigger: session.startTrigger,
    captureLevel: session.captureLevel,
    foregroundStatus: session.foregroundStatus,
    backgroundStatus: session.backgroundStatus,
    startedAt: session.startedAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    foregroundEndedAt: session.foregroundEndedAt?.toISOString() ?? null,
    endReason: session.endReason,
    settledAt: session.settledAt?.toISOString() ?? null,
  };
}

function projectRun(run: {
  id: string;
  workspaceSessionId: string | null;
  parentTraceRunId: string | null;
  originatingTraceRunId: string | null;
  turnOrdinal: number | null;
  originatingTurnOrdinal: number | null;
  path: string;
  actionKind: string | null;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  providerTotalTokens: number | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerReasoningTokens: number | null;
  providerCachedTokens: number | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
  pricingStatus: string;
  unpricedLlmCallCount: number;
  llmCallCount: number;
  toolCallCount: number;
  errorCount: number;
  traceOverheadMs: number | null;
  traceCompleteness: string;
  finalFlushAt: Date | null;
}) {
  return {
    id: run.id,
    workspaceSessionId: run.workspaceSessionId,
    parentTraceRunId: run.parentTraceRunId,
    originatingTraceRunId: run.originatingTraceRunId,
    turnOrdinal: run.turnOrdinal,
    originatingTurnOrdinal: run.originatingTurnOrdinal,
    path: run.path,
    actionKind: run.actionKind,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    providerInputTokens: run.providerInputTokens,
    providerOutputTokens: run.providerOutputTokens,
    providerTotalTokens: run.providerTotalTokens,
    providerReasoningTokens: run.providerReasoningTokens,
    providerCachedTokens: run.providerCachedTokens,
    estimatedCostUsd: run.estimatedCostUsd,
    pricingVersion: run.pricingVersion,
    pricingStatus: run.pricingStatus,
    unpricedLlmCallCount: run.unpricedLlmCallCount,
    llmCallCount: run.llmCallCount,
    toolCallCount: run.toolCallCount,
    errorCount: run.errorCount,
    traceOverheadMs: run.traceOverheadMs,
    traceCompleteness: run.traceCompleteness,
    finalFlushAt: run.finalFlushAt?.toISOString() ?? null,
  };
}

function projectEvent(event: {
  id: string;
  eventId: string;
  eventDigest: string;
  seq: number | null;
  traceRunId: string;
  parentTraceRunId: string | null;
  turnOrdinal: number | null;
  stepId: string | null;
  parentStepId: string | null;
  stepIndex: number | null;
  agentIteration: number | null;
  path: string;
  stage: string;
  kind: string;
  title: string;
  status: string;
  occurredAt: Date;
  clientOccurredAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  model: string | null;
  responseModel: string | null;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerReasoningTokens: number | null;
  providerCachedTokens: number | null;
  usageSource: string | null;
  usageMissingReason: string | null;
  estimatedTokens: number | null;
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
  pricingStatus: string | null;
  memoryRssBytes: number | null;
  memoryHeapUsedBytes: number | null;
  resourceScope: string | null;
  detailLevel: string;
  payloadState: string;
  redactedFieldsJson: string | null;
  truncatedFieldsJson: string | null;
  unavailableFieldsJson: string | null;
  metadataJson: string | null;
  payload: {
    promptJson: string | null;
    inputJson: string | null;
    outputJson: string | null;
    retrievalJson: string | null;
    stateDeltaJson: string | null;
    memoryDeltaJson: string | null;
    detailMetadataJson: string | null;
    stdout: string | null;
    stderr: string | null;
    byteSize: number;
  } | null;
}) {
  return {
    id: event.id,
    eventId: event.eventId,
    eventDigest: event.eventDigest,
    seq: event.seq,
    traceRunId: event.traceRunId,
    parentTraceRunId: event.parentTraceRunId,
    turnOrdinal: event.turnOrdinal,
    stepId: event.stepId,
    parentStepId: event.parentStepId,
    stepIndex: event.stepIndex,
    agentIteration: event.agentIteration,
    path: event.path,
    stage: event.stage,
    kind: event.kind,
    title: event.title,
    status: event.status,
    occurredAt: event.occurredAt.toISOString(),
    clientOccurredAt: event.clientOccurredAt?.toISOString() ?? null,
    startedAt: event.startedAt?.toISOString() ?? null,
    endedAt: event.endedAt?.toISOString() ?? null,
    durationMs: event.durationMs,
    model: event.model,
    responseModel: event.responseModel,
    providerInputTokens: event.providerInputTokens,
    providerOutputTokens: event.providerOutputTokens,
    providerTotalTokens: event.providerTotalTokens,
    providerReasoningTokens: event.providerReasoningTokens,
    providerCachedTokens: event.providerCachedTokens,
    usageSource: event.usageSource,
    usageMissingReason: event.usageMissingReason,
    estimatedTokens: event.estimatedTokens,
    estimatedCostUsd: event.estimatedCostUsd,
    pricingVersion: event.pricingVersion,
    pricingStatus: event.pricingStatus,
    memoryRssBytes: event.memoryRssBytes,
    memoryHeapUsedBytes: event.memoryHeapUsedBytes,
    resourceScope: event.resourceScope,
    detailLevel: event.detailLevel,
    payloadState: event.payloadState,
    redactedFields: parseJson(event.redactedFieldsJson, []),
    truncatedFields: parseJson(event.truncatedFieldsJson, []),
    unavailableFields: parseJson(event.unavailableFieldsJson, []),
    metadata: parseJson(event.metadataJson, null),
    payload: event.payload
      ? compactObject({
          prompt: parseJson(event.payload.promptJson, undefined),
          input: parseJson(event.payload.inputJson, undefined),
          output: parseJson(event.payload.outputJson, undefined),
          retrieval: parseJson(event.payload.retrievalJson, undefined),
          stateDelta: parseJson(event.payload.stateDeltaJson, undefined),
          memoryDelta: parseJson(event.payload.memoryDeltaJson, undefined),
          metadata: parseJson(event.payload.detailMetadataJson, undefined),
          stdout: event.payload.stdout ?? undefined,
          stderr: event.payload.stderr ?? undefined,
          byteSize: event.payload.byteSize,
        })
      : null,
  };
}

function aggregateHistoryCompleteness(
  runs: readonly { traceCompleteness: string }[],
) {
  if (runs.length === 0) return "incomplete";
  if (runs.some((run) => run.traceCompleteness === "open" || run.traceCompleteness === "incomplete")) {
    return "incomplete";
  }
  if (runs.some((run) => run.traceCompleteness === "degraded")) return "degraded";
  return "complete";
}

function aggregateHistoryPayloadState(events: readonly { payloadState: string }[]) {
  if (events.length === 0) return "unavailable";
  const states = events.map((event) => event.payloadState);
  if (states.every((state) => state === "captured")) return "full";
  if (states.every((state) => state === "pruned")) return "pruned";
  if (states.every((state) => state === "summary_only")) return "summary_only";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  return "partially_pruned";
}

function aggregateHistoryOutcome(runs: readonly { turnOrdinal: number | null; path: string; status: string }[]) {
  const foreground = runs.filter((run) => run.turnOrdinal !== null && run.path !== "memory_background");
  if (foreground.length === 0) return "unknown";
  if (foreground.some((run) => run.status === "running")) return "running";
  if (foreground.some((run) => run.status === "failed")) return "failed";
  if (foreground.some((run) => run.status === "degraded")) return "degraded";
  return "succeeded";
}

function sumNullable(values: readonly (number | null)[]) {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function parseJson<T>(value: string | null, fallback: T): unknown | T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

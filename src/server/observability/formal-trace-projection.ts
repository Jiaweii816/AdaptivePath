import type { PrismaClient } from "@prisma/client";
import {
  LEGACY_TELEMETRY_EVENT_TYPES,
  type LegacyTelemetryEventType,
} from "@/server/observability/runtime-trace-legacy-mapping";

type FormalTracePrisma = Pick<
  PrismaClient,
  "l1MemoryEvent" | "agentTraceEvent"
>;

export type FormalTraceProjectionRow = {
  id: string;
  traceEventId?: string;
  eventId?: string;
  store: "semantic_l1" | "agent_trace";
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  reviewAttemptId: string | null;
  workspaceSessionId?: string | null;
  traceRunId?: string | null;
  seq?: number | null;
  stepIndex?: number | null;
  eventType: string;
  eventJson: string;
  content: string | null;
  source: string | null;
  occurredAt: Date;
  createdAt: Date;
};

export type FormalTraceProjectionQuery = {
  userId?: string;
  problemId?: string;
  chatSessionId?: string;
  chatSessionIds?: string[];
  reviewAttemptId?: string;
  eventTypes?: string[];
  sources?: string[];
  occurredAt?: { gte?: Date; lte?: Date };
  order?: "asc" | "desc";
  take?: number;
};

const TELEMETRY_TYPES = new Set<string>(LEGACY_TELEMETRY_EVENT_TYPES);

/**
 * Formal post-cutover read model. Memory-semantic events remain in L1 while
 * telemetry-only families are reconstructed from AgentTrace Event/Payload.
 * It intentionally never falls back to telemetry rows that remain in L1.
 */
export async function loadFormalTraceProjection(
  prisma: FormalTracePrisma,
  query: FormalTraceProjectionQuery = {},
): Promise<FormalTraceProjectionRow[]> {
  const requestedTypes = query.eventTypes
    ? new Set(query.eventTypes)
    : undefined;
  const semanticTypes = query.eventTypes?.filter(
    (eventType) => !TELEMETRY_TYPES.has(eventType),
  );
  const requestedTelemetryTypes = query.eventTypes?.filter((eventType) =>
    TELEMETRY_TYPES.has(eventType),
  ) as LegacyTelemetryEventType[] | undefined;
  const shouldReadSemantic = !query.eventTypes || Boolean(semanticTypes?.length);
  const shouldReadTelemetry =
    !query.eventTypes || Boolean(requestedTelemetryTypes?.length);

  const [semanticRows, traceRows, supportRows] = await Promise.all([
    shouldReadSemantic
      ? prisma.l1MemoryEvent.findMany({
          where: {
            ...(query.userId ? { userId: query.userId } : {}),
            ...(query.problemId ? { problemId: query.problemId } : {}),
            ...(query.reviewAttemptId
              ? { reviewAttemptId: query.reviewAttemptId }
              : {}),
            ...chatSessionWhere(query),
            eventType: semanticTypes
              ? { in: semanticTypes }
              : { notIn: [...LEGACY_TELEMETRY_EVENT_TYPES] },
            ...(query.sources ? { source: { in: query.sources } } : {}),
            ...(query.occurredAt ? { occurredAt: query.occurredAt } : {}),
          },
          orderBy: [
            { occurredAt: query.order ?? "asc" },
            { createdAt: query.order ?? "asc" },
            { id: query.order ?? "asc" },
          ],
        })
      : Promise.resolve([]),
    shouldReadTelemetry
      ? prisma.agentTraceEvent.findMany({
          where: {
            ...(query.occurredAt ? { occurredAt: query.occurredAt } : {}),
            ...traceKindWhere(requestedTelemetryTypes),
            traceRun: {
              ...(query.userId ? { userId: query.userId } : {}),
              ...(query.problemId ? { problemId: query.problemId } : {}),
              ...(query.reviewAttemptId
                ? { reviewAttemptId: query.reviewAttemptId }
                : {}),
              ...traceRunChatSessionWhere(query),
            },
          },
          include: { payload: true, traceRun: true },
          orderBy: [
            { occurredAt: query.order ?? "asc" },
            { createdAt: query.order ?? "asc" },
            { id: query.order ?? "asc" },
          ],
        })
      : Promise.resolve([]),
    shouldReadTelemetry
      ? prisma.l1MemoryEvent.findMany({
          where: {
            ...(query.userId ? { userId: query.userId } : {}),
            ...(query.problemId ? { problemId: query.problemId } : {}),
            ...(query.reviewAttemptId
              ? { reviewAttemptId: query.reviewAttemptId }
              : {}),
            ...chatSessionWhere(query),
            eventType: {
              in: ["consolidation_failed", "memory_synthesis_failed"],
            },
            ...(query.sources ? { source: { in: query.sources } } : {}),
            ...(query.occurredAt ? { occurredAt: query.occurredAt } : {}),
          },
        })
      : Promise.resolve([]),
  ]);
  const supportByTraceRunId = new Map(
    supportRows.flatMap((row) => {
      const eventJson = parseJsonRecord(row.eventJson);
      const traceRunId = readString(eventJson.traceRunId);
      return traceRunId ? [[traceRunId, eventJson] as const] : [];
    }),
  );

  const rows: FormalTraceProjectionRow[] = [
    ...semanticRows.map((row) => ({
      ...row,
      store: "semantic_l1" as const,
      traceRunId: readString(parseJsonRecord(row.eventJson).traceRunId) ?? null,
    })),
    ...traceRows.flatMap((row) => {
      const projected = projectAgentTraceEvent(
        row,
        supportByTraceRunId.get(row.traceRunId),
      );
      if (!projected) return [];
      if (requestedTypes && !requestedTypes.has(projected.eventType)) return [];
      return [projected];
    }),
  ].filter((row) => !query.sources || (row.source && query.sources.includes(row.source)));

  rows.sort((left, right) => {
    const direction = query.order === "desc" ? -1 : 1;
    const causalOrder = compareAgentTraceCausalOrder(left, right);
    if (causalOrder !== 0) return direction * causalOrder;
    return direction * (
      left.occurredAt.getTime() - right.occurredAt.getTime() ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
    );
  });

  return query.take === undefined ? rows : rows.slice(0, query.take);
}

/**
 * A trace run's recorder sequence and span step are causal ordering data.
 * They must win over wall-clock ties: SQLite persists DateTime at millisecond
 * resolution, while a tool result and the next model call can both be emitted
 * inside the same millisecond. Falling through to a CUID then made the
 * rendered trace occasionally claim that the model saw a result before it was
 * produced.
 */
function compareAgentTraceCausalOrder(
  left: FormalTraceProjectionRow,
  right: FormalTraceProjectionRow,
) {
  if (
    left.store !== "agent_trace" ||
    right.store !== "agent_trace" ||
    !left.traceRunId ||
    left.traceRunId !== right.traceRunId
  ) {
    return 0;
  }
  if (
    left.seq !== null &&
    left.seq !== undefined &&
    right.seq !== null &&
    right.seq !== undefined &&
    left.seq !== right.seq
  ) {
    return left.seq - right.seq;
  }
  if (
    left.stepIndex !== null &&
    left.stepIndex !== undefined &&
    right.stepIndex !== null &&
    right.stepIndex !== undefined &&
    left.stepIndex !== right.stepIndex
  ) {
    return left.stepIndex - right.stepIndex;
  }
  return toolEventRoleOrder(left) - toolEventRoleOrder(right);
}

function toolEventRoleOrder(row: FormalTraceProjectionRow) {
  if (row.eventType !== "tool_call" && row.eventType !== "tool_result") return 0;
  return row.eventType === "tool_call" ? -1 : 1;
}

type AgentTraceRow = Awaited<
  ReturnType<FormalTracePrisma["agentTraceEvent"]["findMany"]>
>[number] & {
  payload: {
    inputJson: string | null;
    outputJson: string | null;
    retrievalJson: string | null;
    stateDeltaJson: string | null;
    detailMetadataJson: string | null;
  } | null;
  traceRun: {
    userId: string;
    problemId: string | null;
    chatSessionId: string | null;
    reviewAttemptId: string | null;
    actionKind: string | null;
  };
};

function projectAgentTraceEvent(
  row: AgentTraceRow,
  semanticSupport?: Record<string, unknown>,
): FormalTraceProjectionRow | undefined {
  const thinMetadata = parseJsonRecord(row.metadataJson);
  const detailMetadata = parseJsonRecord(row.payload?.detailMetadataJson);
  const metadata = { ...detailMetadata, ...thinMetadata };
  const eventType = projectTelemetryEventType(row, metadata);
  if (!eventType) return undefined;

  const input = parseJsonValue(row.payload?.inputJson);
  const output = parseJsonValue(row.payload?.outputJson);
  const retrieval = parseJsonValue(row.payload?.retrievalJson);
  const stateDelta = parseJsonRecord(row.payload?.stateDeltaJson);
  const unavailableFields = parseJsonValue(row.unavailableFieldsJson);
  const projectedTraceRunId =
    Array.isArray(unavailableFields) && unavailableFields.includes("traceRunId")
      ? undefined
      : row.traceRunId;
  const task = readString(metadata.task);
  const eventJson: Record<string, unknown> = {
    ...metadata,
    traceRunId: projectedTraceRunId,
    stepIndex: row.stepIndex,
    stepId: row.stepId,
    parentStepId: row.parentStepId,
    spanKind: row.kind,
    agentIteration: row.agentIteration,
    path: row.path,
    task,
    status: legacyStatus(row.status, metadata),
    latencyMs: row.durationMs,
  };

  if (eventType === "llm_call") {
    Object.assign(eventJson, {
      model: row.model,
      responseModel: row.responseModel,
      usage: providerUsage(row),
      usageSource: row.usageSource ?? "missing",
      usageMissingReason: row.usageMissingReason,
      "gen_ai.request.model": row.model,
      "gen_ai.response.model": row.responseModel,
      "gen_ai.usage.input_tokens": row.providerInputTokens,
      "gen_ai.usage.output_tokens": row.providerOutputTokens,
      "gen_ai.usage.total_tokens": row.providerTotalTokens,
      error:
        asRecord(output).error ??
        semanticSupport?.error ??
        metadata.error,
    });
  } else if (eventType === "tool_call") {
    eventJson.arguments = input;
  } else if (eventType === "tool_result") {
    eventJson.result = output;
  } else if (eventType === "retrieval_trace") {
    Object.assign(eventJson, asRecord(retrieval));
  } else if (eventType === "reply_safety_replaced") {
    Object.assign(eventJson, asRecord(input), asRecord(output), stateDelta);
  }

  const source = readString(metadata.source);
  return {
    id: row.eventId,
    traceEventId: row.id,
    eventId: row.eventId,
    store: "agent_trace",
    userId: row.traceRun.userId,
    problemId: row.traceRun.problemId,
    chatSessionId: row.traceRun.chatSessionId,
    reviewAttemptId: row.traceRun.reviewAttemptId,
    workspaceSessionId: row.workspaceSessionId,
    traceRunId: projectedTraceRunId ?? null,
    seq: row.seq,
    stepIndex: row.stepIndex,
    eventType,
    eventJson: JSON.stringify(removeUndefined(eventJson)),
    content: row.title,
    source: source ?? null,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}

function projectTelemetryEventType(
  row: { kind: string; title: string; status: string },
  metadata: Record<string, unknown>,
): LegacyTelemetryEventType | undefined {
  if (row.kind === "llm") return "llm_call";
  const role = readString(metadata.eventRole)?.toLowerCase();
  const source = readString(metadata.source)?.toLowerCase();
  if (row.kind === "retrieval") {
    if (
      role === "retrieval_trace" ||
      source === "retrieve_memory" ||
      row.title === "Legacy memory retrieval"
    ) {
      return "retrieval_trace";
    }
    return undefined;
  }
  if (row.kind === "guard") {
    if (
      role === "replacement" ||
      row.title === "Legacy reply safety guard"
    ) {
      return "reply_safety_replaced";
    }
    return undefined;
  }
  if (row.kind !== "tool") return undefined;

  if (role === "result" || /tool result/i.test(row.title)) return "tool_result";
  if (role === "call" || /tool call/i.test(row.title) || row.status === "started") {
    return "tool_call";
  }
  return undefined;
}

function providerUsage(row: {
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
  providerTotalTokens: number | null;
  providerCachedTokens: number | null;
  providerReasoningTokens: number | null;
  usageSource: string | null;
}) {
  if (row.usageSource !== "provider") return null;
  return {
    inputTokens: row.providerInputTokens,
    outputTokens: row.providerOutputTokens,
    totalTokens: row.providerTotalTokens,
    promptTokensDetails:
      row.providerCachedTokens === null
        ? undefined
        : { cachedTokens: row.providerCachedTokens },
    completionTokensDetails:
      row.providerReasoningTokens === null
        ? undefined
        : { reasoningTokens: row.providerReasoningTokens },
  };
}

function legacyStatus(status: string, metadata: Record<string, unknown>) {
  const explicit = readString(metadata.status);
  if (explicit) return explicit;
  if (status === "succeeded") return "ok";
  if (status === "failed") return "error";
  if (status === "skipped") return "denied";
  return status;
}

function traceKindWhere(types: LegacyTelemetryEventType[] | undefined) {
  const requested = new Set(types ?? LEGACY_TELEMETRY_EVENT_TYPES);
  const kinds: string[] = [];
  if (requested.has("llm_call")) kinds.push("llm");
  if (requested.has("tool_call") || requested.has("tool_result")) kinds.push("tool");
  if (requested.has("retrieval_trace")) kinds.push("retrieval");
  if (requested.has("reply_safety_replaced")) kinds.push("guard");
  return { kind: { in: kinds } };
}

function chatSessionWhere(query: FormalTraceProjectionQuery) {
  if (query.chatSessionId) return { chatSessionId: query.chatSessionId };
  if (query.chatSessionIds) return { chatSessionId: { in: query.chatSessionIds } };
  return {};
}

function traceRunChatSessionWhere(query: FormalTraceProjectionQuery) {
  if (query.chatSessionId) return { chatSessionId: query.chatSessionId };
  if (query.chatSessionIds) return { chatSessionId: { in: query.chatSessionIds } };
  return {};
}

function parseJsonValue(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonRecord(value: string | null | undefined) {
  return asRecord(parseJsonValue(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function removeUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

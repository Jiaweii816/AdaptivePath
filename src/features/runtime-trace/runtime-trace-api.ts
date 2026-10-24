import { z } from "zod";

const nullableIsoDateSchema = z.string().datetime({ offset: true }).nullable();
const nullableNonnegativeIntSchema = z.number().int().nonnegative().nullable();
const nullableNonnegativeNumberSchema = z.number().nonnegative().nullable();

export const runtimeTraceProblemSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
});

export const runtimeTraceSessionSchema = z.object({
  id: z.string().min(1),
  problemId: z.string().min(1),
  problem: runtimeTraceProblemSchema.nullable(),
  browserInstanceId: z.string().min(1),
  startTrigger: z.string().min(1),
  captureLevel: z.string().min(1),
  foregroundStatus: z.enum(["active", "closed", "abandoned"]),
  backgroundStatus: z.enum(["idle", "pending", "settled", "failed"]),
  startedAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  foregroundEndedAt: nullableIsoDateSchema,
  endReason: z.string().nullable(),
  settledAt: nullableIsoDateSchema,
});

export const runtimeTraceTurnSchema = z.object({
  turnOrdinal: z.number().int().positive(),
  traceRunId: z.string().min(1),
  path: z.string().min(1),
  actionKind: z.string().nullable(),
  status: z.string().min(1),
  traceCompleteness: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: nullableIsoDateSchema,
  durationMs: nullableNonnegativeIntSchema,
});

export const runtimeTraceRunSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().nullable(),
  parentTraceRunId: z.string().nullable(),
  originatingTraceRunId: z.string().nullable(),
  turnOrdinal: z.number().int().positive().nullable(),
  originatingTurnOrdinal: z.number().int().positive().nullable(),
  path: z.string().min(1),
  actionKind: z.string().nullable(),
  status: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: nullableIsoDateSchema,
  durationMs: nullableNonnegativeIntSchema,
  providerInputTokens: nullableNonnegativeIntSchema,
  providerOutputTokens: nullableNonnegativeIntSchema,
  providerTotalTokens: nullableNonnegativeIntSchema,
  providerReasoningTokens: nullableNonnegativeIntSchema,
  providerCachedTokens: nullableNonnegativeIntSchema,
  estimatedCostUsd: nullableNonnegativeNumberSchema,
  pricingVersion: z.string().nullable(),
  pricingStatus: z.enum(["priced", "partial", "unpriced", "not_applicable"]),
  unpricedLlmCallCount: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  traceOverheadMs: nullableNonnegativeIntSchema,
  traceCompleteness: z.enum(["open", "complete", "degraded", "incomplete"]),
  finalFlushAt: nullableIsoDateSchema,
});

export const runtimeTraceEventSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  eventDigest: z.string().min(1),
  seq: z.number().int().positive().nullable(),
  traceRunId: z.string().min(1),
  parentTraceRunId: z.string().nullable(),
  turnOrdinal: z.number().int().positive().nullable(),
  stepId: z.string().nullable(),
  parentStepId: z.string().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  agentIteration: z.number().int().nonnegative().nullable(),
  path: z.string().min(1),
  stage: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  clientOccurredAt: nullableIsoDateSchema,
  startedAt: nullableIsoDateSchema,
  endedAt: nullableIsoDateSchema,
  durationMs: nullableNonnegativeIntSchema,
  model: z.string().nullable(),
  responseModel: z.string().nullable(),
  providerInputTokens: nullableNonnegativeIntSchema,
  providerOutputTokens: nullableNonnegativeIntSchema,
  providerTotalTokens: nullableNonnegativeIntSchema,
  providerReasoningTokens: nullableNonnegativeIntSchema,
  providerCachedTokens: nullableNonnegativeIntSchema,
  usageSource: z.string().nullable(),
  usageMissingReason: z.string().nullable(),
  estimatedTokens: nullableNonnegativeIntSchema,
  estimatedCostUsd: nullableNonnegativeNumberSchema,
  pricingVersion: z.string().nullable(),
  pricingStatus: z.enum(["priced", "partial", "unpriced", "not_applicable"]).nullable(),
  memoryRssBytes: nullableNonnegativeIntSchema,
  memoryHeapUsedBytes: nullableNonnegativeIntSchema,
  resourceScope: z.string().nullable(),
  detailLevel: z.string().min(1),
  payloadState: z.enum(["captured", "summary_only", "pruned", "unavailable"]),
  redactedFields: z.array(z.string()),
  truncatedFields: z.array(z.string()),
  unavailableFields: z.array(z.string()),
  metadata: z.unknown().nullable(),
  // Uncaptured payload fields are *absent keys* on the wire (trace-query.ts's
  // compactObject() drops them entirely), not `"key": null`. Every field here
  // except `byteSize` (always populated, NOT NULL default 0 in the DB) must
  // therefore tolerate a missing key, not just an explicit null.
  payload: z.object({
    prompt: z.unknown().nullish(),
    input: z.unknown().nullish(),
    output: z.unknown().nullish(),
    retrieval: z.unknown().nullish(),
    stateDelta: z.unknown().nullish(),
    memoryDelta: z.unknown().nullish(),
    metadata: z.unknown().nullish(),
    stdout: z.string().nullish(),
    stderr: z.string().nullish(),
    byteSize: z.number().int().nonnegative(),
  }).nullable(),
});

export const runtimeTracePageSchema = z.object({
  session: runtimeTraceSessionSchema.nullable(),
  turns: z.array(runtimeTraceTurnSchema),
  runs: z.array(runtimeTraceRunSchema),
  events: z.array(runtimeTraceEventSchema),
  nextSeq: z.number().int().nonnegative(),
  highWaterSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  hasActiveTurn: z.boolean(),
  backgroundStatus: z.enum(["idle", "pending", "settled", "failed"]).nullable(),
});

export const runtimeTraceHistorySessionSchema = runtimeTraceSessionSchema.extend({
  durationMs: nullableNonnegativeIntSchema,
  turnCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  outcome: z.enum(["unknown", "running", "succeeded", "failed", "degraded"]),
  traceCompleteness: z.enum(["complete", "degraded", "incomplete"]),
  payloadState: z.enum(["full", "summary_only", "partially_pruned", "pruned", "unavailable"]),
  llmCallCount: z.number().int().nonnegative(),
  providerTotalTokens: nullableNonnegativeIntSchema,
  knownCostUsd: nullableNonnegativeNumberSchema,
  unpricedLlmCallCount: z.number().int().nonnegative(),
});

export const runtimeTraceHistoryPageSchema = z.object({
  sessions: z.array(runtimeTraceHistorySessionSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type RuntimeTraceSession = z.infer<typeof runtimeTraceSessionSchema>;
export type RuntimeTraceTurn = z.infer<typeof runtimeTraceTurnSchema>;
export type RuntimeTraceRun = z.infer<typeof runtimeTraceRunSchema>;
export type RuntimeTraceEvent = z.infer<typeof runtimeTraceEventSchema>;
export type RuntimeTracePage = z.infer<typeof runtimeTracePageSchema>;
export type RuntimeTraceHistorySession = z.infer<typeof runtimeTraceHistorySessionSchema>;
export type RuntimeTraceHistoryPage = z.infer<typeof runtimeTraceHistoryPageSchema>;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RuntimeTraceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly disabled: boolean,
  ) {
    super(message);
    this.name = "RuntimeTraceApiError";
  }
}

export async function fetchCurrentRuntimeTracePage(input: {
  browserInstanceId: string;
  problemId: string;
  since?: number;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}) {
  return fetchTracePage({ ...input, view: "current" });
}

export async function fetchRuntimeTraceDetailPage(input: {
  sessionId: string;
  since?: number;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}) {
  return fetchTracePage({ ...input, view: "detail" });
}

export async function fetchRuntimeTraceHistoryPage(input: {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}) {
  const params = new URLSearchParams({ view: "history", limit: String(input.limit ?? 50) });
  if (input.cursor) params.set("cursor", input.cursor);
  const response = await (input.fetchImpl ?? fetch)(`/api/trace/session?${params}`, {
    signal: input.signal,
  });
  return parseResponse(response, runtimeTraceHistoryPageSchema);
}

export async function endCurrentRuntimeTraceSession(input: {
  browserInstanceId: string;
  problemId: string;
  reason: "problem_changed" | "workbench_navigation" | "explicit_exit";
  keepalive?: boolean;
  fetchImpl?: FetchLike;
}) {
  const response = await (input.fetchImpl ?? fetch)("/api/trace/session/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      browserInstanceId: input.browserInstanceId,
      problemId: input.problemId,
      reason: input.reason,
    }),
    keepalive: input.keepalive,
  });
  return parseResponse(
    response,
    z.object({
      ok: z.literal(true),
      ended: z.boolean(),
      sessionId: z.string().nullable(),
      foregroundStatus: z.literal("closed").nullable(),
    }),
  );
}

async function fetchTracePage(input: {
  view: "current" | "detail";
  browserInstanceId?: string;
  problemId?: string;
  sessionId?: string;
  since?: number;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}) {
  const params = new URLSearchParams({
    view: input.view,
    since: String(input.since ?? 0),
    limit: String(input.limit ?? 200),
  });
  if (input.browserInstanceId) params.set("browserInstanceId", input.browserInstanceId);
  if (input.problemId) params.set("problemId", input.problemId);
  if (input.sessionId) params.set("sessionId", input.sessionId);
  const response = await (input.fetchImpl ?? fetch)(`/api/trace/session?${params}`, {
    signal: input.signal,
  });
  return parseResponse(response, runtimeTracePageSchema);
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "Unable to read runtime trace.";
    throw new RuntimeTraceApiError(message, response.status, response.status === 404 && /disabled/i.test(message));
  }
  return schema.parse(body);
}

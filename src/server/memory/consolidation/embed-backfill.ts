import type { PrismaClient } from "@prisma/client";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  appendTraceEventBestEffort,
  createTraceContext,
  startTraceStep,
  type ProviderUsage,
  type TraceContext,
} from "@/server/llm/trace-context";
import {
  createEmbedClient,
  getEmbeddingDim,
  isEmbeddingConfigured,
  type EmbedClient,
} from "@/server/memory/retrieval/embed-client";
import {
  getDefaultVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import {
  buildLearnerMemoryRetrievalDocuments,
  memoryRetrievalIndexRefId,
} from "@/server/memory/store/retrieval-document-store";

// DashScope's OpenAI-compatible embedding endpoint rejects batches larger
// than 10. Keep the production default at that provider limit and clamp caller
// overrides so a maintenance/backfill script cannot accidentally exceed it.
const MAX_PROVIDER_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = MAX_PROVIDER_BATCH_SIZE;
const MAX_EMBED_BACKFILL_PASSES = 200;

export type RunEmbedBackfillArgs = {
  embedClient?: EmbedClient;
  vectorStore?: VectorStore;
  batchSize?: number;
  /** Claimed memory_background child Run supplied by the durable dispatcher. */
  traceContext?: TraceContext;
  originatingTraceRunId?: string;
  parentTraceRunId?: string;
};

export type EmbedBackfillResult = {
  skipped: boolean;
  embedded: number;
  remaining: number;
  scope: "global_backlog";
  crossSession: true;
  affectedDocumentIds: string[];
  affectedEpisodeIds: string[];
  affectedUserIds: string[];
  affectedChatSessionIds: string[];
};

export async function runEmbedBackfill(
  prisma: PrismaClient,
  args: RunEmbedBackfillArgs = {},
): Promise<EmbedBackfillResult> {
  let aggregate = emptyEmbedResult(false);
  for (let pass = 0; pass < MAX_EMBED_BACKFILL_PASSES; pass += 1) {
    const result = await runEmbedBackfillPass(prisma, args);
    aggregate = mergeEmbedResults(aggregate, result);
    if (result.skipped || result.remaining === 0) return aggregate;
  }
  throw new Error(
    `embed-backfill: backlog did not drain within ${MAX_EMBED_BACKFILL_PASSES} passes`,
  );
}

async function runEmbedBackfillPass(
  prisma: PrismaClient,
  args: RunEmbedBackfillArgs = {},
): Promise<EmbedBackfillResult> {
  const taskStartedAt = Date.now();
  const writePolicy = resolveMemoryWritePolicy();
  if (!writePolicy.durableWrites) {
    await appendEmbedScopeEvent(args.traceContext, {
      stage: "embed_backfill_input",
      kind: "retrieval",
      title: "Load global embedding backlog",
      status: "skipped",
      details: embedScopeDetails([], `ineligible_process_origin:${writePolicy.origin}`),
    });
    return emptyEmbedResult(true);
  }
  if (!args.embedClient && !isEmbeddingConfigured()) {
    await appendEmbedScopeEvent(args.traceContext, {
      stage: "embed_backfill_input",
      kind: "retrieval",
      title: "Load global embedding backlog",
      status: "skipped",
      details: embedScopeDetails([], "embedding_not_configured"),
    });
    return emptyEmbedResult(true);
  }

  const embedClient = args.embedClient ?? createEmbedClient();
  const vectorStore =
    args.vectorStore ??
    getDefaultVectorStore(args.embedClient?.dim ?? getEmbeddingDim());
  if (!vectorStore) {
    await appendEmbedScopeEvent(args.traceContext, {
      stage: "embed_backfill_input",
      kind: "retrieval",
      title: "Load global embedding backlog",
      status: "skipped",
      details: embedScopeDetails([], "vector_store_unavailable"),
    });
    return emptyEmbedResult(true);
  }
  if (embedClient.dim !== vectorStore.dim) {
    throw new Error(
      `embed-backfill: embed client dim ${embedClient.dim} does not match vector index dim ${vectorStore.dim}`,
    );
  }

  const requestedBatchSize =
    args.batchSize === undefined || !Number.isFinite(args.batchSize)
      ? DEFAULT_BATCH_SIZE
      : args.batchSize;
  const batchSize = Math.min(
    MAX_PROVIDER_BATCH_SIZE,
    Math.max(1, Math.floor(requestedBatchSize)),
  );
  const users = await prisma.user.findMany({ select: { id: true } });
  const allDocuments = (
    await Promise.all(
      users.map((user) =>
        buildLearnerMemoryRetrievalDocuments(prisma, { userId: user.id }),
      ),
    )
  )
    .flat()
    .filter((document) =>
      ["fact", "claim_cluster", "episode", "synthesis", "mistake_book"].includes(
        document.ftsKind,
      ),
    );
  for (const kind of [
    "fact",
    "claim_cluster",
    "episode",
    "synthesis",
    "mistake_book",
  ] as const) {
    vectorStore.reconcileProjectionRefs({
      kind,
      refIds: allDocuments
        .filter((document) => document.ftsKind === kind)
        .map(memoryRetrievalIndexRefId),
    });
  }
  const projectionState = new Map(
    vectorStore
      .listProjectionState()
      .map((state) => [state.refId, state] as const),
  );
  const pendingBacklog = allDocuments.filter((document) => {
    const state = projectionState.get(memoryRetrievalIndexRefId(document));
    return (
      !state ||
      state.contentHash !== document.contentHash ||
      state.embeddingModel !== embedClient.model
    );
  });
  const pending = pendingBacklog.slice(0, batchSize);
  if (pending.length === 0) {
    await appendEmbedScopeEvent(args.traceContext, {
      stage: "embed_backfill_input",
      kind: "retrieval",
      title: "Load global embedding backlog",
      status: "skipped",
      details: embedScopeDetails([], "backlog_empty"),
    });
    return emptyEmbedResult(false);
  }

  const pendingEpisodeRows = await prisma.memoryEpisode.findMany({
    where: {
      id: {
        in: pending
          .filter((document) => document.ftsKind === "episode")
          .map((document) => document.sourceRefId),
      },
    },
    select: { id: true, chatSessionId: true },
  });
  const episodeSessionById = new Map(
    pendingEpisodeRows.map((episode) => [episode.id, episode.chatSessionId]),
  );
  const scopedDocuments = pending.map((document) => ({
    id: document.sourceRefId,
    userId: document.learnerId,
    chatSessionId: episodeSessionById.get(document.sourceRefId) ?? null,
    kind: document.ftsKind,
  }));
  const traceContext =
    args.traceContext ??
    createTraceContext({
      prisma,
      userId: pending[0].learnerId,
      path: "memory",
      task: "memory.embed_backfill",
    });
  const affectedDocumentIds = pending.map((document) => document.documentId);
  const affectedEpisodeIds = pending
    .filter((document) => document.ftsKind === "episode")
    .map((document) => document.sourceRefId);
  const affectedUserIds = [
    ...new Set(pending.map((document) => document.learnerId)),
  ];
  const affectedChatSessionIds = [
    ...new Set(
      pendingEpisodeRows
        .map((episode) => episode.chatSessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  await appendEmbedScopeEvent(args.traceContext, {
    stage: "embed_backfill_input",
    kind: "retrieval",
    title: "Load global embedding backlog",
    status: "succeeded",
    details: embedScopeDetails(scopedDocuments),
  });
  const step = startTraceStep(traceContext, { spanKind: "llm" });
  const embeddingInput = pending.map((document) => document.description);
  const embedStartedAt = Date.now();
  let vectors: number[][];
  let usage: ProviderUsage | null | undefined;
  let responseModel: string | null | undefined;

  try {
    if (embedClient.embedWithUsage) {
      const response = await embedClient.embedWithUsage(embeddingInput);
      vectors = response.vectors;
      usage = response.usage;
      responseModel = response.responseModel;
    } else {
      vectors = await embedClient.embed(embeddingInput);
      usage = null;
      responseModel = embedClient.model;
    }
    assertEmbeddingBatch({
      vectors,
      expectedCount: pending.length,
      expectedDim: embedClient.dim,
    });
    addTraceLlmMs(traceContext, Date.now() - embedStartedAt);
  } catch (error) {
    const latencyMs = Date.now() - embedStartedAt;
    addTraceLlmMs(traceContext, latencyMs);
    await appendLlmCallTrace({
      traceContext,
      step,
      task: "memory.embed_backfill",
      source: "memory_agent:embed_backfill",
      content: `embed backfill failed for ${pending.length} retrieval documents`,
      model: embedClient.model,
      responseModel: null,
      latencyMs,
      status: "error",
      finishReason: null,
      usage: null,
      usageMissingReason: "error_response",
      error,
      extraEventJson: {
        provider: embedClient.model,
        embedded: 0,
        remaining: pending.length,
        scope: "global_backlog",
        crossSession: true,
        affectedEpisodeIds,
        affectedDocumentIds,
        affectedUserIds,
        affectedChatSessionIds,
        timings: {
          totalMs: Date.now() - taskStartedAt,
          llmMsTotal: traceContext.llmMsTotal,
        },
      },
    });
    await appendEmbedScopeEvent(args.traceContext, {
      stage: "embed_backfill_failure",
      kind: "error",
      title: "Global embedding backlog failed",
      status: "failed",
      durationMs: Date.now() - taskStartedAt,
      details: {
        output: {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { name: typeof error, message: String(error) },
        },
        metadata: {
          operation: "embed_backfill",
          scope: "global_backlog",
          crossSession: true,
          affectedEpisodeIds,
          affectedDocumentIds,
          affectedUserIds,
          affectedChatSessionIds,
          originOwnsAllEpisodes: false,
        },
      },
    });
    await appendEmbedBackfillFailureTrace(prisma, {
      userId: pending[0].learnerId,
      provider: embedClient.model,
      pendingCount: pending.length,
      durationMs: Date.now() - taskStartedAt,
      llmMsTotal: traceContext.llmMsTotal,
      traceRunId: traceContext.traceRunId,
      error,
    });
    throw error;
  }
  for (const [index, document] of pending.entries()) {
    vectorStore.upsertEmbedding({
      kind: document.ftsKind,
      refId: memoryRetrievalIndexRefId(document),
      embedding: vectors[index],
      contentHash: document.contentHash,
      embeddingModel: embedClient.model,
      learnerId: document.learnerId,
    });
  }

  const remaining = Math.max(0, pendingBacklog.length - pending.length);
  await appendLlmCallTrace({
    traceContext,
    step,
    task: "memory.embed_backfill",
    source: "memory_agent:embed_backfill",
    content: `embedded ${pending.length} retrieval documents (${remaining} remaining)`,
    model: embedClient.model,
    responseModel: responseModel ?? embedClient.model,
    latencyMs: traceContext.llmMsTotal,
    status: "ok",
    finishReason: null,
    usage,
    usageMissingReason: "provider_omitted",
    extraEventJson: {
      provider: embedClient.model,
      embedded: pending.length,
      remaining,
      scope: "global_backlog",
      crossSession: true,
      affectedEpisodeIds,
      affectedDocumentIds,
      affectedUserIds,
      affectedChatSessionIds,
      timings: {
        totalMs: Date.now() - taskStartedAt,
        llmMsTotal: traceContext.llmMsTotal,
      },
    },
  });

  await appendEmbedScopeEvent(args.traceContext, {
    stage: "embed_backfill_persistence",
    kind: "persistence",
    title: "Persist global embedding backlog results",
    status: "succeeded",
    details: {
      output: {
        embedded: pending.length,
        remaining,
        affectedEpisodeIds,
        affectedDocumentIds,
      },
      stateDelta: {
        projectionUpdatedAt: new Date().toISOString(),
      },
      metadata: {
        operation: "embed_backfill_persistence",
        scope: "global_backlog",
        crossSession: true,
        affectedUserIds,
        affectedChatSessionIds,
        originOwnsAllEpisodes: false,
      },
    },
  });

  return {
    skipped: false,
    embedded: pending.length,
    remaining,
    scope: "global_backlog",
    crossSession: true,
    affectedEpisodeIds,
    affectedDocumentIds,
    affectedUserIds,
    affectedChatSessionIds,
  };
}

function assertEmbeddingBatch(args: {
  vectors: number[][];
  expectedCount: number;
  expectedDim: number;
}) {
  if (args.vectors.length !== args.expectedCount) {
    throw new Error(
      `embed-backfill: provider returned ${args.vectors.length} vectors for ${args.expectedCount} documents`,
    );
  }
  for (const [index, vector] of args.vectors.entries()) {
    if (vector.length !== args.expectedDim) {
      throw new Error(
        `embed-backfill: provider vector ${index} dim ${vector.length} does not match expected dim ${args.expectedDim}`,
      );
    }
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error(
        `embed-backfill: provider vector ${index} contains a non-finite value`,
      );
    }
  }
}

async function appendEmbedBackfillFailureTrace(
  prisma: Pick<PrismaClient, "l1MemoryEvent">,
  input: {
    userId: string;
    provider: string;
    pendingCount: number;
    durationMs: number;
    llmMsTotal: number;
    traceRunId: string;
    error: unknown;
  },
) {
  try {
    await appendL1TraceEvent(prisma, {
      userId: input.userId,
      eventType: "memory_synthesis_failed",
      source: "memory_agent:embed_backfill",
      content: input.error instanceof Error ? input.error.message : String(input.error),
      eventJson: {
        traceRunId: input.traceRunId,
        provider: input.provider,
        pendingCount: input.pendingCount,
        timings: {
          totalMs: input.durationMs,
          llmMsTotal: input.llmMsTotal,
        },
        error:
          input.error instanceof Error
            ? { type: input.error.name, message: input.error.message }
            : { type: typeof input.error, message: String(input.error) },
      },
    });
  } catch (traceError) {
    console.warn("Failed to append embed backfill failure trace.", traceError);
  }
}

function emptyEmbedResult(skipped: boolean): EmbedBackfillResult {
  return {
    skipped,
    embedded: 0,
    remaining: 0,
    scope: "global_backlog",
    crossSession: true,
    affectedDocumentIds: [],
    affectedEpisodeIds: [],
    affectedUserIds: [],
    affectedChatSessionIds: [],
  };
}

function mergeEmbedResults(
  aggregate: EmbedBackfillResult,
  result: EmbedBackfillResult,
): EmbedBackfillResult {
  return {
    skipped: aggregate.skipped || result.skipped,
    embedded: aggregate.embedded + result.embedded,
    remaining: result.remaining,
    scope: "global_backlog",
    crossSession: true,
    affectedDocumentIds: uniqueStrings([
      ...aggregate.affectedDocumentIds,
      ...result.affectedDocumentIds,
    ]),
    affectedEpisodeIds: uniqueStrings([
      ...aggregate.affectedEpisodeIds,
      ...result.affectedEpisodeIds,
    ]),
    affectedUserIds: uniqueStrings([
      ...aggregate.affectedUserIds,
      ...result.affectedUserIds,
    ]),
    affectedChatSessionIds: uniqueStrings([
      ...aggregate.affectedChatSessionIds,
      ...result.affectedChatSessionIds,
    ]),
  };
}

function embedScopeDetails(
  documents: Array<{
    id: string;
    userId: string;
    chatSessionId: string | null;
    kind?: string;
  }>,
  skipReason?: string,
) {
  const affectedUserIds = [
    ...new Set(documents.map((document) => document.userId)),
  ];
  const affectedChatSessionIds = [
    ...new Set(
      documents
        .map((document) => document.chatSessionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  return {
    retrieval: {
      affectedDocumentIds: documents.map((document) => document.id),
      affectedEpisodeIds: documents
        .filter((document) => document.kind === "episode")
        .map((document) => document.id),
      affectedUserIds,
      affectedChatSessionIds,
    },
    metadata: {
      operation: "load_embed_backfill_backlog",
      scope: "global_backlog",
      crossSession: true,
      originOwnsAllEpisodes: false,
      skipReason: skipReason ?? null,
    },
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

async function appendEmbedScopeEvent(
  traceContext: TraceContext | undefined,
  input: Parameters<typeof appendTraceEventBestEffort>[1],
) {
  if (!traceContext) return;
  await appendTraceEventBestEffort(traceContext, input);
}

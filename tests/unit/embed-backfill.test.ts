import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTraceContext } from "@/server/llm/trace-context";
import { runEmbedBackfill } from "@/server/memory/consolidation/embed-backfill";
import {
  createFakeEmbedClient,
  isEmbeddingConfigured,
} from "@/server/memory/retrieval/embed-client";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import { createVectorStore } from "@/server/memory/store/vector-store";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const ORIGINAL_MEMORY_ORIGIN = process.env.PATTERNCOACH_MEMORY_ORIGIN;
const ORIGINAL_EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (ORIGINAL_EMBEDDING_API_KEY === undefined) {
    delete process.env.EMBEDDING_API_KEY;
  } else {
    process.env.EMBEDDING_API_KEY = ORIGINAL_EMBEDDING_API_KEY;
  }
  if (ORIGINAL_MEMORY_ORIGIN === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = ORIGINAL_MEMORY_ORIGIN;
  }
});

describe("embed-client", () => {
  it("fake client is deterministic and dimension-correct", async () => {
    const client = createFakeEmbedClient(8);
    const [a1] = await client.embed(["binary search boundary"]);
    const [a2] = await client.embed(["binary search boundary"]);
    const [b] = await client.embed(["hash map two sum"]);

    expect(a1).toHaveLength(8);
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  it("isEmbeddingConfigured reflects EMBEDDING_API_KEY", () => {
    process.env.EMBEDDING_API_KEY = "";
    expect(isEmbeddingConfigured()).toBe(false);
    process.env.EMBEDDING_API_KEY = "sk-test";
    expect(isEmbeddingConfigured()).toBe(true);
  });
});

describe("runEmbedBackfill", () => {
  it("clamps caller batch overrides to the DashScope provider limit of 10", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    for (let index = 0; index < 12; index += 1) {
      await createMemoryEpisode(db.prisma, {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: "learner",
        kind: "review",
        title: `Provider batch cap episode ${index}`,
        summary: `Distinct learner memory document ${index}.`,
        outcome: "resolved",
        tags: ["provider_batch_cap"],
        salience: 0.5,
        sourceTraceIds: [],
      });
    }
    const vectorStore = createVectorStore(db.dbPath, 2);
    const observedBatchSizes: number[] = [];

    const result = await runEmbedBackfill(db.prisma, {
      vectorStore,
      batchSize: 999,
      embedClient: {
        model: "dashscope-compatible-cap-test",
        dim: 2,
        async embed(texts) {
          observedBatchSizes.push(texts.length);
          if (texts.length > 10) throw new Error("batch size must be <= 10");
          return texts.map(() => [1, 0]);
        },
      },
    });

    expect(observedBatchSizes).toEqual([10, 2]);
    expect(result).toMatchObject({ embedded: 12, remaining: 0 });
    vectorStore.close();
  });

  it("rejects an embed-client/vector-index dimension mismatch before calling the provider", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "Dimension gate review",
      summary: "The learner preserved the binary-search interval invariant.",
      outcome: "passed",
      tags: ["binary_search"],
      salience: 0.8,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 7);
    let providerCalls = 0;

    await expect(
      runEmbedBackfill(db.prisma, {
        vectorStore,
        embedClient: {
          model: "dimension-mismatch",
          dim: 8,
          async embed(texts) {
            providerCalls += 1;
            return texts.map(() => new Array<number>(8).fill(0));
          },
        },
      }),
    ).rejects.toThrow(
      "embed-backfill: embed client dim 8 does not match vector index dim 7",
    );
    expect(providerCalls).toBe(0);
    vectorStore.close();
  });

  it("validates the complete provider batch before writing any vector", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "First batch item",
      summary: "The learner preserved a search invariant.",
      outcome: "passed",
      tags: ["binary_search"],
      salience: 0.8,
      sourceTraceIds: [],
    });
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "Second batch item",
      summary: "The learner updated the boundary incorrectly.",
      outcome: "failed",
      tags: ["binary_search"],
      salience: 0.8,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 2);

    await expect(
      runEmbedBackfill(db.prisma, {
        vectorStore,
        batchSize: 10,
        embedClient: {
          model: "malformed-batch",
          dim: 2,
          async embed() {
            return [[1, 0], [1]];
          },
        },
      }),
    ).rejects.toThrow(
      "embed-backfill: provider vector 1 dim 1 does not match expected dim 2",
    );
    expect(
      vectorStore.searchSimilar([1, 0], { kind: "episode", limit: 10 }),
    ).toEqual([]);
    vectorStore.close();
  });

  it("embeds trusted L2 and active L3 retrieval documents without an Episode backlog", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "embed-second-binary-search",
        title: "Embed Second Binary Search",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "strength",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
        value: "Preserves the interval invariant before moving a boundary.",
        confidence: 0.7,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "binary_search_invariant",
          humanLabel: "binary-search interval invariant",
          problemIds: [problem.id, secondProblem.id],
        }),
      },
    });
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "strengths",
        synthesisKey: "binary-search-strength",
        text: "Across problems, the learner preserves binary-search interval invariants.",
        evidenceFactIds: JSON.stringify([fact.id]),
        confidence: 0.7,
        status: "active",
        memoryOrigin: "learner",
      },
    });
    const vectorStore = createVectorStore(db.dbPath, 8);
    const embedClient = createFakeEmbedClient(8);

    const result = await runEmbedBackfill(db.prisma, {
      embedClient,
      vectorStore,
      batchSize: 10,
    });

    expect(result.embedded).toBe(2);
    const [query] = await embedClient.embed([
      "binary-search interval invariant cross problem strength",
    ]);
    expect(
      vectorStore.searchSimilar(query, { kind: "fact", limit: 5 })[0]?.refId,
    ).toBe(fact.id);
    expect(
      vectorStore.searchSimilar(query, { kind: "synthesis", limit: 5 })[0]
        ?.refId,
    ).toBe(slot.id);

    await expect(
      runEmbedBackfill(db.prisma, { embedClient, vectorStore, batchSize: 10 }),
    ).resolves.toMatchObject({ embedded: 0 });
    await db.prisma.l2MemoryFact.update({
      where: { id: fact.id },
      data: { status: "stale" },
    });
    await expect(
      runEmbedBackfill(db.prisma, { embedClient, vectorStore, batchSize: 10 }),
    ).resolves.toMatchObject({ embedded: 0 });
    expect(
      vectorStore.searchSimilar(query, { kind: "fact", limit: 5 }),
    ).toEqual([]);
    expect(
      vectorStore.searchSimilar(query, { kind: "synthesis", limit: 5 }),
    ).toEqual([]);
    vectorStore.close();
  });

  it("never embeds legacy or blocked-noise episodes", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const safe = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "Boundary transition review",
      summary: "The learner explained when the right boundary can move.",
      outcome: "resolved",
      tags: ["binary_search"],
      salience: 0.8,
      sourceTraceIds: [],
    });
    await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: "legacy_unknown",
        kind: "review",
        title: "Legacy review",
        summary: "This record has no trustworthy source provenance.",
        outcome: "unresolved",
        tags: "[]",
        salience: 0.5,
        sourceTraceIds: "[]",
      },
    });
    await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: "learner",
        kind: "review",
        title: "Injected development label",
        summary: "Repeated hardcoded_return placeholder from a demo fixture.",
        outcome: "unresolved",
        tags: JSON.stringify(["hardcoded_return"]),
        salience: 0.5,
        sourceTraceIds: "[]",
      },
    });
    const vectorStore = createVectorStore(db.dbPath, 8);

    const result = await runEmbedBackfill(db.prisma, {
      embedClient: createFakeEmbedClient(8),
      vectorStore,
      batchSize: 10,
    });

    expect(result.affectedEpisodeIds).toEqual([safe.id]);
    const [query] = await createFakeEmbedClient(8).embed([
      "hardcoded return placeholder",
    ]);
    expect(
      vectorStore
        .searchSimilar(query, { kind: "episode", limit: 10 })
        .map((hit) => hit.refId),
    ).toEqual([safe.id]);
    vectorStore.close();
  });

  it("embeds pending episodes and makes them vector-searchable", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const episode = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "Binary Search review #1: off_by_one",
      summary: "Right boundary excluded the answer.",
      outcome: "failed",
      tags: ["binary_search"],
      salience: 0.7,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 8);
    const embedClient = createFakeEmbedClient(8);

    const result = await runEmbedBackfill(db.prisma, {
      embedClient,
      vectorStore,
      batchSize: 10,
    });
    expect(result).toMatchObject({
      skipped: false,
      embedded: 1,
      scope: "global_backlog",
      crossSession: true,
      affectedEpisodeIds: [episode.id],
      affectedUserIds: [user.id],
    });

    const [query] = await embedClient.embed([
      "Binary Search review #1: off_by_one\nRight boundary excluded the answer.\n[\"binary_search\"]",
    ]);
    const hits = vectorStore.searchSimilar(query, { kind: "episode", limit: 5 });
    expect(hits[0]?.refId).toBe(episode.id);

    const second = await runEmbedBackfill(db.prisma, {
      embedClient,
      vectorStore,
      batchSize: 10,
    });
    expect(second).toMatchObject({ embedded: 0 });
    const llmTrace = (await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      sources: ["memory_agent:embed_backfill"],
      take: 1,
    }))[0]!;
    const eventJson = JSON.parse(llmTrace.eventJson);
    expect(eventJson).toMatchObject({
      path: "memory_background",
      task: "memory.embed_backfill",
      status: "ok",
      usage: null,
      usageSource: "missing",
      usageMissingReason: "provider_omitted",
      embedded: 1,
      remaining: 0,
      timings: {
        totalMs: expect.any(Number),
        llmMsTotal: expect.any(Number),
      },
    });
    vectorStore.close();
  });

  it("records provider embedding usage when the client exposes it", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      kind: "review",
      title: "Hash Map review",
      summary: "Hardcoded answer.",
      outcome: "failed",
      tags: ["hash_table"],
      salience: 0.7,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 2);

    await runEmbedBackfill(db.prisma, {
      vectorStore,
      batchSize: 10,
      embedClient: {
        model: "text-embedding-v4",
        dim: 2,
        async embed(texts) {
          return texts.map(() => [1, 0]);
        },
        async embedWithUsage(texts) {
          return {
            vectors: texts.map(() => [1, 0]),
            usage: {
              prompt_tokens: 11,
              completion_tokens: 0,
              total_tokens: 11,
            },
            responseModel: "text-embedding-v4",
          };
        },
      },
    });

    const llmTrace = (await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      sources: ["memory_agent:embed_backfill"],
      take: 1,
    }))[0]!;
    expect(JSON.parse(llmTrace.eventJson)).toMatchObject({
      usageSource: "provider",
      usage: {
        inputTokens: 11,
        outputTokens: 0,
        totalTokens: 11,
      },
    });
    vectorStore.close();
  });

  it("reports cross-session episode ids honestly for the global backlog", async () => {
    db = await createMemoryTestDb();
    const first = await seedMinimalUserAndProblem(db.prisma);
    const secondUser = await db.prisma.user.create({
      data: { handle: "second-user" },
    });
    const secondSession = await db.prisma.chatSession.create({
      data: {
        userId: secondUser.id,
        problemId: first.problem.id,
        title: first.problem.title,
        isActive: true,
      },
    });
    const firstEpisode = await createMemoryEpisode(db.prisma, {
      userId: first.user.id,
      problemId: first.problem.id,
      memoryOrigin: "learner",
      chatSessionId: first.chatSession.id,
      kind: "chat_segment",
      title: "First session",
      summary: "First session memory.",
      outcome: "resolved",
      tags: ["array"],
      salience: 0.5,
      sourceTraceIds: [],
    });
    const secondEpisode = await createMemoryEpisode(db.prisma, {
      userId: secondUser.id,
      problemId: first.problem.id,
      memoryOrigin: "learner",
      chatSessionId: secondSession.id,
      kind: "chat_segment",
      title: "Second session",
      summary: "Second session memory.",
      outcome: "resolved",
      tags: ["array"],
      salience: 0.5,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 8);

    const result = await runEmbedBackfill(db.prisma, {
      embedClient: createFakeEmbedClient(8),
      vectorStore,
      batchSize: 10,
    });

    expect(result).toMatchObject({
      scope: "global_backlog",
      crossSession: true,
      embedded: 2,
    });
    expect(result.affectedEpisodeIds).toEqual(
      expect.arrayContaining([firstEpisode.id, secondEpisode.id]),
    );
    expect(result.affectedUserIds).toEqual(
      expect.arrayContaining([first.user.id, secondUser.id]),
    );
    expect(result.affectedChatSessionIds).toEqual(
      expect.arrayContaining([first.chatSession.id, secondSession.id]),
    );

    vectorStore.close();
  });

  it("attaches global-scope retrieval and persistence to the supplied child Run", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const episode = await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "learner",
      chatSessionId: chatSession.id,
      kind: "chat_segment",
      title: "Scoped trace",
      summary: "The backlog remains global even when a turn triggers it.",
      outcome: "resolved",
      tags: ["array"],
      salience: 0.5,
      sourceTraceIds: [],
    });
    const vectorStore = createVectorStore(db.dbPath, 8);
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      problemId: problem.id,
      path: "memory_background",
      task: "memory.embed_backfill",
      captureLevel: "full",
      bufferedRecorder: false,
    });

    const result = await runEmbedBackfill(db.prisma, {
      traceContext,
      embedClient: createFakeEmbedClient(8),
      vectorStore,
    });

    expect(result.affectedEpisodeIds).toEqual([episode.id]);
    const events = await db.prisma.agentTraceEvent.findMany({
      where: { traceRunId: traceContext.traceRunId },
      include: { payload: true },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => `${event.kind}:${event.stage}`)).toEqual(
      expect.arrayContaining([
        "retrieval:embed_backfill_input",
        "persistence:embed_backfill_persistence",
      ]),
    );
    const payloads = events
      .flatMap((event) => [
        event.payload?.retrievalJson,
        event.payload?.outputJson,
        event.payload?.detailMetadataJson,
      ])
      .filter((value): value is string => Boolean(value))
      .join("\n");
    expect(payloads).toContain('"scope":"global_backlog"');
    expect(payloads).toContain(episode.id);

    vectorStore.close();
  });

  it("skips explicitly when embedding is not configured and no client injected", async () => {
    db = await createMemoryTestDb();
    delete process.env.EMBEDDING_API_KEY;
    const result = await runEmbedBackfill(db.prisma, {});
    expect(result).toMatchObject({ skipped: true, embedded: 0 });
  });
});

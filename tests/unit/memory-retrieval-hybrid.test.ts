import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRetrievalQueryPlan } from "@/server/memory/retrieval/build-retrieval-query-plan";
import { factCandidate } from "@/server/memory/retrieval/candidate-source-adapters";
import { createFakeEmbedClient } from "@/server/memory/retrieval/embed-client";
import { searchCandidateRanks } from "@/server/memory/retrieval/hybrid-candidate-recall";
import {
  createFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import {
  createVectorStore,
  type VectorStore,
} from "@/server/memory/store/vector-store";
import {
  buildLearnerMemoryRetrievalDocuments,
  reconcileLearnerMemoryRetrievalDocuments,
} from "@/server/memory/store/retrieval-document-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
let fts: FtsStore | undefined;
let vectorStore: VectorStore | undefined;

const QUERY = "binary search right boundary";
const BINARY_EPISODE_ID = "episode-binary-boundary";
const HASH_EPISODE_ID = "episode-hash-map";
const BINARY_FACT_ID = "fact-binary-boundary";

afterEach(async () => {
  vectorStore?.close();
  fts?.close();
  await db?.cleanup();
  vectorStore = undefined;
  fts = undefined;
  db = undefined;
  vi.unstubAllEnvs();
});

async function createIndexedStores(options: { withVectors: boolean }) {
  db = await createMemoryTestDb();
  fts = createFtsStore(db.dbPath);

  fts.indexMemoryDocument({
    kind: "fact",
    refId: BINARY_FACT_ID,
    content: "Binary search right boundary invariant",
  });
  fts.indexMemoryDocument({
    kind: "episode",
    refId: BINARY_EPISODE_ID,
    content: QUERY,
  });
  fts.indexMemoryDocument({
    kind: "episode",
    refId: HASH_EPISODE_ID,
    content: "Two Sum hash map complement lookup",
  });

  if (options.withVectors) {
    const embedClient = createFakeEmbedClient(8);
    vectorStore = createVectorStore(db.dbPath, embedClient.dim);
    const [binaryEmbedding, hashEmbedding] = await embedClient.embed([
      QUERY,
      "Two Sum hash map complement lookup",
    ]);
    vectorStore.upsertEmbedding({
      kind: "episode",
      refId: BINARY_EPISODE_ID,
      embedding: binaryEmbedding,
    });
    vectorStore.upsertEmbedding({
      kind: "episode",
      refId: HASH_EPISODE_ID,
      embedding: hashEmbedding,
    });
    return { fts, vectorStore, embedClient };
  }

  return { fts };
}

describe("searchCandidateRanks", () => {
  it("uses open-world v2 claim semantics without treating the opaque cluster key as a concept", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "knowledge_state",
        tag: "claim_cluster_opaque_7f31",
        label: "Needs practice with monotone frontier compression",
        value: "The learner loses the compressed frontier invariant.",
        claimText:
          "The learner loses the monotone frontier compression invariant.",
        scopeJson: JSON.stringify({
          level: "mechanism",
          topicHints: ["monotone frontier compression"],
        }),
        mechanismKeysJson: "[]",
        polarity: "negative",
        integrityVersion: 2,
        confidence: 0.8,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "claim_cluster_opaque_7f31",
          humanLabel: "Compatibility claim cluster",
          clusterCount: 2,
        }),
      },
      include: { problem: true },
    });
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "上次 monotone frontier compression 哪里出错？",
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        tags: ["monotone frontier compression"],
      },
    });

    const candidate = factCandidate(fact, plan, new Map([[fact.id, 0]]));

    expect(candidate?.concepts).toContain("monotone_frontier_compression");
    expect(candidate?.concepts).not.toContain("claim_cluster_opaque_7f31");
    expect(candidate?.role).toBe("recurring_mistake");
    expect(candidate?.retrievalSignals).toMatchObject({
      conceptMatch: "candidate",
    });
    fts = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
      ftsStore: fts,
    });
    const recall = await searchCandidateRanks({
      fts,
      query: "monotone frontier compression",
      vectorMode: "disabled",
    });
    expect(recall.factRanks.has(fact.id)).toBe(true);
    const documents = await buildLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
    });
    expect(
      documents.find(
        (document) =>
          document.sourceKind === "l2_fact" && document.sourceRefId === fact.id,
      ),
    ).toMatchObject({
      canonicalMechanisms: [],
      searchableAliases: ["monotone frontier compression"],
    });
  });

  it("preserves a vector-only rank when hydrating an L2 fact candidate", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "hybrid-second-binary-search",
        title: "Hybrid Second Binary Search",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: "binary_search_invariant",
        label: "binary-search boundary update broke the loop invariant",
        value: "Boundary updates repeatedly broke the interval invariant.",
        confidence: 0.8,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "binary_search_invariant",
          humanLabel: "binary-search interval invariant",
          problemIds: [problem.id, secondProblem.id],
        }),
      },
      include: { problem: true },
    });
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "二分查找每次边界更新都把循环不变量搞坏",
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        tags: [],
      },
    });

    const candidate = factCandidate(
      fact,
      plan,
      new Map(),
      new Map([[fact.id, 0]]),
    );

    expect(candidate?.retrievalSignals).toMatchObject({
      lexicalRank: undefined,
      vectorRank: 0,
    });
  });

  it("returns lexical_only ranks when embedding is unavailable", async () => {
    vi.stubEnv("EMBEDDING_API_KEY", "");
    const stores = await createIndexedStores({ withVectors: false });

    const result = await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
    });

    expect(result.mode).toBe("lexical_only");
    expect(result.factRanks.get(BINARY_FACT_ID)).toBe(0);
    expect(result.episodeRanks.get(BINARY_EPISODE_ID)).toBe(0);
    expect(result.vectorEpisodeRanks.size).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("returns full ranks with an explicit vector store and fake embed client", async () => {
    const stores = await createIndexedStores({ withVectors: true });

    const result = await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
      vectorStore: stores.vectorStore,
      embedClient: stores.embedClient,
    });

    expect(result.mode).toBe("full");
    expect(result.episodeRanks.get(BINARY_EPISODE_ID)).toBe(0);
    expect(result.vectorEpisodeRanks.get(BINARY_EPISODE_ID)).toBe(0);
    expect(result.vectorEpisodeDistances.get(BINARY_EPISODE_ID)).toBe(0);
    expect(result.vectorEpisodeRanks.has(HASH_EPISODE_ID)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects distant vector neighbours without affecting lexical recall", async () => {
    db = await createMemoryTestDb();
    fts = createFtsStore(db.dbPath);
    fts.indexMemoryDocument({
      kind: "fact",
      refId: "lexical-survivor",
      content: "frontier invariant",
    });
    vectorStore = createVectorStore(db.dbPath, 4);
    vectorStore.upsertEmbedding({
      kind: "fact",
      refId: "near-vector",
      embedding: [1, 0, 0, 0],
    });
    vectorStore.upsertEmbedding({
      kind: "fact",
      refId: "orthogonal-vector",
      embedding: [0, 1, 0, 0],
    });

    const result = await searchCandidateRanks({
      fts,
      query: "frontier invariant",
      semanticQuery: "unknown open world topic",
      vectorStore,
      embedClient: {
        model: "controlled-test",
        dim: 4,
        embed: async () => [[1, 0, 0, 0]],
      },
    });

    expect(result.factRanks.has("lexical-survivor")).toBe(true);
    expect(result.vectorFactRanks.get("near-vector")).toBe(0);
    expect(result.vectorFactDistances.get("near-vector")).toBe(0);
    expect(result.vectorFactRanks.has("orthogonal-vector")).toBe(false);
    expect(result.vectorFactDistances.has("orthogonal-vector")).toBe(false);
  });

  it("supports an explicit lexical-only control without calling embeddings", async () => {
    const stores = await createIndexedStores({ withVectors: true });
    const baseClient = stores.embedClient!;
    let providerCalls = 0;

    const result = await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
      vectorMode: "disabled",
      vectorStore: stores.vectorStore,
      embedClient: {
        ...baseClient,
        async embed(texts) {
          providerCalls += 1;
          return baseClient.embed(texts);
        },
      },
    });

    expect(result.mode).toBe("lexical_only");
    expect(result.factRanks.get(BINARY_FACT_ID)).toBe(0);
    expect(result.vectorFactRanks.size).toBe(0);
    expect(result.vectorEpisodeRanks.size).toBe(0);
    expect(result.vectorSynthesisRanks.size).toBe(0);
    expect(providerCalls).toBe(0);
  });

  it("embeds the semantic user query while keeping structured terms for FTS", async () => {
    const stores = await createIndexedStores({ withVectors: true });
    const embeddedInputs: string[][] = [];
    const baseClient = stores.embedClient!;

    const result = await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
      semanticQuery: "二分查找每次边界更新都把循环不变量搞坏",
      vectorStore: stores.vectorStore,
      embedClient: {
        ...baseClient,
        async embed(texts) {
          embeddedInputs.push(texts);
          return baseClient.embed(texts);
        },
      },
    });

    expect(result.mode).toBe("full");
    expect(result.factRanks.get(BINARY_FACT_ID)).toBe(0);
    expect(embeddedInputs).toEqual([
      ["二分查找每次边界更新都把循环不变量搞坏"],
    ]);
  });

  it("embeds learner wording together with active graph-DFS context", async () => {
    const stores = await createIndexedStores({ withVectors: true });
    const embeddedInputs: string[][] = [];
    const baseClient = stores.embedClient!;
    const retrievalPlan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "这个模式眼熟，上次在哪里栽坑？",
      problem: {
        id: "133",
        slug: "clone-graph",
        title: "Clone Graph",
        leetcodeNumber: 133,
        tags: ["Graph", "Depth-First Search"],
      },
    });

    await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
      semanticQuery: retrievalPlan.semanticQuery,
      vectorStore: stores.vectorStore,
      embedClient: {
        ...baseClient,
        async embed(texts) {
          embeddedInputs.push(texts);
          return baseClient.embed(texts);
        },
      },
    });

    expect(embeddedInputs[0]?.[0]).toContain("上次在哪里栽坑");
    expect(embeddedInputs[0]?.[0]).toContain("Clone Graph");
    expect(embeddedInputs[0]?.[0]).toContain("Depth-First Search");
  });

  it("returns partial_failure while preserving FTS ranks when embedding throws", async () => {
    const stores = await createIndexedStores({ withVectors: true });

    const result = await searchCandidateRanks({
      fts: stores.fts,
      query: QUERY,
      vectorStore: stores.vectorStore,
      embedClient: {
        model: "throwing-test-embedder",
        dim: 8,
        embed: async () => {
          throw new Error("embedding endpoint down");
        },
      },
    });

    expect(result.mode).toBe("partial_failure");
    expect(result.factRanks.get(BINARY_FACT_ID)).toBe(0);
    expect(result.episodeRanks.get(BINARY_EPISODE_ID)).toBe(0);
    expect(result.vectorEpisodeRanks.size).toBe(0);
    expect(result.errors).toEqual(["vector:embedding endpoint down"]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimClusterRefId,
  recallClaimRelationCandidates,
} from "@/server/memory/claims/claim-relation-candidate-recall";
import { runEmbedBackfill } from "@/server/memory/consolidation/embed-backfill";
import { createFakeEmbedClient } from "@/server/memory/retrieval/embed-client";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import { createVectorStore } from "@/server/memory/store/vector-store";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("claim relation candidate recall", () => {
  it("recalls an unknown-topic claim with no canonical mechanism", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "claim-user" } });
    const fact = await createClaim(user.id, {
      claimText: "在陌生的颜色切换递归中容易忘记恢复局部染色状态。",
      topicHints: ["颜色切换递归"],
      optionalMechanisms: [],
    });
    const fts = createFtsStore(db.dbPath);
    try {
      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      const result = await recallClaimRelationCandidates(db.prisma, {
        userId: user.id,
        query: "颜色切换递归 恢复染色状态",
        limit: 5,
        ftsStore: fts,
        vectorMode: "disabled",
      });

      expect(result.mode).toBe("lexical_only");
      expect(result.candidates).toEqual([
        expect.objectContaining({
          factId: fact.id,
          claimText: "在陌生的颜色切换递归中容易忘记恢复局部染色状态。",
          claimType: "weakness",
          polarity: "negative",
          optionalMechanisms: [],
        }),
      ]);
      expect(
        fts.searchMemoryFts("颜色切换递归", { kind: "fact", limit: 5 }),
      ).toEqual([]);
    } finally {
      fts.close();
    }
  });

  it("hydrates with user/origin/status/version guards even when stale index rows exist", async () => {
    db = await createMemoryTestDb();
    const [owner, other] = await Promise.all([
      db.prisma.user.create({ data: { handle: "claim-owner" } }),
      db.prisma.user.create({ data: { handle: "claim-other" } }),
    ]);
    const valid = await createClaim(owner.id, {
      claimText: "网格遍历时需要显式维护访问状态。",
    });
    const wrongOwner = await createClaim(other.id, {
      claimText: "网格遍历时需要显式维护访问状态。",
      tagSuffix: "other",
    });
    const stale = await createClaim(owner.id, {
      claimText: "网格遍历时需要显式维护访问状态。",
      status: "resolved",
      tagSuffix: "resolved",
    });
    const legacyVersion = await createClaim(owner.id, {
      claimText: "网格遍历时需要显式维护访问状态。",
      integrityVersion: 1,
      tagSuffix: "v1",
    });
    const fts = createFtsStore(db.dbPath);
    try {
      for (const fact of [valid, wrongOwner, stale, legacyVersion]) {
        fts.indexMemoryDocument({
          kind: "claim_cluster",
          refId: claimClusterRefId(fact.id),
          content: `网格遍历 访问状态\n${fact.claimText!}`,
          learnerId: fact.userId,
        });
      }
      const result = await recallClaimRelationCandidates(db.prisma, {
        userId: owner.id,
        query: "网格遍历 访问状态",
        limit: 10,
        ftsStore: fts,
        vectorMode: "disabled",
      });

      expect(result.candidates.map((candidate) => candidate.factId)).toEqual([
        valid.id,
      ]);
    } finally {
      fts.close();
    }
  });

  it("returns positive and negative semantic neighbours without merging or labeling them", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "polarity-user" } });
    const negative = await createClaim(user.id, {
      claimText: "图 DFS 中经常忘记标记 visited。",
      polarity: "negative",
      claimType: "weakness",
      tagSuffix: "negative",
    });
    const positive = await createClaim(user.id, {
      claimText: "图 DFS 中能够稳定标记 visited。",
      polarity: "positive",
      claimType: "strength",
      tagSuffix: "positive",
    });
    const fts = createFtsStore(db.dbPath);
    try {
      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      const result = await recallClaimRelationCandidates(db.prisma, {
        userId: user.id,
        query: "图 DFS 标记 visited",
        limit: 5,
        ftsStore: fts,
        vectorMode: "disabled",
      });

      expect(new Set(result.candidates.map((item) => item.factId))).toEqual(
        new Set([negative.id, positive.id]),
      );
      expect(result.candidates.map((item) => item.polarity)).toEqual(
        expect.arrayContaining(["negative", "positive"]),
      );
      expect(result.candidates.every((item) => !("relation" in item))).toBe(true);
      await expect(db.prisma.memoryClaimRelation.count()).resolves.toBe(0);
      await expect(db.prisma.memoryEvidenceContribution.count()).resolves.toBe(0);
    } finally {
      fts.close();
    }
  });

  it("falls back to lexical candidates when semantic embedding fails", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "fallback-user" } });
    const fact = await createClaim(user.id, {
      claimText: "双端收缩时能够稳定维护左右边界。",
      topicHints: ["双端收缩", "左右边界"],
    });
    const fts = createFtsStore(db.dbPath);
    const vector = createVectorStore(db.dbPath, 4);
    try {
      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      const result = await recallClaimRelationCandidates(db.prisma, {
        userId: user.id,
        query: "双端收缩 左右边界",
        limit: 5,
        ftsStore: fts,
        vectorStore: vector,
        embedClient: {
          model: "failing-embed",
          dim: 4,
          async embed() {
            throw new Error("provider unavailable");
          },
        },
      });

      expect(result.mode).toBe("partial_failure");
      expect(result.errors).toEqual(["vector:provider unavailable"]);
      expect(result.candidates[0]?.factId).toBe(fact.id);
    } finally {
      vector.close();
      fts.close();
    }
  });

  it("backfills prefixed claim-cluster vectors without publishing ordinary Coach facts", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "embed-claim-user" } });
    const fact = await createClaim(user.id, {
      claimText: "开放世界主题中的状态恢复仍需练习。",
    });
    const vector = createVectorStore(db.dbPath, 8);
    const embedClient = createFakeEmbedClient(8);
    try {
      const result = await runEmbedBackfill(db.prisma, {
        vectorStore: vector,
        embedClient,
        batchSize: 10,
      });
      const [query] = await embedClient.embed([fact.claimText!]);

      expect(result.embedded).toBe(1);
      expect(
        vector.searchSimilar(query, { kind: "claim_cluster", limit: 5 })[0]
          ?.refId,
      ).toBe(claimClusterRefId(fact.id));
      expect(vector.searchSimilar(query, { kind: "fact", limit: 5 })).toEqual(
        [],
      );
    } finally {
      vector.close();
    }
  });

  async function createClaim(
    userId: string,
    args: {
      claimText: string;
      claimType?: string;
      polarity?: string;
      status?: string;
      integrityVersion?: number;
      optionalMechanisms?: string[];
      topicHints?: string[];
      tagSuffix?: string;
    },
  ) {
    const suffix = args.tagSuffix ?? Math.random().toString(36).slice(2);
    return db!.prisma.l2MemoryFact.create({
      data: {
        userId,
        factType: args.claimType ?? "weakness",
        tag: `claim_${suffix}`,
        label: args.claimText,
        value: args.claimText,
        claimText: args.claimText,
        clusterKey: `claim:v2:${userId}:${suffix}`,
        polarity: args.polarity ?? "negative",
        scopeJson: JSON.stringify({
          level: "mechanism",
          problemIds: [],
          topicHints: args.topicHints ?? [],
        }),
        mechanismKeysJson: JSON.stringify(args.optionalMechanisms ?? []),
        integrityVersion: args.integrityVersion ?? 2,
        status: args.status ?? "candidate",
        source: "memory_agent_claim",
        memoryOrigin: "learner",
      },
    });
  }
});

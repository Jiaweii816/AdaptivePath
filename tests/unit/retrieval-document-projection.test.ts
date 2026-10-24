import { afterEach, describe, expect, it } from "vitest";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  buildLearnerMemoryRetrievalDocuments,
  reconcileLearnerMemoryRetrievalDocuments,
} from "@/server/memory/store/retrieval-document-store";
import {
  createMemoryTestDb,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("learner memory retrieval-document projection", () => {
  it("reconciles a global learner manifest without deleting another user's FTS rows", async () => {
    db = await createMemoryTestDb();
    const fts = createFtsStore(db.dbPath);
    const users = await Promise.all(
      ["alpha", "beta"].map((suffix) =>
        db!.prisma.user.create({ data: { handle: `fts-${suffix}` } }),
      ),
    );
    const problems = await Promise.all(
      ["alpha", "beta"].map((suffix) =>
        db!.prisma.problem.create({
          data: {
            slug: `fts-${suffix}-problem`,
            title: `FTS ${suffix} problem`,
            methodName: "solve",
            tags: JSON.stringify([`${suffix}_unknown_topic`]),
          },
        }),
      ),
    );
    const facts = await Promise.all(
      users.map((user, index) =>
        db!.prisma.l2MemoryFact.create({
          data: {
            userId: user.id,
            problemId: problems[index]!.id,
            factType: "weakness",
            tag: `${index === 0 ? "alpha" : "beta"}_unknown_topic`,
            label: `${index === 0 ? "alpha" : "beta"} unique frontier invariant`,
            value: `${index === 0 ? "alpha" : "beta"} unique frontier invariant`,
            confidence: 0.8,
            status: "active",
            ...trustedL2FactFixture({
              mechanism: `${index === 0 ? "alpha" : "beta"}_unknown_topic`,
              humanLabel: `${index === 0 ? "alpha" : "beta"} unique frontier invariant`,
              clusterCount: 2,
            }),
          },
        }),
      ),
    );

    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: users[0]!.id,
      ftsStore: fts,
    });
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: users[1]!.id,
      ftsStore: fts,
    });

    expect(fts.searchMemoryFts("alpha", { kind: "fact", limit: 5 }))
      .toEqual([expect.objectContaining({ refId: facts[0]!.id })]);
    expect(fts.searchMemoryFts("beta", { kind: "fact", limit: 5 }))
      .toEqual([expect.objectContaining({ refId: facts[1]!.id })]);
    await db.prisma.l2MemoryFact.update({
      where: { id: facts[0]!.id },
      data: { status: "stale" },
    });
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: users[0]!.id,
      ftsStore: fts,
    });
    expect(fts.searchMemoryFts("alpha", { kind: "fact", limit: 5 }))
      .toEqual([]);
    expect(fts.searchMemoryFts("beta", { kind: "fact", limit: 5 }))
      .toEqual([expect.objectContaining({ refId: facts[1]!.id })]);
    fts.close();
  });

  it("builds deterministic L2/L3 documents and reconciles idempotently", async () => {
    db = await createMemoryTestDb();
    const fixture = await seedCrossProblemStrength(db);
    const fts = createFtsStore(db.dbPath);

    const documents = await buildLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: fixture.userId,
    });
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: `l2_fact:${fixture.factId}`,
          rootMemoryId: fixture.factId,
          sourceKind: "l2_fact",
          truthClass: "trusted",
          role: "strength",
          canonicalMechanisms: ["binary_search_invariant"],
          evidenceClusterCount: 2,
          distinctProblemCount: 2,
          contentVersion: 1,
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          documentId: `l3_synthesis:${fixture.slotId}`,
          sourceKind: "l3_synthesis",
          truthClass: "trusted",
          evidenceClusterCount: 2,
          distinctProblemCount: 2,
        }),
      ]),
    );

    const first = await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: fixture.userId,
      ftsStore: fts,
    });
    const firstFactHits = fts.searchMemoryFts("binary search invariant", {
      kind: "fact",
      limit: 10,
    });
    const firstSynthesisHits = fts.searchMemoryFts("cross problem strength", {
      kind: "synthesis",
      limit: 10,
    });
    const second = await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: fixture.userId,
      ftsStore: fts,
    });

    expect(second.manifestHash).toBe(first.manifestHash);
    expect(second.documentCount).toBe(first.documentCount);
    expect(fts.searchMemoryFts("binary search invariant", {
      kind: "fact",
      limit: 10,
    })).toEqual(firstFactHits);
    expect(fts.searchMemoryFts("cross problem strength", {
      kind: "synthesis",
      limit: 10,
    })).toEqual(firstSynthesisHits);
    fts.close();
  });

  it("tombstones stale L2 and dependent L3 documents during reconciliation", async () => {
    db = await createMemoryTestDb();
    const fixture = await seedCrossProblemStrength(db);
    const fts = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: fixture.userId,
      ftsStore: fts,
    });
    expect(fts.searchMemoryFts("binary search invariant", {
      kind: "fact",
      limit: 10,
    })).toHaveLength(1);
    expect(fts.searchMemoryFts("cross problem strength", {
      kind: "synthesis",
      limit: 10,
    })).toHaveLength(1);

    await db.prisma.l2MemoryFact.update({
      where: { id: fixture.factId },
      data: { status: "stale" },
    });
    const result = await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: fixture.userId,
      ftsStore: fts,
    });

    expect(result.removed).toBe(2);
    expect(result.documentCount).toBe(0);
    expect(fts.searchMemoryFts("binary search invariant", {
      kind: "fact",
      limit: 10,
    })).toEqual([]);
    expect(fts.searchMemoryFts("cross problem strength", {
      kind: "synthesis",
      limit: 10,
    })).toEqual([]);
    fts.close();
  });

  it("projects stored assisted-repair mechanisms as historical lexical aliases", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "repair-projection-user" } });
    const problem = await db.prisma.problem.create({
      data: {
        slug: "search-insert-position-repair-projection",
        title: "Search Insert Position Repair Projection",
        methodName: "searchInsert",
        tags: JSON.stringify(["binary_search", "array"]),
      },
    });
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        kind: "assisted_repair",
        title: "Resolved interval repair",
        summary:
          "The failed boundary update was repaired after Coach guidance and the changed revision passed Review evidence.",
        outcome: "resolved",
        tags: JSON.stringify(["binary_search", "binary_search_invariant"]),
        sourceTraceIds: JSON.stringify(["repair-chain-evidence"]),
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      const documents = await buildLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
      });
      const document = documents.find(
        (candidate) => candidate.sourceRefId === episode.id,
      );

      expect(document).toMatchObject({
        truthClass: "historical",
        status: "resolved",
        canonicalMechanisms: ["binary_search_invariant"],
      });
      expect(document?.searchableAliases).toContain(
        "binary-search interval invariant",
      );

      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      expect(
        fts.searchMemoryFts("binary search interval invariant", {
          kind: "episode",
          limit: 10,
        }),
      ).toEqual([expect.objectContaining({ refId: episode.id })]);
    } finally {
      fts.close();
    }
  });

  it("projects open-world L3 from claim semantics without leaking opaque cluster keys as mechanisms", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "open-world-synthesis-projection" },
    });
    const problems = await Promise.all(
      ["dfs-projection-a", "dfs-projection-b"].map((slug, index) =>
        db!.prisma.problem.create({
          data: {
            slug,
            title: `DFS Projection ${index + 1}`,
            methodName: "solve",
            tags: JSON.stringify(["graph"]),
          },
        }),
      ),
    );
    const facts = await Promise.all(
      problems.map((problem, index) => {
        const opaqueClusterKey = `claim:v1:opaque-secret-${index + 1}`;
        return db!.prisma.l2MemoryFact.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            factType: "knowledge_state",
            tag: `claim_projection_${index + 1}`,
            label: "DFS visited-state handling needs a deliberate check.",
            value: "DFS visited-state handling needs a deliberate check.",
            claimText:
              index === 0
                ? "The learner omitted visited marking before DFS recursion."
                : "The learner again needed a cue to guard DFS revisitation.",
            polarity: "negative",
            scopeJson: JSON.stringify({
              level: "cross_problem",
              problemIds: [problem.id],
              topicHints: ["graph DFS", "visited state"],
            }),
            mechanismKeysJson: "[]",
            integrityVersion: 2,
            clusterKey: opaqueClusterKey,
            confidence: 0.58,
            evidenceCount: 1,
            status: "active",
            memoryOrigin: "learner",
            validationJson: JSON.stringify({
              integrity: {
                version: 1,
                origin: "learner",
                subject: "learner_behavior",
                mechanism: opaqueClusterKey,
                humanLabel: "DFS visited-state handling",
                portability: "portable",
                promotionStatus: "trusted",
                evidenceClusters: [
                  {
                    key: `dfs-projection-activity-${index + 1}`,
                    problemId: problem.id,
                    reviewAttemptId: null,
                    revisionKey: `dfs-projection-revision-${index + 1}`,
                    transition: "reinforce",
                    evidenceTraceIds: [`dfs-projection-trace-${index + 1}`],
                  },
                ],
              },
            }),
          },
        });
      }),
    );
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "dfs-visited-state-prevention",
        text: "Across graph problems, visited-state marking still benefits from a pre-recursion check.",
        evidenceFactIds: JSON.stringify(facts.map((fact) => fact.id)),
        confidence: 0.64,
        status: "active",
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      const documents = await buildLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
      });
      const document = documents.find(
        (candidate) => candidate.documentId === `l3_synthesis:${slot.id}`,
      );

      expect(document).toMatchObject({
        canonicalMechanisms: [],
        searchableAliases: expect.arrayContaining(["graph DFS", "visited state"]),
      });
      expect(document?.description).toContain(
        "The learner omitted visited marking before DFS recursion.",
      );
      expect(document?.description).not.toContain("opaque-secret");
      expect(document?.searchableAliases.join(" ")).not.toContain("opaque-secret");

      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      expect(
        fts.searchMemoryFts("graph DFS visited state", {
          kind: "synthesis",
          limit: 10,
        }),
      ).toEqual([expect.objectContaining({ refId: slot.id })]);
      expect(
        fts.searchMemoryFts("opaque secret", {
          kind: "synthesis",
          limit: 10,
        }),
      ).toEqual([]);
    } finally {
      fts.close();
    }
  });
});

async function seedCrossProblemStrength(testDb: MemoryTestDb) {
  const user = await testDb.prisma.user.create({
    data: { handle: "retrieval-projection-user" },
  });
  const [firstProblem, secondProblem] = await Promise.all([
    testDb.prisma.problem.create({
      data: {
        slug: "binary-search-projection-one",
        title: "Binary Search Projection One",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    }),
    testDb.prisma.problem.create({
      data: {
        slug: "binary-search-projection-two",
        title: "Binary Search Projection Two",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    }),
  ]);
  const fact = await testDb.prisma.l2MemoryFact.create({
    data: {
      userId: user.id,
      problemId: firstProblem.id,
      factType: "strength",
      tag: "binary_search_invariant",
      label: "binary-search interval invariant",
      value: "Maintains a correct interval invariant across binary-search tasks.",
      confidence: 0.7,
      status: "active",
      ...trustedL2FactFixture({
        mechanism: "binary_search_invariant",
        humanLabel: "binary-search interval invariant",
        problemIds: [firstProblem.id, secondProblem.id],
      }),
    },
  });
  const slot = await testDb.prisma.synthesisSlot.create({
    data: {
      userId: user.id,
      slot: "strengths",
      synthesisKey: "binary-search-invariant-strength",
      text: "Cross-problem strength: preserves the binary-search interval invariant.",
      evidenceFactIds: JSON.stringify([fact.id]),
      confidence: 0.7,
      status: "active",
      memoryOrigin: "learner",
    },
  });
  return { userId: user.id, factId: fact.id, slotId: slot.id };
}

describe("source-owned retrieval text", () => {
  it("uses migrated prose directly while preserving episode/L2/L3 evidence linkage", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "retrieval-text-source-owner" } });
    const [first, second] = await Promise.all([
      db.prisma.problem.create({ data: { slug: "retrieval-text-one", title: "Retrieval Text One", methodName: "solve", tags: "[]" } }),
      db.prisma.problem.create({ data: { slug: "retrieval-text-two", title: "Retrieval Text Two", methodName: "solve", tags: "[]" } }),
    ]);
    const cluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: first.id,
        clusterKind: "review",
        sourceKey: "retrieval-text-source-owner:activity",
        status: "sealed",
        memoryOrigin: "learner",
        startedAt: new Date(),
      },
    });
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: first.id,
        activityClusterId: cluster.id,
        kind: "review",
        title: "legacy episode title",
        summary: "legacy episode summary",
        outcome: "failed",
        sourceTraceIds: "[]",
        memoryOrigin: "learner",
        retrievalText: "On Retrieval Text One, the search interval stopped before checking its final candidate; the useful repair is to keep the loop boundary and return value consistent.",
        retrievalTextVersion: 1,
        retrievalInputHash: "episode-input",
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: first.id,
        factType: "weakness",
        tag: "legacy_tag",
        label: "legacy label",
        value: "legacy value",
        status: "active",
        retrievalText: "Across two reviewed problems, boundary choices need an explicit check: decide whether the midpoint remains a candidate before moving a bound.",
        retrievalTextVersion: 1,
        retrievalInputHash: "fact-input",
        ...trustedL2FactFixture({ mechanism: "binary_search_invariant", humanLabel: "Boundary reasoning", problemIds: [first.id, second.id] }),
      },
    });
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "boundary-guidance",
        text: "legacy synthesis",
        evidenceFactIds: JSON.stringify([fact.id]),
        status: "active",
        memoryOrigin: "learner",
        retrievalText: "For boundary-heavy searches, first ask the learner to state whether the midpoint can still be the answer before choosing which side to discard.",
        retrievalTextVersion: 1,
        retrievalInputHash: "slot-input",
      },
    });

    const documents = await buildLearnerMemoryRetrievalDocuments(db.prisma, { userId: user.id });
    const episodeDocument = documents.find((document) => document.sourceRefId === episode.id);
    const factDocument = documents.find((document) => document.sourceRefId === fact.id && document.sourceKind === "l2_fact");
    const slotDocument = documents.find((document) => document.sourceRefId === slot.id);

    expect(episodeDocument).toMatchObject({
      description: episode.retrievalText,
      retrievalTextVersion: 1,
      evidenceClusterIds: [cluster.id],
    });
    expect(factDocument).toMatchObject({ description: fact.retrievalText, retrievalTextVersion: 1 });
    expect(slotDocument).toMatchObject({
      description: slot.retrievalText,
      retrievalTextVersion: 1,
      evidenceClusterIds: expect.arrayContaining([`fixture:binary_search_invariant:${first.id}:1`]),
    });
  });
});

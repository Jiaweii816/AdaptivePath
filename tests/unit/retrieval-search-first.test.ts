import { afterEach, describe, expect, it } from "vitest";
import { buildRetrievalQueryPlan } from "@/server/memory/retrieval/build-retrieval-query-plan";
import { retrieveCoachMemoryCandidates } from "@/server/memory/retrieval/retrieve-coach-memory";
import {
  createFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
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

describe("search-first read-only memory retrieval", () => {
  it("applies learner ownership inside FTS before the recall LIMIT", async () => {
    db = await createMemoryTestDb();
    const fts = createFtsStore(db.dbPath);
    try {
      for (let index = 0; index < 120; index += 1) {
        fts.indexMemoryDocument({
          kind: "fact",
          refId: `foreign-${index}`,
          learnerId: "foreign-user",
          content: "shared visited state omission",
        });
      }
      fts.indexMemoryDocument({
        kind: "fact",
        refId: "owned-fact",
        learnerId: "target-user",
        content: "shared visited state omission",
      });

      expect(
        fts.searchMemoryFts("visited state", {
          kind: "fact",
          learnerId: "target-user",
          limit: 1,
        }),
      ).toEqual([expect.objectContaining({ refId: "owned-fact" })]);
    } finally {
      fts.close();
    }
  });

  it("hydrates owner-trusted rows before applying the declared source limit", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "iris-crowd-out" } });
    const problem = await db.prisma.problem.create({
      data: {
        slug: "novel-frontier-crowd-out",
        title: "Novel Frontier",
        methodName: "solve",
        tags: JSON.stringify(["monotone_frontier_compression"]),
      },
    });
    const irisFact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "weakness",
        tag: "monotone_frontier_compression",
        label: "monotone frontier compression invariant",
        value: "The learner loses the monotone frontier compression invariant.",
        confidence: 0.8,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "monotone_frontier_compression",
          humanLabel: "monotone frontier compression invariant",
          clusterCount: 2,
        }),
      },
    });
    const foreignHits = Array.from({ length: 40 }, (_, index) => ({
      refId: `foreign-fact-${index}`,
      kind: "fact" as const,
      rank: index,
    }));
    const fts: FtsStore = {
      indexMemoryDocument() {},
      removeMemoryDocument() {},
      reconcileMemoryDocuments: () => ({ indexed: 0, removed: 0 }),
      searchMemoryFts: (_query, options): ReturnType<FtsStore["searchMemoryFts"]> =>
        options.kind === "fact"
          ? [
              ...foreignHits,
              { refId: irisFact.id, kind: "fact" as const, rank: 41 },
            ].slice(0, options.limit)
          : [],
      close() {},
    };
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "monotone frontier compression 上次哪里出错？",
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        tags: ["monotone_frontier_compression"],
      },
    });

    const result = await retrieveCoachMemoryCandidates(db.prisma, {
      userId: user.id,
      plan,
      ftsStore: fts,
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: irisFact.id })]),
    );
  });

  it("hydrates an indexed relevant fact outside the most-recent 80 without mutating FTS", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "search-first-user" },
    });
    const current = await db.prisma.problem.create({
      data: {
        slug: "search-insert-position-search-first",
        title: "Search Insert Position Search First",
        methodName: "searchInsert",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const historical = await db.prisma.problem.create({
      data: {
        slug: "old-binary-search-evidence",
        title: "Old Binary Search Evidence",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const oldest = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: historical.id,
        factType: "strength",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
        value:
          "The learner states and preserves the binary-search interval invariant.",
        confidence: 0.7,
        status: "active",
        lastSeenAt: new Date("2020-01-01T00:00:00.000Z"),
        ...trustedL2FactFixture({
          mechanism: "binary_search_invariant",
          humanLabel: "binary-search interval invariant",
          problemIds: [historical.id, current.id],
        }),
      },
    });
    await db.prisma.l2MemoryFact.createMany({
      data: Array.from({ length: 80 }, (_, index) => ({
        userId: user.id,
        problemId: current.id,
        factType: "strength",
        tag: `recent_array_scan_${index}`,
        label: `Recent array scan ${index}`,
        value: `Recent unrelated array scan memory ${index}`,
        confidence: 0.7,
        status: "active",
        memoryOrigin: "learner",
        lastSeenAt: new Date(1_800_000_000_000 + index),
        validationJson: trustedL2FactFixture({
          mechanism: `recent_array_scan_${index}`,
          humanLabel: `Recent array scan ${index}`,
          problemIds: [current.id, historical.id],
        }).validationJson,
      })),
    });

    const fts = createFtsStore(db.dbPath);
    fts.indexMemoryDocument({
      kind: "fact",
      refId: oldest.id,
      learnerId: user.id,
      content:
        "Demonstrated strength\nbinary search interval invariant\n二分搜索循环不变量",
    });
    expect(fts.searchMemoryFts("recent array scan", { limit: 100 })).toEqual(
      [],
    );

    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "profile_meta_question",
      userText: "What are my earned strengths?",
      problem: {
        id: current.id,
        slug: current.slug,
        title: current.title,
        tags: ["binary-search"],
      },
      currentSignal: { mechanism: "binary search interval invariant" },
    });
    const result = await retrieveCoachMemoryCandidates(db.prisma, {
      userId: user.id,
      plan,
      ftsStore: fts,
    });

    expect(result.candidates.map((candidate) => candidate.id)).toContain(
      oldest.id,
    );
    expect(fts.searchMemoryFts("recent array scan", { limit: 100 })).toEqual(
      [],
    );
    fts.close();
  });

  it("uses the synthesis projection as a real lexical recall source", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "synthesis-recall-user" },
    });
    const problem = await db.prisma.problem.create({
      data: {
        slug: "dp-synthesis-current",
        title: "DP Synthesis Current",
        methodName: "solve",
        tags: JSON.stringify(["dynamic-programming"]),
      },
    });
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "dp-synthesis-prior",
        title: "DP Synthesis Prior",
        methodName: "solve",
        tags: JSON.stringify(["dynamic-programming"]),
      },
    });
    const facts = await Promise.all(
      [problem, secondProblem].map((sourceProblem, index) =>
        db!.prisma.l2MemoryFact.create({
          data: {
            userId: user.id,
            problemId: sourceProblem.id,
            factType: "strength",
            tag: `dynamic_programming_state_transition_${index}`,
            label: "dynamic-programming state and transition",
            value: "Defines the DP state before writing transitions.",
            confidence: 0.7,
            status: "active",
            ...trustedL2FactFixture({
              mechanism: "dynamic_programming_state_transition",
              humanLabel: "dynamic-programming state and transition",
              problemIds: [sourceProblem.id],
            }),
          },
        }),
      ),
    );
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "strengths",
        synthesisKey: "dp-state-transition-strength",
        text: "Across different problems, the learner defines dynamic-programming states before writing transitions.",
        evidenceFactIds: JSON.stringify(facts.map((fact) => fact.id)),
        confidence: 0.7,
        status: "active",
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    fts.indexMemoryDocument({
      kind: "synthesis",
      refId: slot.id,
      learnerId: user.id,
      content:
        "Demonstrated strength\ndynamic programming state transition\n动态规划状态转移",
    });
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "profile_meta_question",
      userText: "What strengths have I earned?",
      problem: {
        id: problem.id,
        slug: problem.slug,
        title: problem.title,
        tags: ["dynamic-programming"],
      },
      currentSignal: { mechanism: "dynamic programming state transition" },
    });

    const result = await retrieveCoachMemoryCandidates(db.prisma, {
      userId: user.id,
      plan,
      ftsStore: fts,
    });
    const candidate = result.candidates.find(
      (item) => item.id === slot.id && item.source === "synthesis",
    );

    expect(candidate?.retrievalSignals.matchTier).not.toBe("none");
    expect(candidate?.concepts).toContain("dynamic_programming");
    fts.close();
  });
});

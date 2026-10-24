import { afterEach, describe, expect, it } from "vitest";
import { assembleCoachMemory } from "@/server/memory/assemble-coach-memory";
import { recallCoachHistoryContext } from "@/server/memory/recall-coach-history-context";
import { selectHistoryRecall } from "@/server/memory/retrieval/select-history-recall";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
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

describe("Coach memory assembly", () => {
  it("recalls a prior visited repair for a Chinese cross-problem graph-DFS question", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "graph-dfs-recall-user" },
    });
    const prior = await db.prisma.problem.create({
      data: {
        slug: "number-of-islands",
        title: "Number of Islands",
        leetcodeNumber: 200,
        methodName: "numIslands",
        tags: JSON.stringify(["graph", "depth_first_search", "matrix"]),
      },
    });
    const current = await db.prisma.problem.create({
      data: {
        slug: "clone-graph",
        title: "Clone Graph",
        leetcodeNumber: 133,
        methodName: "cloneGraph",
        tags: JSON.stringify(["graph", "depth_first_search"]),
      },
    });
    const activityCluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: prior.id,
        clusterKind: "chat_only",
        status: "sealed",
        sourceKey: "typed-graph-dfs-repair",
        memoryOrigin: "learner",
        startedAt: new Date("2026-07-19T12:00:00.000Z"),
        endedAt: new Date("2026-07-19T12:05:00.000Z"),
      },
    });
    const priorEpisode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: prior.id,
        activityClusterId: activityCluster.id,
        kind: "chat_activity",
        title: "Graph DFS visited repair",
        summary:
          "What went wrong: the learner forgot to mark visited before recursively expanding neighbors. Coach guidance: identify when a node enters visited. Later result: the changed revision passed Review evidence.",
        outcome: "resolved",
        tags: JSON.stringify(["graph", "depth_first_search", "visited"]),
        sourceTraceIds: JSON.stringify(["graph-repair-chain"]),
        memoryOrigin: "learner",
      },
    });
    await db.prisma.memoryClaimObservation.create({
      data: {
        userId: user.id,
        problemId: prior.id,
        activityClusterId: activityCluster.id,
        episodeId: priorEpisode.id,
        claimType: "weakness",
        claimText:
          "The learner omitted visited-state marking before DFS expansion.",
        polarity: "negative",
        scopeJson: JSON.stringify({
          level: "mechanism",
          topicHints: ["graph DFS", "visited state"],
        }),
        mechanismKeysJson: "[]",
        source: "activity_extraction",
        memoryOrigin: "learner",
        status: "accepted",
        claimFingerprint: "typed-visited-state-omission",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      const assembly = await assembleCoachMemory(db.prisma, {
        userId: user.id,
        problemId: current.id,
        problemTags: ["graph", "depth_first_search"],
        queryText:
          "这个模式眼熟，我做过图 DFS，上次在哪里栽坑？",
        entry: { kind: "chat", intent: "past_mistake_recall_request" },
        profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
        ftsStore: fts,
      });
      const recalled = selectHistoryRecall({
        mode: "past_mistake_recall",
        query:
          "这个模式眼熟，我做过图 DFS，上次在哪里栽坑？",
        queryPlan: assembly.queryPlan,
        candidates: assembly.candidates,
      });

      expect(assembly.brief.teachableMemories).toEqual([]);
      expect(assembly.queryPlan.semanticQuery).toContain("Clone Graph");
      expect(assembly.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: priorEpisode.id,
            historyFacets: ["past_problem", "past_mistake"],
          }),
        ]),
      );
      expect(recalled.items[0]).toMatchObject({
        sourceProblem: { slug: "number-of-islands" },
        summary: expect.stringContaining("forgot to mark visited"),
      });
    } finally {
      fts.close();
    }
  });

  it("uses problem metadata to recall a cross-problem DP success without selecting binary-search noise", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "assembly-user" } });
    const current = await db.prisma.problem.create({
      data: {
        slug: "edit-distance",
        title: "Edit Distance",
        leetcodeNumber: 72,
        methodName: "minDistance",
        tags: JSON.stringify(["multidimensional_dp", "string", "top_interview_150"]),
      },
    });
    const priorDp = await db.prisma.problem.create({
      data: {
        slug: "interleaving-string",
        title: "Interleaving String",
        leetcodeNumber: 97,
        methodName: "isInterleave",
        tags: JSON.stringify(["multidimensional_dp", "string"]),
      },
    });
    const binary = await db.prisma.problem.create({
      data: {
        slug: "search-in-rotated-sorted-array",
        title: "Search in Rotated Sorted Array",
        leetcodeNumber: 33,
        methodName: "search",
        tags: JSON.stringify(["binary_search", "array"]),
      },
    });
    await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: priorDp.id,
        kind: "review",
        title: "Defined the DP state before coding",
        summary:
          "The learner succeeded after stating what each two-dimensional state represented before writing transitions.",
        outcome: "passed",
        tags: JSON.stringify(["multidimensional_dp", "state_transition"]),
        sourceTraceIds: JSON.stringify(["episode-trace-97"]),
        memoryOrigin: "learner",
      },
    });
    await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: binary.id,
        factType: "weakness",
        tag: "binary_search_boundary_update",
        label: "Needs to keep binary-search interval updates consistent",
        lastEvidenceSummary: "Two rotated-array reviews showed the same issue.",
        confidence: 0.8,
        status: "active",
        evidenceTraceIds: JSON.stringify(["binary-trace"]),
        ...trustedL2FactFixture({
          mechanism: "binary_search_boundary_update",
          humanLabel: "Needs to keep binary-search interval updates consistent",
        }),
      },
    });
    const fts = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
      ftsStore: fts,
    });

    const assembly = await assembleCoachMemory(db.prisma, {
      userId: user.id,
      problemId: current.id,
      problemTags: ["multidimensional_dp", "string", "top_interview_150"],
      queryText: "Can you give me a hint?",
      entry: { kind: "chat", intent: "hint_request" },
      profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
      ftsStore: fts,
    });
    const explicitRecall = await recallCoachHistoryContext({
      prisma: db.prisma,
      userId: user.id,
      memoryOrigin: "learner",
      mode: "past_problem_recall",
      userText: "这个题很熟悉，我之前做过类似的，从旧单词构造到新单词，帮我回忆",
      modelQuery: "multidimensional DP state transition prior problem",
      searchHints: ["word_transformation"],
      activeProblem: {
        id: current.id, slug: current.slug, title: current.title,
        leetcodeNumber: current.leetcodeNumber ?? undefined,
        tags: ["multidimensional_dp", "string", "top_interview_150"],
      },
      ftsStore: fts,
      vectorMode: "disabled",
    });
    fts.close();

    expect(assembly.queryPlan.queryTerms.map((term) => term.value)).toContain(
      "edit_distance",
    );
    expect(["lexical_only", "full"]).toContain(
      assembly.brief.retrievalStatus,
    );
    expect(assembly.brief.teachableMemories).toHaveLength(1);
    expect(assembly.brief.teachableMemories[0]?.sourceLabel).toBe(
      "Interleaving String",
    );
    expect(JSON.stringify(assembly.brief)).not.toContain("binary_search");
    expect(assembly.brief.teachableMemories.length).toBeLessThanOrEqual(2);
    expect(explicitRecall.queryPlan.intent).toBe(
      "past_problem_recall_request",
    );
    expect(explicitRecall.items[0]?.sourceProblem?.slug).toBe(
      "interleaving-string",
    );
    expect(JSON.stringify(explicitRecall.items)).not.toContain(
      "search-in-rotated-sorted-array",
    );
  });

  it("separates self-reported profile cues from earned evidence", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "profile-user" } });
    const problem = await db.prisma.problem.create({
      data: {
        slug: "best-time-to-buy-and-sell-stock-ii",
        title: "Best Time to Buy and Sell Stock II",
        leetcodeNumber: 122,
        methodName: "maxProfit",
        tags: JSON.stringify(["array", "dynamic_programming", "greedy"]),
      },
    });
    const fts = createFtsStore(db.dbPath);

    const assembly = await assembleCoachMemory(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["array", "dynamic_programming", "greedy"],
      queryText: "How much do you know about me?",
      entry: { kind: "chat", intent: "profile_meta_question" },
      profile: {
        strongPatterns: ["sliding_window"],
        weakPatterns: ["dynamic_programming"],
        outputPreferences: ["Prefer one concrete next step"],
      },
      ftsStore: fts,
    });
    fts.close();

    expect(assembly.brief.teachableMemories).toHaveLength(2);
    expect(
      assembly.brief.teachableMemories.every(
        (memory) => memory.learnerSignalBasis === "self_reported",
      ),
    ).toBe(true);
    expect(assembly.brief.outputPreferences).toEqual([
      "Prefer one concrete next step",
    ]);
    expect(JSON.stringify(assembly.brief)).not.toContain("rotated_sorted_array");
  });

  it("reuses a resolved assisted repair for both explicit history facets without bypassing automatic stale-history guards", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({ data: { handle: "repair-recall-user" } });
    const current = await db.prisma.problem.create({
      data: {
        slug: "search-in-rotated-sorted-array",
        title: "Search in Rotated Sorted Array",
        methodName: "search",
        tags: JSON.stringify(["binary_search", "array"]),
      },
    });
    const repaired = await db.prisma.problem.create({
      data: {
        slug: "search-insert-position",
        title: "Search Insert Position",
        methodName: "searchInsert",
        tags: JSON.stringify(["binary_search", "array"]),
      },
    });
    const repair = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: repaired.id,
        kind: "assisted_repair",
        title: "Repaired a binary-search boundary",
        summary:
          "The first attempt moved the wrong boundary. Coach suggested preserving the first-greater-or-equal interval invariant, and the changed revision then passed its Review evidence.",
        outcome: "resolved",
        tags: JSON.stringify(["binary_search", "binary_search_invariant"]),
        sourceTraceIds: JSON.stringify(["repair-chain-trace"]),
        memoryOrigin: "learner",
      },
    });
    const ordinaryResolved = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: current.id,
        kind: "review",
        title: "Completed the current binary-search problem",
        summary:
          "The visible Review evidence passed with a consistent search interval.",
        outcome: "resolved",
        tags: JSON.stringify(["binary_search"]),
        sourceTraceIds: JSON.stringify(["ordinary-review-trace"]),
        memoryOrigin: "learner",
      },
    });
    await db.prisma.memoryEpisode.createMany({
      data: [
        {
          userId: user.id,
          problemId: repaired.id,
          kind: "assisted_repair",
          title: "Repair without evidence",
          summary: "A readable but unsupported repair summary should not be recalled.",
          outcome: "resolved",
          tags: JSON.stringify(["binary_search_invariant"]),
          sourceTraceIds: "[]",
          memoryOrigin: "learner",
        },
        {
          userId: user.id,
          problemId: repaired.id,
          kind: "assisted_repair",
          title: "Development repair fixture",
          summary: "Development-origin repair data should not be recalled as learner history.",
          outcome: "resolved",
          tags: JSON.stringify(["binary_search_invariant"]),
          sourceTraceIds: JSON.stringify(["development-trace"]),
          memoryOrigin: "development",
        },
      ],
    });
    const fts = createFtsStore(db.dbPath);

    try {
      await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
        userId: user.id,
        ftsStore: fts,
      });
      const assembly = await assembleCoachMemory(db.prisma, {
        userId: user.id,
        problemId: current.id,
        problemTags: ["binary_search", "array"],
        queryText: "What happened in my earlier binary-search work?",
        entry: { kind: "chat", intent: "past_mistake_recall_request" },
        profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
        ftsStore: fts,
      });
      const mistakeRecall = selectHistoryRecall({
        mode: "past_mistake_recall",
        query: "What happened in my earlier binary-search work?",
        queryPlan: assembly.queryPlan,
        candidates: assembly.candidates,
      });
      const problemRecall = selectHistoryRecall({
        mode: "past_problem_recall",
        query: "What happened in my earlier binary-search work?",
        queryPlan: assembly.queryPlan,
        candidates: assembly.candidates,
      });
      const automatic = await assembleCoachMemory(db.prisma, {
        userId: user.id,
        problemId: current.id,
        problemTags: ["binary_search", "array"],
        queryText: "Give me one hint for this binary-search problem.",
        entry: { kind: "chat", intent: "hint_request" },
        profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
        ftsStore: fts,
      });

      expect(assembly.brief.teachableMemories).toEqual([]);
      expect(["lexical_only", "full"]).toContain(
        assembly.brief.retrievalStatus,
      );
      expect(mistakeRecall.items).toEqual([]);
      expect(problemRecall.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceProblem: expect.objectContaining({ slug: repaired.slug }),
          }),
          expect.objectContaining({
            sourceProblem: expect.objectContaining({ slug: current.slug }),
          }),
        ]),
      );
      expect(mistakeRecall.items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: ordinaryResolved.title }),
        ]),
      );
      expect(JSON.stringify(assembly.candidates)).not.toMatch(
        /Repair without evidence|Development repair fixture/,
      );
      expect(automatic.decisions).toContainEqual({
        candidateId: ordinaryResolved.id,
        selected: false,
        reason: "same_problem_stale_narrative",
      });
      expect(automatic.brief.teachableMemories).toHaveLength(1);
      expect(automatic.brief.teachableMemories[0]?.cue).toContain(
        "changed revision then passed",
      );
      expect(assembly.candidateFingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(
        assembly.candidates.find((candidate) => candidate.id === repair.id),
      ).toMatchObject({
        role: "successful_transfer",
        historyFacets: ["past_problem"],
        truthClass: "historical_evidence",
      });
    } finally {
      fts.close();
    }
  });
});

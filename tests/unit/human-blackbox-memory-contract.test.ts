import { afterEach, describe, expect, it } from "vitest";
import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { buildHistoryRecallApplicationTrace } from "@/server/agents/coach-agent/history-recall-application-trace";
import { guardHistoryRecallScopeClaims } from "@/server/agents/coach-agent/history-recall-scope-guard";
import { buildCoachMemoryContext } from "@/server/memory";
import { buildRetrievalQueryPlan } from "@/server/memory/retrieval/build-retrieval-query-plan";
import type {
  MemoryCandidate,
  RetrievalQueryPlan,
} from "@/server/memory/retrieval/candidate-core.types";
import { selectAutomaticMemory } from "@/server/memory/retrieval/select-automatic-memory";
import { selectHistoryRecall } from "@/server/memory/retrieval/select-history-recall";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { pastProblemRecallChatTool } from "@/server/tools/chat-tools/history-recall-tool";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("human black-box history recall contract", () => {
  it("records selected, applied, and visible history claims separately", () => {
    const toolTrace = [
      {
        toolCallId: "history-call",
        name: "past_mistake_recall" as const,
        result: {
          items: [
            {
              kind: "past_mistake",
              title: "Interleaving String transition review",
              summary: "You separated the state transitions after defining dp[i][j].",
              mechanisms: ["dynamic_programming"],
              evidenceBasis: "durable_negative_claim",
              executionAuthority: "unknown",
              resolutionStatus: "unknown",
              relationToCurrent: "cross_problem_history",
            },
          ],
        },
        disposition: "executed" as const,
      },
    ];

    expect(
      buildHistoryRecallApplicationTrace({
        toolTrace,
        appliedGuards: ["history_recall_scope_claim"],
      }),
    ).toEqual({
      selected: {
        status: "history_selector_output",
        count: 1,
        titles: ["Interleaving String transition review"],
      },
      applied: {
        status: "deterministic_history_projection",
        count: 1,
      },
      visibleClaim: {
        status: "verified_from_visible_projection",
        count: 1,
        titles: ["Interleaving String transition review"],
      },
    });
  });

  it("keeps the real history intent and legacy domain KB out of its assembly", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const fts = createFtsStore(db.dbPath);
    try {
      const memory = await buildCoachMemoryContext(db.prisma, {
        userId: user.id,
        problemId: problem.id,
        problemTags: ["Dynamic Programming"],
        queryText: "Have I made a similar DP state-transition mistake before?",
        entry: { kind: "chat", intent: "past_mistake_recall_request" },
        profile: {
          strongPatterns: ["HashMap"],
          weakPatterns: ["Binary Search"],
          outputPreferences: ["Python"],
        },
        ftsStore: fts,
      });

      expect(memory.queryPlan.intent).toBe("past_mistake_recall_request");
      expect(memory.candidates.some((item) => item.source === "domain_kb")).toBe(
        false,
      );
      expect(memory.brief.teachableMemories).toEqual([]);
      expect(memory.brief.domainReferences).toEqual([]);
    } finally {
      fts.close();
    }
  });

  it("replaces false stateless-memory claims after an empty trusted recall", () => {
    const guarded = guardHistoryRecallScopeClaims({
      reply:
        "This is our first session together. I only remember mistakes in the current problem window.",
      responseLanguage: "en",
      turnIntent: "past_mistake_recall_request",
      toolTrace: [
        {
          toolCallId: "history-call",
          name: "past_mistake_recall",
          result: { items: [] },
          disposition: "executed",
        },
      ],
    });

    expect(guarded).toMatchObject({ replaced: true, itemCount: 0 });
    expect(guarded.reply).toContain("returned no matching historical evidence");
    expect(guarded.reply).not.toMatch(/first session|current problem window/i);
  });

  it("renders a positive recall only from the tool's human-readable items", () => {
    const guarded = guardHistoryRecallScopeClaims({
      reply:
        "You always fail binary search, and here is a new recurrence I inferred.",
      responseLanguage: "en",
      turnIntent: "past_mistake_recall_request",
      toolTrace: [
        {
          toolCallId: "history-call",
          name: "past_mistake_recall",
          result: {
            items: [
              {
                kind: "past_mistake",
                title: "Interleaving String transition review",
                summary:
                  "You separated the predecessor checks after defining dp[i][j].",
                sourceProblem: "Interleaving String",
                mechanisms: ["dynamic_programming"],
                evidenceBasis: "durable_negative_claim",
                executionAuthority: "unknown",
                resolutionStatus: "unknown",
                relationToCurrent: "cross_problem_history",
              },
            ],
          },
          disposition: "executed",
        },
      ],
    });

    expect(guarded).toMatchObject({ replaced: true, itemCount: 1 });
    expect(guarded.reply).toContain("Interleaving String transition review");
    expect(guarded.reply).toContain("separated the predecessor checks");
    expect(guarded.reply).not.toMatch(/always fail|new recurrence/i);
  });

  it("returns zero items when every past mistake is unrelated", () => {
    const plan = dpRecallPlan();
    const result = selectHistoryRecall({
      mode: "past_mistake_recall",
      query: "这道 DP 状态机以前犯过什么错？",
      queryPlan: plan,
      candidates: [
        mistakeCandidate({
          id: "rotated-search-history",
          title: "Search in Rotated Sorted Array",
          teachingText:
            "Previously moved the binary-search boundary too early.",
          concepts: ["binary_search"],
        }),
        mistakeCandidate({
          id: "two-sum-history",
          title: "Two Sum",
          teachingText: "Previously checked a lookup map after using it.",
          concepts: ["hash_map"],
        }),
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: "rotated-search-history",
          selected: false,
        }),
        expect.objectContaining({
          candidateId: "two-sum-history",
          selected: false,
        }),
      ]),
    );
  });

  it("does not let a wrong binary-search hint outrank the active DP mechanism", () => {
    const result = selectHistoryRecall({
      mode: "past_mistake_recall",
      query: "similar old mistake",
      searchHints: ["binary search boundary conditions"],
      queryPlan: dpRecallPlan(),
      candidates: [
        mistakeCandidate({
          id: "dp-history",
          title: "Edit Distance",
          teachingText:
            "Previously combined two state transitions before defining what each state means.",
          concepts: ["dynamic_programming", "state_machine"],
        }),
        mistakeCandidate({
          id: "binary-history",
          title: "Search in Rotated Sorted Array",
          teachingText:
            "Previously made a binary search boundary conditions mistake.",
          concepts: ["binary_search"],
        }),
      ],
    });

    expect(result.items[0]?.title).toBe("Edit Distance");
  });

  it("does not let active-problem metadata override an explicit different concept", () => {
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "Have I made a similar monotonic-stack mistake before?",
      problem: {
        id: "322",
        slug: "coin-change",
        title: "Coin Change",
        leetcodeNumber: 322,
        tags: ["Dynamic Programming", "Array"],
      },
    });
    const result = selectHistoryRecall({
      mode: "past_mistake_recall",
      query: "Have I made a similar monotonic-stack mistake before?",
      queryPlan: plan,
      candidates: [
        mistakeCandidate({
          id: "dp-history",
          title: "Interleaving String",
          teachingText: "Previously combined two DP transitions too early.",
          concepts: ["dynamic_programming", "state_machine"],
        }),
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.decisions).toContainEqual({
      candidateId: "dp-history",
      selected: false,
      reason: "insufficient_relevance",
    });
  });

  it("projects only human history fields to the Coach tool observation", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(db.prisma);
    const priorProblem = await db.prisma.problem.create({
      data: {
        slug: "find-minimum-in-rotated-sorted-array",
        title: "Find Minimum in Rotated Sorted Array",
        statementMarkdown: "Find the minimum element in a rotated sorted array.",
        methodName: "findMin",
        tags: JSON.stringify(["binary_search", "array"]),
      },
    });
    const priorSession = await db.prisma.chatSession.create({
      data: {
        userId: user.id,
        problemId: priorProblem.id,
        title: priorProblem.title,
        isActive: false,
        memoryOrigin: "learner",
      },
    });
    const review = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: priorProblem.id,
        chatSessionId: priorSession.id,
        language: "Python",
        codeSnapshot: "class Solution: pass",
        memoryOrigin: "learner",
      },
    });
    const history = await db.prisma.problemHistory.create({
      data: {
        userId: user.id,
        problemId: priorProblem.id,
        reviewAttemptId: review.id,
        chatSessionId: priorSession.id,
        language: "Python",
        problemTags: JSON.stringify(["binary_search", "array"]),
        runStatus: "passed_visible_tests",
        userIssueSummary: "Retained the possible midpoint while narrowing the interval.",
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      fts.indexMemoryDocument({
        kind: "problem_history",
        refId: history.id,
        learnerId: user.id,
        content: `${priorProblem.title} binary search retained the possible midpoint`,
      });
      const result = await pastProblemRecallChatTool(
        { query: "similar binary search problem" },
        {
          prisma: db.prisma,
          userId: user.id,
          memoryOrigin: "learner",
          chatSessionId: chatSession.id,
          userMessageContent: "What similar binary-search problem did I solve before?",
          ftsStore: fts,
          problem: {
            id: problem.id,
            slug: problem.slug,
            title: problem.title,
            leetcodeNumber: null,
            methodName: problem.methodName,
            inputContractJson: problem.inputContractJson,
            outputContractJson: problem.outputContractJson,
            isDemoSupported: problem.isDemoSupported,
            localRunStatus: problem.localRunStatus,
            localRunStatusMessage: problem.localRunStatusMessage,
            comparisonStrategy: problem.comparisonStrategy,
            comparisonConfigJson: problem.comparisonConfigJson,
            contractKind: problem.contractKind,
          },
          problemTags: ["binary_search", "array"],
        },
      );
      const serialized = JSON.stringify(result);

      expect(result.items).toHaveLength(1);
      expect(serialized).toContain("Find Minimum in Rotated Sorted Array");
      expect(result.items[0]).toMatchObject({
        kind: "past_problem",
        sourceProblem: "Find Minimum in Rotated Sorted Array",
        outcome: "passed visible tests",
        relationToCurrent: "cross_problem_history",
      });
      expect(serialized).not.toMatch(
        /retrievalStatus|lexical_only|learnerSignalBasis|earned_evidence|passed_visible_tests|candidate-internal-id|cmrh45dj0018dncfjtfurb19|confidence\s*:\s*0\.99/i,
      );
      expect(serialized).not.toContain("find-minimum-in-rotated-sorted-array");
    } finally {
      fts.close();
    }
  });
});

describe("human black-box Profile memory contract", () => {
  it.each([
    "How much you know about me?",
    "I thought you know my strength and weakness, so you don't know?",
    "What are my strengths and weaknesses?",
  ])("routes the common Profile follow-up: %s", (message) => {
    expect(buildChatTurnPlan(message)).toMatchObject({
      primaryIntent: "profile_meta_question",
      contextNeeds: {
        workspace: false,
        currentCode: false,
        runEvidence: false,
        learnerSignals: true,
      },
    });
  });

  it("keeps both a strength and a weakness when both are known", () => {
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "profile_meta_question",
      userText: "What are my strengths and weaknesses?",
      problem: {
        id: "122",
        slug: "best-time-to-buy-and-sell-stock-ii",
        title: "Best Time to Buy and Sell Stock II",
        leetcodeNumber: 122,
        tags: ["Array", "Greedy"],
      },
    });
    const result = selectAutomaticMemory({
      profileId: "profile-meta",
      plan,
      candidates: [
        profileCandidate({
          id: "self-strength",
          role: "successful_transfer",
          teachingText: "The learner described array traversal as a strength.",
        }),
        profileCandidate({
          id: "self-weakness",
          role: "recurring_mistake",
          teachingText:
            "The learner described dynamic programming as an area to strengthen.",
        }),
        earnedCandidate({
          id: "earned-strength",
          role: "successful_transfer",
          teachingText:
            "Passed evidence shows the learner can define states clearly.",
        }),
        earnedCandidate({
          id: "earned-weakness",
          role: "recurring_mistake",
          teachingText:
            "Repeated failed evidence shows transitions are combined too early.",
        }),
      ],
      retrievalStatus: "lexical_only",
    });

    expect(result.brief.teachableMemories).toHaveLength(2);
    expect(
      result.brief.teachableMemories.map((memory) => memory.kind).sort(),
    ).toEqual(["recurring_mistake", "successful_transfer"]);
  });

  it("prefers cross-problem synthesis over a single episode for Profile meta", () => {
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "profile_meta_question",
      userText: "How much do you know about me?",
      problem: {
        id: "122",
        slug: "best-time-to-buy-and-sell-stock-ii",
        title: "Best Time to Buy and Sell Stock II",
        tags: ["Array", "Greedy"],
      },
    });
    const result = selectAutomaticMemory({
      profileId: "profile-meta",
      plan,
      candidates: [
        historyCandidate({
          id: "single-episode",
          source: "episode",
          role: "recurring_mistake",
          teachingText: "One past turn mentioned a boundary question.",
        }),
        earnedCandidate({
          id: "cross-problem-synthesis",
          source: "synthesis",
          role: "recurring_mistake",
          teachingText:
            "Across two problems, binary-search interval boundaries were inconsistent.",
        }),
      ],
      retrievalStatus: "lexical_only",
    });

    expect(result.decisions).toContainEqual({
      candidateId: "cross-problem-synthesis",
      selected: true,
      reason: "selected_for_distinct_teaching_role",
    });
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        candidateId: "single-episode",
        selected: false,
      }),
    );
  });

  it("does not recycle a clean paraphrase whose only evidence is a blocked fact", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const blocked = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: "hardcoded_return",
        label: "Hardcoded return",
        status: "active",
        memoryOrigin: "learner",
      },
    });
    await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "legacy-clean-paraphrase",
        text: "The learner often struggles to turn an idea into a loop invariant.",
        evidenceFactIds: JSON.stringify([blocked.id]),
        confidence: 0.99,
        status: "active",
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      const memory = await buildCoachMemoryContext(db.prisma, {
        userId: user.id,
        problemId: problem.id,
        problemTags: ["array", "greedy"],
        queryText: "How much do you know about me?",
        entry: { kind: "chat", intent: "profile_meta_question" },
        profile: {
          strongPatterns: [],
          weakPatterns: [],
          outputPreferences: [],
        },
        ftsStore: fts,
      });

      expect(memory.brief.teachableMemories).toEqual([]);
      expect(JSON.stringify(memory.brief)).not.toContain(
        "turn an idea into a loop invariant",
      );
    } finally {
      fts.close();
    }
  });
});

function dpRecallPlan(): RetrievalQueryPlan {
  return buildRetrievalQueryPlan({
    path: "chat",
    intent: "general_followup",
    userText: "这道题明明是 DP 状态机，以前犯过什么相似错误？",
    problem: {
      id: "97",
      slug: "interleaving-string",
      title: "Interleaving String",
      leetcodeNumber: 97,
      tags: ["Dynamic Programming", "String"],
    },
  });
}

function mistakeCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return historyCandidate({
    role: "recurring_mistake",
    outcome: "failed",
    historyFacets: ["past_mistake"],
    mistakeRecallBasis: {
      kind: "durable_negative_claim",
      evidenceTraceIds: ["review-evidence"],
    },
    retrievalSignals: {
      matchTier: "none",
      conceptMatch: "none",
      mechanismMatch: false,
      intentFit: 0.1,
    },
    ...overrides,
  });
}

function historyCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    id: "history-candidate",
    source: "problem_history",
    truthClass: "historical_evidence",
    role: "successful_transfer",
    title: "Past problem",
    teachingText: "A human-readable historical observation.",
    concepts: [],
    evidenceRefs: ["review-evidence"],
    retrievalSignals: {
      matchTier: "concept",
      conceptMatch: "active",
      mechanismMatch: false,
      intentFit: 0.8,
    },
    ...overrides,
  };
}

function profileCandidate(
  overrides: Partial<MemoryCandidate>,
): MemoryCandidate {
  return {
    ...historyCandidate(),
    id: "self-report",
    source: "onboarding_profile",
    truthClass: "self_reported_profile",
    evidenceRefs: [],
    sourceProblem: undefined,
    outcome: undefined,
    retrievalSignals: {
      matchTier: "lexical_only",
      conceptMatch: "none",
      mechanismMatch: false,
      intentFit: 1,
    },
    ...overrides,
  };
}

function earnedCandidate(
  overrides: Partial<MemoryCandidate>,
): MemoryCandidate {
  return {
    ...historyCandidate(),
    source: "l2_fact",
    truthClass: "learner_state",
    sourceProblem: undefined,
    outcome: undefined,
    retrievalSignals: {
      matchTier: "lexical_only",
      conceptMatch: "none",
      mechanismMatch: false,
      intentFit: 0.9,
    },
    ...overrides,
  };
}

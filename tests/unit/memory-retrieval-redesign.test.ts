import { afterEach, describe, expect, it } from "vitest";
import { buildRetrievalQueryPlan } from "@/server/memory/retrieval/build-retrieval-query-plan";
import { mistakeRecallBasis } from "@/server/memory/retrieval/mistake-eligibility";
import { retrieveCoachMemoryCandidates } from "@/server/memory/retrieval/retrieve-coach-memory";
import { applySourceBudget } from "@/server/memory/retrieval/source-budget";
import type { MemoryCandidate } from "@/server/memory/retrieval/candidate-core.types";
import { createFtsStore, toFtsMatchQuery } from "@/server/memory/store/fts-store";
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

function candidate(
  id: string,
  role: MemoryCandidate["role"],
  lexicalRank: number,
): MemoryCandidate {
  return {
    id,
    source: "l2_fact",
    truthClass: "learner_state",
    role,
    title: id,
    teachingText: id,
    concepts: [],
    evidenceRefs: [],
    retrievalSignals: {
      lexicalRank,
      matchTier: "lexical_only",
      conceptMatch: "none",
      mechanismMatch: false,
      intentFit: 1,
    },
  };
}

describe("memory retrieval three-layer redesign", () => {
  it("makes the CJK lexical path a prefix query", () => {
    expect(toFtsMatchQuery("递归 树")).toBe('"递归"*');
  });

  it("retains user/model query terms and the explicit recall facet", () => {
    const plan = buildRetrievalQueryPlan({
      path: "chat",
      intent: "past_mistake_recall_request",
      userText: "我以前在递归题哪里出错？",
      modelQuery: "recursion base case",
      requiredFacet: "past_mistake",
      problem: {
        id: "112",
        slug: "path-sum",
        title: "Path Sum",
        leetcodeNumber: 112,
        tags: ["Tree", "Depth-First Search"],
      },
    });

    expect(plan.requiredFacet).toBe("past_mistake");
    expect(plan.queryTerms).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "intent_facet", value: "memory_facet_past_mistake" }),
      expect.objectContaining({ origin: "model_query", value: "recursion" }),
    ]));
    expect(plan.semanticQueryPlan.learnerRequest).toContain("递归题");
    expect(plan.semanticQueryPlan.learnerRequest).toContain("recursion base case");
  });

  it("never upgrades a state/outcome into a past-mistake evidence basis", () => {
    expect(mistakeRecallBasis({
      source: "episode",
      acceptedNegativeObservationIds: [],
    })).toBeUndefined();
  });

  it("requires trusted negative L2 evidence", () => {
    expect(mistakeRecallBasis({
      source: "l2_fact",
      factPolarity: "negative",
      factIntegrityTrusted: true,
      factEvidenceTraceIds: ["trace-1"],
    })?.kind).toBe("durable_negative_claim");
  });

  it("hydrates rows only from the caller's process-owned memory origin", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const developmentSession = await db.prisma.chatSession.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        title: problem.title,
        isActive: false,
        memoryOrigin: "development",
      },
    });
    const developmentReview = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: developmentSession.id,
        language: "Python",
        codeSnapshot: "class Solution: pass",
        memoryOrigin: "development",
      },
    });
    const developmentHistory = await db.prisma.problemHistory.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        reviewAttemptId: developmentReview.id,
        chatSessionId: developmentSession.id,
        language: "Python",
        problemTags: JSON.stringify(["binary_search"]),
        runStatus: "passed_visible_tests",
        userIssueSummary: "Development-only binary search exercise.",
        memoryOrigin: "development",
      },
    });
    const fts = createFtsStore(db.dbPath);
    try {
      fts.indexMemoryDocument({
        kind: "problem_history",
        refId: developmentHistory.id,
        learnerId: user.id,
        content: "Binary Search development-only exercise",
      });
      const plan = buildRetrievalQueryPlan({
        path: "chat",
        intent: "past_problem_recall_request",
        userText: "Which binary search problem did I solve?",
        requiredFacet: "past_problem",
        problem: {
          id: problem.id,
          slug: problem.slug,
          title: problem.title,
          tags: ["binary_search"],
        },
      });
      const result = await retrieveCoachMemoryCandidates(db.prisma, {
        userId: user.id,
        memoryOrigin: "learner",
        plan,
        ftsStore: fts,
        vectorMode: "disabled",
      });

      expect(result.candidates).toEqual([]);
    } finally {
      fts.close();
    }
  });

  it("reserves a post-hydration recurring-mistake slot without inventing one", () => {
    const selected = applySourceBudget([
      candidate("positive-top", "successful_transfer", 0),
      candidate("positive-next", "successful_transfer", 1),
      candidate("negative-evidenced", "recurring_mistake", 8),
    ], {
      candidateLimit: 2,
      selectionPriority: "primary",
      reservedRoleSlots: { recurring_mistake: 1 },
    });
    expect(selected.map((item) => item.id)).toEqual([
      "negative-evidenced",
      "positive-top",
    ]);
  });
});

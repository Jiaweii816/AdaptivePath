import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHistoricalReviewReplay } from "@/server/memory/replay/historical-review-replay";
import { readDurableFactIntegrity } from "@/server/memory/integrity/memory-integrity-policy";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
let fts: FtsStore | undefined;
const originalOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  fts?.close();
  fts = undefined;
  await db?.cleanup();
  db = undefined;
  if (originalOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalOrigin;
  }
});

describe("historical Review replay", () => {
  it("obeys manual provenance, rejects missing runs, materializes portable memory, and reruns idempotently", async () => {
    db = await createMemoryTestDb();
    fts = createFtsStore(db.dbPath);
    const user = await db.prisma.user.create({
      data: { handle: "PatternCoachReplayTest" },
    });
    const showcase = await createProblem(db, {
      slug: "search-insert-position",
      title: "Search Insert Position",
      order: 1,
      tags: ["binary-search", "array"],
    });
    const nonShowcase = await createProblem(db, {
      slug: "binary-search-replay-second",
      title: "Binary Search Replay Second",
      order: 2,
      tags: ["binary-search", "array"],
    });
    const fixtureProblem = await createProblem(db, {
      slug: "two-sum",
      title: "Two Sum",
      order: 3,
      tags: ["hash-table", "array"],
    });
    const missingRunProblem = await createProblem(db, {
      slug: "merge-sorted-array",
      title: "Merge Sorted Array",
      order: 4,
      tags: ["two-pointers", "array"],
    });
    const first = await seedHistoricalReview(db, {
      userId: user.id,
      problemId: showcase.id,
      status: "passed_visible_tests",
      providerUsed: "lc_submit",
      fact: {
        factType: "strength",
        tag: "binary_search_boundary",
        label: "Keeps a valid binary-search interval",
        evidenceSummary:
          "The accepted revision preserved the possible-answer interval while moving boundaries.",
      },
      createdAt: new Date("2026-06-10T10:00:00.000Z"),
    });
    const second = await seedHistoricalReview(db, {
      userId: user.id,
      problemId: nonShowcase.id,
      status: "passed_visible_tests",
      providerUsed: "lc_submit",
      fact: {
        factType: "strength",
        tag: "binary_search_boundary",
        label: "Keeps a valid binary-search interval",
        evidenceSummary:
          "A second accepted problem preserved the search interval invariant.",
      },
      createdAt: new Date("2026-06-10T11:00:00.000Z"),
    });
    const fixture = await seedHistoricalReview(db, {
      userId: user.id,
      problemId: fixtureProblem.id,
      status: "passed_visible_tests",
      providerUsed: "piston_fallback",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
      fact: {
        factType: "mistake",
        tag: "hardcoded_return",
        label: "Hardcoded return",
        evidenceSummary: "Returned a fixed result without reading the input.",
      },
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });
    const missingRun = await seedHistoricalReview(db, {
      userId: user.id,
      problemId: missingRunProblem.id,
      status: "passed_visible_tests",
      providerUsed: "lc_submit",
      omitRun: true,
      fact: {
        factType: "skill",
        tag: "two_pointers",
        label: "Moves two pointers consistently",
        evidenceSummary: "The revision moved both pointers consistently.",
      },
      createdAt: new Date("2026-06-10T13:00:00.000Z"),
    });

    const firstRun = await runHistoricalReviewReplay(db.prisma, {
      userId: user.id,
      replayRunId: "unit-replay-one",
      apply: true,
      ftsStore: fts,
      minimumAcceptedNonShowcaseProblems: 1,
      provenanceDecisions: [
        manualDecision(first, "learner"),
        manualDecision(second, "learner"),
        manualDecision(fixture, "development"),
        manualDecision(missingRun, "learner"),
      ],
      provenanceDecisionFingerprint: "unit-approval-one",
    });

    expect(firstRun.summary).toMatchObject({
      scannedReviews: 4,
      acceptedReviews: 2,
      learnerApprovedReviews: 3,
      manualExcludedReviews: 1,
      rejectedReviews: 2,
      generatedEpisodes: 2,
    });
    expect(
      firstRun.decisions.find(
        (decision) => decision.sourceReviewAttemptId === first.id,
      ),
    ).toMatchObject({
      decision: "accept_learner_review",
      problemSlug: "search-insert-position",
      canonicalMechanisms: ["binary_search_invariant"],
    });
    expect(firstRun.decisions).toContainEqual(
      expect.objectContaining({
        problemSlug: "two-sum",
        decision: "reject_manual_provenance",
      }),
    );
    expect(firstRun.decisions).toContainEqual(
      expect.objectContaining({
        problemSlug: "merge-sorted-array",
        decision: "reject_missing_execution_evidence",
      }),
    );
    const fact = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: {
        userId: user.id,
        factType: "strength",
        tag: "binary_search_invariant",
        memoryOrigin: "learner",
      },
    });
    const integrity = readDurableFactIntegrity(fact.validationJson)!;
    expect(fact.status).toBe("active");
    expect(integrity.promotionStatus).toBe("trusted");
    expect(new Set(integrity.evidenceClusters.map((item) => item.problemId))).toEqual(
      new Set([showcase.id, nonShowcase.id]),
    );
    expect(
      await db.prisma.l2MemoryFact.count({
        where: { tag: { in: ["hardcoded_return", "no_search_logic"] } },
      }),
    ).toBe(0);
    expect(
      fts.searchMemoryFts("binary search interval", {
        kind: "fact",
        limit: 10,
      }),
    ).toContainEqual(expect.objectContaining({ refId: fact.id }));
    const beforeSecond = {
      events: await db.prisma.l1MemoryEvent.count(),
      facts: await db.prisma.l2MemoryFact.count(),
      episodes: await db.prisma.memoryEpisode.count(),
    };

    const secondRun = await runHistoricalReviewReplay(db.prisma, {
      userId: user.id,
      replayRunId: "unit-replay-two",
      apply: true,
      ftsStore: fts,
      minimumAcceptedNonShowcaseProblems: 1,
      provenanceDecisions: [
        manualDecision(first, "learner"),
        manualDecision(second, "learner"),
        manualDecision(fixture, "development"),
        manualDecision(missingRun, "learner"),
      ],
      provenanceDecisionFingerprint: "unit-approval-one",
    });

    expect(secondRun.summary).toMatchObject({
      generatedEpisodes: 0,
      generatedFactWrites: 0,
      idempotentSkips: 2,
    });
    await expect(db.prisma.l1MemoryEvent.count()).resolves.toBe(
      beforeSecond.events,
    );
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(
      beforeSecond.facts,
    );
    await expect(db.prisma.memoryEpisode.count()).resolves.toBe(
      beforeSecond.episodes,
    );
    await expect(
      db.prisma.reviewAttempt.count({
        where: { memoryOrigin: "legacy_unknown" },
      }),
    ).resolves.toBe(4);
  });

  it("writes a searchable Episode for an approved Review that has no portable fact", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "PatternCoachLedgerOnlyTest" },
    });
    const problem = await createProblem(db, {
      slug: "valid-parentheses",
      title: "Valid Parentheses",
      order: 1,
      tags: ["stack"],
    });
    const review = await seedHistoricalReview(db, {
      userId: user.id,
      problemId: problem.id,
      status: "passed_visible_tests",
      providerUsed: "lc_submit",
      code: "class Solution:\n    def solve(self, value):\n        return value",
      fact: null,
      createdAt: new Date("2026-06-11T10:00:00.000Z"),
    });

    const result = await runHistoricalReviewReplay(db.prisma, {
      userId: user.id,
      replayRunId: "unit-ledger-only",
      apply: true,
      minimumAcceptedNonShowcaseProblems: 0,
      provenanceDecisions: [manualDecision(review, "learner")],
      provenanceDecisionFingerprint: "unit-ledger-only-approval",
    });

    expect(result.decisions[0]).toMatchObject({
      decision: "accept_learner_ledger_only",
      materializesMemory: false,
    });
    // Episode is searchable history; an L2 fact is a durable claim. A Review
    // with nothing to promote to L2 must still leave retrievable history.
    expect(result.summary).toMatchObject({
      ledgerOnlyReviews: 1,
      generatedEpisodes: 1,
      generatedFactWrites: 0,
    });
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(0);

    const episode = await db.prisma.memoryEpisode.findFirstOrThrow();
    expect(episode).toMatchObject({
      kind: "review",
      memoryOrigin: "learner",
      outcome: "passed",
    });
    expect(episode.summary).toContain("Run: passed visible tests");
    expect(episode.tags).toContain("stack");

    const completion = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: { eventType: "historical_replay_completed" },
    });
    expect(completion.eventJson).toContain('"memoryDisposition":"episode_only"');
    expect(completion.eventJson).toContain(`"generatedEpisodeId":"${episode.id}"`);
  });
});

function manualDecision(
  review: { id: string; chatSessionId: string },
  classification: "learner" | "development",
) {
  return {
    reviewAttemptId: review.id,
    chatSessionId: review.chatSessionId,
    leetcodeNumber: null,
    problemTitle: "Replay fixture",
    activityLabel: "活动 1/1 · test",
    classification,
    decisionSource: "activity_checkbox" as const,
  };
}

async function createProblem(
  testDb: MemoryTestDb,
  args: { slug: string; title: string; order: number; tags: string[] },
) {
  return testDb.prisma.problem.create({
    data: {
      slug: args.slug,
      title: args.title,
      methodName: "solve",
      hot150Order: args.order,
      tags: JSON.stringify(args.tags),
    },
  });
}

async function seedHistoricalReview(
  testDb: MemoryTestDb,
  args: {
    userId: string;
    problemId: string;
    status: "passed_visible_tests" | "failed";
    providerUsed: string;
    code?: string;
    omitRun?: boolean;
    createdAt: Date;
    fact: {
      factType: string;
      tag: string;
      label: string;
      evidenceSummary: string;
    } | null;
  },
) {
  const problem = await testDb.prisma.problem.findUniqueOrThrow({
    where: { id: args.problemId },
  });
  const session = await testDb.prisma.chatSession.create({
    data: {
      userId: args.userId,
      problemId: problem.id,
      title: problem.title,
      memoryOrigin: "legacy_unknown",
    },
  });
  const code =
    args.code ??
    "class Solution:\n    def solve(self, nums, target):\n        left, right = 0, len(nums) - 1\n        while left <= right:\n            mid = (left + right) // 2\n            if nums[mid] < target: left = mid + 1\n            else: right = mid - 1\n        return left";
  const review = await testDb.prisma.reviewAttempt.create({
    data: {
      userId: args.userId,
      problemId: problem.id,
      chatSessionId: session.id,
      language: "Python",
      codeSnapshot: code,
      selectedTestCaseIds: JSON.stringify(["historical-case"]),
      selectedTestsJson: "[]",
      coachReplyMarkdown: "Historical coach reply.",
      memoryOrigin: "legacy_unknown",
      createdAt: args.createdAt,
    },
  });
  if (!args.omitRun) {
    const passed = args.status === "passed_visible_tests";
    await testDb.prisma.runEvidence.create({
      data: {
        reviewAttemptId: review.id,
        chatSessionId: session.id,
        source: "review",
        status: args.status,
        passedCount: passed ? 10 : 0,
        failedCount: passed ? 0 : 1,
        stdout: "",
        stderr: passed ? "Accepted" : "Wrong Answer",
        rawResultJson: JSON.stringify({
          status: args.status,
          passedCount: passed ? 10 : 0,
          failedCount: passed ? 0 : 1,
          stdout: "",
          stderr: passed ? "Accepted" : "Wrong Answer",
          testResults: [],
          rawResult: { providerUsed: args.providerUsed },
        }),
        memoryOrigin: "legacy_unknown",
        createdAt: args.createdAt,
      },
    });
  }
  const diagnosis = {
    problemSlug: problem.slug,
    runStatus: args.status,
    userIssueSummary:
      args.fact?.evidenceSummary ??
      "Visible tests passed; continue with the next planned item.",
    coachSummary:
      args.fact?.label ?? "Self-rate this problem and continue to Today.",
    mistakeTags:
      args.fact?.factType === "mistake" ? [args.fact.tag] : [],
    skillTags: args.fact?.factType === "skill" ? [args.fact.tag] : [],
    memoryUpdateCandidate: {
      facts: args.fact ? [{ ...args.fact, confidence: 0.8 }] : [],
      summary: args.fact?.evidenceSummary,
    },
  };
  await testDb.prisma.diagnosisResult.create({
    data: {
      reviewAttemptId: review.id,
      diagnosisJson: JSON.stringify(diagnosis),
      memoryUpdateCandidateJson: JSON.stringify(
        diagnosis.memoryUpdateCandidate,
      ),
      mistakeTags: JSON.stringify(diagnosis.mistakeTags),
      skillTags: JSON.stringify(diagnosis.skillTags),
      userIssueSummary: diagnosis.userIssueSummary,
      coachSummary: diagnosis.coachSummary,
      createdAt: args.createdAt,
    },
  });
  return review;
}

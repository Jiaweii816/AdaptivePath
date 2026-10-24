import { afterEach, describe, expect, it } from "vitest";
import {
  sealHistoricalReplayActivityCluster,
} from "@/server/memory/activity-clusters";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("sealHistoricalReplayActivityCluster", () => {
  it("seals a learner-origin cluster over a legacy_unknown Review", async () => {
    const { prisma, review } = await seedReplayedReview({
      replayRunId: "run-a",
    });

    const sealed = await sealHistoricalReplayActivityCluster(prisma, {
      reviewAttemptId: review.id,
      replayRunId: "run-a",
    });

    expect(sealed.cluster.memoryOrigin).toBe("learner");
    expect(sealed.cluster.kind).toBe("review_rooted");
    await expect(
      prisma.reviewAttempt.findUniqueOrThrow({ where: { id: review.id } }),
    ).resolves.toMatchObject({ memoryOrigin: "legacy_unknown" });
  });

  it("anchors on the named replay run only", async () => {
    const { prisma, review } = await seedReplayedReview({
      replayRunId: "run-a",
    });
    await appendAttestation(prisma, review, "run-b");

    const sealed = await sealHistoricalReplayActivityCluster(prisma, {
      reviewAttemptId: review.id,
      replayRunId: "run-b",
    });

    const l1Items = sealed.items.filter(
      (item) => item.sourceType === "l1_event",
    );
    expect(l1Items).toHaveLength(1);
  });

  it("refuses a Review with no attestation from that run", async () => {
    const { prisma, review } = await seedReplayedReview({
      replayRunId: "run-a",
    });

    await expect(
      sealHistoricalReplayActivityCluster(prisma, {
        reviewAttemptId: review.id,
        replayRunId: "run-missing",
      }),
    ).rejects.toThrow(/historical_replay_attestation_not_found/);
  });

  it("is idempotent", async () => {
    const { prisma, review } = await seedReplayedReview({
      replayRunId: "run-a",
    });
    const args = { reviewAttemptId: review.id, replayRunId: "run-a" };

    const first = await sealHistoricalReplayActivityCluster(prisma, args);
    const second = await sealHistoricalReplayActivityCluster(prisma, args);

    expect(second.cluster.id).toBe(first.cluster.id);
    await expect(prisma.memoryActivityCluster.count()).resolves.toBe(1);
  });
});

async function seedReplayedReview(args: { replayRunId: string }) {
  db = await createMemoryTestDb();
  const { user, problem, session } = await seedReviewContainer(
    db,
    args.replayRunId,
  );
  const review = await seedLegacyReviewRecords(db, {
    userId: user.id,
    problemId: problem.id,
    problemSlug: problem.slug,
    chatSessionId: session.id,
  });
  await appendAttestation(db.prisma, review, args.replayRunId);
  return { prisma: db.prisma, review };
}

async function seedReviewContainer(testDb: MemoryTestDb, replayRunId: string) {
  const user = await testDb.prisma.user.create({
    data: { handle: `PatternCoachReplaySeal-${replayRunId}` },
  });
  const problem = await createProblem(testDb, {
    slug: `replay-seal-${replayRunId}`,
    title: "Replay Seal",
  });
  const session = await testDb.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      memoryOrigin: "legacy_unknown",
    },
  });
  return { user, problem, session };
}

async function seedLegacyReviewRecords(
  testDb: MemoryTestDb,
  args: {
    userId: string;
    problemId: string;
    problemSlug: string;
    chatSessionId: string;
  },
) {
  const createdAt = new Date("2026-06-10T10:00:00.000Z");
  const review = await testDb.prisma.reviewAttempt.create({
    data: {
      userId: args.userId,
      problemId: args.problemId,
      chatSessionId: args.chatSessionId,
      language: "Python",
      codeSnapshot:
        "class Solution:\n    def solve(self, nums):\n        return len(nums)",
      selectedTestCaseIds: JSON.stringify(["historical-case"]),
      selectedTestsJson: "[]",
      coachReplyMarkdown: "Historical coach reply.",
      memoryOrigin: "legacy_unknown",
      createdAt,
    },
  });
  await testDb.prisma.runEvidence.create({
    data: {
      reviewAttemptId: review.id,
      chatSessionId: args.chatSessionId,
      source: "review",
      status: "passed_visible_tests",
      passedCount: 1,
      failedCount: 0,
      stderr: "Accepted",
      rawResultJson: JSON.stringify({
        status: "passed_visible_tests",
        providerUsed: "lc_submit",
      }),
      memoryOrigin: "legacy_unknown",
      createdAt,
    },
  });
  await testDb.prisma.diagnosisResult.create({
    data: {
      reviewAttemptId: review.id,
      diagnosisJson: JSON.stringify({
        problemSlug: args.problemSlug,
        runStatus: "passed_visible_tests",
        coachSummary: "Historical coach reply.",
      }),
      memoryUpdateCandidateJson: "{}",
      createdAt,
    },
  });
  return review;
}

async function appendAttestation(
  prisma: MemoryTestDb["prisma"],
  review: {
    id: string;
    userId: string;
    problemId: string;
    chatSessionId: string;
    createdAt: Date;
  },
  replayRunId: string,
) {
  return prisma.l1MemoryEvent.create({
    data: {
      userId: review.userId,
      problemId: review.problemId,
      chatSessionId: review.chatSessionId,
      reviewAttemptId: review.id,
      eventType: "historical_replay_attestation",
      eventJson: JSON.stringify({ replayRunId }),
      source: "historical_replay",
      memoryOrigin: "learner",
      occurredAt: review.createdAt,
    },
  });
}

async function createProblem(
  testDb: MemoryTestDb,
  args: { slug: string; title: string },
) {
  return testDb.prisma.problem.create({
    data: {
      slug: args.slug,
      title: args.title,
      methodName: "solve",
      hot150Order: 1,
      tags: JSON.stringify(["array"]),
    },
  });
}

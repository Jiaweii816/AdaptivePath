import { afterEach, describe, expect, it, vi } from "vitest";
import { completeReviewBackground } from "@/server/agents/coach-agent/review-background";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  createTestForegroundTraceContext,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

const enqueueAssistedRepairConsolidation = vi.hoisted(() => vi.fn());
const enqueueActivityExtraction = vi.hoisted(() => vi.fn());

vi.mock("@/server/jobs/enqueue-assisted-repair-consolidation", () => ({
  enqueueAssistedRepairConsolidation,
}));
vi.mock("@/server/jobs/enqueue-activity-extraction", () => ({
  enqueueActivityExtraction,
}));

let db: MemoryTestDb | undefined;
const originalOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  restore("PATTERNCOACH_MEMORY_ORIGIN", originalOrigin);
  restore("DATABASE_URL", originalDatabaseUrl);
  enqueueAssistedRepairConsolidation.mockReset();
  enqueueActivityExtraction.mockReset();
});

describe("Review background retrieval projection", () => {
  it("leaves the queued receipt durable and does not dispatch when background work is disabled", async () => {
    db = await createMemoryTestDb();
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
    process.env.DATABASE_URL = `file:${db.dbPath}`;
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const attempt = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        language: "Python",
        codeSnapshot: "class Solution: pass",
        memoryOrigin: "learner",
      },
    });
    const cluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        rootReviewAttemptId: attempt.id,
        clusterKind: "review_rooted",
        status: "sealed",
        sourceKey: `review:${attempt.id}`,
        memoryOrigin: "learner",
        startedAt: attempt.createdAt,
        endedAt: attempt.createdAt,
      },
    });
    const receipt = await db.prisma.memoryExtractionReceipt.create({
      data: {
        activityClusterId: cluster.id,
        extractorVersion: "activity-memory-v1",
        status: "queued",
        inputHash: "fixture-input",
      },
    });
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        kind: "review",
        title: "Binary Search strength",
        summary: "Preserved the binary-search interval invariant.",
        outcome: "passed",
        tags: JSON.stringify(["binary_search"]),
        memoryOrigin: "learner",
        activityClusterId: cluster.id,
      },
    });
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "binary-search-background-second",
        title: "Binary Search Background Second",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        sourceReviewAttemptId: attempt.id,
        factType: "strength",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
        value: "Preserves the interval invariant before updating bounds.",
        confidence: 0.7,
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "binary_search_invariant",
          humanLabel: "binary-search interval invariant",
          problemIds: [problem.id, secondProblem.id],
        }),
      },
    });
    const fts = createFtsStore(db.dbPath);

    await completeReviewBackground({
      db: db.prisma,
      outcome: {
        reviewAttempt: { id: attempt.id },
        memoryEpisode: episode,
        activityCluster: cluster,
        extractionReceipt: receipt,
      },
      userId: user.id,
      problemId: problem.id,
      backgroundJobsDisabled: true,
      ftsStore: fts,
    });

    expect(fts.searchMemoryFts("binary search strength", {
      kind: "episode",
      limit: 5,
    })[0]?.refId).toBe(episode.id);
    expect(fts.searchMemoryFts("binary search interval invariant", {
      kind: "fact",
      limit: 5,
    })[0]?.refId).toBe(fact.id);
    expect(enqueueActivityExtraction).not.toHaveBeenCalled();
    await expect(
      db.prisma.memoryExtractionReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    ).resolves.toMatchObject({ status: "queued" });
    expect(fact.id).toBeTruthy();
    fts.close();
  });

  it("does not enqueue the retired assisted-repair consolidation path", async () => {
    db = await createMemoryTestDb();
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
    process.env.DATABASE_URL = `file:${db.dbPath}`;
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const cluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        clusterKind: "review_rooted",
        status: "sealed",
        sourceKey: "review:background-no-assisted",
        memoryOrigin: "learner",
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });
    const receipt = await db.prisma.memoryExtractionReceipt.create({
      data: {
        activityClusterId: cluster.id,
        extractorVersion: "activity-memory-v1",
        status: "queued",
        inputHash: "fixture-input",
      },
    });
    await completeReviewBackground({
      db: db.prisma,
      outcome: {
        reviewAttempt: { id: "review-1" },
        memoryEpisode: null,
        activityCluster: cluster,
        extractionReceipt: receipt,
      },
      userId: user.id,
      problemId: problem.id,
      backgroundJobsDisabled: false,
      ftsStore: {
        indexMemoryDocument: vi.fn(),
        removeMemoryDocument: vi.fn(),
        reconcileMemoryDocuments: vi
          .fn()
          .mockReturnValue({ indexed: 0, removed: 0 }),
        searchMemoryFts: vi.fn().mockReturnValue([]),
        close: vi.fn(),
      },
    });

    expect(enqueueAssistedRepairConsolidation).not.toHaveBeenCalled();
    expect(enqueueActivityExtraction).not.toHaveBeenCalled();
  });

  it("dispatches the durable activity worker from an enabled Review trace", async () => {
    db = await createMemoryTestDb();
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
    process.env.DATABASE_URL = `file:${db.dbPath}`;
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const attempt = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        language: "Python",
        codeSnapshot: "class Solution: pass",
        memoryOrigin: "learner",
      },
    });
    const cluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        rootReviewAttemptId: attempt.id,
        clusterKind: "review_rooted",
        status: "sealed",
        sourceKey: `review:${attempt.id}`,
        memoryOrigin: "learner",
        startedAt: attempt.createdAt,
        endedAt: attempt.createdAt,
      },
    });
    const receipt = await db.prisma.memoryExtractionReceipt.create({
      data: {
        activityClusterId: cluster.id,
        extractorVersion: "activity-memory-v1",
        status: "queued",
        inputHash: "fixture-input",
      },
    });
    const failedCluster = await db.prisma.memoryActivityCluster.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        clusterKind: "chat_only",
        status: "sealed",
        sourceKey: "chat:prior-failed-extraction",
        memoryOrigin: "learner",
        startedAt: new Date(attempt.createdAt.getTime() - 1_000),
        endedAt: new Date(attempt.createdAt.getTime() - 500),
      },
    });
    await db.prisma.memoryExtractionReceipt.create({
      data: {
        activityClusterId: failedCluster.id,
        extractorVersion: "activity-memory-v1",
        status: "failed",
        inputHash: "prior-fixture-input",
        errorMessage: "temporary provider failure",
      },
    });
    const traceContext = await createTestForegroundTraceContext({
      prisma: db.prisma,
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      path: "review",
      task: "coach.review",
      traceRunId: "review-background-root",
    });
    enqueueActivityExtraction.mockResolvedValue({ id: "durable-job" });

    const result = await completeReviewBackground({
      db: db.prisma,
      outcome: {
        reviewAttempt: { id: attempt.id },
        memoryEpisode: null,
        activityCluster: cluster,
        extractionReceipt: receipt,
      },
      userId: user.id,
      problemId: problem.id,
      backgroundJobsDisabled: false,
      traceContext,
    });

    expect(result.dispatchStatus).toBe("dispatched");
    expect(enqueueActivityExtraction).toHaveBeenCalledTimes(2);
    expect(enqueueActivityExtraction.mock.calls[0]?.[1]).toMatchObject({
      activityClusterId: cluster.id,
      originatingTraceRunId: traceContext.traceRunId,
    });
    expect(enqueueActivityExtraction.mock.calls[1]?.[1]).toMatchObject({
      activityClusterId: failedCluster.id,
      originatingTraceRunId: traceContext.traceRunId,
    });
    expect(result.recoveredFailedReceiptCount).toBe(1);
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

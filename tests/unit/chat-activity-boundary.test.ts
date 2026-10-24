import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealChatActivityBoundary } from "@/server/memory/activity-clusters/seal-chat-activity-boundary";
import {
  createMockActivityExtractionProvider,
  runActivityExtraction,
} from "@/server/memory/extraction";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("Chat activity lifecycle boundary", () => {
  it("seals and enqueues one useful learner Chat segment exactly once", async () => {
    const fixture = await seedFixture();
    await fixture.prisma.chatMessage.createMany({
      data: [
        message(
          fixture.chatSession.id,
          1,
          "user",
          "图 DFS 反复失败，我漏了 visited，后来修复并通过。",
        ),
        message(
          fixture.chatSession.id,
          2,
          "assistant",
          "你漏了 visited 标记。",
        ),
      ],
    });
    await appendExactUserTrace(fixture, 1);
    const enqueue = vi.fn(async () => undefined);

    const first = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "explicit_exit",
      enqueueActivityExtraction: enqueue,
    });
    const replay = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "explicit_exit",
      enqueueActivityExtraction: enqueue,
    });

    expect(first.sealedSegments).toHaveLength(1);
    expect(first.sealedSegments[0]).toMatchObject({
      startMessageSequence: 1,
      endMessageSequence: 2,
      receiptStatus: "queued",
      enqueueStatus: "enqueued",
    });
    expect(replay.sealedSegments).toEqual([]);
    expect(replay.alreadyClaimedMessageCount).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(1);
    await expect(fixture.prisma.memoryActivityCluster.count()).resolves.toBe(1);
    await expect(fixture.prisma.memoryExtractionReceipt.count()).resolves.toBe(
      1,
    );
    const frozenL1 = await fixture.prisma.memoryActivityItem.findFirstOrThrow({
      where: { sourceType: "l1_event" },
    });
    const extracted = await runActivityExtraction(fixture.prisma, {
      activityClusterId: first.sealedSegments[0]!.activityClusterId,
      provider: createMockActivityExtractionProvider(),
    });
    expect(frozenL1.sourceId).toEqual(expect.any(String));
    expect(extracted).toMatchObject({
      receiptStatus: "succeeded",
      episodeId: expect.any(String),
      changedFactIds: [expect.any(String)],
    });
  });

  it("seals courtesy Chat for extractor no-signal judgment instead of pre-filtering it", async () => {
    const fixture = await seedFixture();
    await fixture.prisma.chatMessage.createMany({
      data: [
        message(fixture.chatSession.id, 1, "user", "谢谢你，我先回 Today 了。"),
        message(fixture.chatSession.id, 2, "assistant", "好的，继续加油。"),
      ],
    });
    await appendExactUserTrace(fixture, 1);

    const result = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "workbench_navigation",
    });

    expect(result.sealedSegments).toHaveLength(1);
    expect(result.sealedSegments[0]).toMatchObject({
      receiptStatus: "queued",
      enqueueStatus: "not_configured",
    });
    const extracted = await runActivityExtraction(fixture.prisma, {
      activityClusterId: result.sealedSegments[0]!.activityClusterId,
      provider: createMockActivityExtractionProvider(),
    });
    expect(extracted).toMatchObject({
      receiptStatus: "no_semantic_signal",
      changedFactIds: [],
    });
  });

  it("re-enqueues a previously failed same-session receipt at the next Chat boundary", async () => {
    const fixture = await seedFixture();
    await fixture.prisma.chatMessage.createMany({
      data: [
        message(
          fixture.chatSession.id,
          1,
          "user",
          "我之前图 DFS 到底哪里错了？",
        ),
        message(
          fixture.chatSession.id,
          2,
          "assistant",
          "我来回顾你之前的记录。",
        ),
      ],
    });
    await appendExactUserTrace(fixture, 1);
    const first = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "explicit_exit",
    });
    const receiptId = first.sealedSegments[0]!.extractionReceiptId;
    await fixture.prisma.memoryExtractionReceipt.update({
      where: { id: receiptId },
      data: {
        status: "failed",
        startedAt: new Date(),
        completedAt: new Date(),
        errorMessage: "temporary memory provider failure",
      },
    });

    const enqueue = vi.fn(async () => undefined);
    const recoveryBoundary = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "explicit_exit",
      enqueueActivityExtraction: enqueue,
    });

    expect(recoveryBoundary.sealedSegments).toEqual([]);
    expect(recoveryBoundary.requeuedFailedExtractionCount).toBe(1);
    expect(enqueue).toHaveBeenCalledWith({
      activityClusterId: first.sealedSegments[0]!.activityClusterId,
      extractionReceiptId: receiptId,
      extractorVersion: "activity-memory-v1",
    });
  });

  it("does not claim Review-rooted messages and records assistant-only skips", async () => {
    const fixture = await seedFixture();
    const review = await fixture.prisma.reviewAttempt.create({
      data: {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        chatSessionId: fixture.chatSession.id,
        language: "Python",
        codeSnapshot: "def dfs(node): pass",
        memoryOrigin: "learner",
      },
    });
    await fixture.prisma.chatMessage.createMany({
      data: [
        {
          ...message(fixture.chatSession.id, 1, "user", "Review my code"),
          reviewAttemptId: review.id,
        },
        {
          ...message(
            fixture.chatSession.id,
            2,
            "assistant",
            "Review diagnosis",
          ),
          reviewAttemptId: review.id,
        },
        message(
          fixture.chatSession.id,
          3,
          "assistant",
          "远程 review 暂时不可用。",
        ),
      ],
    });
    const enqueue = vi.fn(async () => undefined);

    const result = await sealChatActivityBoundary(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      boundaryReason: "problem_changed",
      enqueueActivityExtraction: enqueue,
    });

    expect(result.reviewOwnedMessageCount).toBe(2);
    expect(result.sealedSegments).toEqual([]);
    expect(result.skippedSegments).toEqual([
      {
        startMessageSequence: 3,
        endMessageSequence: 3,
        messageCount: 1,
        reason: "assistant_only_segment",
      },
    ]);
    expect(enqueue).not.toHaveBeenCalled();
    await expect(fixture.prisma.memoryActivityCluster.count()).resolves.toBe(0);
  });
});

async function seedFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const seeded = await seedMinimalUserAndProblem(database.prisma);
  return { prisma: database.prisma, ...seeded };
}

async function appendExactUserTrace(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  sequence: number,
) {
  const userMessage = await fixture.prisma.chatMessage.findUniqueOrThrow({
    where: {
      sessionId_sequence: { sessionId: fixture.chatSession.id, sequence },
    },
  });
  return fixture.prisma.l1MemoryEvent.create({
    data: {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      eventType: "chat_user_message",
      source: "chat_reply",
      content: userMessage.contentMarkdown,
      eventJson: JSON.stringify({ chatMessageId: userMessage.id, sequence }),
      memoryOrigin: "learner",
    },
  });
}

function message(
  sessionId: string,
  sequence: number,
  role: "user" | "assistant",
  contentMarkdown: string,
) {
  return {
    sessionId,
    sequence,
    role,
    contentMarkdown,
    memoryOrigin: "learner",
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import { enqueueActivityExtraction } from "@/server/jobs/enqueue-activity-extraction";
import {
  createMockActivityExtractionProvider,
  runActivityExtraction,
} from "@/server/memory/extraction";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  await db?.cleanup();
  db = undefined;
});

describe("clearCoachChatHistory", () => {
  it("records a soft clear boundary, resets working summary/cursor, and appends L1 trace", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedIrisChat(db.prisma);
    const messages = await Promise.all(
      [
        ["user", "old question"],
        ["assistant", "old reply"],
        ["assistant", "old review reply"],
      ].map(([role, contentMarkdown], index) =>
        db!.prisma.chatMessage.create({
          data: {
            sessionId: chatSession.id,
            role,
            contentMarkdown,
            sequence: index + 1,
            memoryOrigin: "test",
          },
        }),
      ),
    );
    await db.prisma.chatSession.update({
      where: { id: chatSession.id },
      data: {
        rollingSummary: "old working summary",
        lastConsolidatedMessageId: messages[1].id,
      },
    });
    const clearCoachChatHistory = await loadClearCoachChatHistory(db.prisma);

    const result = await clearCoachChatHistory({
      chatSessionId: chatSession.id,
    });

    expect(result).toMatchObject({
      ok: true,
      chatSessionId: chatSession.id,
      clearedBeforeSequence: 3,
      hiddenMessageCount: 3,
    });
    expect(result.clearedAt).toEqual(expect.any(String));

    const storedSession = await db.prisma.chatSession.findUniqueOrThrow({
      where: { id: chatSession.id },
    });
    expect(storedSession.clearedBeforeSequence).toBe(3);
    expect(storedSession.clearedAt).toBeInstanceOf(Date);
    expect(storedSession.rollingSummary).toBeNull();
    expect(storedSession.lastConsolidatedMessageId).toBeNull();

    const trace = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_history_cleared",
      },
    });
    expect(JSON.parse(trace.eventJson)).toMatchObject({
      chatSessionId: chatSession.id,
      previousClearedBeforeSequence: 0,
      clearedBeforeSequence: 3,
      hiddenMessageCount: 3,
    });
  });

  it("returns a no-op success when the current problem has no session", async () => {
    db = await createMemoryTestDb();
    await db.prisma.user.create({ data: { handle: irisHandle } });
    await db.prisma.problem.create({
      data: {
        slug: "binary-search",
        title: "Binary Search",
        statementMarkdown: "Find target.",
        methodName: "search",
      },
    });
    const clearCoachChatHistory = await loadClearCoachChatHistory(db.prisma);

    const result = await clearCoachChatHistory({
      problemSlug: "binary-search",
    });

    expect(result).toEqual({
      ok: true,
      chatSessionId: null,
      clearedBeforeSequence: 0,
      clearedAt: null,
      hiddenMessageCount: 0,
    });
    await expect(db.prisma.l1MemoryEvent.count()).resolves.toBe(0);
  });

  it("does not advance the clear cursor when activity sealing fails", async () => {
    db = await createMemoryTestDb();
    const { chatSession } = await seedIrisChat(db.prisma);
    await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "这条消息不能丢",
        sequence: 1,
        memoryOrigin: "test",
      },
    });
    const clearCoachChatHistory = await loadClearCoachChatHistory(db.prisma);

    await expect(
      clearCoachChatHistory(
        { chatSessionId: chatSession.id },
        {
          sealBoundary: async () => {
            throw new Error("receipt_write_failed");
          },
        },
      ),
    ).rejects.toThrow("receipt_write_failed");

    expect(
      await db.prisma.chatSession.findUniqueOrThrow({
        where: { id: chatSession.id },
      }),
    ).toMatchObject({ clearedBeforeSequence: 0, clearedAt: null });
    await expect(
      db.prisma.chatMessage.count({ where: { sessionId: chatSession.id } }),
    ).resolves.toBe(1);
    await expect(db.prisma.l1MemoryEvent.count()).resolves.toBe(0);
  });

  it("re-enqueues a failed learner extraction on the next clear boundary", async () => {
    const previousOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
    try {
      db = await createMemoryTestDb();
      const { user, problem, chatSession } = await seedIrisChat(
        db.prisma,
        "learner",
      );
      const userMessage = await db.prisma.chatMessage.create({
        data: {
          sessionId: chatSession.id,
          role: "user",
          contentMarkdown: "图 DFS 漏了 visited，修复后通过。",
          sequence: 1,
          memoryOrigin: "learner",
        },
      });
      await db.prisma.chatMessage.create({
        data: {
          sessionId: chatSession.id,
          role: "assistant",
          contentMarkdown: "记住在扩展邻居前标记 visited。",
          sequence: 2,
          memoryOrigin: "learner",
        },
      });
      await db.prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          eventType: "chat_user_message",
          source: "chat_reply",
          content: userMessage.contentMarkdown,
          eventJson: JSON.stringify({
            chatMessageId: userMessage.id,
            sequence: 1,
          }),
          memoryOrigin: "learner",
        },
      });
      await db.prisma.agentTraceRun.create({
        data: {
          id: "clear-chat-root",
          userId: user.id,
          problemId: problem.id,
          path: "chat",
          actionKind: "chat",
          status: "succeeded",
          processInstanceId: "clear-test",
          memoryOrigin: "learner",
          chatSessionId: chatSession.id,
        },
      });
      const provider = createMockActivityExtractionProvider();
      let providerCalls = 0;
      const retryingProvider = {
        name: "clear-retry-provider",
        async extract(...args: Parameters<typeof provider.extract>) {
          providerCalls += 1;
          if (providerCalls === 1) {
            throw new Error("temporary provider failure");
          }
          return provider.extract(...args);
        },
      };
      const scheduled: Array<() => void> = [];
      const enqueueJob: typeof enqueueActivityExtraction = (prisma, args) =>
        enqueueActivityExtraction(prisma, args, {
          processInstanceId: "clear-worker",
          schedule: (task) => scheduled.push(task),
          run: (workerDb, workerArgs) =>
            runActivityExtraction(workerDb, {
              ...workerArgs,
              provider: retryingProvider,
            }),
        });
      const clearCoachChatHistory = await loadClearCoachChatHistory(db.prisma);

      await clearCoachChatHistory(
        { chatSessionId: chatSession.id },
        { enqueueJob },
      );
      expect(scheduled.length).toBeGreaterThanOrEqual(1);
      scheduled.shift()!();
      scheduled.length = 0;
      await vi.waitFor(async () => {
        expect(
          await db!.prisma.memoryExtractionReceipt.findFirstOrThrow(),
        ).toMatchObject({ status: "failed" });
      }, { timeout: 5_000 });

      await clearCoachChatHistory(
        { chatSessionId: chatSession.id },
        { enqueueJob },
      );
      expect(scheduled.length).toBeGreaterThanOrEqual(1);
      scheduled.shift()!();
      await vi.waitFor(async () => {
        expect(
          await db!.prisma.memoryExtractionReceipt.findFirstOrThrow(),
        ).toMatchObject({ status: "succeeded" });
      }, { timeout: 5_000 });
      expect(providerCalls).toBe(2);
      await expect(db.prisma.memoryEpisode.count()).resolves.toBe(1);
    } finally {
      if (previousOrigin === undefined) {
        delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
      } else {
        process.env.PATTERNCOACH_MEMORY_ORIGIN = previousOrigin;
      }
    }
  });
});

describe("loadWorkbenchSession clear boundary", () => {
  it("restores only messages after the latest clear boundary", async () => {
    db = await createMemoryTestDb();
    const { problem, chatSession } = await seedIrisChat(db.prisma);
    await db.prisma.chatMessage.createMany({
      data: [
        {
          sessionId: chatSession.id,
          role: "user",
          contentMarkdown: "old question",
          sequence: 1,
        },
        {
          sessionId: chatSession.id,
          role: "assistant",
          contentMarkdown: "old reply",
          sequence: 2,
        },
        {
          sessionId: chatSession.id,
          role: "user",
          contentMarkdown: "new question",
          sequence: 3,
        },
      ],
    });
    await db.prisma.chatSession.update({
      where: { id: chatSession.id },
      data: { clearedBeforeSequence: 2 },
    });
    const loadWorkbenchSession = await loadWorkbenchSessionWithDb(db.prisma);

    const session = await loadWorkbenchSession(problem.id);

    expect(session?.chatSessionId).toBe(chatSession.id);
    expect(session?.chatTurns).toEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "new question",
      },
    ]);
  });
});

async function seedIrisChat(
  prisma: PrismaClient,
  memoryOrigin: "test" | "learner" = "test",
) {
  const user = await prisma.user.create({ data: { handle: irisHandle } });
  const problem = await prisma.problem.create({
    data: {
      slug: "binary-search",
      title: "Binary Search",
      statementMarkdown: "Find target.",
      methodName: "search",
      tags: JSON.stringify(["binary_search", "array"]),
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      isActive: true,
      memoryOrigin,
    },
  });

  return { user, problem, chatSession };
}

async function loadClearCoachChatHistory(prisma: PrismaClient) {
  vi.resetModules();
  vi.doMock("@/server/db/prisma", () => ({
    default: prisma,
    prisma,
  }));
  const clearHistoryModule = await import(
    "@/server/agents/coach-agent/clear-chat-history"
  );

  return clearHistoryModule.clearCoachChatHistory;
}

async function loadWorkbenchSessionWithDb(prisma: PrismaClient) {
  vi.resetModules();
  vi.doMock("@/server/db/prisma", () => ({
    default: prisma,
    prisma,
  }));
  const workbenchSessionModule = await import(
    "@/features/workbench/workbench-session"
  );

  return workbenchSessionModule.loadWorkbenchSession;
}

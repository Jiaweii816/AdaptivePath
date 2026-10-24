import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceSessionEndRequestSchema } from "../../app/api/trace/session/end/route";
import { endTraceSession } from "@/server/observability/trace-session-end";
import { isTraceUiEnabled } from "@/server/observability/trace-ui-config";
import { enqueueActivityExtraction } from "@/server/jobs/enqueue-activity-extraction";
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

describe("runtime trace explicit session end", () => {
  it("closes only the owned matching tab/problem and is idempotent", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
    const target = await createSession(database, user.id, problem.id, "target", "idle");
    const otherTab = await createSession(database, user.id, problem.id, "other-tab", "idle");
    const now = new Date("2026-07-12T12:00:00.000Z");

    const first = await endTraceSession(database.prisma, {
      userId: user.id,
      browserInstanceId: "target",
      problemId: problem.id,
      reason: "explicit_exit",
    }, now);
    const replay = await endTraceSession(database.prisma, {
      userId: user.id,
      browserInstanceId: "target",
      problemId: problem.id,
      reason: "explicit_exit",
    }, now);

    expect(first).toEqual({ ok: true, ended: true, sessionId: target.id, foregroundStatus: "closed" });
    expect(replay).toEqual({ ok: true, ended: false, sessionId: null, foregroundStatus: null });
    expect(await database.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      foregroundStatus: "closed",
      backgroundStatus: "settled",
      activeIdentityKey: null,
      foregroundEndedAt: now,
      settledAt: now,
      endReason: "explicit_exit",
    });
    expect(await database.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: otherTab.id } })).toMatchObject({
      foregroundStatus: "active",
      activeIdentityKey: expect.any(String),
    });
  });

  it("keeps pending background work unsettled", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
    const session = await createSession(database, user.id, problem.id, "pending-tab", "pending");

    await endTraceSession(database.prisma, {
      userId: user.id,
      browserInstanceId: "pending-tab",
      problemId: problem.id,
      reason: "workbench_navigation",
    });

    expect(await database.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: session.id } })).toMatchObject({
      foregroundStatus: "closed",
      backgroundStatus: "pending",
      settledAt: null,
    });
  });

  it("seals learner Chat before closing the foreground session", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(database.prisma);
    const workspace = await createSession(database, user.id, problem.id, "chat-tab", "idle");
    await database.prisma.chatMessage.createMany({
      data: [
        {
          sessionId: chatSession.id,
          role: "user",
          contentMarkdown: "上次图 DFS 哪里栽坑？",
          sequence: 1,
          memoryOrigin: "learner",
        },
        {
          sessionId: chatSession.id,
          role: "assistant",
          contentMarkdown: "你上次忘了进入节点时标记 visited。",
          sequence: 2,
          memoryOrigin: "learner",
        },
      ],
    });
    const userMessage = await database.prisma.chatMessage.findUniqueOrThrow({
      where: {
        sessionId_sequence: { sessionId: chatSession.id, sequence: 1 },
      },
    });
    await database.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        source: "chat_reply",
        content: userMessage.contentMarkdown,
        eventJson: JSON.stringify({
          chatMessageId: userMessage.id,
          sequence: userMessage.sequence,
        }),
        memoryOrigin: "learner",
      },
    });
    await database.prisma.agentTraceRun.create({
      data: {
        id: "chat-boundary-root",
        userId: user.id,
        problemId: problem.id,
        workspaceSessionId: workspace.id,
        turnOrdinal: 1,
        path: "chat",
        actionKind: "chat",
        status: "succeeded",
        processInstanceId: "test-process",
        memoryOrigin: "learner",
        chatSessionId: chatSession.id,
      },
    });
    const scheduled: Array<() => void> = [];
    const enqueueJob: typeof enqueueActivityExtraction = async (prisma, args) => {
      const current = await database.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: workspace.id },
      });
      expect(current.foregroundStatus).toBe("active");
      return enqueueActivityExtraction(prisma, args, {
        processInstanceId: "chat-boundary-worker",
        traceRunId: "chat-boundary-child",
        schedule: (task) => scheduled.push(task),
        run: (workerDb, workerArgs) =>
          runActivityExtraction(workerDb, {
            ...workerArgs,
            provider: createMockActivityExtractionProvider(),
          }),
      });
    };

    await endTraceSession(
      database.prisma,
      {
        userId: user.id,
        browserInstanceId: "chat-tab",
        problemId: problem.id,
        reason: "workbench_navigation",
      },
      new Date("2026-07-20T12:00:00.000Z"),
      { enqueueJob },
    );

    expect(scheduled).toHaveLength(1);
    await expect(database.prisma.memoryActivityCluster.count()).resolves.toBe(1);
    await expect(database.prisma.memoryExtractionReceipt.count()).resolves.toBe(1);
    await expect(database.prisma.backgroundJob.count()).resolves.toBe(1);
    expect(
      await database.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: workspace.id },
      }),
    ).toMatchObject({ foregroundStatus: "closed" });
    scheduled[0]!();
    await vi.waitFor(async () => {
      expect(
        await database.prisma.backgroundJob.findFirstOrThrow(),
      ).toMatchObject({ status: "succeeded" });
    }, { timeout: 5_000 });
    await expect(database.prisma.memoryEpisode.count()).resolves.toBe(1);
  });

  it("does not accept client-owned user identity", () => {
    expect(traceSessionEndRequestSchema.safeParse({
      userId: "attacker",
      browserInstanceId: "tab",
      problemId: "problem",
      reason: "explicit_exit",
    }).success).toBe(false);
  });

  it("defaults UI off outside development and honors an explicit disabled flag", () => {
    expect(isTraceUiEnabled({}, "production")).toBe(false);
    expect(isTraceUiEnabled({ TRACE_UI_ENABLED: "false" }, "development")).toBe(false);
    expect(isTraceUiEnabled({ TRACE_UI_ENABLED: "true" }, "production")).toBe(true);
  });

  it("returns 404 from both API routes when TRACE_UI_ENABLED is false", async () => {
    const previous = process.env.TRACE_UI_ENABLED;
    process.env.TRACE_UI_ENABLED = "false";
    try {
      const [{ GET }, { POST }] = await Promise.all([
        import("../../app/api/trace/session/route"),
        import("../../app/api/trace/session/end/route"),
      ]);
      const getResponse = await GET(new Request("http://localhost/api/trace/session?problemId=p&browserInstanceId=b"));
      const postResponse = await POST(new Request("http://localhost/api/trace/session/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserInstanceId: "b", problemId: "p", reason: "explicit_exit" }),
      }));
      expect(getResponse.status).toBe(404);
      expect(postResponse.status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.TRACE_UI_ENABLED;
      else process.env.TRACE_UI_ENABLED = previous;
    }
  });
});

async function createSession(
  database: MemoryTestDb,
  userId: string,
  problemId: string,
  browserInstanceId: string,
  backgroundStatus: "idle" | "pending",
) {
  return database.prisma.problemWorkspaceSession.create({
    data: {
      userId,
      problemId,
      browserInstanceId,
      activeIdentityKey: `${userId}:${problemId}:${browserInstanceId}`,
      startTrigger: "review",
      captureLevel: "full",
      backgroundStatus,
      memoryOrigin: "learner",
    },
  });
}

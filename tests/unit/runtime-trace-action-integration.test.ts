import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import type { CoachProvider } from "@/server/agents/coach-agent/coach-agent.types";
import {
  createLocalVisibleCodeRunnerFixtureProvider,
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let database: MemoryTestDb | undefined;
const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  CODE_RUNNER_PROVIDER: process.env.CODE_RUNNER_PROVIDER,
  TRACE_CAPTURE_LEVEL: process.env.TRACE_CAPTURE_LEVEL,
};

afterEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  restoreEnv();
  await database?.cleanup();
  database = undefined;
});

describe("runtime trace action integration", () => {
  it("keeps semantic L1 writes while the obsolete flag can no longer disable tracing", async () => {
    const fixture = await createActionFixture();
    const { reviewPipeline } = await loadActionPaths(fixture.prisma);

    const result = await reviewPipeline(
      {
        problemId: fixture.problem.id,
        language: "Python",
        code: fixture.code,
        selectedTestCaseIds: [fixture.testCase.id],
        responseLanguage: "en",
        browserInstanceId: "always-cutover-tab",
        clientOccurredAt: "2026-07-12T18:00:00.000Z",
      },
      {
        prisma: fixture.prisma,
        coachProvider: fixture.coachProvider,
        codeRunnerProvider: fixture.codeRunnerProvider,
        backgroundJobsPolicy: "disabled",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.trace).toBeDefined();
    await expect(fixture.prisma.problemWorkspaceSession.count()).resolves.toBe(1);
    await expect(
      fixture.prisma.l1MemoryEvent.count({ where: { eventType: "coach_reply" } }),
    ).resolves.toBe(1);
  });

  it("appends Review, Chat, and Practice Run to one opted-in tab Session", async () => {
    const fixture = await createActionFixture();
    const { reviewPipeline, chatReply, runPracticeTests } =
      await loadActionPaths(fixture.prisma);
    const browserInstanceId = "trace-tab-sequential-actions";
    const clientOccurredAt = "2026-07-12T18:00:00.000Z";

    await expect(
      fixture.prisma.problemWorkspaceSession.count(),
    ).resolves.toBe(0);

    const review = await reviewPipeline(
      {
        problemId: fixture.problem.id,
        language: "Python",
        code: fixture.code,
        selectedTestCaseIds: [fixture.testCase.id],
        responseLanguage: "en",
        browserInstanceId,
        clientOccurredAt,
      },
      {
        prisma: fixture.prisma,
        coachProvider: fixture.coachProvider,
        codeRunnerProvider: fixture.codeRunnerProvider,
        backgroundJobsPolicy: "disabled",
      },
    );
    const chat = await chatReply(
      {
        chatSessionId: review.chatSessionId,
        problemId: fixture.problem.id,
        message: "Why does the left pointer never move backward?",
        language: "Python",
        code: fixture.code,
        selectedTestCaseIds: [fixture.testCase.id],
        responseLanguage: "en",
        browserInstanceId,
        clientOccurredAt,
      },
      {
        prisma: fixture.prisma,
        coachProvider: fixture.coachProvider,
        codeRunnerProvider: fixture.codeRunnerProvider,
        backgroundJobsPolicy: "disabled",
      },
    );
    const practice = await runPracticeTests({
      problemId: fixture.problem.id,
      language: "Python",
      code: fixture.code,
      selectedTestCaseIds: [fixture.testCase.id],
      browserInstanceId,
      clientOccurredAt,
    });

    const sessions = await fixture.prisma.problemWorkspaceSession.findMany();
    const runs = await fixture.prisma.agentTraceRun.findMany({
      orderBy: { turnOrdinal: "asc" },
    });
    const events = await fixture.prisma.agentTraceEvent.findMany({
      orderBy: { seq: "asc" },
    });
    const practiceRunLog =
      await fixture.prisma.practiceRunLog.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
      });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      browserInstanceId,
      startTrigger: "review",
      nextTurnOrdinal: 4,
      nextSeq: events.length + 1,
    });
    expect(runs.map((run) => [run.path, run.turnOrdinal])).toEqual([
      ["review", 1],
      ["chat", 2],
      ["practice_run", 3],
    ]);
    expect(runs.every((run) => run.traceCompleteness === "complete")).toBe(true);
    expect(runs.every((run) => run.endedAt !== null)).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    for (const run of runs) {
      expect(
        events.some(
          (event) =>
            event.traceRunId === run.id && event.kind === "workspace_snapshot",
        ),
      ).toBe(true);
    }
    const eventsFor = (path: string) => {
      const run = runs.find((candidate) => candidate.path === path)!;
      return events.filter((event) => event.traceRunId === run.id);
    };
    expect(eventsFor("review").filter((event) => event.kind === "llm")).toHaveLength(1);
    expect(eventsFor("review").some((event) => event.kind === "runner")).toBe(true);
    expect(eventsFor("chat").some((event) => event.kind === "llm")).toBe(true);
    expect(eventsFor("practice_run").filter((event) => event.kind === "runner")).toHaveLength(2);
    expect(eventsFor("practice_run").some((event) => event.kind === "persistence")).toBe(true);
    expect(eventsFor("practice_run").some((event) => event.kind === "llm")).toBe(false);
    expect(eventsFor("practice_run").some((event) => event.kind === "retrieval")).toBe(false);
    expect(review.trace).toMatchObject({
      workspaceSessionId: sessions[0].id,
      turnOrdinal: 1,
    });
    expect(chat.trace).toMatchObject({
      workspaceSessionId: sessions[0].id,
      turnOrdinal: 2,
    });
    expect(practice.trace).toMatchObject({
      workspaceSessionId: sessions[0].id,
      turnOrdinal: 3,
    });
    expect(practiceRunLog.codeHash).toMatch(/^sha256:/);
    expect(practiceRunLog.executionFingerprint).toMatch(
      /^execfp:v1:sha256:/,
    );
    await expect(
      fixture.prisma.l1MemoryEvent.count({
        where: { eventType: { in: ["coach_reply", "chat_reply"] } },
      }),
    ).resolves.toBe(2);
  });

  it("keeps Review and semantic L1 writes working when allocator persistence fails", async () => {
    const fixture = await createActionFixture();
    await fixture.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_workspace_trace_session
      BEFORE INSERT ON ProblemWorkspaceSession
      BEGIN
        SELECT RAISE(ABORT, 'workspace trace unavailable');
      END;
    `);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { reviewPipeline } = await loadActionPaths(fixture.prisma);

    const result = await reviewPipeline(
      {
        problemId: fixture.problem.id,
        language: "Python",
        code: fixture.code,
        selectedTestCaseIds: [fixture.testCase.id],
        responseLanguage: "en",
        browserInstanceId: "trace-tab-allocator-failure",
        clientOccurredAt: "2026-07-12T18:00:00.000Z",
      },
      {
        prisma: fixture.prisma,
        coachProvider: fixture.coachProvider,
        codeRunnerProvider: fixture.codeRunnerProvider,
        backgroundJobsPolicy: "disabled",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.trace).toBeUndefined();
    await expect(fixture.prisma.problemWorkspaceSession.count()).resolves.toBe(0);
    await expect(
      fixture.prisma.l1MemoryEvent.count({ where: { eventType: "coach_reply" } }),
    ).resolves.toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("continuing without new-store telemetry"),
      expect.anything(),
    );
  });
});

async function createActionFixture() {
  database = await createMemoryTestDb();
  process.env.DATABASE_URL = `file:${database.dbPath}`;
  process.env.CODE_RUNNER_PROVIDER = "mock";
  process.env.TRACE_CAPTURE_LEVEL = "full";
  await seedDatabase(database.prisma);

  const problem = await database.prisma.problem.findUniqueOrThrow({
    where: { slug: "longest-substring-without-repeating-characters" },
  });
  const testCase = await database.prisma.problemTestCase.findFirstOrThrow({
    where: { problemId: problem.id, isVisible: true },
  });
  const code = [
    "class Solution:",
    "    def lengthOfLongestSubstring(self, s):",
    "        return len(set(s))",
  ].join("\n");
  const coachProvider: CoachProvider = {
    review: vi.fn(async (input) => ({
      diagnosis: {
        problemSlug: input.problem.slug,
        runStatus: input.runResult.status,
        userIssueSummary: "Visible fixture evidence was reviewed.",
        coachSummary: "Keep the current approach and verify one repeated-character case.",
        mistakeTags: [],
        skillTags: ["sliding-window"],
        memoryUpdateCandidate: { facts: [] },
      },
      coachReply: "The visible fixture ran. Next, verify one repeated-character case.",
    })),
    chat: vi.fn(async () => ({
      type: "final" as const,
      coachReply: "Because moving left backward would reintroduce a duplicate into the window.",
    })),
  };

  return {
    prisma: database.prisma,
    problem,
    testCase,
    code,
    coachProvider,
    codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
  };
}

async function loadActionPaths(prisma: MemoryTestDb["prisma"]) {
  vi.resetModules();
  vi.doMock("@/server/db/prisma", () => ({ default: prisma, prisma }));
  const [review, chat, practice] = await Promise.all([
    import("@/server/agents/coach-agent/review-pipeline"),
    import("@/server/agents/coach-agent/chat-reply"),
    import("@/server/workbench/practice-run"),
  ]);
  return {
    reviewPipeline: review.reviewPipeline,
    chatReply: chat.chatReply,
    runPracticeTests: practice.runPracticeTests,
  };
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

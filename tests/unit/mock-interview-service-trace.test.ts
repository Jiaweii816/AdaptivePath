import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { InterviewerProvider } from "@/server/agents/interviewer-agent/interviewer-agent.types";
import type { CodeRunResult } from "@/types/code-runner";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
let provider: InterviewerProvider;
let runCodeWithTests: ReturnType<typeof vi.fn>;

afterEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  await db?.cleanup();
  db = undefined;
});

describe("mock interview service trace", () => {
  it("links start/respond/run-code/send-code L1 events with traceRunId and timings", async () => {
    db = await createMemoryTestDb();
    const seeded = await seedMockInterviewProblem(db.prisma);
    provider = createTracingInterviewerProvider();
    runCodeWithTests = vi.fn().mockResolvedValue({
      status: "failed",
      passedCount: 0,
      failedCount: 1,
      stdout: "",
      stderr: "",
      durationMs: 12,
      actualOutput: "[]",
      expectedOutput: "[0,1]",
      firstFailedCase: {
        id: seeded.testCase.id,
        label: seeded.testCase.label,
        input: [2, 7, 11, 15],
        expected: [0, 1],
        actual: [],
      },
      testResults: [],
      rawResult: { providerUsed: "piston_fallback" },
    } satisfies CodeRunResult);
    mockServiceModules(db.prisma);

    const { startMockInterview } = await import(
      "@/server/mock-interview/start-mock-interview"
    );
    const { continueMockInterview } = await import(
      "@/server/mock-interview/continue-mock-interview"
    );
    const { runMockInterviewCode } = await import(
      "@/server/mock-interview/run-mock-interview-code"
    );
    const { sendCodeToInterviewer } = await import(
      "@/server/mock-interview/send-code-to-interviewer"
    );

    const started = await startMockInterview({
      problemId: seeded.problem.id,
      focusTags: [],
      language: "Python",
      responseLanguage: "zh",
    });
    const startEvents = await db.prisma.l1MemoryEvent.findMany({
      where: { source: "mock_interview:start" },
      orderBy: { occurredAt: "asc" },
    });
    expect(startEvents).toHaveLength(2);
    expectTraceLinked(startEvents.map((event) => JSON.parse(event.eventJson)));
    expect(JSON.parse(startEvents[1].eventJson).timings).toMatchObject({
      totalMs: expect.any(Number),
      llmMsTotal: 0,
    });

    await continueMockInterview({
      sessionId: started.session.id,
      message: "我会先用哈希表找 complement。",
      responseLanguage: "zh",
    });
    const respondEvents = await db.prisma.l1MemoryEvent.findMany({
      where: { source: "mock_interview:respond" },
      orderBy: { occurredAt: "asc" },
    });
    expect(respondEvents).toHaveLength(2);
    expectTraceLinked(respondEvents.map((event) => JSON.parse(event.eventJson)));
    expect(JSON.parse(respondEvents[1].eventJson).timings).toMatchObject({
      totalMs: expect.any(Number),
      llmMsTotal: 0,
    });

    await runMockInterviewCode({
      sessionId: started.session.id,
      language: "Python",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return []",
      selectedTestCaseIds: [seeded.testCase.id],
    });
    const runEvent = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: { eventType: "mock_interview_run_evidence" },
    });
    expect(JSON.parse(runEvent.eventJson)).toMatchObject({
      traceRunId: expect.any(String),
      runEvidenceId: expect.any(String),
      timings: {
        totalMs: expect.any(Number),
        runnerMs: expect.any(Number),
      },
    });
    await expect(db.prisma.reviewAttempt.count()).resolves.toBe(0);

    await sendCodeToInterviewer({
      sessionId: started.session.id,
      language: "Python",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return []",
      selectedTestCaseIds: [seeded.testCase.id],
      message: "这是我的当前代码。",
    });
    const sendCodeEvents = await db.prisma.l1MemoryEvent.findMany({
      where: { source: "mock_interview:send_code" },
      orderBy: { occurredAt: "asc" },
    });
    expect(sendCodeEvents).toHaveLength(2);
    expectTraceLinked(sendCodeEvents.map((event) => JSON.parse(event.eventJson)));
    expect(JSON.parse(sendCodeEvents[1].eventJson).timings).toMatchObject({
      totalMs: expect.any(Number),
      llmMsTotal: 0,
    });

    expect(provider.start).toHaveBeenCalledWith(
      expect.objectContaining({
        traceContext: expect.objectContaining({ path: "mock_interview" }),
      }),
    );
    expect(provider.continue).toHaveBeenCalledWith(
      expect.objectContaining({
        traceContext: expect.objectContaining({ path: "mock_interview" }),
      }),
    );
    expect(provider.discussCode).toHaveBeenCalledWith(
      expect.objectContaining({
        traceContext: expect.objectContaining({ path: "mock_interview" }),
      }),
    );
  });
});

function createTracingInterviewerProvider(): InterviewerProvider {
  return {
    start: vi.fn(async () => ({
      messageMarkdown: "开场问题",
      proposedPhase: "intro" as const,
      questionAsked: false,
    })),
    continue: vi.fn(async () => ({
      messageMarkdown: "继续追问",
      proposedPhase: "coding" as const,
      questionAsked: true,
    })),
    discussCode: vi.fn(async () => ({
      messageMarkdown: "代码追问",
      proposedPhase: "code_discussion" as const,
      questionAsked: true,
    })),
    complete: vi.fn(async () => {
      throw new Error("not used in this trace test");
    }),
  };
}

function mockServiceModules(prisma: PrismaClient) {
  vi.doMock("@/server/db/prisma", () => ({ default: prisma }));
  vi.doMock("@/server/agents/interviewer-agent/interviewer-provider", () => ({
    getInterviewerProvider: () => provider,
  }));
  vi.doMock("@/server/tools/code-runner/run-code-with-tests", async () => {
    const actual = await vi.importActual<
      typeof import("@/server/tools/code-runner/run-code-with-tests")
    >("@/server/tools/code-runner/run-code-with-tests");
    return {
      ...actual,
      runCodeWithTests,
    };
  });
}

async function seedMockInterviewProblem(prisma: PrismaClient) {
  const problem = await prisma.problem.create({
    data: {
      slug: "two-sum",
      title: "Two Sum",
      statementMarkdown: "Find two indices.",
      methodName: "twoSum",
      tags: JSON.stringify(["array", "hash_table"]),
      isDemoSupported: true,
      localRunStatus: "runnable",
      starterCodePython: "class Solution:\n    def twoSum(self, nums, target):\n        pass",
    },
  });
  const testCase = await prisma.problemTestCase.create({
    data: {
      problemId: problem.id,
      label: "sample",
      inputJson: JSON.stringify({ nums: [2, 7, 11, 15], target: 9 }),
      expectedJson: JSON.stringify([0, 1]),
      isVisible: true,
      source: "visible",
      sortOrder: 1,
    },
  });

  return { problem, testCase };
}

function expectTraceLinked(events: Array<{ traceRunId?: string }>) {
  const traceRunIds = new Set(events.map((event) => event.traceRunId));
  expect(traceRunIds.size).toBe(1);
  expect([...traceRunIds][0]).toEqual(expect.any(String));
}

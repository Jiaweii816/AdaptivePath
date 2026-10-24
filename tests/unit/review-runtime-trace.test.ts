import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { reviewPipeline } from "@/server/agents/coach-agent/review-pipeline";
import { DIAGNOSIS_SENTINEL } from "@/server/agents/coach-agent/review-output-protocol";
import { createMockCodeRunnerProvider } from "@/server/tools/code-runner/mock-runner";
import {
  createLocalVisibleCodeRunnerFixtureProvider,
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let database: MemoryTestDb | undefined;
const originalTraceCaptureLevel = process.env.TRACE_CAPTURE_LEVEL;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

afterEach(async () => {
  vi.restoreAllMocks();
  await database?.cleanup();
  database = undefined;
  if (originalTraceCaptureLevel === undefined) {
    delete process.env.TRACE_CAPTURE_LEVEL;
  } else {
    process.env.TRACE_CAPTURE_LEVEL = originalTraceCaptureLevel;
  }
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("Review runtime trace", () => {
  it("finalizes a successful Review with exactly one LLM and at least one runner event", async () => {
    const fixture = await createFixture();
    const content = reviewContent({
      runStatus: "failed",
      reply:
        "The first visible case returned the wrong index. Change only the boundary return, then rerun that same case.",
      facts: [],
      mistakeTags: [],
    });
    const { provider, create } = qwenProvider(content);
    const progressEvents: Array<{ type: string }> = [];

    const result = await reviewPipeline(
      reviewInput(fixture, "review-trace-success"),
      {
        prisma: fixture.prisma,
        coachProvider: provider,
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider({
          outcome: { kind: "failed", actual: 2, expected: 1 },
        }),
        backgroundJobsPolicy: "disabled",
        onProgress(event) {
          progressEvents.push(event);
        },
      },
    );

    const traceRunId = result.trace!.traceRunId;
    const [run, events] = await Promise.all([
      fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: traceRunId },
      }),
      fixture.prisma.agentTraceEvent.findMany({
        where: { traceRunId },
        orderBy: { seq: "asc" },
      }),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(progressEvents).toEqual([{ type: "evidence", evidence: expect.any(Object) }]);
    expect(events.filter((event) => event.kind === "llm")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "runner").length).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.kind === "guard")).toBe(true);
    expect(events.some((event) => event.kind === "persistence")).toBe(true);
    expect(run).toMatchObject({
      status: "succeeded",
      traceCompleteness: "complete",
      llmCallCount: 1,
    });
    expect(run.finalFlushAt).not.toBeNull();
  });

  it("keeps raw, parsed, and visible Review output distinguishable on the one LLM event", async () => {
    const fixture = await createFixture();
    const rawReply = [
      "The selected visible test passed.",
      "guaranteed accepted.",
    ].join("\n");
    const content = reviewContent({
      runStatus: "passed_visible_tests",
      reply: rawReply,
      facts: [],
      mistakeTags: [],
    });
    const { provider } = qwenProvider(content);

    const result = await reviewPipeline(
      reviewInput(fixture, "review-trace-output-shapes"),
      {
        prisma: fixture.prisma,
        coachProvider: provider,
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider(),
        backgroundJobsPolicy: "disabled",
      },
    );
    const event = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: { traceRunId: result.trace!.traceRunId, kind: "llm" },
      include: { payload: true },
    });
    const prompt = JSON.parse(event.payload?.promptJson ?? "[]") as Array<{
      role: string;
    }>;
    const output = JSON.parse(event.payload?.outputJson ?? "{}") as {
      rawResponse: string;
      parsedResponse: { coachReply: string };
      visibleResponse: { coachReply: string };
    };

    expect(prompt.map((message) => message.role)).toEqual(["system", "user"]);
    expect(output.rawResponse).toBe(content);
    expect(output.parsedResponse.coachReply).toContain("guaranteed accepted");
    expect(output.visibleResponse.coachReply).not.toContain("guaranteed");
    const guardEvent = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: {
        traceRunId: result.trace!.traceRunId,
        kind: "guard",
        title: "Review output guard & visible reply",
      },
      include: { payload: true },
    });
    const guardOutput = JSON.parse(
      guardEvent.payload?.outputJson ?? "{}",
    ) as { visibleAfterGuard?: { coachReply?: string } };
    expect(guardOutput.visibleAfterGuard?.coachReply).toBe(result.coachReply);
    expect(result.coachReply).not.toContain("guaranteed");
  });

  it("records runner service failure honestly and persists the degraded Review without an LLM call", async () => {
    const fixture = await createFixture();
    const { provider, create } = qwenProvider(
      reviewContent({
        runStatus: "runner_error",
        reply: "This response must not be requested.",
        facts: [],
        mistakeTags: [],
      }),
    );

    const result = await reviewPipeline(
      reviewInput(fixture, "review-trace-runner-failure"),
      {
        prisma: fixture.prisma,
        coachProvider: provider,
        codeRunnerProvider: createMockCodeRunnerProvider({
          outcome: {
            kind: "runner_error",
            stderr: "sandbox service unavailable",
          },
        }),
        backgroundJobsPolicy: "disabled",
      },
    );
    const events = await fixture.prisma.agentTraceEvent.findMany({
      where: { traceRunId: result.trace!.traceRunId },
      include: { payload: true },
      orderBy: { seq: "asc" },
    });
    const runner = events.find((event) => event.kind === "runner")!;
    const runnerOutput = JSON.parse(runner.payload?.outputJson ?? "{}") as {
      normalizedEvidence?: { status?: string; stderr?: string };
    };
    const memoryResult = events.find(
      (event) => event.kind === "memory" && event.title === "L2 arbitration result",
    )!;
    const memoryMetadata = JSON.parse(memoryResult.metadataJson ?? "{}") as {
      reason?: string;
      operation?: string;
    };
    const run = await fixture.prisma.agentTraceRun.findUniqueOrThrow({
      where: { id: result.trace!.traceRunId },
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.runResult.status).toBe("runner_error");
    expect(result.coachReply).toContain("execution service was unavailable");
    expect(runner.status).toBe("failed");
    expect(runnerOutput.normalizedEvidence).toMatchObject({
      status: "runner_error",
      stderr: "sandbox service unavailable",
    });
    expect(memoryMetadata.reason).toBe("memory_skipped");
    expect(memoryMetadata.operation).toBe("arbitration_result");
    expect(events.some((event) => event.kind === "persistence" && event.status === "succeeded")).toBe(true);
    expect(run).toMatchObject({
      status: "degraded",
      traceCompleteness: "complete",
      llmCallCount: 0,
    });
  });

  it("traces Review candidates as delegated to the queued activity extraction path", async () => {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
    const fixture = await createFixture();
    const content = reviewContent({
      runStatus: "failed",
      reply:
        "The first visible case diverges at the returned index. Keep the approach and change only the boundary return, then rerun.",
      facts: [
        {
          factType: "mistake",
          tag: "binary_search_invariant",
          label:
            "Moves the binary-search boundary past the first valid insertion position.",
          confidence: 0.7,
          evidenceSummary: "The visible failed case returned the right-side index.",
        },
      ],
      mistakeTags: ["binary_search_boundary_mistake"],
    });
    const { provider } = qwenProvider(content);

    const result = await reviewPipeline(
      reviewInput(fixture, "review-trace-arbitration"),
      {
        prisma: fixture.prisma,
        coachProvider: provider,
        codeRunnerProvider: createLocalVisibleCodeRunnerFixtureProvider({
          outcome: { kind: "failed", actual: 2, expected: 1 },
        }),
        backgroundJobsPolicy: "disabled",
      },
    );
    const events = await fixture.prisma.agentTraceEvent.findMany({
      where: { traceRunId: result.trace!.traceRunId },
      orderBy: { seq: "asc" },
    });
    const requestIndex = events.findIndex(
      (event) => event.title === "L2 fact candidate arbitration",
    );
    const resultIndex = events.findIndex(
      (event) => event.title === "L2 arbitration result",
    );
    const resultMetadata = JSON.parse(
      events[resultIndex]?.metadataJson ?? "{}",
    ) as {
      operation?: string;
      opcode?: string;
      acceptedCount?: number;
      reason?: string;
    };
    const fact = await fixture.prisma.l2MemoryFact.findUnique({
      where: {
        userId_factType_tag_memoryOrigin: {
          userId: fixture.userId,
          factType: "mistake",
          tag: "binary_search_invariant",
          memoryOrigin: "learner",
        },
      },
    });
    const factRejections = await fixture.prisma.l1MemoryEvent.findMany({
      where: { eventType: "fact_rejected" },
      select: { content: true, eventJson: true },
    });

    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(requestIndex);
    expect(resultMetadata, JSON.stringify(factRejections)).toMatchObject({
      operation: "arbitration_result",
      opcode: "reinforce",
      acceptedCount: 0,
      reason: "delegated_to_activity_extraction",
    });
    expect(events.some((event) => event.kind === "persistence" && event.status === "succeeded")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.title === "Background intent · activity_extraction" &&
          event.status === "succeeded",
      ),
    ).toBe(true);
    expect(fact, JSON.stringify(factRejections)).toBeNull();
    await expect(
      fixture.prisma.memoryActivityCluster.count({
        where: { rootReviewAttemptId: result.reviewAttemptId },
      }),
    ).resolves.toBe(1);
    await expect(fixture.prisma.memoryExtractionReceipt.count()).resolves.toBe(
      1,
    );
  });
});

async function createFixture() {
  process.env.TRACE_CAPTURE_LEVEL = "full";
  database = await createMemoryTestDb();
  await seedDatabase(database.prisma);
  const user = await database.prisma.user.findUniqueOrThrow({
    where: { handle: "try" },
  });
  const problem = await database.prisma.problem.findUniqueOrThrow({
    where: { slug: "search-insert-position" },
  });
  const testCase = await database.prisma.problemTestCase.findFirstOrThrow({
    where: { problemId: problem.id, isVisible: true },
  });
  return {
    prisma: database.prisma,
    userId: user.id,
    problem,
    testCase,
    code: [
      "class Solution:",
      "    def searchInsert(self, nums, target):",
      "        return 2",
    ].join("\n"),
  };
}

function reviewInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  browserInstanceId: string,
) {
  return {
    problemId: fixture.problem.id,
    language: "Python",
    code: fixture.code,
    selectedTestCaseIds: [fixture.testCase.id],
    responseLanguage: "en",
    browserInstanceId,
    clientOccurredAt: "2026-07-12T18:00:00.000Z",
  };
}

function qwenProvider(content: string) {
  const create = vi.fn().mockResolvedValue({
    model: "deepseek-chat",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });
  const client = {
    chat: { completions: { create } },
  } as unknown as OpenAI;
  return {
    create,
    provider: createQwenCoachProvider({
      reviewClient: client,
      chatClient: client,
      reviewModel: "deepseek-chat",
    }),
  };
}

function reviewContent(args: {
  runStatus: string;
  reply: string;
  facts: unknown[];
  mistakeTags: string[];
}) {
  return [
    args.reply,
    DIAGNOSIS_SENTINEL,
    JSON.stringify({
      problemSlug: "search-insert-position",
      runStatus: args.runStatus,
      userIssueSummary: "The current visible execution evidence was reviewed.",
      coachSummary: "Use the current evidence and make one bounded next change.",
      mistakeTags: args.mistakeTags,
      skillTags: ["binary-search", "array"],
      selfCheck: null,
      memoryUpdateCandidate: {
        facts: args.facts,
        summary: "Review fact candidates generated from current evidence.",
      },
    }),
  ].join("\n");
}

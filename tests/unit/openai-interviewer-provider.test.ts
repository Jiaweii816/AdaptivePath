import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { createOpenAiInterviewerProvider } from "@/server/agents/interviewer-agent/openai-interviewer-provider";
import { INTERVIEW_TURN_JSON_SENTINEL } from "@/server/agents/interviewer-agent/interview-output-protocol";
import type { InterviewerStartInput } from "@/server/agents/interviewer-agent/interviewer-agent.types";
import { createTraceContext } from "@/server/llm/trace-context";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
} from "./memory-test-helpers";

const baseInput: Omit<InterviewerStartInput, "traceContext"> = {
  sessionId: "pending",
  problem: {
    id: "problem-1",
    slug: "two-sum",
    title: "Two Sum",
    leetcodeNumber: 1,
    difficulty: "Easy",
    tags: ["array", "hash_table"],
  },
  dossier: {
    displayName: "Iris",
    focusTags: ["hash_table"],
    strongSignals: [],
    weakSignals: [],
    recentMistakes: [],
    solvedTags: [],
    languagePreference: "zh",
  },
  durationMinutes: 25,
  maxQuestions: 10,
  language: "Python",
  latestCode: "class Solution: pass",
  responseLanguage: "zh",
};

describe("openai interviewer provider trace", () => {
  it("records mock interview llm_call trace with provider usage", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: [
                "先说你会验证哪个边界。",
                INTERVIEW_TURN_JSON_SENTINEL,
                JSON.stringify({
                  proposedPhase: "intro",
                  questionAsked: false,
                }),
              ].join("\n"),
            },
          },
        ],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 20,
          total_tokens: 100,
        },
      });
      const provider = createOpenAiInterviewerProvider({
        client: { chat: { completions: { create } } } as unknown as OpenAI,
        model: "deepseek-chat",
      });
      const traceContext = createTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "mock_interview",
        task: "mock_interview.start",
        problemId: problem.id,
        captureLevel: "full",
      });

      await provider.start({
        ...baseInput,
        problem: { ...baseInput.problem, id: problem.id },
        traceContext,
      });

      const event = await db.prisma.agentTraceEvent.findFirstOrThrow({
        where: { kind: "llm" },
        include: { payload: true },
      });
      const metadata = JSON.parse(event.payload?.detailMetadataJson ?? "{}");

      expect(event).toMatchObject({
        traceRunId: traceContext.traceRunId,
        path: "mock_interview",
        status: "succeeded",
        model: "deepseek-chat",
        responseModel: "deepseek-chat",
        usageSource: "provider",
        providerInputTokens: 80,
        providerOutputTokens: 20,
        providerTotalTokens: 100,
      });
      expect(metadata).toMatchObject({ task: "mock_interview.start", finishReason: "stop" });
      expect(event.durationMs).toEqual(expect.any(Number));
      await expect(db.prisma.l1MemoryEvent.count()).resolves.toBe(0);
    } finally {
      await db.cleanup();
    }
  });

  it("records provider errors and rethrows", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
      const providerError = Object.assign(new Error("interviewer unavailable"), {
        status: 503,
        code: "service_unavailable",
        type: "api_error",
        request_id: "req-interviewer-trace",
      });
      const provider = createOpenAiInterviewerProvider({
        client: {
          chat: { completions: { create: vi.fn().mockRejectedValue(providerError) } },
        } as unknown as OpenAI,
        model: "deepseek-chat",
      });
      const traceContext = createTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "mock_interview",
        task: "mock_interview.start",
        problemId: problem.id,
        captureLevel: "full",
      });

      await expect(
        provider.start({
          ...baseInput,
          problem: { ...baseInput.problem, id: problem.id },
          traceContext,
        }),
      ).rejects.toThrow("interviewer unavailable");

      const event = await db.prisma.agentTraceEvent.findFirstOrThrow({
        where: { kind: "llm" },
        include: { payload: true },
      });
      const metadata = JSON.parse(event.payload?.detailMetadataJson ?? "{}");
      const output = JSON.parse(event.payload?.outputJson ?? "{}");

      expect(event).toMatchObject({
        path: "mock_interview",
        status: "failed",
        usageSource: "missing",
        usageMissingReason: "error_response",
      });
      expect(metadata).toMatchObject({ task: "mock_interview.start" });
      expect(output).toMatchObject({
        error: {
          type: "api_error",
          code: "service_unavailable",
          message: "interviewer unavailable",
          status: 503,
        },
      });
    } finally {
      await db.cleanup();
    }
  });
});

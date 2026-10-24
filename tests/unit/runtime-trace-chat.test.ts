import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedDatabase } from "../../prisma/seed";
import { chatReply } from "@/server/agents/coach-agent/chat-reply";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { applyPrismaMigrations } from "./prisma-test-utils";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const cleanupTasks: Array<() => Promise<void>> = [];
const originalCaptureLevel = process.env.TRACE_CAPTURE_LEVEL;

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalCaptureLevel === undefined) {
    delete process.env.TRACE_CAPTURE_LEVEL;
  } else {
    process.env.TRACE_CAPTURE_LEVEL = originalCaptureLevel;
  }
  for (const cleanup of cleanupTasks.splice(0)) {
    await cleanup();
  }
});

describe("Chat foreground runtime trace", () => {
  it("keeps Chat successful and degrades the Run when trace reference storage fails", async () => {
    process.env.TRACE_CAPTURE_LEVEL = "full";
    const prisma = await createSeededClient();
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "two-sum" },
    });
    const traceFailure = new Error("synthetic trace reference failure");
    vi.spyOn(prisma.agentTraceRun, "updateMany").mockRejectedValueOnce(
      traceFailure,
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = {
      review: vi.fn(),
      chat: vi.fn(async () => ({
        type: "final" as const,
        coachReply: "Keep the complement as the lookup key, then rerun one visible example.",
      })),
    };

    const result = await chatReply(
      {
        problemId: problem.id,
        message: "Why store the complement?",
        language: "Python",
        code: "class Solution:\n    pass",
        responseLanguage: "en",
        browserInstanceId: "runtime-trace-chat-failure-tab",
        clientOccurredAt: "2026-07-12T19:02:00.000Z",
      },
      {
        prisma,
        coachProvider: provider,
        backgroundJobsPolicy: "disabled",
        traceStoreCutoverEnabled: true,
      },
    );
    const run = await prisma.agentTraceRun.findUniqueOrThrow({
      where: { id: result.trace?.traceRunId },
    });

    expect(result.ok).toBe(true);
    expect(result.coachReply).toContain("complement");
    expect(run).toMatchObject({
      status: "degraded",
      traceCompleteness: "degraded",
    });
  });

  it("links multiple tools from one model response to one agent iteration and preserves missing usage", async () => {
    process.env.TRACE_CAPTURE_LEVEL = "full";
    const prisma = await createSeededClient();
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "longest-substring-without-repeating-characters" },
    });
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "I will check both controlled sources.",
              tool_calls: [
                {
                  id: "call-history",
                  type: "function",
                  function: {
                    name: "past_mistake_recall",
                    arguments: JSON.stringify({
                      query: "recurring mistakes relevant to the current problem",
                    }),
                  },
                },
                {
                  id: "call-api",
                  type: "function",
                  function: {
                    name: "lookup_api_reference",
                    arguments: JSON.stringify({
                      language: "Python",
                      topic: "collections",
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      })
      .mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                "Your history and the local API reference are now separated; use the collections example as the next step.",
            },
          },
        ],
      });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      chatClient: fakeClient,
      reviewClient: fakeClient,
      chatModel: "deepseek-chat",
    });

    const result = await chatReply(
      {
        problemId: problem.id,
        message:
          "Check whether this resembles one of my past mistakes, and remind me of Python collections syntax.",
        language: "Python",
        code: "class Solution:\n    pass",
        responseLanguage: "en",
        browserInstanceId: "runtime-trace-chat-tab",
        clientOccurredAt: "2026-07-12T19:00:00.000Z",
      },
      {
        prisma,
        coachProvider: provider,
        backgroundJobsPolicy: "disabled",
        traceStoreCutoverEnabled: true,
      },
    );

    const llmEvents = await prisma.agentTraceEvent.findMany({
      where: { traceRunId: result.trace?.traceRunId, kind: "llm" },
      include: { payload: true },
      orderBy: { stepIndex: "asc" },
    });
    const toolEvents = await prisma.agentTraceEvent.findMany({
      where: { traceRunId: result.trace?.traceRunId, kind: "tool" },
      orderBy: [{ stepIndex: "asc" }, { seq: "asc" }],
    });
    const firstLlmStepId = llmEvents[0]?.stepId;

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.toolIterations).toBe(1);
    expect(result.toolTrace).toHaveLength(2);
    expect(llmEvents.map((event) => event.agentIteration)).toEqual([1, 2]);
    expect(llmEvents[0]).toMatchObject({
      providerInputTokens: 100,
      providerOutputTokens: 20,
      providerTotalTokens: 120,
      usageSource: "provider",
    });
    expect(llmEvents[1]).toMatchObject({
      providerInputTokens: null,
      providerOutputTokens: null,
      providerTotalTokens: null,
      usageSource: "missing",
      usageMissingReason: "provider_omitted",
    });
    const firstPrompt = JSON.parse(llmEvents[0]?.payload?.promptJson ?? "[]") as
      Array<{ role?: string }>;
    const firstInput = JSON.parse(llmEvents[0]?.payload?.inputJson ?? "{}") as {
      policy?: { intent?: string; mustDo?: unknown[]; avoid?: unknown[] };
      toolMode?: string;
      availableTools?: string[];
      requiredActions?: unknown[];
    };
    const firstOutput = JSON.parse(llmEvents[0]?.payload?.outputJson ?? "{}") as {
      rawResponse?: unknown;
      parsedResponse?: { type?: string; toolCalls?: unknown[] };
      visibleResponse?: unknown;
    };
    expect(firstPrompt.map((message) => message.role)).toEqual(
      expect.arrayContaining(["system", "user"]),
    );
    expect(firstInput).toMatchObject({
      policy: {
        intent: expect.any(String),
        mustDo: expect.any(Array),
        avoid: expect.any(Array),
      },
      toolMode: "tool_loop",
      availableTools: expect.arrayContaining([
        "past_mistake_recall",
        "lookup_api_reference",
      ]),
      requiredActions: expect.any(Array),
    });
    expect(firstOutput.rawResponse).toBeTruthy();
    expect(firstOutput.parsedResponse).toMatchObject({
      type: "tool_calls",
      toolCalls: expect.any(Array),
    });
    expect(firstOutput.visibleResponse).toBeUndefined();
    expect(JSON.stringify(firstOutput)).not.toContain("reasoning_content");
    expect(toolEvents).toHaveLength(4);
    expect(new Set(toolEvents.map((event) => event.agentIteration))).toEqual(
      new Set([1]),
    );
    expect(
      new Set(toolEvents.map((event) => event.parentStepId)),
    ).toEqual(new Set([firstLlmStepId]));

    const eventsByToolCall = new Map<string, typeof toolEvents>();
    for (const event of toolEvents) {
      const metadata = JSON.parse(event.metadataJson ?? "{}") as {
        toolCallId?: string;
      };
      const events = eventsByToolCall.get(metadata.toolCallId ?? "") ?? [];
      events.push(event);
      eventsByToolCall.set(metadata.toolCallId ?? "", events);
    }
    expect([...eventsByToolCall.values()]).toHaveLength(2);
    for (const pair of eventsByToolCall.values()) {
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((event) => event.stepId)).size).toBe(1);
    }
  });

  it("records user input, policy, retrieval, guard-visible output, and persistence stages", async () => {
    process.env.TRACE_CAPTURE_LEVEL = "full";
    const prisma = await createSeededClient();
    const problem = await prisma.problem.findUniqueOrThrow({
      where: { slug: "two-sum" },
    });
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-chat",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              "PatternCoach can only report the evidence available here; rerun one visible example next.",
          },
        },
      ],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 15,
        total_tokens: 45,
      },
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      chatClient: fakeClient,
      reviewClient: fakeClient,
      chatModel: "deepseek-chat",
    });

    const result = await chatReply(
      {
        problemId: problem.id,
        message: "Why should I keep the complement in the dict?",
        language: "Python",
        code: "class Solution:\n    pass",
        responseLanguage: "en",
        browserInstanceId: "runtime-trace-chat-stage-tab",
        clientOccurredAt: "2026-07-12T19:05:00.000Z",
      },
      {
        prisma,
        coachProvider: provider,
        backgroundJobsPolicy: "disabled",
        traceStoreCutoverEnabled: true,
      },
    );

    const events = await prisma.agentTraceEvent.findMany({
      where: { traceRunId: result.trace?.traceRunId },
      include: { payload: true },
      orderBy: { seq: "asc" },
    });
    const stages = new Set(events.map((event) => event.stage));
    const visibleGuard = events.find(
      (event) =>
        event.kind === "guard" && event.title === "Guard and visible Coach reply",
    );
    const guardInput = JSON.parse(visibleGuard?.payload?.inputJson ?? "{}") as {
      rawLlmReply?: string;
    };
    const guardOutput = JSON.parse(visibleGuard?.payload?.outputJson ?? "{}") as {
      visibleReply?: string;
    };

    expect(stages.has("input_workspace_context")).toBe(true);
    expect(stages.has("intent_policy")).toBe(true);
    expect(stages.has("context_memory")).toBe(true);
    expect(stages.has("guard_visible_reply")).toBe(true);
    expect(stages.has("persistence")).toBe(true);
    expect(events.filter((event) => event.kind === "persistence")).toHaveLength(
      2,
    );
    expect(guardInput.rawLlmReply).toBeTruthy();
    expect(guardOutput.visibleReply).toBe(result.coachReply);
  });
});

async function createSeededClient() {
  const dir = mkdtempSync(join(tmpdir(), "patterncoach-runtime-chat-"));
  const databasePath = join(dir, "runtime-chat.db");
  const db = new Database(databasePath);
  applyPrismaMigrations(db);
  db.close();
  const adapter = new PrismaBetterSqlite3({ url: databasePath });
  const prisma = new PrismaClient({ adapter });
  await seedDatabase(prisma);
  cleanupTasks.push(async () => {
    await prisma.$disconnect();
    rmSync(dir, { force: true, recursive: true });
  });
  return prisma;
}

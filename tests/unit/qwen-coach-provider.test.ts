import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { createQwenCoachProvider } from "@/server/agents/coach-agent/qwen-coach-provider";
import { DIAGNOSIS_SENTINEL } from "@/server/agents/coach-agent/review-output-protocol";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import {
  createTestForegroundTraceContext,
  createMemoryTestDb,
  seedMinimalUserAndProblem,
} from "./memory-test-helpers";
import type {
  CoachChatInput,
  CoachReviewInput,
  InternalRunEvidenceEnvelope,
} from "@/server/agents/coach-agent/coach-agent.types";
import { buildCurrentWorkspaceContext } from "@/server/agents/coach-agent/current-workspace-context";
import { hashCodeForRun } from "@/server/code/code-hash";
import { chatToolManifest } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { EvidenceVerdict } from "@/types/evidence";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

const qwenFixture = {
  diagnosis: {
    problemSlug: "search-insert-position",
    runStatus: "failed",
    userIssueSummary: "Insert-in-middle returned index 2 instead of 1.",
    coachSummary: "Use the first >= target boundary and return left.",
    mistakeTags: ["binary_search_boundary_mistake"],
    skillTags: ["binary-search", "array"],
    selfCheck: {
      question: "Search Insert 中 target 落在两个数之间时，最后返回哪个边界？",
      answer:
        "把它看成找第一个 >= target；右边界收缩到 mid，循环结束返回 left。",
    },
    memoryUpdateCandidate: {
      facts: [
        {
          factType: "mistake",
          tag: "binary_search_boundary_mistake",
          label: "Binary search boundary mistake",
          confidence: 0.7,
          evidenceSummary:
            "Visible failed case target=2 returned too far right.",
        },
      ],
      summary: "Boundary weakness surfaced on Search Insert.",
    },
  },
  coachReply: [
    "根因:你的返回边界偏右,把 target=2 的插入点推到了下标 2。",
    "走一遍 nums=[1,3,5,6],target=2:答案应在 1 和 3 中间,也就是下标 1;当前代码返回 2,说明循环结束时拿了右侧位置。",
    "最小改法:把它当成找第一个 `>= target` 的位置,右边界收缩到 `mid`,循环结束 `return left`,只改这一处后重跑同一组可见测试。",
  ].join("\n"),
};

const reviewInput: CoachReviewInput = {
  problem: {
    slug: "search-insert-position",
    title: "Search Insert Position",
    leetcodeNumber: 35,
    tags: ["array", "binary-search"],
    methodName: "searchInsert",
  },
  user: {
    displayName: "try",
    strongPatterns: ["HashMap"],
    weakPatterns: ["Binary Search boundaries"],
    outputPreferences: ["Short, step-by-step answer"],
  },
  memory: coachMemoryBrief({
    teachableMemories: [
      teachableMemory({
        kind: "recurring_mistake",
        cue: "Binary search boundary updates have discarded a possible answer before.",
        sourceLabel: "Prior Search Insert reviews",
      }),
    ],
    outputPreferences: ["Concrete example first"],
  }),
  language: "Python",
  code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 2",
  runResult: {
    status: "failed",
    passedCount: 0,
    failedCount: 1,
    stdout: "",
    stderr: "",
    actualOutput: "2",
    expectedOutput: "1",
    firstFailedCase: {
      id: "case-1",
      label: "insert in middle",
      input: { nums: [1, 3, 5, 6], target: 2 },
      expected: 1,
      actual: 2,
    },
    testResults: [],
  },
  responseLanguage: "zh",
};

const chatInput: CoachChatInput = {
  problem: reviewInput.problem,
  user: reviewInput.user,
  memory: reviewInput.memory,
  messages: [
    {
      role: "user",
      content:
        "Please call the get_algorithm_hint tool for search-insert-position. Do not answer directly before the tool call.",
    },
  ],
  lastRunResult: reviewInput.runResult,
  responseLanguage: "en",
  tools: chatToolManifest,
};

const localOnlyVerdict: EvidenceVerdict = {
  evidenceClass: "local_only",
  replyMode: "local_fallback",
  capabilities: {
    canVerdict: true,
    canWriteMistakeMemory: true,
    canWriteEpisode: true,
    canSignalPlanner: false,
    canUseFailureSalience: true,
  },
  status: "failed",
  scopeLabel: "local visible-test fallback evidence",
  modelInstruction:
    "This is local visible-test fallback evidence only; do not claim official acceptance.",
};

function expectThinkingDisabled(request: Record<string, unknown>) {
  expect(request.thinking).toEqual({ type: "disabled" });
  expect(request).not.toHaveProperty("reasoning_effort");
}

function expectThinkingEnabled(request: Record<string, unknown>) {
  expect(request.thinking).toEqual({ type: "enabled" });
  expect(request.reasoning_effort).toMatch(/^(high|max)$/);
}

describe("Qwen coach provider", () => {
  it("returns a clean failed review from one thinking-model call", async () => {
    const content = [
      qwenFixture.coachReply,
      DIAGNOSIS_SENTINEL,
      JSON.stringify(qwenFixture.diagnosis),
    ].join("\n");
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      reviewModel: "deepseek-v4-flash",
      reviewThinkingModel: "deepseek-v4-pro",
    });
    const result = await provider.review(reviewInput);
    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(create).toHaveBeenCalledTimes(1);
    expect(request.model).toBe("deepseek-v4-pro");
    expectThinkingEnabled(request);
    expect(request).not.toHaveProperty("temperature");
    expect(result.coachReply).toContain("根因");
    expect(result.coachReply).toContain("return left");
    expect(result.diagnosis.memoryUpdateCandidate.facts[0]?.tag).toBe(
      "binary_search_boundary_mistake",
    );
    expect(result.diagnosis.selfCheck?.answer).toContain("返回 left");
    expect(result.degraded).toBeUndefined();
  });

  it("keeps verdict-bearing passed Review on the standard review model", async () => {
    const diagnosis = {
      ...qwenFixture.diagnosis,
      runStatus: "passed_visible_tests",
      mistakeTags: [],
      selfCheck: null,
      memoryUpdateCandidate: { facts: [], summary: "Passed visible tests." },
    };
    const content = [
      "你这版通过了当前可见测试；先记录一下边界判断，再进入下一题。",
      DIAGNOSIS_SENTINEL,
      JSON.stringify(diagnosis),
    ].join("\n");
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      reviewModel: "deepseek-v4-flash",
      reviewThinkingModel: "deepseek-v4-pro",
    });

    await provider.review({
      ...reviewInput,
      runResult: {
        status: "passed_visible_tests",
        passedCount: 1,
        failedCount: 0,
        stdout: "",
        stderr: "",
        testResults: [],
      },
    });
    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(create).toHaveBeenCalledTimes(1);
    expect(request.model).toBe("deepseek-v4-flash");
    expectThinkingDisabled(request);
    expect(request.temperature).toBe(0.2);
  });

  it("degrades to a fallback diagnosis when the JSON tail is corrupt", async () => {
    const content = [
      qwenFixture.coachReply,
      DIAGNOSIS_SENTINEL,
      "{ broken json",
    ].join("\n");
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
    });
    const result = await provider.review(reviewInput);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.coachReply).toContain("最小改法");
    expect(result.degraded?.tier).toBe(1);
    expect(result.degraded?.memorySkipped).toBe(true);
  });

  it("replaces a forbidden-copy reply with safety copy and flags it", async () => {
    const content = [
      qwenFixture.coachReply,
      "guaranteed accepted.",
      DIAGNOSIS_SENTINEL,
      JSON.stringify(qwenFixture.diagnosis),
    ].join("\n");
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
    });
    const result = await provider.review(reviewInput);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.degraded?.safetyReplaced).toBe(true);
    expect(result.coachReply).not.toContain("guaranteed");
  });

  it("throws when the LLM returns an empty response", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
    });

    await expect(provider.review(reviewInput)).rejects.toThrow(
      /empty response/i,
    );
  });

  it("records review LLM trace with provider usage when TraceContext is supplied", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const content = [
        qwenFixture.coachReply,
        DIAGNOSIS_SENTINEL,
        JSON.stringify(qwenFixture.diagnosis),
      ].join("\n");
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [{ finish_reason: "stop", message: { content } }],
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168,
        },
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "review",
        task: "review.diagnose_and_reply",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
        reviewModel: "deepseek-chat",
        reviewThinkingModel: "deepseek-reasoner",
      });

      await provider.review({
        ...reviewInput,
        traceContext,
      });
      await traceContext.recorder?.flush();

      const event = (
        await loadFormalTraceProjection(db.prisma, {
          eventTypes: ["llm_call"],
          take: 1,
        })
      )[0]!;
      const eventJson = JSON.parse(event.eventJson);

      expect(eventJson.traceRunId).toBe(traceContext.traceRunId);
      expect(eventJson.status).toBe("ok");
      expect(eventJson.model).toBe("deepseek-reasoner");
      expect(eventJson.pricingMode).toBe("thinking");
      expect(eventJson.thinking).toBe(true);
      expect(eventJson.reviewThinking).toBe(true);
      expect(eventJson.staticExaminer).toBeUndefined();
      expect(eventJson.localEvidenceExaminer).toBe(false);
      expect(eventJson.usage).toEqual({
        inputTokens: 123,
        outputTokens: 45,
        totalTokens: 168,
      });
      expect(eventJson.usageSource).toBe("provider");
      expect(eventJson.usageMissingReason).toBeNull();
      expect(eventJson["gen_ai.usage.input_tokens"]).toBe(123);
      expect(eventJson.finishReason).toBe("stop");
      expect(eventJson.spanKind).toBe("llm");
      expect(eventJson.memoryPromptReceipt).toMatchObject({
        cueCount: 1,
        cueHashes: [expect.stringMatching(/^[a-f0-9]{64}$/)],
        briefHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(traceContext.llmMsTotal).toBeGreaterThanOrEqual(0);
      const storedEvent = await db.prisma.agentTraceEvent.findFirstOrThrow({
        where: { traceRunId: traceContext.traceRunId, kind: "llm" },
        include: { payload: true },
      });
      const prompt = JSON.parse(
        storedEvent.payload?.promptJson ?? "[]",
      ) as Array<{
        role: string;
      }>;
      const output = JSON.parse(storedEvent.payload?.outputJson ?? "{}") as {
        rawResponse?: unknown;
        parsedResponse?: { coachReply?: string };
        visibleResponse?: { coachReply?: string };
      };
      expect(prompt.map((message) => message.role)).toEqual(["system", "user"]);
      expect(JSON.stringify(prompt)).toContain(
        "Binary search boundary updates have discarded a possible answer before.",
      );
      expect(output.rawResponse).toBe(content);
      expect(output.parsedResponse?.coachReply).toBe(qwenFixture.coachReply);
      expect(output.visibleResponse?.coachReply).toBe(qwenFixture.coachReply);
      expect(output.rawResponse).not.toEqual(output.parsedResponse);
      expect(output.parsedResponse).not.toBe(output.visibleResponse);
    } finally {
      await db.cleanup();
    }
  });

  it("uses the thinking model and gives aligned local run evidence to Local-Evidence Examiner Review", async () => {
    const content = [
      [
        qwenFixture.coachReply,
        "这个结论只针对所选本地可见测试，不是 LeetCode 官方判定。",
      ].join("\n"),
      DIAGNOSIS_SENTINEL,
      JSON.stringify(qwenFixture.diagnosis),
    ].join("\n");
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-reasoner",
      choices: [{ finish_reason: "stop", message: { content } }],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      reviewModel: "deepseek-v4-flash",
      reviewThinkingModel: "deepseek-v4-pro",
    });

    const result = await provider.review({
      ...reviewInput,
      evidenceVerdict: localOnlyVerdict,
      problem: {
        ...reviewInput.problem,
        statementMarkdown: "Given nums and target, return the insert index.",
      },
    });
    const request = create.mock.calls[0]?.[0] as {
      model?: string;
      temperature?: number;
      thinking?: unknown;
      reasoning_effort?: unknown;
      messages?: Array<{ content?: string }>;
    };
    const prompt = request.messages?.[1]?.content ?? "";

    expect(result.coachReply).toContain("只针对所选本地可见测试");
    expect(result.diagnosis.mistakeTags).toContain(
      "binary_search_boundary_mistake",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(request.model).toBe("deepseek-v4-pro");
    expectThinkingEnabled(request as Record<string, unknown>);
    expect(request).not.toHaveProperty("temperature");
    expect(prompt).not.toContain("WITHHELD from CoachAgent");
    expect(prompt).toContain("Problem statement");
    expect(prompt).toContain('"actualOutput": "2"');
    expect(prompt).toContain('"expectedOutput": "1"');
    expect(prompt).toContain("current revision, current problem, and selected visible/custom cases");
  });

  it("uses a deterministic fallback instead of a second local-only Review LLM call", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-reasoner",
      choices: [
        {
          finish_reason: "length",
          message: {
            content: "Actually wait, let me restart this review. ".repeat(80),
          },
        },
      ],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      reviewThinkingModel: "deepseek-reasoner",
    });

    const result = await provider.review({
      ...reviewInput,
      evidenceVerdict: localOnlyVerdict,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.coachReply).not.toContain("Actually wait");
    expect(result.coachReply).toContain("本地可见");
    expect(result.coachReply).toContain("不是官方判定");
    expect(result.degraded?.memorySkipped).toBe(true);
    expect(result.degraded?.reason).toContain("finish_reason_length");
  });

  it("records chat LLM trace with nullable usage when provider omits usage", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Use the existing failed case first." },
          },
        ],
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "chat",
        task: "chat.tool_loop.turn",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
      });

      await provider.chat({
        ...chatInput,
        tools: undefined,
        traceContext,
      });
      await traceContext.recorder?.flush();

      const event = (
        await loadFormalTraceProjection(db.prisma, {
          eventTypes: ["llm_call"],
          take: 1,
        })
      )[0]!;
      const eventJson = JSON.parse(event.eventJson);

      expect(eventJson.status).toBe("ok");
      expect(eventJson.usage).toBeNull();
      expect(eventJson.usageSource).toBe("missing");
      expect(eventJson.usageMissingReason).toBe("provider_omitted");
      expect(eventJson["gen_ai.usage.input_tokens"]).toBeNull();
      expect(eventJson["gen_ai.usage.output_tokens"]).toBeNull();
      expect(eventJson["gen_ai.usage.total_tokens"]).toBeNull();
    } finally {
      await db.cleanup();
    }
  });

  it("returns a safe protocol violation before raw protocol content reaches trace payloads", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const leakedContent = [
        "I will save it.",
        '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="save_knowledge_note">',
      ].join("\n");
      const create = vi.fn().mockResolvedValueOnce({
        id: "chatcmpl-protocol-leak",
        model: "deepseek-v4-flash",
        created: 1_784_000_000,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: leakedContent },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "chat",
        task: "chat.tool_loop.turn",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
      });

      const result = await provider.chat({
        ...chatInput,
        toolMode: "finalize_without_tools",
        tools: undefined,
        traceContext,
      });
      await traceContext.recorder?.flush();

      expect(result.type).toBe("protocol_violation");
      if (result.type === "protocol_violation") {
        expect(result.leak.sentinelIds).toContain("dsml_tool_calls");
        expect(JSON.stringify(result.leak)).not.toContain(
          "save_knowledge_note",
        );
      }

      const event = await db.prisma.agentTraceEvent.findFirstOrThrow({
        where: { traceRunId: traceContext.traceRunId, kind: "llm" },
        include: { payload: true },
      });
      const serializedPayload = JSON.stringify(event.payload);
      const run = await db.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: traceContext.traceRunId },
      });

      expect(event.status).toBe("failed");
      expect(serializedPayload).not.toContain("DSML");
      expect(serializedPayload).not.toContain("save_knowledge_note");
      expect(serializedPayload).toContain("protocolViolation");
      expect(run.status).toBe("degraded");
      expect(run.traceCompleteness).toBe("degraded");
    } finally {
      await db.cleanup();
    }
  });

  it("projects structured tool history before a no-tools finalization request", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-chat",
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Both observations are accounted for." },
        },
      ],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
    });

    await provider.chat({
      ...chatInput,
      toolMode: "finalize_without_tools",
      tools: undefined,
      messages: [
        { role: "user", content: "Save this." },
        {
          role: "assistant",
          toolCalls: [
            {
              id: "call-save",
              name: "save_knowledge_note",
              arguments: { snippet: "do not replay tool arguments" },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-save",
          name: "save_knowledge_note",
          content: JSON.stringify({ saved: true, title: "Toward zero" }),
        },
      ],
    });

    const request = create.mock.calls[0]?.[0] as {
      tools?: unknown;
      tool_choice?: unknown;
      messages: Array<Record<string, unknown>>;
    };
    const serialized = JSON.stringify(request.messages);

    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("tool_choice");
    expect(request.messages.some((message) => message.role === "tool")).toBe(
      false,
    );
    expect(serialized).not.toContain("tool_calls");
    expect(serialized).not.toContain("do not replay tool arguments");
    expect(serialized).toContain("Tool execution observations");
    expect(serialized).toContain('\\\"saved\\\":true');
  });

  it("uses the thinking model without sampling or tools and traces reasoning metadata", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-reasoner",
        choices: [
          {
            finish_reason: "stop",
            message: {
              reasoning_content: "private draft with a wrong turn",
              content: "Clean walkthrough only.",
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 12,
          total_tokens: 32,
          completion_tokens_details: {
            reasoning_tokens: 7,
          },
        },
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "chat",
        task: "chat.deep_reasoning.turn",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
        chatModel: "deepseek-v4-flash",
        chatThinkingModel: "deepseek-v4-pro",
      });

      const result = await provider.chat({
        ...chatInput,
        thinking: true,
        tools: chatToolManifest,
        toolChoice: "get_algorithm_hint",
        traceContext,
      });
      await traceContext.recorder?.flush();
      const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
      const event = (
        await loadFormalTraceProjection(db.prisma, {
          eventTypes: ["llm_call"],
          take: 1,
        })
      )[0]!;
      const eventJson = JSON.parse(event.eventJson);

      expect(result).toEqual({
        type: "final",
        coachReply: "Clean walkthrough only.",
      });
      expect(request.model).toBe("deepseek-v4-pro");
      expectThinkingEnabled(request);
      expect(request).not.toHaveProperty("temperature");
      expect(request).not.toHaveProperty("tools");
      expect(request).not.toHaveProperty("tool_choice");
      expect(eventJson.task).toBe("chat.deep_reasoning.turn");
      expect(eventJson.thinking).toBe(true);
      expect(eventJson.deepReasoning).toBe(true);
      expect(eventJson.selfCorrectionMarkerDetected).toBe(false);
      expect(eventJson.reasoningContentChars).toBe(
        "private draft with a wrong turn".length,
      );
      expect(eventJson.reasoningContentApproxTokens).toBeGreaterThan(0);
      expect(eventJson.reasoningTokens).toBe(7);
      expect(JSON.stringify(eventJson)).not.toContain("private draft");
    } finally {
      await db.cleanup();
    }
  });

  it("keeps the default chat model, sampling, and tools when thinking is not enabled", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-chat",
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Default chat response." },
        },
      ],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      chatModel: "deepseek-v4-flash",
      chatThinkingModel: "deepseek-v4-pro",
    });

    await provider.chat(chatInput);

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(request.model).toBe("deepseek-v4-flash");
    expectThinkingDisabled(request);
    expect(request.temperature).toBe(0.3);
    expect(request.tools).toEqual(chatToolManifest);
    expect(request.tool_choice).toBe("auto");
  });

  it("projects semantic run context into the real provider payload without hashes", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      model: "deepseek-chat",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "I will diagnose from the authoritative timeout.",
          },
        },
      ],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createQwenCoachProvider({
      reviewClient: fakeClient,
      chatClient: fakeClient,
      chatModel: "deepseek-v4-flash",
    });
    const code =
      "class Solution:\n    def searchInsert(self, nums, target):\n        return 0";
    const codeHash = hashCodeForRun({ language: "Python", code });
    const authoritativeRun: InternalRunEvidenceEnvelope = {
      id: "practice-run-1",
      storageSource: "practice_run",
      producer: "user_action",
      subject: "current_user_code",
      authority: "authoritative",
      scope: { kind: "selected_suite", totalCount: 3 },
      oracle: "stored_expected",
      createdAt: "2026-07-10T10:00:00.000Z",
      codeHash,
      result: {
        status: "timeout",
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: 3,
        stdout: "",
        stderr: "Execution timed out",
        testResults: [],
        rawResult: {
          providerUsed: "local_hot150",
          chatRunContext: {
            codeHash,
            executedCodeHash: codeHash,
            currentCodeHash: codeHash,
          },
        },
      },
    };
    const workspaceContext = buildCurrentWorkspaceContext({
      problem: chatInput.problem,
      language: "Python",
      code,
      selectedTests: [],
      latestAuthoritativeRunEvidence: authoritativeRun,
      memory: chatInput.memory,
      user: chatInput.user,
    });

    await provider.chat({
      ...chatInput,
      messages: [{ role: "user", content: "Why does my loop time out?" }],
      lastRunResult: authoritativeRun.result,
      workspaceContext,
      tools: chatToolManifest,
    });

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request.model).toBe("deepseek-v4-flash");
    expectThinkingDisabled(request);
    expect(request.tools).toEqual(chatToolManifest);
    expect(request.tool_choice).toBe("auto");
    expectNoModelHashLeak(request);
  });

  it("marks visible self-correction on thinking LLM traces", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-reasoner",
        choices: [
          {
            finish_reason: "stop",
            message: {
              reasoning_content: "private draft",
              content: "Actually wait, let me restart the walkthrough.",
            },
          },
        ],
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "chat",
        task: "chat.deep_reasoning.turn",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
        chatThinkingModel: "deepseek-reasoner",
      });

      await provider.chat({
        ...chatInput,
        thinking: true,
        traceContext,
      });
      await traceContext.recorder?.flush();

      const event = (
        await loadFormalTraceProjection(db.prisma, {
          eventTypes: ["llm_call"],
          take: 1,
        })
      )[0]!;
      const eventJson = JSON.parse(event.eventJson);

      expect(eventJson.task).toBe("chat.deep_reasoning.turn");
      expect(eventJson.selfCorrectionMarkerDetected).toBe(true);
    } finally {
      await db.cleanup();
    }
  });

  it("records an error LLM trace and rethrows the original provider error", async () => {
    const db = await createMemoryTestDb();

    try {
      const { user, problem, chatSession } = await seedMinimalUserAndProblem(
        db.prisma,
      );
      const providerError = Object.assign(new Error("upstream unavailable"), {
        status: 503,
        code: "service_unavailable",
        type: "api_error",
        request_id: "req-trace-test",
      });
      const create = vi.fn().mockRejectedValueOnce(providerError);
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const traceContext = await createTestForegroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        path: "chat",
        task: "chat.tool_loop.turn",
        problemId: problem.id,
        chatSessionId: chatSession.id,
      });
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
      });

      await expect(
        provider.chat({
          ...chatInput,
          tools: undefined,
          traceContext,
        }),
      ).rejects.toThrow("upstream unavailable");
      await traceContext.recorder?.flush();

      const event = (
        await loadFormalTraceProjection(db.prisma, {
          eventTypes: ["llm_call"],
          take: 1,
        })
      )[0]!;
      const eventJson = JSON.parse(event.eventJson);

      expect(eventJson.status).toBe("error");
      expect(eventJson.usage).toBeNull();
      expect(eventJson.usageSource).toBe("missing");
      expect(eventJson.usageMissingReason).toBe("error_response");
      expect(eventJson.error).toMatchObject({
        type: "api_error",
        code: "service_unavailable",
        message: "upstream unavailable",
        status: 503,
        requestId: "req-trace-test",
      });
    } finally {
      await db.cleanup();
    }
  });

  it("returns malformed tool arguments to the caller instead of throwing before tool tracing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const create = vi.fn().mockResolvedValueOnce({
        model: "deepseek-chat",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  id: "call-bad-json",
                  type: "function",
                  function: {
                    name: "get_algorithm_hint",
                    arguments: "{ broken json",
                  },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });
      const fakeClient = {
        chat: { completions: { create } },
      } as unknown as OpenAI;
      const provider = createQwenCoachProvider({
        reviewClient: fakeClient,
        chatClient: fakeClient,
      });

      const result = await provider.chat(chatInput);

      expect(result.type).toBe("tool_calls");
      expect(
        result.type === "tool_calls" ? result.toolCalls[0]?.arguments : null,
      ).toBe("{ broken json");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("invalid JSON arguments"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it.skipIf(!process.env.RUN_REAL_QWEN_TESTS)(
    "runs one real Qwen review when explicitly configured",
    async () => {
      const provider = createQwenCoachProvider();
      const result = await provider.review(reviewInput);

      expect(result.diagnosis.problemSlug).toBe("search-insert-position");
      expect(result.coachReply.length).toBeGreaterThan(20);
    },
    30_000,
  );

  it.skipIf(!process.env.RUN_REAL_QWEN_TESTS)(
    "surfaces a real chat tool call when tools are provided",
    async () => {
      const provider = createQwenCoachProvider();
      const result = await provider.chat(chatInput);

      expect(result.type).toBe("tool_calls");
      expect(
        result.type === "tool_calls" ? result.toolCalls[0]?.name : null,
      ).toBe("get_algorithm_hint");
    },
    30_000,
  );
});

function expectNoModelHashLeak(value: unknown) {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain("sha256:");
  expect(serialized).not.toContain("codeHash");
  expect(serialized).not.toContain("executedCodeHash");
  expect(serialized).not.toContain("currentCodeHash");
  expect(serialized).not.toContain("latestRunCodeHash");
  expect(serialized).not.toContain("isLatestRunForCurrentCode");
}

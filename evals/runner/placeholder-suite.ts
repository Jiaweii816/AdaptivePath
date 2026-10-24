import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AgentObservabilityReport } from "@/server/observability/agent-observability";
import { captureNormalizedTraceEvent } from "@/server/observability/runtime-trace-capture";
import { flushTraceEvents } from "@/server/observability/trace-store";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";

export type PlaceholderSeedOptions = {
  includeMalformedTrace?: boolean;
};

export type PlaceholderCaseResult = {
  name: string;
  status: "pass" | "fail";
  message: string;
};

export type PlaceholderScore = {
  suiteName: "placeholder";
  caseCount: number;
  passCount: number;
  failCount: number;
  cases: PlaceholderCaseResult[];
};

type SeededPlaceholder = {
  userId: string;
  problemId: string;
  chatSessionId: string;
  reviewTraceRunId: string;
  chatTraceRunId: string;
};

export async function seedPlaceholderSuite(
  prisma: PrismaClient,
  options: PlaceholderSeedOptions = {},
): Promise<SeededPlaceholder> {
  const user = await prisma.user.create({
    data: {
      handle: `eval-placeholder-${randomUUID()}`,
    },
  });
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      displayName: "Eval Placeholder",
      interviewGoal: "eval-placeholder",
      preferredLanguages: JSON.stringify(["Python"]),
      strongPatterns: JSON.stringify(["HashMap"]),
      weakPatterns: JSON.stringify(["Binary Search"]),
      explanationStyle: JSON.stringify(["short", "evidence_first"]),
      outputPreferences: JSON.stringify(["markdown"]),
    },
  });
  const problem = await prisma.problem.create({
    data: {
      slug: `eval-placeholder-two-sum-${randomUUID()}`,
      title: "Eval Placeholder Two Sum",
      statementMarkdown: "Find two indices whose values sum to the target.",
      methodName: "twoSum",
      tags: JSON.stringify(["array", "hash-table"]),
      inputContractJson: JSON.stringify({
        kind: "object",
        fields: ["nums", "target"],
      }),
      outputContractJson: JSON.stringify({ kind: "array" }),
      comparisonStrategy: "exact",
      comparisonConfigJson: JSON.stringify({}),
      contractKind: "pure_function",
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin: "evaluation",
      title: problem.title,
      primaryLanguage: "en",
      isActive: true,
    },
  });

  const reviewTraceRunId = `placeholder-review-${randomUUID()}`;
  const chatTraceRunId = `placeholder-chat-${randomUUID()}`;
  const now = new Date();
  const event = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  const browserInstanceId = `eval-placeholder-${user.id}`;
  const reviewTurn = await ensureWorkspaceTraceTurn(prisma, {
    userId: user.id,
    problemId: problem.id,
    browserInstanceId,
    action: "review",
    cutoverEnabled: true,
    captureLevel: "full",
    traceRunId: reviewTraceRunId,
    now: event(0),
    snapshot: {
      language: "Python",
      code: "def twoSum(nums, target): ...",
      clientOccurredAt: event(0),
      metadata: { syntheticEvalInvocation: true, suiteName: "placeholder" },
    },
  });
  const chatTurn = await ensureWorkspaceTraceTurn(prisma, {
    userId: user.id,
    problemId: problem.id,
    browserInstanceId,
    action: "chat",
    cutoverEnabled: true,
    captureLevel: "full",
    traceRunId: chatTraceRunId,
    now: event(2),
    snapshot: {
      language: "Python",
      code: "def twoSum(nums, target): ...",
      clientOccurredAt: event(2),
      metadata: { syntheticEvalInvocation: true, suiteName: "placeholder" },
    },
  });
  if (!reviewTurn.enabled || !chatTurn.enabled) {
    throw new Error("Placeholder synthetic Trace Invocation was disabled.");
  }
  await prisma.agentTraceRun.updateMany({
    where: { id: { in: [reviewTraceRunId, chatTraceRunId] } },
    data: { chatSessionId: chatSession.id },
  });
  await flushTraceEvents(prisma, [
    captureNormalizedTraceEvent(
      {
        identity: {
          eventId: `${reviewTraceRunId}:llm`,
          traceRunId: reviewTraceRunId,
          workspaceSessionId: reviewTurn.workspaceSessionId,
          turnOrdinal: reviewTurn.turnOrdinal,
          stepIndex: 1,
          stepId: `${reviewTraceRunId}:1`,
        },
        scope: {
          path: "review",
          stage: "diagnose_and_reply",
          kind: "llm",
          title: "LLM · review.diagnose_and_reply",
        },
        lifecycle: { status: "succeeded", occurredAt: event(0).toISOString(), durationMs: 820 },
        details: {
          metadata: {
            source: "review:review.diagnose_and_reply",
            task: "review.diagnose_and_reply",
            model: "deepseek-chat",
            responseModel: "deepseek-v4-flash",
            finishReason: "stop",
          },
        },
        metrics: {
          providerInputTokens: 1200,
          providerOutputTokens: 180,
          providerTotalTokens: 1380,
          usageSource: "provider",
          pricingStatus: "unpriced",
        },
      },
      { detailLevel: "full" },
    ),
    captureNormalizedTraceEvent(
      {
        identity: {
          eventId: `${chatTraceRunId}:llm`,
          traceRunId: chatTraceRunId,
          workspaceSessionId: chatTurn.workspaceSessionId,
          turnOrdinal: chatTurn.turnOrdinal,
          stepIndex: 1,
          stepId: `${chatTraceRunId}:1`,
        },
        scope: {
          path: "chat",
          stage: "bounded_agent_loop",
          kind: "llm",
          title: "LLM · chat.tool_loop.turn",
        },
        lifecycle: { status: "succeeded", occurredAt: event(2).toISOString(), durationMs: 610 },
        details: {
          metadata: {
            source: "chat:chat.tool_loop.turn",
            task: "chat.tool_loop.turn",
            model: "deepseek-chat",
            responseModel: "deepseek-v4-flash",
            finishReason: "tool_calls",
          },
        },
        metrics: {
          providerInputTokens: 900,
          providerOutputTokens: 120,
          providerTotalTokens: 1020,
          usageSource: "provider",
          pricingStatus: "unpriced",
        },
      },
      { detailLevel: "full" },
    ),
    captureNormalizedTraceEvent(
      {
        identity: {
          eventId: `${chatTraceRunId}:tool-call`,
          traceRunId: chatTraceRunId,
          workspaceSessionId: chatTurn.workspaceSessionId,
          turnOrdinal: chatTurn.turnOrdinal,
          stepIndex: 2,
          stepId: `${chatTraceRunId}:2`,
          parentStepId: `${chatTraceRunId}:1`,
        },
        scope: { path: "chat", stage: "bounded_agent_loop", kind: "tool", title: "Tool call · lookup_api_reference" },
        lifecycle: { status: "started", occurredAt: event(3).toISOString() },
        details: {
          input: { topic: "python dict lookup" },
          metadata: {
            source: "chat_reply",
            eventRole: "call",
            toolCallId: "placeholder-tool-call-1",
            toolName: "lookup_api_reference",
            sequence: 1,
            responseLanguage: "en",
          },
        },
      },
      { detailLevel: "full" },
    ),
    captureNormalizedTraceEvent(
      {
        identity: {
          eventId: `${chatTraceRunId}:tool-result`,
          traceRunId: chatTraceRunId,
          workspaceSessionId: chatTurn.workspaceSessionId,
          turnOrdinal: chatTurn.turnOrdinal,
          stepIndex: 2,
          stepId: `${chatTraceRunId}:2`,
          parentStepId: `${chatTraceRunId}:1`,
        },
        scope: { path: "chat", stage: "bounded_agent_loop", kind: "tool", title: "Tool result · lookup_api_reference" },
        lifecycle: { status: "succeeded", occurredAt: event(4).toISOString(), durationMs: 14 },
        details: {
          output: {
            title: "Python dict lookup",
            summary: "Use `key in dict` or `dict.get(key)` before indexing.",
          },
          metadata: {
            source: "chat_reply",
            eventRole: "result",
            toolCallId: "placeholder-tool-call-1",
            toolName: "lookup_api_reference",
            sequence: 1,
            responseLanguage: "en",
            approxResultTokens: 24,
          },
        },
      },
      { detailLevel: "full" },
    ),
  ]);

  await prisma.l1MemoryEvent.createMany({
    data: [
      {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "coach_reply",
        source: "review_pipeline",
        content: "Placeholder review reply.",
        occurredAt: event(1),
        eventJson: JSON.stringify({
          traceRunId: reviewTraceRunId,
          chatMessageId: "placeholder-review-message",
          problemHistoryId: "placeholder-history",
          runStatus: "failed",
          evidenceVerdict: {
            trustLevel: "visible_tests",
            capabilities: {},
          },
          degraded: null,
          timings: {
            totalMs: 1230,
            runnerMs: 260,
            llmMsTotal: 820,
          },
        }),
      },
      {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        source: "chat_reply",
        content: "Placeholder chat reply.",
        occurredAt: event(5),
        eventJson: JSON.stringify({
          traceRunId: chatTraceRunId,
          chatMessageId: "placeholder-chat-message",
          sequence: 2,
          responseLanguage: "en",
          intent: "api_reference_question",
          toolCallCount: 1,
          toolIterations: 1,
          toolBudgetReached: false,
          workspace: {},
          timings: {
            totalMs: 760,
            llmMsTotal: 610,
            toolMsTotal: 14,
          },
        }),
      },
      ...(options.includeMalformedTrace
        ? [
            {
              userId: user.id,
              problemId: problem.id,
              chatSessionId: chatSession.id,
              eventType: "chat_reply",
              source: "eval:placeholder:malformed-semantic-fixture",
              content: "malformed placeholder trace",
              occurredAt: event(6),
              eventJson: "{malformed-json",
            },
          ]
        : []),
    ],
  });

  return {
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    reviewTraceRunId,
    chatTraceRunId,
  };
}

export function scorePlaceholderSuite(
  observability: AgentObservabilityReport,
): PlaceholderScore {
  const failures: string[] = [];

  if (observability.sampleCounts.reviewPathCount < 1) {
    failures.push("expected at least one review path trace");
  }

  if (observability.sampleCounts.chatPathCount < 1) {
    failures.push("expected at least one chat path trace");
  }

  if (observability.sampleCounts.llmCallCount < 1) {
    failures.push("expected at least one llm_call trace");
  }

  if (observability.sampleCounts.toolCallCount < 1) {
    failures.push("expected at least one tool_call trace");
  }

  if (observability.malformedEventJsonCount > 0) {
    failures.push(
      `expected zero malformed eventJson rows, saw ${observability.malformedEventJsonCount}`,
    );
  }

  const caseResult: PlaceholderCaseResult =
    failures.length === 0
      ? {
          name: "placeholder observability trace is readable",
          status: "pass",
          message: "Seeded L1 trace can be aggregated by observability read-model.",
        }
      : {
          name: "placeholder observability trace is readable",
          status: "fail",
          message: failures.join("; "),
        };

  return {
    suiteName: "placeholder",
    caseCount: 1,
    passCount: caseResult.status === "pass" ? 1 : 0,
    failCount: caseResult.status === "fail" ? 1 : 0,
    cases: [caseResult],
  };
}

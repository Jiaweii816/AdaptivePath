import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { CoachChatInput, CoachProvider } from "./coach-agent.types";
import {
  buildCoachChatSystemPrompt,
  buildCoachReviewPrompt,
} from "./build-coach-prompt";
import { detectVisibleSelfCorrectionMarker } from "./chat-intent-policy";
import { applyCoachReplyGuards } from "./coach-reply-contract";
import { parseCoachReviewOutput } from "./parse-coach-output";
import { buildRunEvidenceDiagnosis } from "./run-evidence-diagnosis";
import { captureToolCalls } from "./tool-call-trace";
import { createReviewClient, createChatClient } from "@/server/llm/client";
import {
  getReviewModel,
  getReviewThinkingModel,
  getChatModel,
  getChatThinkingModel,
} from "@/server/llm/models";
import { deepSeekV4ThinkingParams } from "@/server/llm/deepseek-v4-request";
import {
  addTraceLlmMs,
  appendLlmCallTrace,
  startTraceStep,
} from "@/server/llm/trace-context";
import {
  detectToolProtocolLeak,
  type SafeProtocolLeakSummary,
} from "@/server/llm/tool-protocol-leak";
import {
  projectNoToolsChatHistory,
  type NoToolsChatMessage,
} from "@/server/llm/no-tools-chat-history";
import { markTraceRunDegradedBestEffort } from "@/server/observability/trace-store";
import type {
  CoachDiagnosis,
  CoachReviewDegradation,
  CoachReviewResult,
} from "@/types/coach";
import { buildMemoryPromptReceipt } from "@/server/memory/retrieval/memory-prompt-receipt";

export type QwenCoachProviderOptions = {
  reviewClient?: OpenAI;
  reviewModel?: string;
  reviewThinkingModel?: string;
  chatClient?: OpenAI;
  chatModel?: string;
  chatThinkingModel?: string;
};

const REVIEW_TRACE_RECORDED = Symbol("review-trace-recorded");

export function createQwenCoachProvider(
  options: QwenCoachProviderOptions = {},
): CoachProvider {
  const reviewClient = options.reviewClient ?? createReviewClient();
  const reviewModel = options.reviewModel ?? getReviewModel();
  const reviewThinkingModel =
    options.reviewThinkingModel ?? getReviewThinkingModel();
  const chatClient = options.chatClient ?? createChatClient();
  const chatModel = options.chatModel ?? getChatModel();
  const chatThinkingModel = options.chatThinkingModel ?? getChatThinkingModel();

  return {
    runtimeTraceOwnership: "provider" as const,
    async review(input) {
      const localEvidenceExaminer =
        input.evidenceVerdict?.evidenceClass === "local_only";
      const fallbackDiagnosis = buildRunEvidenceDiagnosis({
        problemSlug: input.problem.slug,
        problemTags: input.problem.tags,
        runResult: input.runResult,
      });
      const safeFallbackDiagnosis = fallbackDiagnosis;

      if (localEvidenceExaminer) {
        return requestLocalEvidenceExaminerReview({
          client: reviewClient,
          model: reviewThinkingModel,
          input,
          fallbackDiagnosis: safeFallbackDiagnosis,
        });
      }

      const failedReview = input.runResult.status !== "passed_visible_tests";
      const reviewCompletion = await requestReviewCompletion({
        client: reviewClient,
        model: failedReview ? reviewThinkingModel : reviewModel,
        messages: buildReviewMessages(input),
        traceContext: input.traceContext,
        task: "review.diagnose_and_reply",
        useThinking: failedReview,
        memoryPromptReceipt: buildMemoryPromptReceipt(input.memory),
      });
      const completion = reviewCompletion.completion;
      const content = readCompletionContent(completion);
      const parsed = parseCoachReviewOutput(content, {
        fallbackDiagnosis: safeFallbackDiagnosis,
      });
      const guard = applyCoachReplyGuards(parsed.coachReply, {
        responseLanguage: input.responseLanguage ?? "zh",
        runStatus: input.runResult.status,
      });

      if (guard.formatWarnings.length > 0) {
        console.warn(
          "Coach review reply format warnings:",
          guard.formatWarnings,
        );
      }

      const result = {
        coachReply: guard.reply,
        diagnosis: parsed.diagnosis,
        degraded: mergeReviewDegradation(parsed.degraded, guard.safetyReplaced),
      };
      await appendSuccessfulReviewLlmTrace(reviewCompletion, {
        rawOutput: content,
        parsedOutput: parsed,
        visibleOutput: result,
      });
      return result;
    },

    async chat(input) {
      const chatCompletion = await requestChatCompletion({
        client: chatClient,
        model: input.thinking ? chatThinkingModel : chatModel,
        input,
      });
      if (chatCompletion.protocolLeak) {
        return {
          type: "protocol_violation",
          leak: chatCompletion.protocolLeak,
        };
      }
      const completion = chatCompletion.completion;
      const message = completion.choices[0]?.message;

      if (!message) {
        throw new Error("Chat LLM returned an empty response.");
      }

      const toolCalls = (message.tool_calls ?? [])
        .filter((toolCall) => toolCall.type === "function")
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: parseToolArguments({
            name: toolCall.function.name,
            rawArguments: toolCall.function.arguments,
          }),
        }));

      if (toolCalls.length > 0) {
        return {
          type: "tool_calls",
          toolCalls,
          assistantContent: message.content ?? undefined,
        };
      }

      const coachReply = message.content;

      if (!coachReply) {
        throw new Error("Chat LLM returned an empty response.");
      }

      return {
        type: "final",
        coachReply,
      };
    },
  };
}

function buildReviewMessages(
  input: Parameters<CoachProvider["review"]>[0],
  repairReasons: string[] = [],
): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: [
        "You produce PatternCoach AI review output. Write the markdown reply first, then the sentinel line, then the diagnosis JSON. Never claim hidden-test success or guaranteed official success.",
        repairReasons.length > 0
          ? "Your previous review output was rejected by a display guard. Regenerate only the final learner-visible reply and diagnosis JSON. Do not reveal reasoning, do not self-correct visibly, do not repeat yourself, and keep the markdown concise."
          : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    },
    {
      role: "user",
      content: [
        buildCoachReviewPrompt(input),
        repairReasons.length > 0
          ? [
              "",
              "Regeneration guard reasons:",
              repairReasons.map((reason) => `- ${reason}`).join("\n"),
              "Regenerate from scratch. Do not discuss the rejected output.",
            ].join("\n")
          : "",
      ].join("\n"),
    },
  ];
}

async function requestLocalEvidenceExaminerReview(args: {
  client: OpenAI;
  model: string;
  input: Parameters<CoachProvider["review"]>[0];
  fallbackDiagnosis: CoachDiagnosis;
}): Promise<CoachReviewResult> {
  const reviewCompletion = await requestReviewCompletion({
    client: args.client,
    model: args.model,
    messages: buildReviewMessages(args.input),
    traceContext: args.input.traceContext,
    task: "review.local_evidence_examiner",
    useThinking: true,
    retryAttempt: 0,
    memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
  });
  const completion = reviewCompletion.completion;
  const content = readCompletionContent(completion);
  const parsed = parseCoachReviewOutput(content, {
    fallbackDiagnosis: args.fallbackDiagnosis,
  });
  const guard = applyCoachReplyGuards(parsed.coachReply, {
    responseLanguage: args.input.responseLanguage ?? "zh",
    runStatus: args.input.runResult.status,
  });
  const reasons = reviewOutputRejectionReasons({
    completion,
    parsed,
    visibleReply: parsed.coachReply,
    guardedReply: guard.reply,
    guardWarnings: guard.formatWarnings,
    safetyReplaced: guard.safetyReplaced,
  });
  const result =
    reasons.length === 0
      ? {
          coachReply: guard.reply,
          diagnosis: parsed.diagnosis,
          degraded: mergeReviewDegradation(
            parsed.degraded,
            guard.safetyReplaced,
          ),
        }
      : buildLocalEvidenceExaminerGuardFallback({
          input: args.input,
          diagnosis: args.fallbackDiagnosis,
          reasons: [...new Set(reasons)],
        });
  await appendSuccessfulReviewLlmTrace(reviewCompletion, {
    rawOutput: content,
    parsedOutput: parsed,
    visibleOutput: result,
  });
  return result;
}

async function requestReviewCompletion(args: {
  client: OpenAI;
  model: string;
  messages: ChatCompletionMessageParam[];
  traceContext?: Parameters<CoachProvider["review"]>[0]["traceContext"];
  task?: string;
  useThinking?: boolean;
  retryAttempt?: number;
  memoryPromptReceipt: ReturnType<typeof buildMemoryPromptReceipt>;
}) {
  const step = startTraceStep(args.traceContext, { spanKind: "llm" });
  const startedAt = Date.now();
  const useThinking = args.useThinking === true;

  try {
    const completion = (await args.client.chat.completions.create({
      model: args.model,
      messages: args.messages,
      ...deepSeekV4ThinkingParams(
        args.model,
        useThinking ? "enabled" : "disabled",
      ),
      ...(useThinking ? {} : { temperature: 0.2 }),
    })) as ChatCompletion;
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(args.traceContext, latencyMs);
    const reasoningContent = readReasoningContent(
      completion.choices[0]?.message,
    );
    const reasoningTokens = readReasoningTokens(completion.usage);
    if (!completion.choices[0]?.message.content) {
      const error = Object.assign(
        new Error("Review LLM returned an empty response."),
        { [REVIEW_TRACE_RECORDED]: true },
      );
      await appendLlmCallTrace({
        traceContext: args.traceContext,
        step,
        task: args.task ?? "review.diagnose_and_reply",
        model: args.model,
        responseModel: completion.model,
        latencyMs,
        status: "error",
        finishReason: completion.choices[0]?.finish_reason ?? null,
        usage: completion.usage,
        error,
        mode: useThinking ? "thinking" : "standard",
        prompt: tracePrompt(args.messages),
        input: {
          temperature: useThinking ? null : 0.2,
          thinking: useThinking,
          thinkingControl: useThinking ? "enabled" : "disabled",
        },
        rawOutput: "",
        extraEventJson: {
          memoryPromptReceipt: args.memoryPromptReceipt,
        },
      });
      throw error;
    }
    return {
      completion,
      trace: {
        traceContext: args.traceContext,
        step,
        task: args.task ?? "review.diagnose_and_reply",
        model: args.model,
        messages: args.messages,
        latencyMs,
        useThinking,
        retryAttempt: args.retryAttempt ?? 0,
        reasoningContentChars: reasoningContent.length,
        reasoningContentApproxTokens: approximateTokens(reasoningContent),
        reasoningTokens,
        memoryPromptReceipt: args.memoryPromptReceipt,
      },
    };
  } catch (error) {
    if (error && typeof error === "object" && REVIEW_TRACE_RECORDED in error) {
      throw error;
    }
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(args.traceContext, latencyMs);
    await appendLlmCallTrace({
      traceContext: args.traceContext,
      step,
      task: args.task ?? "review.diagnose_and_reply",
      model: args.model,
      responseModel: null,
      latencyMs,
      status: "error",
      finishReason: null,
      usage: null,
      usageMissingReason: "error_response",
      error,
      mode: useThinking ? "thinking" : "standard",
      prompt: tracePrompt(args.messages),
      input: {
        temperature: useThinking ? null : 0.2,
        thinking: useThinking,
        thinkingControl: useThinking ? "enabled" : "disabled",
      },
      extraEventJson: useThinking
        ? {
            memoryPromptReceipt: args.memoryPromptReceipt,
            thinking: true,
            reviewThinking: true,
            localEvidenceExaminer:
              args.task === "review.local_evidence_examiner",
            retryAttempt: args.retryAttempt ?? 0,
          }
        : { memoryPromptReceipt: args.memoryPromptReceipt },
    });
    throw error;
  }
}

async function appendSuccessfulReviewLlmTrace(
  request: Awaited<ReturnType<typeof requestReviewCompletion>>,
  output: {
    rawOutput: string;
    parsedOutput: unknown;
    visibleOutput: unknown;
  },
) {
  const { completion, trace } = request;
  await appendLlmCallTrace({
    traceContext: trace.traceContext,
    step: trace.step,
    task: trace.task,
    model: trace.model,
    responseModel: completion.model,
    latencyMs: trace.latencyMs,
    status: "ok",
    finishReason: completion.choices[0]?.finish_reason ?? null,
    usage: completion.usage,
    mode: trace.useThinking ? "thinking" : "standard",
    prompt: tracePrompt(trace.messages),
    input: {
      temperature: trace.useThinking ? null : 0.2,
      thinking: trace.useThinking,
      thinkingControl: trace.useThinking ? "enabled" : "disabled",
    },
    rawOutput: output.rawOutput,
    parsedOutput: output.parsedOutput,
    visibleOutput: output.visibleOutput,
    extraEventJson: trace.useThinking
      ? {
          memoryPromptReceipt: trace.memoryPromptReceipt,
          thinking: true,
          reviewThinking: true,
          localEvidenceExaminer:
            trace.task === "review.local_evidence_examiner",
          retryAttempt: trace.retryAttempt,
          reasoningContentChars: trace.reasoningContentChars,
          reasoningContentApproxTokens: trace.reasoningContentApproxTokens,
          reasoningTokens: trace.reasoningTokens,
          selfCorrectionMarkerDetected: detectVisibleSelfCorrectionMarker(
            completion.choices[0]?.message.content ?? "",
          ),
        }
      : { memoryPromptReceipt: trace.memoryPromptReceipt },
  });
}

function tracePrompt(messages: ChatCompletionMessageParam[]) {
  return messages.map((message) => ({
    role: message.role,
    content: "content" in message ? message.content : undefined,
  }));
}

function readCompletionContent(completion: ChatCompletion) {
  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error("Review LLM returned an empty response.");
  }

  return content;
}

function reviewOutputRejectionReasons(args: {
  completion: ChatCompletion;
  parsed: ReturnType<typeof parseCoachReviewOutput>;
  visibleReply: string;
  guardedReply: string;
  guardWarnings: string[];
  safetyReplaced: boolean;
}) {
  const reasons: string[] = [];
  const finishReason = args.completion.choices[0]?.finish_reason;

  if (finishReason === "length") {
    reasons.push("finish_reason_length");
  }

  if (args.parsed.degraded?.reason.includes("No diagnosis sentinel")) {
    reasons.push("missing_diagnosis_sentinel");
  }

  if (args.parsed.degraded?.reason.includes("could not be parsed")) {
    reasons.push("malformed_diagnosis_json");
  }

  if (args.safetyReplaced) {
    reasons.push("safety_replaced");
  }

  if (args.guardWarnings.some((warning) => warning.includes("too long"))) {
    reasons.push("reply_too_long");
  }

  if (detectVisibleSelfCorrectionMarker(args.visibleReply)) {
    reasons.push("visible_self_correction");
  }

  if (containsReasoningLeakMarker(args.visibleReply)) {
    reasons.push("reasoning_leak_marker");
  }

  if (containsRepeatedSentence(args.visibleReply)) {
    reasons.push("repeated_sentence");
  }

  if (args.guardedReply.trim().length === 0) {
    reasons.push("empty_guarded_reply");
  }

  return [...new Set(reasons)];
}

function containsReasoningLeakMarker(markdown: string) {
  return /<\/?think>|(?:^|\n)\s*(thinking|reasoning)\s*:|思考过程|推理过程/i.test(
    markdown,
  );
}

function containsRepeatedSentence(markdown: string) {
  const counts = new Map<string, number>();
  const segments = markdown
    .split(/[\n。！？!?；;]+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter((segment) => segment.length >= 24);

  for (const segment of segments) {
    const count = (counts.get(segment) ?? 0) + 1;

    if (count >= 3) {
      return true;
    }

    counts.set(segment, count);
  }

  return false;
}

function buildLocalEvidenceExaminerGuardFallback(args: {
  input: Parameters<CoachProvider["review"]>[0];
  diagnosis: CoachDiagnosis;
  reasons: string[];
}): CoachReviewResult {
  return {
    diagnosis: args.diagnosis,
    coachReply: buildLocalEvidenceExaminerGuardFallbackReply(args.input),
    degraded: {
      tier: 2,
      reason: `Local-Evidence Examiner output rejected after the single Review call: ${
        args.reasons.join(", ") || "unknown"
      }`,
      memorySkipped: true,
      safetyReplaced: true,
    },
  };
}

function buildLocalEvidenceExaminerGuardFallbackReply(
  input: Parameters<CoachProvider["review"]>[0],
) {
  const language = input.responseLanguage ?? "zh";
  const run = input.runResult;
  const total = run.passedCount + run.failedCount;

  if (language === "en") {
    if (run.status === "passed_visible_tests") {
      return `The current revision passed ${run.passedCount}/${total || run.passedCount} selected local visible tests. This is not an official LeetCode verdict and does not cover hidden tests. Next, verify one meaningful boundary case or run the official judge.`;
    }

    const failed = run.firstFailedCase;
    return failed
      ? `On the selected local visible case ${failed.label}, the current revision produced ${JSON.stringify(failed.actual)} instead of ${JSON.stringify(failed.expected)}. This is local visible evidence, not an official verdict. Trace that case to the first diverging step, then rerun it.`
      : `The selected local visible run ended with ${run.status}. This is local visible evidence, not an official verdict. Use the displayed error details to make one small correction, then rerun the same selected cases.`;
  }

  if (run.status === "passed_visible_tests") {
    return `当前代码通过了所选本地可见测试（${run.passedCount}/${total || run.passedCount}）。这不是 LeetCode 官方判定，也不覆盖隐藏测试。下一步请补一个有意义的边界用例，或用官方评测确认。`;
  }

  const failed = run.firstFailedCase;
  return failed
    ? `在所选本地可见用例“${failed.label}”中，当前代码实际得到 ${JSON.stringify(failed.actual)}，预期为 ${JSON.stringify(failed.expected)}。这是本地可见证据，不是官方判定。先找到该用例第一个跑偏的步骤，再重跑同一用例。`
    : `所选本地可见测试运行结果为 ${run.status}。这是本地可见证据，不是官方判定。请根据已展示的错误信息做一处最小修改，再重跑同一组用例。`;
}

async function requestChatCompletion(args: {
  client: OpenAI;
  model: string;
  input: Parameters<CoachProvider["chat"]>[0];
}) {
  const step = startTraceStep(args.input.traceContext, { spanKind: "llm" });
  const startedAt = Date.now();
  const useThinking = args.input.thinking === true;
  const task = useThinking ? "chat.deep_reasoning.turn" : "chat.tool_loop.turn";
  const toolsPresent = !useThinking && Boolean(args.input.tools?.length);
  const toolsCallable =
    toolsPresent && args.input.toolMode !== "finalize_without_tools";
  const historyProjection = toolsPresent
    ? null
    : projectNoToolsChatHistory(args.input.messages);
  const messages = buildOpenAiChatMessages(
    args.input,
    historyProjection?.messages,
  );
  assertNoStructuredToolHistoryWithoutTools(messages, toolsPresent);
  const generationInput = {
    mode: useThinking ? "thinking" : "standard",
    temperature: useThinking ? null : 0.3,
    thinkingControl: useThinking ? "enabled" : "disabled",
    toolMode: args.input.toolMode ?? "tool_loop",
    toolChoice: toolsPresent ? (toolsCallable ? "auto" : "none") : null,
    plannedToolChoice: args.input.toolChoice ?? null,
    availableTools: toolsPresent
      ? (args.input.tools?.map((tool) => tool.function.name) ?? [])
      : [],
    tools: toolsPresent ? (args.input.tools ?? []) : [],
    noToolsHistoryProjection: historyProjection
      ? {
          truncated: historyProjection.truncated,
          omittedChars: historyProjection.omittedChars,
        }
      : null,
    policy: projectChatTracePolicy(args.input),
    requiredActions: args.input.requiredActions ?? [],
  };

  try {
    const completion = await args.client.chat.completions.create({
      model: args.model,
      messages,
      ...deepSeekV4ThinkingParams(
        args.model,
        useThinking ? "enabled" : "disabled",
      ),
      ...(useThinking ? {} : { temperature: 0.3 }),
      ...(toolsPresent && args.input.tools
        ? {
            tools: args.input.tools as ChatCompletionTool[],
            tool_choice: !toolsCallable
              ? ("none" as const)
              : ("auto" as const),
          }
        : {}),
    });
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(args.input.traceContext, latencyMs);
    const reasoningContent = readReasoningContent(
      completion.choices[0]?.message,
    );
    const reasoningTokens = readReasoningTokens(completion.usage);
    const selfCorrectionMarkerDetected =
      useThinking &&
      detectVisibleSelfCorrectionMarker(
        completion.choices[0]?.message.content ?? "",
      );
    const protocolLeak = detectToolProtocolLeak(
      completion.choices[0]?.message.content ?? "",
      { finishReason: completion.choices[0]?.finish_reason ?? null },
    );
    if (protocolLeak) {
      await markProtocolViolationTraceDegraded(args.input.traceContext);
    }
    const capturedToolCalls = captureRawToolCalls(completion);
    await appendLlmCallTrace({
      traceContext: args.input.traceContext,
      step,
      task,
      model: args.model,
      responseModel: completion.model,
      latencyMs,
      status: protocolLeak ? "error" : "ok",
      finishReason: completion.choices[0]?.finish_reason ?? null,
      usage: completion.usage,
      mode: useThinking ? "thinking" : "standard",
      prompt: buildChatTracePrompt(messages),
      input: generationInput,
      error: protocolLeak
        ? new Error("Provider returned private tool protocol as plain content.")
        : undefined,
      rawOutput: protocolLeak
        ? buildProtocolViolationRawOutput(completion, protocolLeak)
        : buildSafeChatRawOutput(completion),
      parsedOutput: protocolLeak
        ? { type: "protocol_violation", leak: protocolLeak }
        : buildChatParsedOutput(completion),
      extraEventJson: useThinking
        ? {
            memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
            thinking: true,
            deepReasoning: true,
            reasoningContentChars: reasoningContent.length,
            reasoningContentApproxTokens: approximateTokens(reasoningContent),
            reasoningTokens,
            selfCorrectionMarkerDetected,
            visibleOutputDeferredTo: "guard_visible_reply",
            protocolViolation: Boolean(protocolLeak),
            toolCalls: capturedToolCalls,
          }
        : {
            memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
            visibleOutputDeferredTo: "guard_visible_reply",
            protocolViolation: Boolean(protocolLeak),
            toolCalls: capturedToolCalls,
          },
    });

    return { completion, protocolLeak };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    addTraceLlmMs(args.input.traceContext, latencyMs);
    await appendLlmCallTrace({
      traceContext: args.input.traceContext,
      step,
      task,
      model: args.model,
      responseModel: null,
      latencyMs,
      status: "error",
      finishReason: null,
      usage: null,
      usageMissingReason: "error_response",
      error,
      mode: useThinking ? "thinking" : "standard",
      prompt: buildChatTracePrompt(messages),
      input: generationInput,
      extraEventJson: {
        memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
        ...(useThinking ? { thinking: true } : {}),
      },
    });
    throw error;
  }
}

function projectChatTracePolicy(input: CoachChatInput) {
  const policy = input.interactionState?.policy;
  if (!policy) return null;
  return {
    intent: policy.intent,
    styleMode: policy.styleMode,
    primaryGoal: policy.primaryGoal,
    responseShape: policy.responseShape,
    codeDisclosure: policy.codeDisclosure,
    mustDo: policy.mustDo,
    avoid: policy.avoid,
  };
}

/**
 * This provider owns its runtime trace (`runtimeTraceOwnership: "provider"`),
 * so it never passes through chat-reply.ts's `callChatProviderOnce` seam —
 * it must capture function-calling JSON onto its own LLM trace event here,
 * reusing the same `captureToolCalls()` logic that seam uses.
 */
function captureRawToolCalls(completion: ChatCompletion) {
  const functionToolCalls = (completion.choices[0]?.message.tool_calls ?? [])
    .filter((toolCall) => toolCall.type === "function")
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    }));

  return functionToolCalls.length > 0
    ? captureToolCalls(functionToolCalls)
    : undefined;
}

function buildChatTracePrompt(messages: ChatCompletionMessageParam[]) {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === "assistant" && "tool_calls" in message
        ? {
            content: message.content,
            toolCalls: message.tool_calls,
          }
        : "content" in message
          ? message.content
          : null,
  }));
}

function buildSafeChatRawOutput(completion: ChatCompletion) {
  return {
    id: completion.id ?? null,
    model: completion.model,
    created: completion.created ?? null,
    choices: completion.choices.map((choice) => ({
      index: choice.index,
      finishReason: choice.finish_reason,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        toolCalls: choice.message.tool_calls ?? [],
      },
    })),
  };
}

function buildProtocolViolationRawOutput(
  completion: ChatCompletion,
  leak: SafeProtocolLeakSummary,
) {
  return {
    id: completion.id ?? null,
    model: completion.model,
    created: completion.created ?? null,
    protocolViolation: leak,
  };
}

function buildChatParsedOutput(completion: ChatCompletion) {
  const message = completion.choices[0]?.message;
  if (!message) {
    return { type: "empty" };
  }
  const toolCalls = (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.type === "function")
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: parseToolArguments({
        name: toolCall.function.name,
        rawArguments: toolCall.function.arguments,
      }),
    }));

  return toolCalls.length > 0
    ? {
        type: "tool_calls",
        assistantContent: message.content ?? null,
        toolCalls,
      }
    : {
        type: "final",
        coachReply: message.content ?? null,
      };
}

function readReasoningContent(message: unknown) {
  if (!message || typeof message !== "object") {
    return "";
  }

  const value = (message as Record<string, unknown>).reasoning_content;
  return typeof value === "string" ? value : "";
}

function readReasoningTokens(usage: unknown) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const details = (usage as Record<string, unknown>).completion_tokens_details;

  if (!details || typeof details !== "object") {
    return null;
  }

  const value = (details as Record<string, unknown>).reasoning_tokens;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function approximateTokens(value: string) {
  return value ? Math.ceil(value.length / 4) : 0;
}

function buildOpenAiChatMessages(
  input: Parameters<CoachProvider["chat"]>[0],
  projectedMessages?: readonly NoToolsChatMessage[],
): ChatCompletionMessageParam[] {
  const messages = projectedMessages ?? input.messages;

  return [
    {
      role: "system",
      content: input.frozenSystemPrompt ?? buildCoachChatSystemPrompt(input),
    },
    ...messages.map((message): ChatCompletionMessageParam => {
      if (message.role === "tool") {
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }

      if ("toolCalls" in message) {
        return {
          role: "assistant",
          content: message.content ?? null,
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments ?? {}),
            },
          })),
        };
      }

      return {
        role: message.role,
        content: message.content,
      };
    }),
  ];
}

function assertNoStructuredToolHistoryWithoutTools(
  messages: readonly ChatCompletionMessageParam[],
  toolsEnabled: boolean,
) {
  if (toolsEnabled) {
    return;
  }

  const invalid = messages.some(
    (message) =>
      message.role === "tool" ||
      (message.role === "assistant" &&
        "tool_calls" in message &&
        Boolean(message.tool_calls?.length)),
  );

  if (invalid) {
    throw new Error(
      "No-tools chat request contains structured tool history after projection.",
    );
  }
}

async function markProtocolViolationTraceDegraded(
  traceContext: Parameters<CoachProvider["chat"]>[0]["traceContext"],
) {
  if (!traceContext) {
    return;
  }

  traceContext.recorder?.markDegraded();
  await markTraceRunDegradedBestEffort(
    traceContext.prisma,
    traceContext.traceRunId,
  );
}

function parseToolArguments(args: {
  name: string;
  rawArguments: string;
}): unknown {
  try {
    return args.rawArguments ? JSON.parse(args.rawArguments) : {};
  } catch (error) {
    console.warn(
      `Chat LLM returned invalid JSON arguments for ${args.name}; routing to tool validation trace: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
    return args.rawArguments;
  }
}

function mergeReviewDegradation(
  parsed: CoachReviewDegradation | undefined,
  safetyReplaced: boolean,
): CoachReviewDegradation | undefined {
  if (!safetyReplaced) {
    return parsed;
  }

  return {
    tier: parsed?.tier,
    reason: parsed
      ? `${parsed.reason} | Reply replaced by safety guard.`
      : "Reply replaced by safety guard (forbidden copy).",
    memorySkipped: parsed?.memorySkipped ?? false,
    safetyReplaced: true,
  };
}

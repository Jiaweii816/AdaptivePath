import {
  addTraceLlmMs,
  appendLlmCallTrace,
  appendTraceEventBestEffort,
  attachTraceRunReferences,
  startTraceStep,
} from "@/server/llm/trace-context";
import type { TraceContext, TraceStep } from "@/server/llm/trace-context";
import { markTraceRunDegradedBestEffort } from "@/server/observability/trace-store";
import type { CoachChatInput, CoachProvider } from "./coach-agent.types";
import type { ChatReplyResult } from "./chat-reply-contracts";
import { captureToolCalls } from "./tool-call-trace";
import { buildMemoryPromptReceipt } from "@/server/memory/retrieval/memory-prompt-receipt";

export async function appendReplySafetyTrace(
  traceContext: TraceContext,
  step: TraceStep | undefined,
  args: {
    chatSessionId: string;
    reason: string;
    originalReply: string;
    replacement: string;
    metadata?: Record<string, unknown>;
  },
) {
  await appendTraceEventBestEffort(traceContext, {
    step,
    stage: "guard_visible_reply",
    kind: "guard",
    title: `Reply safety replacement · ${args.reason}`,
    status: "succeeded",
    details: {
      input: { originalReply: args.originalReply },
      output: { replacement: args.replacement },
      metadata: {
        source: "chat_reply",
        chatSessionId: args.chatSessionId,
        eventRole: "replacement",
        reason: args.reason,
        ...args.metadata,
      },
    },
  });
}

export async function attachChatTraceReferencesBestEffort(
  traceContext: TraceContext,
  chatSessionId: string,
) {
  try {
    await attachTraceRunReferences(traceContext, { chatSessionId });
  } catch (error) {
    console.warn(
      `Unable to attach ChatSession ${chatSessionId} to trace ${traceContext.traceRunId}; continuing Chat without failing the learner request.`,
      error,
    );
    await markTraceRunDegradedBestEffort(
      traceContext.prisma,
      traceContext.traceRunId,
    );
  }
}

export async function callChatProviderOnce(
  provider: CoachProvider,
  input: CoachChatInput,
  traceContext: TraceContext,
) {
  if (provider.runtimeTraceOwnership === "provider") return provider.chat(input);
  const step = startTraceStep(traceContext, { spanKind: "llm" });
  const startedAt = Date.now();
  const tracePrompt = buildTracePrompt(input);
  const traceInput = buildTraceInput(input);
  try {
    const result = await provider.chat(input);
    await traceProviderSuccess({
      input,
      result,
      traceContext,
      step,
      startedAt,
      tracePrompt,
      traceInput,
    });
    return result;
  } catch (error) {
    await traceProviderError({
      input,
      error,
      traceContext,
      step,
      startedAt,
      tracePrompt,
      traceInput,
    });
    throw error;
  }
}

function buildTracePrompt(input: CoachChatInput) {
  return input.messages.map((message) => ({
    role: message.role,
    content:
      "toolCalls" in message
        ? { content: message.content ?? null, toolCalls: message.toolCalls }
        : "toolCallId" in message
          ? {
              toolCallId: message.toolCallId,
              name: message.name,
              content: message.content,
            }
          : message.content,
  }));
}

function buildTraceInput(input: CoachChatInput) {
  const policy = input.interactionState?.policy;
  return {
    providerTraceOwnership: "orchestration",
    thinking: input.thinking === true,
    toolMode: input.toolMode ?? "tool_loop",
    toolChoice: input.toolChoice ?? null,
    availableTools: input.tools?.map((tool) => tool.function.name) ?? [],
    policy: policy
      ? {
          intent: policy.intent,
          styleMode: policy.styleMode,
          primaryGoal: policy.primaryGoal,
          responseShape: policy.responseShape,
          codeDisclosure: policy.codeDisclosure,
          mustDo: policy.mustDo,
          avoid: policy.avoid,
        }
      : null,
    requiredActions: input.requiredActions ?? [],
  };
}

type ProviderTraceArgs = {
  input: CoachChatInput;
  traceContext: TraceContext;
  step: TraceStep | undefined;
  startedAt: number;
  tracePrompt: ReturnType<typeof buildTracePrompt>;
  traceInput: ReturnType<typeof buildTraceInput>;
};

async function traceProviderSuccess(
  args: ProviderTraceArgs & {
    result: Awaited<ReturnType<CoachProvider["chat"]>>;
  },
) {
  const latencyMs = Date.now() - args.startedAt;
  addTraceLlmMs(args.traceContext, latencyMs);
  await appendLlmCallTrace({
    ...baseTrace(args, latencyMs),
    status: "ok",
    usage: null,
    usageMissingReason: "provider_omitted",
    rawOutput: args.result,
    parsedOutput: args.result,
    extraEventJson: {
      providerSeam: true,
      memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
      visibleOutputDeferredTo: "guard_visible_reply",
      toolCalls:
        args.result.type === "tool_calls" && args.result.toolCalls.length
          ? captureToolCalls(args.result.toolCalls)
          : undefined,
    },
  });
}

async function traceProviderError(
  args: ProviderTraceArgs & { error: unknown },
) {
  const latencyMs = Date.now() - args.startedAt;
  addTraceLlmMs(args.traceContext, latencyMs);
  await appendLlmCallTrace({
    ...baseTrace(args, latencyMs),
    status: "error",
    usage: null,
    usageMissingReason: "error_response",
    error: args.error,
    extraEventJson: {
      providerSeam: true,
      memoryPromptReceipt: buildMemoryPromptReceipt(args.input.memory),
    },
  });
}

function baseTrace(args: ProviderTraceArgs, latencyMs: number) {
  return {
    traceContext: args.traceContext,
    step: args.step,
    task: args.input.thinking
      ? "chat.deep_reasoning.turn"
      : "chat.tool_loop.turn",
    source: "chat:provider_seam",
    provider: "injected",
    model: "coach-provider-seam",
    latencyMs,
    mode: args.input.thinking ? "thinking" : "standard",
    prompt: args.tracePrompt,
    input: args.traceInput,
  } as const;
}

export function buildToolBudgetReachedReply(responseLanguage: "zh" | "en") {
  return responseLanguage === "en"
    ? "Tool budget reached before I could finish the tool loop. I have stopped here instead of hiding the partial state; ask me to continue with a narrower question or run Review My Code again after your next edit."
    : "工具调用次数已达到上限，我先在这里停下，不会假装已经完成。你可以把问题缩小一点继续问，或改完代码后再点 Review My Code。";
}

export function buildProtocolViolationReply(
  responseLanguage: "zh" | "en",
  toolTrace: ChatReplyResult["toolTrace"],
) {
  const writes = confirmedWrites(toolTrace);
  if (responseLanguage === "en") {
    return writes.length > 0
      ? `I blocked an invalid provider-protocol response. The backend confirms only these completed writes: ${writes.join(", ")}. No other write is being reported as completed.`
      : "I blocked an invalid provider-protocol response before it reached the chat. The backend has not confirmed any requested write in this turn; please retry.";
  }
  return writes.length > 0
    ? `我拦截了一段异常的模型工具协议输出。后端仅确认以下写入已完成：${writes.join("、")}；其余写入均不报告为成功。`
    : "我拦截了一段异常的模型工具协议输出，未让它显示或执行。本轮后端没有确认任何写入成功，请重试。";
}

function confirmedWrites(toolTrace: ChatReplyResult["toolTrace"]) {
  const names = new Set(["save_mistake_book_entry", "save_knowledge_note", "note_memory"]);
  return toolTrace
    .filter(
      (entry) =>
        names.has(entry.name) &&
        entry.result &&
        typeof entry.result === "object" &&
        (entry.result as { saved?: unknown }).saved === true,
    )
    .map((entry) => entry.name);
}

import { addTraceToolMs, startTraceStep } from "@/server/llm/trace-context";
import {
  assertChatToolAvailableThisTurn,
  ChatToolDispatchError,
  dispatchPreparedChatToolCall,
  prepareResolvedChatToolCall,
  resolveChatToolCallName,
} from "@/server/tools/chat-tools/chat-tool-dispatch";
import { isDurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";
import {
  recordInvalidArguments,
} from "@/server/tools/chat-tools/required-action-ledger";
import type { TurnToolPlan } from "@/server/tools/chat-tools/turn-tool-plan";
import type { CoachToolCall } from "./coach-agent.types";
import type { ChatLoopState } from "./chat-tool-loop-types";
import { hasPendingRequiredAction } from "./chat-tool-plan";
import {
  appendToolCallTrace,
  appendToolResultTrace,
} from "./chat-tool-runtime-trace";
import { handleToolRuntimeDecision } from "./chat-tool-execution-result";
import { discoverChatCapability } from "./capability-discovery";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import { getChatToolByCapabilityId } from "@/server/tools/chat-tools/chat-tool-registry";
import { guardToolAdmission } from "./chat-tool-invocation-guard";

export async function denyUnavailableToolCalls(
  state: ChatLoopState,
  toolCalls: readonly CoachToolCall[],
) {
  state.loopMessages.push({
    role: "assistant",
    content: "",
    toolCalls: [...toolCalls],
  });
  for (const toolCall of toolCalls) {
    const step = startTraceStep(state.turn.traceContext, {
      spanKind: "tool",
      parentStepId: state.turn.traceContext.latestLlmStepId,
    });
    await appendToolCallTrace(traceArgs(state, toolCall, step));
    const startedAt = Date.now();
    const decision = state.toolRuntime.recordPreflightDenial({
      toolName: toolCall.name,
      reason: "tool_not_available_this_turn",
    });
    const latencyMs = Date.now() - startedAt;
    addTraceToolMs(state.turn.traceContext, latencyMs);
    await appendToolResultTrace({
      ...traceArgs(state, toolCall, step),
      toolResult: decision.observation,
      status: "denied",
      latencyMs,
      runtimeDisposition: "denied",
      runtimeReason: decision.observation.reason,
    });
    state.loopMessages.push({
      role: "tool",
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify(decision.observation),
    });
  }
}

export async function executeToolCalls(
  state: ChatLoopState,
  toolCalls: readonly CoachToolCall[],
  executionPlan: TurnToolPlan,
) {
  for (const toolCall of toolCalls) {
    await executeOneTool(state, toolCall, executionPlan);
  }
}

async function executeOneTool(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  executionPlan: TurnToolPlan,
) {
  const step = startTraceStep(state.turn.traceContext, {
    spanKind: "tool",
    parentStepId: state.turn.traceContext.latestLlmStepId,
  });
  await appendToolCallTrace(traceArgs(state, toolCall, step));
  const startedAt = Date.now();
  if (toolCall.name === "discover_capability") {
    await executeDiscovery(state, toolCall, step, startedAt);
    return;
  }
  const prepared = await prepareTool(state, toolCall, executionPlan, step, startedAt);
  if (!prepared) return;
  const decision = await state.toolRuntime.invoke(
    prepared,
    () => dispatchPreparedChatToolCall(prepared, executionContext(state)),
    { availableToolNames: executionPlan.availableToolNames },
  );
  const latencyMs = Date.now() - startedAt;
  addTraceToolMs(state.turn.traceContext, latencyMs);
  await handleToolRuntimeDecision(state, toolCall, decision, step, latencyMs);
}

async function executeDiscovery(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
) {
  const need = typeof toolCall.arguments === "object" && toolCall.arguments && !Array.isArray(toolCall.arguments)
    ? (toolCall.arguments as { need?: unknown }).need
    : undefined;
  const result = typeof need === "string" && need.trim().length >= 8 && need.trim().length <= 240 && state.discoveryCalls < 2
    ? discoverChatCapability({ need, policy: state.capabilityPolicy })
    : { status: "no_match" as const, matchedCapabilities: [], lexicalScores: [], resolverUsed: false };
  state.discoveryCalls += 1;
  const newlyLoaded = result.status === "loaded"
    ? result.matchedCapabilities
        .map((item) => item.capabilityId)
        .map((id) => getChatToolByCapabilityId(id)?.name)
        .filter((name): name is import("@/server/tools/chat-tools/chat-tool-contracts").ChatToolName => Boolean(name))
    : [];
  for (const name of newlyLoaded) state.loadedToolNames.add(name);
  const observation = { status: result.status, matchedCapabilities: result.matchedCapabilities };
  const latencyMs = Date.now() - startedAt;
  addTraceToolMs(state.turn.traceContext, latencyMs);
  await appendTraceEventBestEffort(state.turn.traceContext, {
    step,
    stage: "tool_governance",
    kind: "tool",
    title: "Discover Chat capability",
    status: "succeeded",
    details: { output: { discovery: { need, lexicalScores: result.lexicalScores, resolverUsed: result.resolverUsed, policyResult: result.status, newlyLoadedTools: newlyLoaded } } },
  });
  await appendToolResultTrace({
    ...traceArgs(state, toolCall, step), toolResult: observation, status: "ok", latencyMs,
  });
  state.loopMessages.push({ role: "tool", toolCallId: toolCall.id, name: toolCall.name as ChatLoopState["toolTrace"][number]["name"], content: JSON.stringify(observation) });
  state.toolTrace.push({ toolCallId: toolCall.id, name: toolCall.name as ChatLoopState["toolTrace"][number]["name"], result: observation, disposition: "executed" });
}

async function prepareTool(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  executionPlan: TurnToolPlan,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
) {
  let resolved;
  try {
    resolved = resolveChatToolCallName(toolCall);
    assertChatToolAvailableThisTurn(resolved, state.loadedToolNames);
    guardToolAdmission({
      toolCallId: resolved.id,
      toolName: resolved.name,
      loadedToolNames: state.loadedToolNames,
      policy: state.capabilityPolicy,
      hasCurrentCode: Boolean(state.effectiveWorkspaceContext.currentCode?.trim()),
    });
    return prepareResolvedChatToolCall(resolved);
  } catch (error) {
    const denial =
      error instanceof ChatToolDispatchError &&
      error.errorKind === "authorization_denied";
    const decision = denial
      ? state.toolRuntime.recordPreflightDenial({
          toolName: resolved?.name ?? toolCall.name,
          reason: "tool_not_available_this_turn",
          error,
        })
      : state.toolRuntime.recordInvalidRequest({
          toolName: resolved?.name ?? toolCall.name,
          error,
        });
    recordInvalidDurableArguments(state, resolved?.name, error);
    await appendPreflightFailure(state, toolCall, decision.observation, error, step, startedAt);
    return undefined;
  }
}

function recordInvalidDurableArguments(
  state: ChatLoopState,
  toolName: string | undefined,
  error: unknown,
) {
  if (
    toolName &&
    isDurableWriteToolName(toolName) &&
    error instanceof ChatToolDispatchError &&
    error.errorKind === "invalid_args" &&
    hasPendingRequiredAction(state.requiredActionLedger, toolName)
  ) {
    state.requiredActionLedger = recordInvalidArguments(
      state.requiredActionLedger,
      toolName,
      { locale: state.context.responseLanguage },
    ).ledger;
  }
}

async function appendPreflightFailure(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  observation: { reason: string },
  error: unknown,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
) {
  const latencyMs = Date.now() - startedAt;
  addTraceToolMs(state.turn.traceContext, latencyMs);
  await appendToolResultTrace({
    ...traceArgs(state, toolCall, step),
    toolResult: observation,
    status: "denied",
    latencyMs,
    error,
    runtimeDisposition: "denied",
    runtimeReason: observation.reason as "tool_not_available_this_turn",
  });
  state.loopMessages.push({
    role: "tool",
    toolCallId: toolCall.id,
    name: toolCall.name,
    content: JSON.stringify(observation),
  });
}

function traceArgs(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  step: ReturnType<typeof startTraceStep>,
) {
  return {
    prisma: state.turn.db,
    userId: state.turn.user.id,
    problemId: state.turn.problem.id,
    chatSessionId: state.turn.chatSession.id,
    responseLanguage: state.context.responseLanguage,
    sequence: state.userMessage.sequence,
    toolCall,
    workspaceContext: state.effectiveWorkspaceContext,
    traceContext: state.turn.traceContext,
    step,
  };
}

function executionContext(state: ChatLoopState) {
  const problem = state.turn.problem;
  return {
    prisma: state.turn.db,
    userId: state.turn.user.id,
    memoryOrigin: state.turn.traceContext.memoryOrigin,
    memoryAssembly: state.context.memoryAssembly,
    traceContext: state.turn.traceContext,
    chatSessionId: state.turn.chatSession.id,
    problem: {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      leetcodeNumber: problem.leetcodeNumber,
      methodName: problem.methodName,
      inputContractJson: problem.inputContractJson,
      outputContractJson: problem.outputContractJson,
      isDemoSupported: problem.isDemoSupported,
      localRunStatus: problem.localRunStatus,
      localRunStatusMessage: problem.localRunStatusMessage,
      comparisonStrategy: problem.comparisonStrategy,
      comparisonConfigJson: problem.comparisonConfigJson,
      contractKind: problem.contractKind,
    },
    problemTags: state.turn.problemTags,
    learnerWeaknessCues: state.turn.profile.weakPatterns.slice(0, 3),
    userMessageId: state.userMessage.id,
    userMessageSequence: state.userMessage.sequence,
    userMessageContent: state.turn.input.message,
    ftsStore: state.turn.ftsStore,
    workspace: {
      code: state.effectiveWorkspaceContext.currentCode,
      language: state.effectiveWorkspaceContext.language,
      codeHash: state.effectiveWorkspaceContext.currentCodeHash,
      executionFingerprint: state.effectiveWorkspaceContext.currentExecutionFingerprint,
      selectedTests: state.turn.selectedTestCases,
    },
    codeRunnerProvider: state.turn.deps.codeRunnerProvider,
  };
}

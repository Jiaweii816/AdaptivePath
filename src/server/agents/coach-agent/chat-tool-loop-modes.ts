import { areChatToolsDisabled } from "@/server/tools/chat-tools/chat-tool-contracts";
import {
  markPendingRequiredActionsUnfulfilled,
} from "@/server/tools/chat-tools/required-action-ledger";
import { setTraceAgentIteration } from "@/server/llm/trace-context";
import type { ChatLoopState } from "./chat-tool-loop-types";
import { callChatProviderOnce } from "./chat-provider-call";
import {
  buildProtocolViolationReply,
  buildToolBudgetReachedReply,
} from "./chat-provider-call";
import { denyUnavailableToolCalls } from "./chat-tool-execution";

export async function runNonLoopMode(state: ChatLoopState) {
  if (state.deepReasoning) {
    await runDeepReasoning(state);
    return true;
  }
  if (state.noToolTurn) {
    await runNoToolTurn(state);
    return true;
  }
  if (areChatToolsDisabled()) {
    await runToolsDisabled(state);
    return true;
  }
  return false;
}

async function runDeepReasoning(state: ChatLoopState) {
  setTraceAgentIteration(state.turn.traceContext, 1);
  const result = await callChatProviderOnce(
    state.provider,
    {
      ...state.baseCoachInput,
      messages: state.loopMessages,
      thinking: true,
      toolMode: "finalize_without_tools",
      requiredActions: state.requiredActionLedger.actions,
    },
    state.turn.traceContext,
  );
  if (result.type === "protocol_violation") {
    recordProtocolViolation(state, result.leak);
  } else if (result.type !== "final") {
    throw new Error("Chat thinking LLM requested tool calls without tools.");
  } else {
    state.coachReply = result.coachReply;
  }
}

async function runNoToolTurn(state: ChatLoopState) {
  setTraceAgentIteration(state.turn.traceContext, 1);
  const result = await callFinalProvider(state, []);
  if (result.type === "protocol_violation") {
    recordProtocolViolation(state, result.leak);
    return;
  }
  if (result.type !== "tool_calls") {
    state.coachReply = result.coachReply;
    return;
  }
  await denyUnavailableToolCalls(state, result.toolCalls);
  setTraceAgentIteration(state.turn.traceContext, 2);
  const recovered = await callFinalProvider(state, []);
  if (recovered.type === "protocol_violation") {
    recordProtocolViolation(state, recovered.leak);
  } else if (recovered.type === "final") {
    state.coachReply = recovered.coachReply;
  } else {
    state.usedToolBudgetFallback = true;
    state.toolStopReason = "no_available_tools";
    state.coachReply = buildToolBudgetReachedReply(state.context.responseLanguage);
  }
}

async function runToolsDisabled(state: ChatLoopState) {
  state.requiredActionLedger = markPendingRequiredActionsUnfulfilled(
    state.requiredActionLedger,
    "tools_disabled",
    { locale: state.context.responseLanguage },
  );
  state.toolStopReason = "tools_disabled";
  setTraceAgentIteration(state.turn.traceContext, 1);
  const result = await callFinalProvider(
    state,
    state.requiredActionLedger.actions,
  );
  if (result.type === "protocol_violation") {
    recordProtocolViolation(state, result.leak);
  } else if (result.type !== "final") {
    throw new Error("Chat LLM requested tool calls while chat tools are disabled.");
  } else {
    state.coachReply = result.coachReply;
  }
}

function callFinalProvider(
  state: ChatLoopState,
  requiredActions: ChatLoopState["requiredActionLedger"]["actions"],
) {
  return callChatProviderOnce(
    state.provider,
    {
      ...state.baseCoachInput,
      workspaceContext: state.effectiveWorkspaceContext,
      messages: state.loopMessages,
      toolMode: "finalize_without_tools",
      requiredActions,
    },
    state.turn.traceContext,
  );
}

function recordProtocolViolation(
  state: ChatLoopState,
  leak: NonNullable<ChatLoopState["protocolViolation"]>,
) {
  state.protocolViolation = leak;
  state.requiredActionLedger = markPendingRequiredActionsUnfulfilled(
    state.requiredActionLedger,
    "protocol_violation",
    { locale: state.context.responseLanguage },
  );
  state.toolStopReason = "protocol_violation";
  state.coachReply = buildProtocolViolationReply(
    state.context.responseLanguage,
    state.toolTrace,
  );
}

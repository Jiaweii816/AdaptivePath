import { CHAT_MAX_TOOL_ITERATIONS } from "@/server/tools/chat-tools/chat-tool-contracts";
import {
  buildActionOutcomes,
  markPendingRequiredActionsUnfulfilled,
  pendingRequiredActions,
} from "@/server/tools/chat-tools/required-action-ledger";
import { buildActionOutcomeMarkdown } from "@/server/tools/chat-tools/action-outcome-presentation";
import { setTraceAgentIteration } from "@/server/llm/trace-context";
import type { CoachToolCall } from "./coach-agent.types";
import type { ChatLoopState } from "./chat-tool-loop-types";
import { callChatProviderOnce } from "./chat-provider-call";
import { buildCoachChatSystemPrompt } from "./build-chat-prompt";
import {
  buildProtocolViolationReply,
  buildToolBudgetReachedReply,
} from "./chat-provider-call";
import {
  denyUnavailableToolCalls,
  executeToolCalls,
} from "./chat-tool-execution";
import {
  deriveChatTurnToolPlan,
  inferNoAvailableToolReason,
  inferToolStopReason,
} from "./chat-tool-plan";

export async function runBoundedToolLoop(state: ChatLoopState) {
  let finalizationPending = CHAT_MAX_TOOL_ITERATIONS === 0;
  let batchOpportunityUsed = false;
  let toolLoopRounds = 0;
  let finalizationRecoveryUsed = false;
  if (finalizationPending) setRoundLimit(state);
  while (!state.coachReply) {
    if (finishPureDurableTurn(state)) break;
    let plan = buildPlan(state, finalizationPending, batchOpportunityUsed);
    state.requiredActionLedger = plan.ledger;
    if (!finalizationPending && plan.availableToolNames.size === 0) {
      finalizationPending = true;
      if (!completedHistoryRecall(state)) {
        state.toolBudgetReached = true;
        state.requiredActionLedger = markPendingRequiredActionsUnfulfilled(
          state.requiredActionLedger,
          inferNoAvailableToolReason(state.toolRuntime.snapshot()),
          { locale: state.context.responseLanguage },
        );
        state.toolStopReason = inferToolStopReason(
          state.toolRuntime.snapshot(),
        );
      }
      plan = buildPlan(state, true, batchOpportunityUsed);
    }
    setTraceAgentIteration(state.turn.traceContext, toolLoopRounds + 1);
    const result = await callLoopProvider(state, plan, finalizationPending);
    if (!finalizationPending) {
      batchOpportunityUsed = true;
      toolLoopRounds += 1;
    }
    const outcome = await handleProviderResult(state, result, {
      finalizationPending,
      finalizationRecoveryUsed,
      toolLoopRounds,
      plan,
    });
    finalizationPending = outcome.finalizationPending;
    finalizationRecoveryUsed = outcome.finalizationRecoveryUsed;
    if (outcome.breakLoop) break;
    if (result.type === "tool_calls" && !finalizationPending) {
      const toolCalls = collapseRepeatedHistoryCalls(result.toolCalls);
      state.toolIterations += 1;
      state.loopMessages.push({
        role: "assistant",
        content: result.assistantContent,
        toolCalls,
      });
      await executeProviderToolCalls(state, toolCalls);
    }
    if (toolLoopRounds >= CHAT_MAX_TOOL_ITERATIONS) {
      setRoundLimit(state);
      finalizationPending = true;
    } else if (
      state.requiredActionLedger.actions.length > 0 &&
      pendingRequiredActions(state.requiredActionLedger).length === 0
    ) {
      finalizationPending = !state.pureDurableActionTurn;
    }
  }
}

function finishPureDurableTurn(state: ChatLoopState) {
  if (
    state.requiredActionLedger.actions.length === 0 ||
    pendingRequiredActions(state.requiredActionLedger).length > 0 ||
    !state.pureDurableActionTurn
  )
    return false;
  state.actionOutcomes = [...buildActionOutcomes(state.requiredActionLedger)];
  state.coachReply = buildActionOutcomeMarkdown(
    state.actionOutcomes,
    state.context.responseLanguage,
  );
  state.actionOutcomeBlockAlreadyRendered = true;
  state.toolStopReason = "backend_action_outcomes";
  return true;
}

function buildPlan(
  state: ChatLoopState,
  finalizationPending: boolean,
  batchOpportunityUsed: boolean,
) {
  return deriveChatTurnToolPlan({
    mode: finalizationPending ? "finalize_without_tools" : "tool_loop",
    ledger: state.requiredActionLedger,
    runtimeSnapshot: state.toolRuntime.snapshot(),
    chatTurnPlan: state.finalContext.interactionState.turnPlan,
    batchOpportunityUsed,
    durableOnly: state.pureDurableActionTurn,
    explicitlyDeniedToolNames: state.explicitlyDeniedDurableTools,
    topologyToolOrder: state.topologyToolOrder,
    loadedToolNames: state.loadedToolNames,
  });
}

function callLoopProvider(
  state: ChatLoopState,
  plan: ReturnType<typeof buildPlan>,
  finalizationPending: boolean,
) {
  const tools = [...plan.manifest];
  const providerInput = {
    ...state.baseCoachInput,
    lastRunResult: state.context.lastRunResult,
    workspaceContext: state.effectiveWorkspaceContext,
    messages: state.loopMessages,
    tools: tools.length > 0 ? tools : undefined,
    toolMode: finalizationPending
      ? ("finalize_without_tools" as const)
      : ("tool_loop" as const),
    toolChoice:
      !finalizationPending && plan.toolChoice && plan.toolChoice !== "auto"
        ? plan.toolChoice
        : undefined,
    requiredActions: state.requiredActionLedger.actions,
  };
  if (!state.frozenSystemPrompt) {
    state.frozenSystemPrompt = buildCoachChatSystemPrompt(providerInput);
  }
  return callChatProviderOnce(
    state.provider,
    {
      ...providerInput,
      frozenSystemPrompt: state.frozenSystemPrompt,
    },
    state.turn.traceContext,
  ).catch((error) => {
    if (!finalizationPending) throw error;
    state.usedToolBudgetFallback = true;
    return {
      type: "final" as const,
      coachReply: buildToolBudgetReachedReply(state.context.responseLanguage),
    };
  });
}

type ProviderResult = Awaited<ReturnType<typeof callLoopProvider>>;

async function handleProviderResult(
  state: ChatLoopState,
  result: ProviderResult,
  flags: {
    finalizationPending: boolean;
    finalizationRecoveryUsed: boolean;
    toolLoopRounds: number;
    plan: ReturnType<typeof buildPlan>;
  },
) {
  if (result.type === "protocol_violation") {
    state.protocolViolation = result.leak;
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
    return { ...flags, breakLoop: true };
  }
  if (result.type === "final") {
    return handleFinalResult(state, result.coachReply, flags);
  }
  if (!flags.finalizationPending) return { ...flags, breakLoop: false };
  if (
    !flags.finalizationRecoveryUsed &&
    state.toolStopReason === "no_available_tools"
  ) {
    await denyUnavailableToolCalls(state, result.toolCalls);
    return { ...flags, finalizationRecoveryUsed: true, breakLoop: false };
  }
  state.usedToolBudgetFallback = true;
  state.coachReply = buildToolBudgetReachedReply(
    state.context.responseLanguage,
  );
  return { ...flags, breakLoop: true };
}

function handleFinalResult(
  state: ChatLoopState,
  coachReply: string,
  flags: Parameters<typeof handleProviderResult>[2],
) {
  if (
    !flags.finalizationPending &&
    pendingRequiredActions(state.requiredActionLedger).length > 0
  ) {
    const limitReached = flags.toolLoopRounds >= CHAT_MAX_TOOL_ITERATIONS;
    if (limitReached) {
      setRoundLimit(state);
      return { ...flags, finalizationPending: true, breakLoop: false };
    }
    return { ...flags, breakLoop: false };
  }
  state.coachReply = coachReply;
  return { ...flags, breakLoop: true };
}

async function executeProviderToolCalls(
  state: ChatLoopState,
  toolCalls: readonly Parameters<typeof executeToolCalls>[1][number][],
) {
  for (const toolCall of toolCalls) {
    const plan = deriveChatTurnToolPlan({
      mode: "tool_loop",
      ledger: state.requiredActionLedger,
      runtimeSnapshot: state.toolRuntime.snapshot(),
      chatTurnPlan: state.finalContext.interactionState.turnPlan,
      batchOpportunityUsed: true,
      durableOnly: state.pureDurableActionTurn,
      explicitlyDeniedToolNames: state.explicitlyDeniedDurableTools,
      topologyToolOrder: state.topologyToolOrder,
      loadedToolNames: state.loadedToolNames,
    });
    state.requiredActionLedger = plan.ledger;
    await executeToolCalls(state, [toolCall], plan);
  }
}

function completedHistoryRecall(state: ChatLoopState) {
  const capabilities =
    state.finalContext.interactionState.turnPlan.toolCapabilities;
  if (capabilities.length === 0 || !capabilities.every(isHistoryRecallTool)) {
    return false;
  }
  const snapshot = state.toolRuntime.snapshot();
  return capabilities.every(
    (name) => (snapshot.perToolExecutions[name] ?? 0) >= 1,
  );
}

function isHistoryRecallTool(
  name: string,
): name is
  "past_problem_recall" | "past_mistake_recall" | "recall_learning_experience" {
  return (
    name === "past_problem_recall" ||
    name === "past_mistake_recall" ||
    name === "recall_learning_experience"
  );
}

function collapseRepeatedHistoryCalls(toolCalls: readonly CoachToolCall[]) {
  const seen = new Set<
    "past_problem_recall" | "past_mistake_recall" | "recall_learning_experience"
  >();
  return toolCalls.filter((toolCall) => {
    if (!isHistoryRecallTool(toolCall.name)) return true;
    if (seen.has(toolCall.name)) return false;
    seen.add(toolCall.name);
    return true;
  });
}

function setRoundLimit(state: ChatLoopState) {
  state.toolBudgetReached = true;
  if (pendingRequiredActions(state.requiredActionLedger).length > 0) {
    state.requiredActionLedger = markPendingRequiredActionsUnfulfilled(
      state.requiredActionLedger,
      "round_limit",
      { locale: state.context.responseLanguage },
    );
  }
  state.toolStopReason = "round_limit";
}

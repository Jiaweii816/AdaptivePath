import { hashSelectedTestSuite } from "@/server/code/code-hash";
import { createChatToolRuntime } from "@/server/tools/chat-tools/chat-tool-runtime";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import type { RequestedAction } from "@/server/tools/chat-tools/requested-actions";
import {
  buildActionOutcomes,
  createRequiredActionLedger,
  markPendingRequiredActionsUnfulfilled,
  pendingRequiredActions,
} from "@/server/tools/chat-tools/required-action-ledger";
import { buildActionOutcomeMarkdown } from "@/server/tools/chat-tools/action-outcome-presentation";
import {
  detectDeepReasoningRequest,
  detectVisibleSelfCorrectionMarker,
} from "./chat-intent-policy";
import {
  buildCoachProblemContext,
  buildCoachUserContext,
} from "./review-pipeline";
import { getCoachProvider } from "./coach-provider";
import type { BootstrappedChatTurn } from "./chat-turn-bootstrap";
import type {
  FinalChatTurnContext,
  LoadedChatTurnContext,
} from "./chat-turn-context";
import { appendRequestedActionResolverTrace } from "./chat-tool-plan";
import { detectStepwiseExecutionWording } from "./chat-tool-plan";
import { runNonLoopMode } from "./chat-tool-loop-modes";
import { runBoundedToolLoop } from "./chat-bounded-tool-loop";
import type { ChatLoopResult, ChatLoopState } from "./chat-tool-loop-types";
import { guardChatReply } from "./chat-reply-guards";
import type { GuardChatReplyArgs } from "./chat-reply-guards";
import { deriveHistoryRecallScope } from "./history-recall-scope-guard";
import { deriveHistoryRecallScopeV2 } from "./turn-understanding-v2/history-recall-scope-v2";
import { toolOrderFromTopology } from "./turn-understanding-v2/request-topology";
import {
  operationalPreconditionForRecall,
  recallOperationalNotes,
} from "@/server/memory/operational-memory";
import { buildTurnCapabilityPolicy } from "./turn-capability-policy";
import { planChatCapabilities } from "./capability-planner";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";

export async function runChatToolLoop(args: {
  turn: BootstrappedChatTurn;
  context: LoadedChatTurnContext;
  finalContext: FinalChatTurnContext;
  userMessage: { id: string; sequence: number };
}) {
  const state = await initializeLoopState(args);
  const handled = await runNonLoopMode(state);
  if (!handled) await runBoundedToolLoop(state);
  finalizeRequiredActions(state);
  ensureFinalReply(state);
  return projectLoopResult(state);
}

async function initializeLoopState(
  args: Parameters<typeof runChatToolLoop>[0],
): Promise<ChatLoopState> {
  const { turn, context, finalContext } = args;
  const granted = context.requestedActions.filter(
    (action) => action.decision === "granted",
  );
  const denied = new Set<ChatToolName>(
    context.requestedActions
      .filter((action) => action.decision === "denied")
      .map((action) => action.toolName),
  );
  const ledger = createRequiredActionLedgerFromTopology(
    context.turnUnderstandingV2.requests,
    granted,
  );
  const capabilityPolicy = buildTurnCapabilityPolicy({
    understanding: context.turnUnderstandingV2,
    requestedActions: context.requestedActions,
    message: turn.input.message,
    resources: {
      userId: turn.user.id,
      problemId: turn.problem.id,
      chatSessionId: turn.chatSession.id,
      memoryOrigin: turn.traceContext.memoryOrigin ?? "legacy_unknown",
      currentCodeHash: finalContext.workspaceContext.currentCodeHash,
    },
  });
  const capabilityPlan = planChatCapabilities({
    understanding: context.turnUnderstandingV2,
    policy: capabilityPolicy,
    message: turn.input.message,
    hasCurrentProblem: Boolean(turn.problem.id),
    hasProblemTags: turn.problemTags.length > 0,
    hasApiTopic: /(?:api|syntax|语法|deque|library)/iu.test(turn.input.message),
  });
  await appendTraceEventBestEffort(turn.traceContext, {
    stage: "tool_governance",
    kind: "guard",
    title: "Plan initial Chat capability exposure",
    status: "succeeded",
    details: { output: { intent: { requests: context.turnUnderstandingV2.requests, hardDenies: capabilityPolicy.hardDenies }, policy: { explicitGrants: capabilityPolicy.explicitGrants, resourceScope: capabilityPolicy.resources }, planner: capabilityPlan } },
  });
  await appendRequestedActionResolverTrace(turn.traceContext, {
    requestedActions: context.requestedActions,
  });
  const toolRuntime = createRuntime(args);
  const operationalNotes = await recallOperationalNotes({
    prisma: turn.db,
    memoryOrigin: turn.traceContext.memoryOrigin ?? "legacy_unknown",
    candidateTools: finalContext.interactionState.turnPlan.toolCapabilities,
    precondition: operationalPreconditionForRecall({
      selectedSuiteHasVisibleTests: finalContext.workspaceContext.selectedTests.length > 0,
      providerOverride: process.env.CODE_RUNNER_PROVIDER,
    }),
    traceContext: turn.traceContext,
  });
  const executionRequested = hasExecutionCapability(
    finalContext.interactionState.turnPlan.toolCapabilities,
  );
  const deepReasoning =
    ledger.actions.length === 0 &&
    detectDeepReasoningRequest(turn.input.message) &&
    isDeepReasoningOnlyTurn(context, finalContext.interactionState.policy.intent) &&
    !executionRequested &&
    !detectStepwiseExecutionWording(turn.input.message);
  return {
    ...args,
    provider: turn.deps.coachProvider ?? getCoachProvider(),
    loopMessages: [
      ...context.historyProjection.messages,
      { role: "user", content: turn.input.message },
    ],
    toolTrace: [],
    toolIterations: 0,
    toolBudgetReached: false,
    effectiveWorkspaceContext: finalContext.workspaceContext,
    explicitlyDeniedDurableTools: denied,
    topologyToolOrder: toolOrderFromTopology(context.turnUnderstandingV2.requests),
    requiredActionLedger: ledger,
    toolRuntime,
    loadedToolNames: new Set(capabilityPlan.initialLoadedTools),
    capabilityPolicy,
    capabilityPlan,
    discoveryCalls: 0,
    deepReasoning,
    baseCoachInput: {
      problem: buildCoachProblemContext(turn.problem, turn.problemTags),
      user: buildCoachUserContext(turn.profile),
      memory: finalContext.memory,
      sessionPlan: context.sessionPlan,
      lastRunResult: context.lastRunResult,
      interactionState: finalContext.interactionState,
      turnUnderstanding: context.understanding,
      ...(context.consumeTurnUnderstandingV2
        ? { turnUnderstandingV2: context.turnUnderstandingV2 }
        : {}),
      ...(context.campaignCoaching
        ? { campaignCoaching: context.campaignCoaching }
        : {}),
      workspaceContext: finalContext.workspaceContext,
      responseLanguage: context.responseLanguage,
      traceContext: turn.traceContext,
      operationalNotes,
    },
    coachReply: undefined,
    usedToolBudgetFallback: false,
    protocolViolation: undefined,
    actionOutcomes: [],
    toolStopReason: "final_reply",
    actionOutcomeBlockAlreadyRendered: false,
    // Legacy/V2 intent eligibility is only an optional-scoring input.  It
    // must not bypass governance after the planner has pinned discovery (and
    // normally learning-experience recall) for this model call.
    noToolTurn:
      capabilityPlan.initialLoadedTools.length === 0 &&
      ledger.actions.length === 0,
    pureDurableActionTurn: context.pureDurableActionTurn,
  };
}

/** Required durable actions inherit the canonical V2 dependency schedule. */
export function createRequiredActionLedgerFromTopology(
  requests: Parameters<typeof toolOrderFromTopology>[0],
  granted: readonly RequestedAction[],
) {
  const topologyOrder = toolOrderFromTopology(requests);
  return createRequiredActionLedger(
    granted.map((action) => ({
      toolName: action.toolName,
      order: topologyOrder.get(action.toolName) ?? action.order,
      evidence: action.evidence,
    })),
  );
}

function createRuntime(args: Parameters<typeof runChatToolLoop>[0]) {
  const { turn, context, finalContext } = args;
  const workspace = finalContext.workspaceContext;
  return createChatToolRuntime({
    policy: {
      explicitExecutionRequested:
        hasExecutionCapability(
          finalContext.interactionState.turnPlan.toolCapabilities,
        ),
      workspaceIdentity: {
        problemId: turn.problem.id,
        language: workspace.language,
        codeHash: workspace.currentCodeHash,
        executionFingerprint: workspace.currentExecutionFingerprint,
        selectedSuiteFingerprint: hashSelectedTestSuite(
          workspace.selectedTests.map((test) => test.id),
        ),
      },
      authoritativeSelectedSuite: context.latestRunEvidenceContext
        ? {
            codeHash: context.latestRunEvidenceContext.codeHash,
            executionFingerprint:
              context.latestRunEvidenceContext.executionFingerprint,
            suiteFingerprint: context.latestRunEvidenceContext.suiteFingerprint,
            canVerdict:
              context.latestRunEvidenceContext.evidenceVerdict?.capabilities
                .canVerdict === true,
          }
        : undefined,
    },
  });
}

function isDeepReasoningOnlyTurn(
  context: LoadedChatTurnContext,
  legacyIntent: string,
) {
  if (!context.consumeTurnUnderstandingV2) {
    return legacyIntent === "concept_question" || legacyIntent === "general_followup";
  }
  const requests = context.turnUnderstandingV2.requests;
  return (
    requests.length > 0 &&
    requests.every(
      (request) =>
        request.kind === "respond" &&
        (request.deliverable === "understand" || request.deliverable === "chat") &&
        request.target !== "api",
    )
  );
}

function finalizeRequiredActions(state: ChatLoopState) {
  if (pendingRequiredActions(state.requiredActionLedger).length > 0) {
    state.requiredActionLedger = markPendingRequiredActionsUnfulfilled(
      state.requiredActionLedger,
      "provider_failure",
      { locale: state.context.responseLanguage },
    );
  }
  if (state.actionOutcomeBlockAlreadyRendered ||
      state.requiredActionLedger.actions.length === 0) return;
  const required = [...buildActionOutcomes(state.requiredActionLedger)];
  const names = new Set(required.map((outcome) => outcome.toolName));
  state.actionOutcomes = [
    ...required,
    ...state.actionOutcomes.filter((outcome) => !names.has(outcome.toolName)),
  ];
}

function ensureFinalReply(state: ChatLoopState) {
  if (state.coachReply) return;
  if (state.actionOutcomes.length === 0) {
    throw new Error("Chat LLM did not return a final reply.");
  }
  state.coachReply = buildActionOutcomeMarkdown(
    state.actionOutcomes,
    state.context.responseLanguage,
  );
  state.actionOutcomeBlockAlreadyRendered = true;
  state.toolStopReason = "backend_action_outcomes";
}

function projectLoopResult(state: ChatLoopState): ChatLoopResult {
  return {
    coachReply: state.coachReply!,
    toolTrace: state.toolTrace,
    toolIterations: state.toolIterations,
    toolBudgetReached: state.toolBudgetReached,
    effectiveWorkspaceContext: state.effectiveWorkspaceContext,
    requiredActionLedger: state.requiredActionLedger,
    toolRuntime: state.toolRuntime,
    deepReasoning: state.deepReasoning,
    usedToolBudgetFallback: state.usedToolBudgetFallback,
    protocolViolation: state.protocolViolation,
    actionOutcomes: state.actionOutcomes,
    toolStopReason: state.toolStopReason,
    actionOutcomeBlockAlreadyRendered: state.actionOutcomeBlockAlreadyRendered,
    selfCorrectionMarkerDetected:
      state.deepReasoning && detectVisibleSelfCorrectionMarker(state.coachReply!),
    requiredActionProjection: state.requiredActionLedger.actions.map(
      ({ toolName, order, status, terminalReason }) => ({
        toolName,
        order,
        status,
        terminalReason: terminalReason ?? null,
      }),
    ),
  };
}

export async function guardChatToolLoopResult(args: {
  turn: BootstrappedChatTurn;
  context: LoadedChatTurnContext;
  finalContext: FinalChatTurnContext;
  loop: ChatLoopResult;
}) {
  return guardChatReply({
    coachReply: args.loop.coachReply,
    recallScope: args.context.consumeTurnUnderstandingV2
      ? deriveHistoryRecallScopeV2(args.context.turnUnderstandingV2)
      : deriveHistoryRecallScope(args.context.understanding),
    responseLanguage: args.context.responseLanguage,
    toolTrace: args.loop.toolTrace,
    workspaceContext: args.loop.effectiveWorkspaceContext,
    actionOutcomes: args.loop.actionOutcomes,
    actionOutcomeBlockAlreadyRendered: args.loop.actionOutcomeBlockAlreadyRendered,
    deepReasoning: args.loop.deepReasoning,
    traceContext: args.turn.traceContext,
    chatSessionId: args.turn.chatSession.id,
    protocolViolation: args.loop.protocolViolation,
    toolStopReason: args.loop.toolStopReason,
    usedToolBudgetFallback: args.loop.usedToolBudgetFallback,
    toolBudgetReached: args.loop.toolBudgetReached,
    campaignCoaching: args.context.campaignCoaching,
    pendingPersists: args.context.pendingPersists,
    pendingConfirmation: args.context.pendingConfirmation,
  });
}

function hasExecutionCapability(
  capabilities: readonly ChatToolName[],
): boolean {
  return capabilities.some(
    (name) => name === "run_current_code" || name === "verify_proposed_repair",
  );
}

export type { ChatLoopResult } from "./chat-tool-loop-types";
export type GuardedChatReply = Awaited<ReturnType<typeof guardChatToolLoopResult>>;
export type { GuardChatReplyArgs };

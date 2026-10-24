import { startTraceStep } from "@/server/llm/trace-context";
import { isDurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";
import { evaluateDurableWriteResult } from "@/server/tools/chat-tools/durable-write-result-semantics";
import {
  markRequiredActionFailed,
  markRequiredActionUnfulfilled,
  recordRequiredActionResult,
} from "@/server/tools/chat-tools/required-action-ledger";
import type { CoachToolCall, InternalRunEvidenceEnvelope } from "./coach-agent.types";
import type { ChatLoopState } from "./chat-tool-loop-types";
import {
  durableFailureReasonFromRuntimeError,
  hasPendingRequiredAction,
  runtimeDenialToUnfulfilledReason,
} from "./chat-tool-plan";
import {
  buildToolObservationForLlm,
  readRunToolContext,
} from "./chat-tool-observation";
import { appendToolResultTrace } from "./chat-tool-runtime-trace";
import {
  classifyOperationalOutcome,
  operationalPreconditionForResult,
  OPERATIONAL_CONTRACT_VERSION,
} from "@/server/memory/operational-memory";

type RuntimeDecision = Awaited<
  ReturnType<ChatLoopState["toolRuntime"]["invoke"]>
>;

export async function handleToolRuntimeDecision(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  decision: RuntimeDecision,
  step: ReturnType<typeof startTraceStep>,
  latencyMs: number,
) {
  if (decision.disposition === "denied" || decision.disposition === "error") {
    await handleRuntimeFailure(state, toolCall, decision, step, latencyMs);
  } else {
    await handleRuntimeSuccess(state, toolCall, decision, step, latencyMs);
  }
}

async function handleRuntimeFailure(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  decision: Extract<RuntimeDecision, { disposition: "denied" | "error" }>,
  step: ReturnType<typeof startTraceStep>,
  latencyMs: number,
) {
  updateFailureLedger(state, decision);
  await appendToolResultTrace({
    ...traceArgs(state, toolCall, step),
    toolName: decision.name,
    toolResult: decision.observation,
    status: decision.disposition,
    latencyMs,
    error: decision.disposition === "error" ? decision.error : undefined,
    runtimeDisposition: decision.disposition,
    runtimeReason: decision.observation.reason,
  });
  pushObservation(state, toolCall.id, decision.name, decision.observation);
}

function operationalTraceMetadata(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  toolName: string,
  result: unknown,
  disposition: "executed" | "reused",
) {
  if (disposition !== "executed") return {};
  const precondition = operationalPreconditionForResult({
    toolName,
    toolArguments: toolCall.arguments,
    result,
    selectedSuiteHasVisibleTests: state.finalContext.workspaceContext.selectedTests.length > 0,
  });
  if (!precondition) return {};
  return {
    outcomeUtility: classifyOperationalOutcome(toolName, result),
    operationalPreconditionJson: JSON.stringify(precondition),
    operationalContractVersion: OPERATIONAL_CONTRACT_VERSION,
  } as const;
}

function updateFailureLedger(
  state: ChatLoopState,
  decision: Extract<RuntimeDecision, { disposition: "denied" | "error" }>,
) {
  if (!isDurableWriteToolName(decision.name) ||
      !hasPendingRequiredAction(state.requiredActionLedger, decision.name)) return;
  state.requiredActionLedger = decision.disposition === "error"
    ? markRequiredActionFailed(
        state.requiredActionLedger,
        decision.name,
        durableFailureReasonFromRuntimeError(decision.error),
        { locale: state.context.responseLanguage },
      )
    : markRequiredActionUnfulfilled(
        state.requiredActionLedger,
        decision.name,
        runtimeDenialToUnfulfilledReason(decision.observation.reason),
        { locale: state.context.responseLanguage },
      );
}

async function handleRuntimeSuccess(
  state: ChatLoopState,
  toolCall: CoachToolCall,
  decision: Extract<RuntimeDecision, { disposition: "executed" | "reused" }>,
  step: ReturnType<typeof startTraceStep>,
  latencyMs: number,
) {
  updateSuccessLedger(state, decision.name, decision.result);
  if (decision.disposition === "executed") updateWorkspaceRun(state, decision.result);
  const projected = buildToolObservationForLlm(decision.name, decision.result);
  const content = reusedObservation(decision, projected);
  await appendToolResultTrace({
    ...traceArgs(state, toolCall, step),
    toolName: decision.name,
    toolResult: decision.result,
    status: decision.disposition === "reused" ? "reused" : "ok",
    latencyMs,
    runtimeDisposition: decision.disposition,
    ...operationalTraceMetadata(state, toolCall, decision.name, decision.result, decision.disposition),
  });
  pushObservation(state, toolCall.id, decision.name, JSON.parse(content));
  state.toolTrace.push({
    toolCallId: toolCall.id,
    name: decision.name,
    result: decision.result,
    disposition: decision.disposition,
  });
}

function updateSuccessLedger(
  state: ChatLoopState,
  toolName: ChatLoopState["toolTrace"][number]["name"],
  result: unknown,
) {
  if (isDurableWriteToolName(toolName) &&
      hasPendingRequiredAction(state.requiredActionLedger, toolName)) {
    state.requiredActionLedger = recordRequiredActionResult(
      state.requiredActionLedger,
      toolName,
      result,
      { locale: state.context.responseLanguage },
    );
  } else if (isDurableWriteToolName(toolName)) {
    const outcome = evaluateDurableWriteResult(toolName, result, {
      locale: state.context.responseLanguage,
    }).outcome;
    state.actionOutcomes = [
      ...state.actionOutcomes.filter((item) => item.toolName !== toolName),
      outcome,
    ];
  }
}

function updateWorkspaceRun(state: ChatLoopState, result: unknown) {
  const run = readRunToolContext(result);
  if (!run) return;
  const observation: InternalRunEvidenceEnvelope = {
    id: run.runEvidenceId,
    storageSource: run.codeOrigin === "assistant_candidate"
      ? "chat_candidate_tool"
      : "chat_current_tool",
    producer: run.producer,
    subject: run.subject,
    authority: run.authority,
    scope: run.scope,
    oracle: run.oracle,
    createdAt: new Date().toISOString(),
    codeHash: run.executedCodeHash ?? run.codeHash ?? null,
    executionFingerprint: run.executionFingerprint ?? null,
    result: run.result,
    evidenceVerdict: run.evidenceVerdict,
    reviewAttemptId: run.reviewAttemptId ?? null,
    candidateDescription: run.candidateDescription,
  };
  state.effectiveWorkspaceContext = {
    ...state.effectiveWorkspaceContext,
    currentTurnRunObservations: [
      ...state.effectiveWorkspaceContext.currentTurnRunObservations,
      observation,
    ],
  };
}

function reusedObservation(
  decision: Extract<RuntimeDecision, { disposition: "executed" | "reused" }>,
  projected: unknown,
) {
  return JSON.stringify(decision.disposition === "reused" ? {
    observationKind: "chat_tool_runtime_reuse",
    disposition: "reused",
    toolName: decision.name,
    reusedFromToolCallId: decision.reusedFromToolCallId,
    result: projected,
    modelInstruction: "Use the prior observation; this identical call was not executed again.",
  } : projected);
}

function pushObservation(
  state: ChatLoopState,
  toolCallId: string,
  name: string,
  observation: unknown,
) {
  state.loopMessages.push({
    role: "tool",
    toolCallId,
    name,
    content: typeof observation === "string" ? observation : JSON.stringify(observation),
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

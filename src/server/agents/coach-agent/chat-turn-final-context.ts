import {
  appendTraceEventBestEffort,
  startTraceStep,
} from "@/server/llm/trace-context";
import { buildChatInteractionState } from "./chat-intent-policy";
import {
  buildCurrentWorkspaceContext,
  buildWorkspaceMetadata,
} from "./current-workspace-context";
import { buildCoachUserContext } from "./review-pipeline";
import type { BootstrappedChatTurn } from "./chat-turn-bootstrap";
import type { LoadedChatTurnContext } from "./chat-turn-context";

export async function finalizeChatTurnContext(
  turn: BootstrappedChatTurn,
  context: LoadedChatTurnContext,
) {
  const memory = context.baseMemory;
  const interactionState = buildChatInteractionState({
    intentMatch: context.intentMatch,
    turnPlan: context.chatTurnPlan,
    userMessage: turn.input.message,
    problemTags: turn.problemTags,
    memory,
    lastRunResult: context.lastRunResult,
    reviewContext: context.latestReviewContext,
    currentHintLevel: context.currentHintLevel,
  });
  const workspaceContext = buildCurrentWorkspaceContext({
    problem: problemView(turn),
    language: turn.input.language,
    code: turn.input.code,
    selectedTests: turn.selectedTestCases,
    latestAuthoritativeRunEvidence: context.latestRunEvidenceContext,
    latestReviewContext: context.latestReviewContext,
    memory,
    user: buildCoachUserContext(turn.profile),
    sessionPlan: context.sessionPlan,
  });
  await tracePolicy(turn, context, interactionState, workspaceContext);
  return { memory, interactionState, workspaceContext };
}

async function tracePolicy(
  turn: BootstrappedChatTurn,
  context: LoadedChatTurnContext,
  interactionState: ReturnType<typeof buildChatInteractionState>,
  workspaceContext: ReturnType<typeof buildCurrentWorkspaceContext>,
) {
  const step = startTraceStep(turn.traceContext, { spanKind: "guard" });
  await appendTraceEventBestEffort(turn.traceContext, {
    step,
    stage: "intent_policy",
    kind: "guard",
    title: "Deterministic intent and coaching policy",
    status: "succeeded",
    details: {
      input: { message: turn.input.message, intentMatch: context.intentMatch },
      output: {
        turnPlan: interactionState.turnPlan,
        policy: interactionState.policy,
        teachingState: interactionState.teachingState,
        campaignPolicy: context.campaignCoaching?.policy ?? null,
      },
      stateDelta: { workspace: buildWorkspaceMetadata(workspaceContext) },
      metadata: {
        source: "chat_reply",
        chatSessionId: turn.chatSession.id,
        deterministic: true,
        campaignRole: context.campaignCoaching?.slotRole ?? null,
        coachingMode:
          context.campaignCoaching?.policy.coachingMode ?? "ordinary",
        autoMemoryCueBudget:
          context.campaignCoaching?.policy
            .automaticTechnicalMemoryCueBudget ?? 2,
        explicitDisclosureOverride:
          context.campaignCoaching?.policy.explicitDisclosureOverride ?? false,
        policyFingerprint:
          context.campaignCoaching?.policy.fingerprint ?? null,
      },
    },
  });
}

function problemView(turn: BootstrappedChatTurn) {
  return {
    slug: turn.problem.slug,
    title: turn.problem.title,
    leetcodeNumber: turn.problem.leetcodeNumber,
    tags: turn.problemTags,
    methodName: turn.problem.methodName,
    statementMarkdown: turn.problem.statementMarkdown,
    examples: parseProblemCardList(turn.problem.examplesJson),
    constraints: parseProblemCardList(turn.problem.constraintsJson),
  };
}

function parseProblemCardList(value: string): readonly unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type FinalChatTurnContext = Awaited<
  ReturnType<typeof finalizeChatTurnContext>
>;

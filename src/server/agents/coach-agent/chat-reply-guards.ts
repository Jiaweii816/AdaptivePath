import {
  buildNonVerdictSafetyReply,
  shouldReplaceNonVerdictReply,
} from "@/lib/evidence-trust";
import {
  appendTraceEventBestEffort,
  startTraceStep,
} from "@/server/llm/trace-context";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  appendActionOutcomeMarkdown,
  replaceConflictingDurableOutcomeClaims,
} from "@/server/tools/chat-tools/action-outcome-presentation";
import type { ActionOutcome } from "@/server/tools/chat-tools/durable-write-result-semantics";
import type { SafeProtocolLeakSummary } from "@/server/llm/tool-protocol-leak";
import { detectVisibleSelfCorrectionMarker } from "./chat-intent-policy";
import {
  appendModelPersistConfirmation,
  appendModelPersistResolution,
  type ModelPersistConfirmation,
} from "./model-persist-confirmation";
import type { DurableWriteToolName } from "@/server/tools/chat-tools/durable-write-types";
import {
  guardHistoryRecallScopeClaims,
  type HistoryRecallScope,
} from "./history-recall-scope-guard";
import { buildHistoryRecallApplicationTrace } from "./history-recall-application-trace";
import {
  applyProductInvariantGuard,
  buildProductInvariantGuardFacts,
} from "./product-invariant-guard";
import type {
  CurrentWorkspaceContext,
} from "./coach-agent.types";
import type {
  ChatReplyResult,
  ChatToolStopReason,
} from "./chat-reply-contracts";
import { appendReplySafetyTrace } from "./chat-provider-call";
import { latestNonVerdictRunToolResult } from "./chat-tool-observation";
import {
  applyCampaignPolicyGuard,
  type CampaignCoachingContext,
} from "@/server/campaign/coaching";

export type GuardChatReplyArgs = {
  coachReply: string;
  recallScope: HistoryRecallScope;
  responseLanguage: "zh" | "en";
  toolTrace: ChatReplyResult["toolTrace"];
  workspaceContext: CurrentWorkspaceContext;
  actionOutcomes: ActionOutcome[];
  actionOutcomeBlockAlreadyRendered: boolean;
  deepReasoning: boolean;
  traceContext: TraceContext;
  chatSessionId: string;
  protocolViolation?: SafeProtocolLeakSummary;
  toolStopReason: ChatToolStopReason;
  usedToolBudgetFallback: boolean;
  toolBudgetReached: boolean;
  campaignCoaching?: CampaignCoachingContext | null;
  pendingPersists: readonly DurableWriteToolName[];
  pendingConfirmation: ModelPersistConfirmation;
};

export type ProductInvariantGuardMode = "observe" | "enforce";

/**
 * Product-invariant detection stays observable while enforcement is paused.
 * This is intentionally fail-open for Coach reply rendering until the
 * selected-suite/advisory evidence contract is repaired.
 */
export function resolveProductInvariantGuardMode(
  env: NodeJS.ProcessEnv = process.env,
): ProductInvariantGuardMode {
  return env.CHAT_PRODUCT_INVARIANT_GUARD_MODE === "enforce"
    ? "enforce"
    : "observe";
}

export async function guardChatReply(args: GuardChatReplyArgs) {
  const rawLlmCoachReply = args.coachReply;
  const state = { reply: args.coachReply, applied: [] as string[] };
  await applyOperationalNoteLeakGuard(args, state);
  await applyNonVerdictGuard(args, state);
  await applyHistoryRecallScopeGuard(args, state);
  const productInvariantGuard = await applyInvariantGuard(args, state, rawLlmCoachReply);
  const campaignPolicyGuard = await applyCampaignGuard(args, state);
  await applyDurableClaimGuard(args, state);
  state.reply = appendModelPersistConfirmation(
    state.reply, args.pendingPersists, args.responseLanguage,
  );
  state.reply = appendModelPersistResolution(
    state.reply, args.pendingConfirmation.resolution, args.responseLanguage,
  );
  await appendVisibleReplyTrace(
    args,
    state,
    rawLlmCoachReply,
    campaignPolicyGuard,
  );
  return {
    coachReply: state.reply,
    actionOutcomeBlockAlreadyRendered:
      args.actionOutcomeBlockAlreadyRendered || args.actionOutcomes.length > 0,
    productInvariantGuardMetadata: {
      version: productInvariantGuard.version,
      mode: productInvariantGuard.mode,
      replaced: productInvariantGuard.replaced,
      strategy: productInvariantGuard.strategy,
      reasonCodes: productInvariantGuard.violations.map(
        (violation) => violation.invariantId,
      ),
    },
    campaignPolicyGuardMetadata: campaignPolicyGuard,
  };
}

type GuardState = { reply: string; applied: string[] };

/** The internal aggregate caveat is an instruction, never learner-facing evidence. */
async function applyOperationalNoteLeakGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
) {
  if (!/\[OPERATIONAL NOTES|operational notes\s*[—-]\s*internal/i.test(state.reply)) return;
  const originalReply = state.reply;
  state.reply = state.reply
    .replace(/\[OPERATIONAL NOTES[^\n]*\][\s\S]*?(?=\n\n|$)/gi, "")
    .trim();
  await traceReplacement(args, "operational_note_leak", originalReply, state.reply, {
    guard: "operational_note_leak",
  });
  state.applied.push("operational_note_leak");
}

async function applyCampaignGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
) {
  const guard = applyCampaignPolicyGuard({
    reply: state.reply,
    responseLanguage: args.responseLanguage,
    context: args.campaignCoaching ?? null,
    problemMethodName: args.workspaceContext.problem.methodName,
  });
  if (guard.replaced || guard.prependedWarning) {
    const originalReply = state.reply;
    state.reply = guard.reply;
    await traceReplacement(
      args,
      guard.reason === "none" ? "campaign_probe_warning" : guard.reason,
      originalReply,
      state.reply,
      {
        guard: "campaign_policy",
        guardVersion: guard.version,
        campaignRole: args.campaignCoaching?.slotRole ?? null,
        coachingMode:
          args.campaignCoaching?.policy.coachingMode ?? "ordinary",
        policyFingerprint:
          args.campaignCoaching?.policy.fingerprint ?? null,
      },
    );
    state.applied.push(
      guard.reason === "none" ? "campaign_probe_warning" : guard.reason,
    );
  }
  return guard;
}

async function applyHistoryRecallScopeGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
) {
  const guarded = guardHistoryRecallScopeClaims({
    reply: state.reply,
    responseLanguage: args.responseLanguage,
    toolTrace: args.toolTrace,
    recallScope: args.recallScope,
  });
  if (!guarded.replaced) return;
  const originalReply = state.reply;
  state.reply = guarded.reply;
  await traceReplacement(
    args,
    "history_recall_scope_claim",
    originalReply,
    state.reply,
    { historyItemCount: guarded.itemCount },
  );
  state.applied.push("history_recall_scope_claim");
}

async function applyNonVerdictGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
) {
  const observation = latestNonVerdictRunToolResult(args.toolTrace);
  if (!shouldReplaceNonVerdictReply({
    verdict: observation?.evidenceVerdict,
    markdown: state.reply,
  })) return;
  const originalReply = state.reply;
  state.reply = buildNonVerdictSafetyReply(
    args.responseLanguage,
    observation?.evidenceVerdict,
  );
  await traceReplacement(args, "non_verdict_claim", originalReply, state.reply, {
    evidenceVerdict: observation?.evidenceVerdict,
  });
  state.applied.push("non_verdict_claim");
}

async function applyInvariantGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
  rawLlmReply: string,
) {
  const guard = applyProductInvariantGuard({
    reply: state.reply,
    responseLanguage: args.responseLanguage,
    facts: buildProductInvariantGuardFacts(args.workspaceContext),
  });
  const mode = resolveProductInvariantGuardMode();
  if (!guard.replaced) return { ...guard, mode };
  const requiresSubjectEnforcement = guard.violations.some(
    (violation) => violation.invariantId === "candidate_run_as_current_code",
  );
  if (mode === "observe" && !requiresSubjectEnforcement) {
    await traceProductInvariantObservation(args, guard, rawLlmReply, state.reply);
    state.applied.push("product_invariant_observed");
    return {
      ...guard,
      mode,
      reply: state.reply,
      replaced: false,
      strategy: "observe_only" as const,
    };
  }
  const originalReply = state.reply;
  state.reply = guard.reply;
  await traceReplacement(args, "product_invariant", originalReply, state.reply, {
    guard: "product_invariant",
    guardVersion: guard.version,
    strategy: guard.strategy,
    reasonCodes: guard.violations.map((violation) => violation.invariantId),
    patternIds: guard.violations.flatMap((violation) => violation.patternIds),
    evidenceSnapshot: guard.evidenceSnapshot,
    rawLlmReply,
  });
  state.applied.push("product_invariant");
  return { ...guard, mode };
}

async function traceProductInvariantObservation(
  args: GuardChatReplyArgs,
  guard: ReturnType<typeof applyProductInvariantGuard>,
  rawLlmReply: string,
  visibleReply: string,
) {
  const step = startTraceStep(args.traceContext, {
    spanKind: "guard",
    parentStepId: args.traceContext.latestLlmStepId,
  });
  await appendTraceEventBestEffort(args.traceContext, {
    step,
    stage: "guard_visible_reply",
    kind: "guard",
    title: "Reply safety observation · product invariant",
    status: "succeeded",
    details: {
      input: { rawLlmReply },
      output: { visibleReplyUnchanged: visibleReply },
      metadata: {
        source: "chat_reply",
        chatSessionId: args.chatSessionId,
        guard: "product_invariant",
        guardVersion: guard.version,
        mode: "observe",
        wouldReplace: true,
        proposedStrategy: guard.strategy,
        proposedReplacement: guard.reply,
        reasonCodes: guard.violations.map((violation) => violation.invariantId),
        patternIds: guard.violations.flatMap((violation) => violation.patternIds),
        evidenceSnapshot: guard.evidenceSnapshot,
      },
    },
  });
}

async function applyDurableClaimGuard(
  args: GuardChatReplyArgs,
  state: GuardState,
) {
  if (args.actionOutcomeBlockAlreadyRendered) return;
  const guard = replaceConflictingDurableOutcomeClaims(
    state.reply,
    args.actionOutcomes,
    args.responseLanguage,
  );
  if (guard.replaced) {
    const originalReply = state.reply;
    state.reply = guard.markdown;
    await traceReplacement(args, "durable_action_claim", originalReply, state.reply, {
      actionOutcomes: args.actionOutcomes,
      authority: "backend",
    });
    state.applied.push("durable_action_claim");
  }
  if (args.actionOutcomes.length > 0) {
    state.reply = appendActionOutcomeMarkdown({
      markdown: state.reply,
      outcomes: args.actionOutcomes,
      locale: args.responseLanguage,
    });
  }
}

async function traceReplacement(
  args: GuardChatReplyArgs,
  reason: string,
  originalReply: string,
  replacement: string,
  metadata: Record<string, unknown>,
) {
  const step = startTraceStep(args.traceContext, {
    spanKind: "guard",
    parentStepId: args.traceContext.latestLlmStepId,
  });
  await appendReplySafetyTrace(args.traceContext, step, {
    chatSessionId: args.chatSessionId,
    reason,
    originalReply,
    replacement,
    metadata,
  });
}

async function appendVisibleReplyTrace(
  args: GuardChatReplyArgs,
  state: GuardState,
  rawLlmReply: string,
  campaignPolicyGuard: ReturnType<typeof applyCampaignPolicyGuard>,
) {
  const step = startTraceStep(args.traceContext, {
    spanKind: "guard",
    parentStepId: args.traceContext.latestLlmStepId,
  });
  await appendTraceEventBestEffort(args.traceContext, {
    step,
    stage: "guard_visible_reply",
    kind: "guard",
    title: "Guard and visible Coach reply",
    status: "succeeded",
    details: {
      input: { rawLlmReply },
      output: { visibleReply: state.reply },
      stateDelta: {
        changed: rawLlmReply !== state.reply,
        appliedGuards: state.applied,
      },
      metadata: {
        source: "chat_reply",
        chatSessionId: args.chatSessionId,
        replySource: replySource(args),
        rawParsedVisibleRelationship: "raw_to_visible_after_guards",
        selfCorrectionMarkerDetected:
          args.deepReasoning && detectVisibleSelfCorrectionMarker(rawLlmReply),
        toolBudgetReached: args.toolBudgetReached,
        memoryApplication: buildHistoryRecallApplicationTrace({
          toolTrace: args.toolTrace,
          appliedGuards: state.applied,
        }),
        campaignRole: args.campaignCoaching?.slotRole ?? null,
        coachingMode:
          args.campaignCoaching?.policy.coachingMode ?? "ordinary",
        autoMemoryCueBudget:
          args.campaignCoaching?.policy.automaticTechnicalMemoryCueBudget ?? 2,
        explicitDisclosureOverride:
          args.campaignCoaching?.policy.explicitDisclosureOverride ?? false,
        policyGuardTriggered:
          campaignPolicyGuard.replaced ||
          campaignPolicyGuard.prependedWarning,
        policyFingerprint:
          args.campaignCoaching?.policy.fingerprint ?? null,
      },
    },
  });
}

function replySource(args: GuardChatReplyArgs) {
  if (args.protocolViolation) return "protocol_violation_fallback";
  if (args.toolStopReason === "backend_action_outcomes") {
    return "backend_action_outcomes";
  }
  return args.usedToolBudgetFallback ? "tool_budget_fallback" : "llm";
}

export function latestAlgorithmHintLevel(
  toolTrace: ChatReplyResult["toolTrace"],
) {
  return [...toolTrace]
    .reverse()
    .map((entry) =>
      entry.name === "get_algorithm_hint" &&
      typeof (entry.result as { level?: unknown }).level === "number"
        ? ((entry.result as { level: number }).level)
        : undefined,
    )
    .find((level): level is number => level !== undefined);
}

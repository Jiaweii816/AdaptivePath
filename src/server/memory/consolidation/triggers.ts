import {
  CHAT_CONSOLIDATION_TURN_THRESHOLD,
  CONSOLIDATION_DEBOUNCE_TURNS,
  SALIENCE_HINT_LEVEL,
} from "@/server/memory/memory.types";

export type ChatConsolidationTriggerInput = {
  unconsolidatedUserTurns: number;
  turnsSinceLastSuccess: number;
  intent: string;
  hintLevel: number;
  runCodeFailedInSegment: boolean;
  alignedPracticeFailureDiagnosed?: boolean;
  isBoundary: boolean;
  hasExplicitMemoryInstruction: boolean;
};

export type ChatConsolidationTriggerReason =
  | "empty_segment"
  | "salience_explicit_memory_instruction"
  | "boundary"
  | "salience_stuck"
  | "salience_hint_escalation"
  | "salience_run_failed"
  | "salience_aligned_practice_failure"
  | "turn_threshold"
  | "no_trigger";

export type ChatConsolidationDecision = {
  shouldConsolidate: boolean;
  reason: ChatConsolidationTriggerReason;
};

export function evaluateChatConsolidationTrigger(
  input: ChatConsolidationTriggerInput,
): ChatConsolidationDecision {
  if (input.unconsolidatedUserTurns <= 0) {
    return { shouldConsolidate: false, reason: "empty_segment" };
  }

  if (input.hasExplicitMemoryInstruction) {
    return {
      shouldConsolidate: true,
      reason: "salience_explicit_memory_instruction",
    };
  }

  if (input.isBoundary) {
    return { shouldConsolidate: true, reason: "boundary" };
  }

  // A learner-triggered Practice failure plus an aligned Coach diagnosis is
  // already a concrete, recall-worthy episode even when no later Review
  // closes an Assisted Repair Chain. It does not authorize L2 weakness facts.
  if (input.alignedPracticeFailureDiagnosed) {
    return {
      shouldConsolidate: true,
      reason: "salience_aligned_practice_failure",
    };
  }

  const salienceIsDebounced =
    input.turnsSinceLastSuccess < CONSOLIDATION_DEBOUNCE_TURNS;

  if (!salienceIsDebounced) {
    if (input.intent === "anxiety_or_stuck") {
      return { shouldConsolidate: true, reason: "salience_stuck" };
    }

    if (input.hintLevel >= SALIENCE_HINT_LEVEL) {
      return {
        shouldConsolidate: true,
        reason: "salience_hint_escalation",
      };
    }

    if (input.runCodeFailedInSegment) {
      return { shouldConsolidate: true, reason: "salience_run_failed" };
    }
  }

  if (input.unconsolidatedUserTurns >= CHAT_CONSOLIDATION_TURN_THRESHOLD) {
    return { shouldConsolidate: true, reason: "turn_threshold" };
  }

  return { shouldConsolidate: false, reason: "no_trigger" };
}

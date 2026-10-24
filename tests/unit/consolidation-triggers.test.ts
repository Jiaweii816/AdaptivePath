import { describe, expect, it } from "vitest";
import {
  evaluateChatConsolidationTrigger,
  type ChatConsolidationTriggerInput,
} from "@/server/memory/consolidation/triggers";
import {
  CHAT_CONSOLIDATION_TURN_THRESHOLD,
  CONSOLIDATION_DEBOUNCE_TURNS,
  SALIENCE_HINT_LEVEL,
} from "@/server/memory/memory.types";

const base: ChatConsolidationTriggerInput = {
  unconsolidatedUserTurns: 1,
  turnsSinceLastSuccess: CONSOLIDATION_DEBOUNCE_TURNS,
  intent: "general_followup",
  hintLevel: 0,
  runCodeFailedInSegment: false,
  isBoundary: false,
  hasExplicitMemoryInstruction: false,
};

describe("evaluateChatConsolidationTrigger", () => {
  it("immediately consolidates an aligned learner Practice failure diagnosis", () => {
    expect(
      evaluateChatConsolidationTrigger({
        unconsolidatedUserTurns: 1,
        turnsSinceLastSuccess: 1,
        intent: "debug_followup",
        hintLevel: 0,
        runCodeFailedInSegment: false,
        alignedPracticeFailureDiagnosed: true,
        isBoundary: false,
        hasExplicitMemoryInstruction: false,
      }),
    ).toEqual({
      shouldConsolidate: true,
      reason: "salience_aligned_practice_failure",
    });
  });
  it("fires immediately for stuck salience once outside debounce", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        intent: "anxiety_or_stuck",
      }),
    ).toEqual({ shouldConsolidate: true, reason: "salience_stuck" });
  });

  it("fires when hint level reaches the salience hint threshold", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        hintLevel: SALIENCE_HINT_LEVEL,
      }),
    ).toEqual({
      shouldConsolidate: true,
      reason: "salience_hint_escalation",
    });
  });

  it("fires when run_code failed in the unconsolidated segment", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        runCodeFailedInSegment: true,
      }),
    ).toEqual({ shouldConsolidate: true, reason: "salience_run_failed" });
  });

  it("debounces salience triggers within the recent-success window", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        turnsSinceLastSuccess: CONSOLIDATION_DEBOUNCE_TURNS - 1,
        intent: "anxiety_or_stuck",
        hintLevel: SALIENCE_HINT_LEVEL,
        runCodeFailedInSegment: true,
      }),
    ).toEqual({ shouldConsolidate: false, reason: "no_trigger" });
  });

  it("lets explicit memory instructions bypass debounce", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        turnsSinceLastSuccess: CONSOLIDATION_DEBOUNCE_TURNS - 1,
        hasExplicitMemoryInstruction: true,
      }),
    ).toEqual({
      shouldConsolidate: true,
      reason: "salience_explicit_memory_instruction",
    });
  });

  it("fires on conversation boundaries", () => {
    expect(
      evaluateChatConsolidationTrigger({ ...base, isBoundary: true }),
    ).toEqual({ shouldConsolidate: true, reason: "boundary" });
  });

  it("uses the turn threshold as the fallback trigger at the exact boundary", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        unconsolidatedUserTurns: CHAT_CONSOLIDATION_TURN_THRESHOLD - 1,
      }),
    ).toEqual({ shouldConsolidate: false, reason: "no_trigger" });

    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        unconsolidatedUserTurns: CHAT_CONSOLIDATION_TURN_THRESHOLD,
      }),
    ).toEqual({ shouldConsolidate: true, reason: "turn_threshold" });
  });

  it("never consolidates an empty segment even when other triggers are present", () => {
    expect(
      evaluateChatConsolidationTrigger({
        ...base,
        unconsolidatedUserTurns: 0,
        isBoundary: true,
        hasExplicitMemoryInstruction: true,
        intent: "anxiety_or_stuck",
        hintLevel: SALIENCE_HINT_LEVEL,
        runCodeFailedInSegment: true,
      }),
    ).toEqual({ shouldConsolidate: false, reason: "empty_segment" });
  });
});

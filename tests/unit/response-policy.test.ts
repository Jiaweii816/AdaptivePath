import { describe, expect, it } from "vitest";

import { INTENT_INSTRUCTIONS } from "@/server/agents/coach-agent/chat-policy-prompt";
import { backboneInstructions } from "@/server/agents/coach-agent/response-policy/family-backbone";
import { modifierOverlayInstructions } from "@/server/agents/coach-agent/response-policy/modifier-overlays";
import type { TurnModifiers } from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";

const directModifiers = {
  codeDisclosure: { level: "guided", source: "default" },
  affect: "none",
  deliveryMode: "direct",
  requestedArtifact: "explanation",
} satisfies TurnModifiers;

function instructionTags(lines: string[]): string[] {
  return lines.flatMap((line) => line.match(/^\[[^\]]+\]/)?.[0] ?? []);
}

describe("family backbone instructions", () => {
  it("reuses exact legacy arrays and bracket tags across all nine families", () => {
    const cases = [
      [{ family: "diagnose", target: "current_user_code" }, "execute_failed_ask", "[DEBUG]"],
      [{ family: "execute", target: "current_user_code" }, "run_case_request", "[RUN]"],
      [{ family: "optimize", target: "current_user_code" }, "optimization_request", "[OPTIMIZATION]"],
      [{ family: "lookup_api", target: "api_object" }, "api_reference_question", "[API]"],
      [{ family: "recall", target: "past_mistake" }, "past_mistake_recall_request", "[HISTORY]"],
      [{ family: "recall", target: "past_problem" }, "past_problem_recall_request", "[HISTORY]"],
      [{ family: "profile_meta", target: "learner_profile" }, "profile_meta_question", "[LEARNER PROFILE]"],
      [{ family: "recommend", target: "practice_problem" }, "practice_request", "[PRACTICE]"],
      [{ family: "persist", target: "mistake_book" }, "mistake_book_save_request", "[DURABLE ACTION]"],
      [{ family: "answer", target: "concept", topic: "concept" }, "concept_question", "[CONCEPT]"],
      [{ family: "answer", target: "contextual_referent" }, "general_followup", "[FOLLOW-UP]"],
    ] as const;

    for (const [backbone, legacyIntent, tag] of cases) {
      const lines = backboneInstructions(backbone);
      expect(lines).toEqual(INTENT_INSTRUCTIONS[legacyIntent]);
      expect(instructionTags(lines)).toEqual([tag]);
    }
  });

  it("does not invent durable authority for preference or handbook persistence", () => {
    expect(backboneInstructions({ family: "persist", target: "preference" })).toEqual([]);
    expect(
      backboneInstructions({ family: "persist", target: "knowledge_handbook" }),
    ).toEqual([]);
    expect(backboneInstructions({ family: "persist", target: "mistake_book" })).toEqual(
      INTENT_INSTRUCTIONS.mistake_book_save_request,
    );
  });
});

describe("modifier overlay instructions", () => {
  it("renders exact legacy overlays with full-code precedence and stable order", () => {
    const cases = [
      [directModifiers, [], []],
      [{ ...directModifiers, deliveryMode: "hint" }, INTENT_INSTRUCTIONS.hint_request, ["[HINT]"]],
      [{ ...directModifiers, affect: "anxious_stuck" }, INTENT_INSTRUCTIONS.anxiety_or_stuck, ["[STUCK]"]],
      [{ ...directModifiers, codeDisclosure: { level: "full_code", source: "explicit_allow" } }, INTENT_INSTRUCTIONS.full_code_request, ["[FULL CODE]"]],
      [{ ...directModifiers, deliveryMode: "hint", requestedArtifact: "full_implementation" }, INTENT_INSTRUCTIONS.full_code_request, ["[FULL CODE]"]],
      [{ ...directModifiers, deliveryMode: "hint", affect: "anxious_stuck" }, [...INTENT_INSTRUCTIONS.hint_request, ...INTENT_INSTRUCTIONS.anxiety_or_stuck], ["[HINT]", "[STUCK]"]],
      [{ ...directModifiers, codeDisclosure: { level: "full_code", source: "explicit_allow" }, deliveryMode: "hint", affect: "anxious_stuck" }, [...INTENT_INSTRUCTIONS.full_code_request, ...INTENT_INSTRUCTIONS.anxiety_or_stuck], ["[FULL CODE]", "[STUCK]"]],
    ] as const;

    for (const [modifiers, expected, tags] of cases) {
      const lines = modifierOverlayInstructions(modifiers);
      expect(lines).toEqual(expected);
      expect(instructionTags(lines)).toEqual(tags);
    }
  });
});

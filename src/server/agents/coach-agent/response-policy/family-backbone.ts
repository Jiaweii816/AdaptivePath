import { INTENT_INSTRUCTIONS } from "../chat-policy-prompt";
import type { ResponsePlan } from "./response-plan.types";

export function backboneInstructions(
  backbone: ResponsePlan["backbone"],
): string[] {
  switch (backbone.family) {
    case "diagnose":
      return INTENT_INSTRUCTIONS.execute_failed_ask;
    case "execute":
      return INTENT_INSTRUCTIONS.run_case_request;
    case "optimize":
      return INTENT_INSTRUCTIONS.optimization_request;
    case "lookup_api":
      return INTENT_INSTRUCTIONS.api_reference_question;
    case "recall":
      return backbone.target === "past_mistake"
        ? INTENT_INSTRUCTIONS.past_mistake_recall_request
        : INTENT_INSTRUCTIONS.past_problem_recall_request;
    case "profile_meta":
      return INTENT_INSTRUCTIONS.profile_meta_question;
    case "recommend":
      return INTENT_INSTRUCTIONS.practice_request;
    case "persist":
      return backbone.target === "mistake_book"
        ? INTENT_INSTRUCTIONS.mistake_book_save_request
        : [];
    case "answer":
      return backbone.topic === "concept"
        ? INTENT_INSTRUCTIONS.concept_question
        : INTENT_INSTRUCTIONS.general_followup;
  }
}

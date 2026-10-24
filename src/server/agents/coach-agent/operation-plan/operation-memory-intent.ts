import type { CoachChatIntent } from "../coach-agent.types";
import type {
  OperationFamily,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";

function hasFamily(
  understanding: TurnUnderstanding,
  family: OperationFamily,
): boolean {
  return understanding.operations.some((operation) => operation.family === family);
}

function requestsFullCode(understanding: TurnUnderstanding): boolean {
  return (
    understanding.modifiers.codeDisclosure.level === "full_code" ||
    understanding.modifiers.requestedArtifact === "full_implementation"
  );
}

export function deriveMemoryIntent(
  understanding: TurnUnderstanding,
): CoachChatIntent {
  const recall = understanding.operations.filter(
    ({ family }) => family === "recall",
  );
  if (recall.length > 0) {
    return recall.some(({ target }) => target === "past_mistake")
      ? "past_mistake_recall_request"
      : "past_problem_recall_request";
  }
  if (hasFamily(understanding, "profile_meta")) return "profile_meta_question";
  if (hasFamily(understanding, "recommend")) return "practice_request";
  if (hasFamily(understanding, "diagnose")) return "execute_failed_ask";
  if (hasFamily(understanding, "execute")) return "run_case_request";
  if (hasFamily(understanding, "optimize")) return "optimization_request";
  if (understanding.modifiers.affect === "anxious_stuck") {
    return "anxiety_or_stuck";
  }
  if (requestsFullCode(understanding)) return "full_code_request";
  if (understanding.modifiers.deliveryMode === "hint") return "hint_request";
  if (hasFamily(understanding, "lookup_api")) return "api_reference_question";

  const answer = understanding.operations.find(
    ({ family }) => family === "answer",
  );
  if (answer?.target === "concept" || answer?.topic === "concept") {
    return "concept_question";
  }
  return "general_followup";
}

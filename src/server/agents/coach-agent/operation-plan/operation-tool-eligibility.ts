import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";
import { isLearningExperienceRecallPilotEnabled } from "@/server/memory/learning-experience-recall/pilot-mode";

import type {
  Operation,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";

const HINTABLE_RESPONSE_FAMILIES = new Set<Operation["family"]>([
  "answer",
  "diagnose",
  "optimize",
]);

function toolForOperation(operation: Operation): ChatToolName | undefined {
  switch (operation.family) {
    case "execute":
      if (operation.resolution !== "explicit") return undefined;
      if (operation.target === "current_user_code") return "run_current_code";
      if (operation.target === "assistant_candidate") {
        return "verify_proposed_repair";
      }
      return undefined;
    case "lookup_api":
      return operation.target === "api_object" ||
        operation.target === "knowledge_handbook"
        ? "lookup_api_reference"
        : undefined;
    case "recall":
      if (operation.target === "past_problem") return "past_problem_recall";
      if (operation.target === "past_mistake") return "past_mistake_recall";
      return undefined;
    case "recommend":
      return operation.target === "practice_problem"
        ? "find_practice_problem"
        : undefined;
    case "answer":
    case "diagnose":
    case "optimize":
    case "profile_meta":
    case "persist":
      return undefined;
  }
}

export function deriveToolEligibility(
  understanding: TurnUnderstanding,
): ChatToolName[] {
  const capabilities: ChatToolName[] = [];
  const add = (capability: ChatToolName | undefined) => {
    if (capability && !capabilities.includes(capability)) {
      capabilities.push(capability);
    }
  };
  for (const operation of understanding.operations) {
    add(toolForOperation(operation));
  }
  if (
    understanding.operations.some(
      (operation) =>
        operation.family === "recommend" &&
        operation.target === "practice_problem",
    )
  ) {
    add("search_interview_variant_candidates");
  }
  if (
    understanding.modifiers.deliveryMode === "hint" &&
    understanding.operations.some(({ family }) =>
      HINTABLE_RESPONSE_FAMILIES.has(family),
    )
  ) {
    add("get_algorithm_hint");
  }
  if (isLearningExperienceRecallPilotEnabled()) {
    add("recall_learning_experience");
  }
  return capabilities;
}

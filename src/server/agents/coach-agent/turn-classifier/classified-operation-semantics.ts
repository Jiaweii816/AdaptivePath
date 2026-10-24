import type {
  OperationFamily,
  OperationTarget,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";
import type { ClassifierOutput } from "./classifier-output.schema";

type ClassifiedOperation = ClassifierOutput["operations"][number];

const FAMILY_TARGETS: Readonly<
  Record<OperationFamily, ReadonlySet<OperationTarget>>
> = {
  answer: new Set([
    "current_user_code",
    "assistant_candidate",
    "current_approach",
    "active_problem",
    "concept",
    "contextual_referent",
    "unspecified",
  ]),
  lookup_api: new Set(["api_object", "knowledge_handbook"]),
  diagnose: new Set([
    "current_user_code",
    "assistant_candidate",
    "current_approach",
  ]),
  execute: new Set(["current_user_code", "assistant_candidate"]),
  optimize: new Set([
    "current_user_code",
    "assistant_candidate",
    "current_approach",
  ]),
  recall: new Set(["past_problem", "past_mistake"]),
  profile_meta: new Set(["learner_profile"]),
  recommend: new Set(["practice_problem"]),
  persist: new Set(["preference", "knowledge_handbook", "mistake_book"]),
};

export function hasValidFamilyTarget(operation: ClassifiedOperation): boolean {
  return FAMILY_TARGETS[operation.family].has(operation.target);
}

export function hasValidOperationTopic(
  operation: ClassifiedOperation,
): boolean {
  if (operation.topic === undefined) return true;
  if (operation.family === "answer") {
    return operation.topic === "concept" || operation.topic === "general";
  }
  return operation.family === "lookup_api" && operation.topic === "api";
}

export function hasHintTargetMismatch(
  output: ClassifierOutput,
  deterministic: TurnUnderstanding,
): boolean {
  const backendResolvedActiveHint =
    deterministic.modifiers.deliveryMode === "hint" &&
    deterministic.operations.some(
      ({ family, target }) =>
        family === "answer" && target === "active_problem",
    );
  if (!backendResolvedActiveHint) return false;
  const answerTargets = output.operations
    .filter(({ family }) => family === "answer")
    .map(({ target }) => target);
  return (
    !answerTargets.includes("active_problem") ||
    answerTargets.some((target) => target !== "active_problem")
  );
}

export function normalizedDeliveryMode(
  deterministic: TurnUnderstanding,
): TurnUnderstanding["modifiers"]["deliveryMode"] {
  const durableOnly =
    deterministic.operations.length > 0 &&
    deterministic.operations.every(({ family }) => family === "persist");
  return durableOnly ? "direct" : deterministic.modifiers.deliveryMode;
}

import type { CoachChatInput } from "../coach-agent.types";
import type {
  Operation,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";
import type { ResponsePlan } from "./response-plan.types";

const ANSWER_FALLBACK: Operation = {
  id: "op0",
  family: "answer",
  target: "contextual_referent",
  sourceClauseId: "c0",
  dependsOn: [],
  evidence: [],
  resolution: "ambiguous",
};

export type BuildResponsePlanOptions = {
  /** Supplied by the legacy isPureDurableTurn decision until that seam migrates. */
  pureDurable?: boolean;
};

function responseOperations(operations: readonly Operation[]): Operation[] {
  return operations.length > 0 ? [...operations] : [ANSWER_FALLBACK];
}

export function buildResponsePlan(
  understanding: TurnUnderstanding,
  input: CoachChatInput,
  options: BuildResponsePlanOptions = {},
): ResponsePlan {
  const operations = responseOperations(understanding.operations);
  const primary = operations[0];
  const backbone = {
    family: primary.family,
    target: primary.target,
    ...(primary.topic ? { topic: primary.topic } : {}),
  };
  const objectives = operations.map((operation) => ({
    operationId: operation.id,
    family: operation.family,
    target: operation.target,
    dependsOn: [...operation.dependsOn],
  }));

  return {
    backbone,
    objectives,
    modifiers: understanding.modifiers,
    compound: objectives.length > 1,
    pureDurable: options.pureDurable ?? false,
    hasPendingRequiredAction: Boolean(
      input.requiredActions?.some((action) => action.status === "pending"),
    ),
  };
}

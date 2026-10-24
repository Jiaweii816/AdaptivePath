import type { ChatTurnPlan } from "../coach-agent.types";
import { deriveOperations } from "./derive-operations";
import type {
  Operation,
  SignalEvidence,
  TurnClause,
} from "./turn-understanding.types";

const TRIVIAL_POLITENESS =
  /^(?:please|thanks?|thank you|kindly|请|谢谢|麻烦(?:你)?|拜托)(?:\s+me)?[.!?。！？]*$/iu;

function hasMultipleNontrivialClauses(clauses: readonly TurnClause[]): boolean {
  return (
    clauses.filter(({ text }) => !TRIVIAL_POLITENESS.test(text.trim())).length >
    1
  );
}

export function classifyRoute(input: {
  clauses: TurnClause[];
  legacy: ChatTurnPlan;
  discourse: SignalEvidence[];
  negation: SignalEvidence[];
  operations?: readonly Operation[];
}): "fast_path" | "llm" {
  const operations =
    input.operations ?? deriveOperations(input.legacy, input.clauses);
  const hasAmbiguity = operations.some(
    (operation) => operation.resolution === "ambiguous",
  );

  if (
    hasMultipleNontrivialClauses(input.clauses) ||
    input.clauses.some(
      ({ connectorBefore }) => connectorBefore !== undefined,
    ) ||
    input.discourse.length > 0 ||
    input.negation.length > 0 ||
    input.legacy.primaryIntent === "general_followup" ||
    operations.length !== 1 ||
    hasAmbiguity
  ) {
    return "llm";
  }
  return "fast_path";
}

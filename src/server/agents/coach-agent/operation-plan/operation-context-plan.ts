import type { ChatTurnContextNeeds } from "../coach-agent.types";
import type {
  OperationFamily,
  TurnUnderstanding,
} from "../turn-understanding/turn-understanding.types";

const DIAGNOSTIC_FAMILIES: ReadonlySet<OperationFamily> = new Set([
  "diagnose",
  "execute",
]);
const GUIDED_WORK_FAMILIES: ReadonlySet<OperationFamily> = new Set([
  "answer",
  "optimize",
]);
const LEARNER_CONTEXT_FAMILIES: ReadonlySet<OperationFamily> = new Set([
  "answer",
  "diagnose",
  "optimize",
  "profile_meta",
  "recommend",
]);

function includesFamilyFrom(
  families: ReadonlySet<OperationFamily>,
  candidates: ReadonlySet<OperationFamily>,
): boolean {
  return [...families].some((family) => candidates.has(family));
}

export function buildContextPlan(
  understanding: TurnUnderstanding,
): ChatTurnContextNeeds {
  const families = new Set(
    understanding.operations.map((operation) => operation.family),
  );
  const diagnostic = includesFamilyFrom(families, DIAGNOSTIC_FAMILIES);
  const guidedWork = includesFamilyFrom(families, GUIDED_WORK_FAMILIES);
  const mistakeBook = understanding.operations.some(
    ({ family, target }) =>
      family === "persist" && target === "mistake_book",
  );
  const learnerSignals =
    understanding.operations.length === 0 ||
    understanding.operations.some(
      ({ family, target }) =>
        LEARNER_CONTEXT_FAMILIES.has(family) ||
        (family === "persist" &&
          (target === "preference" || target === "knowledge_handbook")),
    );
  const workspace = diagnostic || guidedWork || mistakeBook;

  return {
    workspace,
    currentCode: workspace,
    selectedTests: diagnostic,
    runEvidence: diagnostic,
    reviewContext: diagnostic || guidedWork,
    learnerSignals,
    handbook: families.has("lookup_api"),
    episodes: false,
  };
}

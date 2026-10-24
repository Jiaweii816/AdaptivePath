import type { TrajectoryDatasetCase } from "../evals/runner/trajectory-dataset";
import type { ChatToolName } from "../src/server/tools/chat-tools/chat-tool-contracts";
import type { TurnUnderstanding } from "../src/server/agents/coach-agent/turn-understanding/turn-understanding.types";
import type {
  ResolverFallbackReason,
  TurnUnderstandingProvenance,
} from "../src/server/agents/coach-agent/turn-classifier/resolve-turn-understanding";

export type OperationSignature = `${TurnUnderstanding["operations"][number]["family"]}:${TurnUnderstanding["operations"][number]["target"]}`;
export type ClassifierEvalSample = {
  caseId: string;
  understanding: TurnUnderstanding;
  capabilities: ChatToolName[];
  classifierCalled: boolean;
  provenance: TurnUnderstandingProvenance;
  fallbackReason?: ResolverFallbackReason;
  latencyMs: number;
  inScope: boolean;
};
export type ClassifierEvalRow = {
  caseId: string;
  inScope: boolean;
  route: TurnUnderstanding["route"];
  expectedOperations: OperationSignature[];
  actualOperations: OperationSignature[];
  exact: boolean;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  targetMatched: number;
  targetTotal: number;
  requiredMatched: number;
  requiredTotal: number;
  forbiddenOpened: ChatToolName[];
  executeFalsePositive: boolean;
  persistFalsePositive: boolean;
  hintStateFalsePositive: boolean;
  classifierCalled: boolean;
  provenance: TurnUnderstandingProvenance;
  fallbackReason?: ResolverFallbackReason;
  latencyMs: number;
};
export type ClassifierEvalAggregate = {
  cases: number;
  inScopeCases: number;
  operationExact: number;
  operationPrecision: number;
  operationRecall: number;
  operationF1: number;
  targetMatched: number;
  targetTotal: number;
  requiredMatched: number;
  requiredTotal: number;
  forbiddenOpened: number;
  executeFalsePositives: number;
  persistFalsePositives: number;
  hintStateFalsePositives: number;
  fastRouteClassifierCalls: number;
  classifierCalls: number;
  validated: number;
  fallbacks: number;
  validatorRejects: number;
  wallLatencyMs: number;
};
export type ClassifierEvalArm = {
  rows: ClassifierEvalRow[];
  aggregate: ClassifierEvalAggregate;
};
export type ProviderUsageDelta = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
};
export type ClassifierEvalGate = { passed: boolean; failures: string[] };
export type ClassifierEvalReport = {
  reportVersion: "intent-p4-classifier-eval-v1";
  generatedAt: string;
  datasetVersion: string;
  model: string;
  baseline: ClassifierEvalArm;
  classifier: ClassifierEvalArm;
  providerUsage: ProviderUsageDelta;
  limitations: string[];
  regressedCorrectCaseIds: string[];
  gate: ClassifierEvalGate;
};

const TOOL_OPERATION: Partial<Record<ChatToolName, OperationSignature>> = {
  run_current_code: "execute:current_user_code",
  verify_proposed_repair: "execute:assistant_candidate",
  past_problem_recall: "recall:past_problem",
  past_mistake_recall: "recall:past_mistake",
  find_practice_problem: "recommend:practice_problem",
  get_algorithm_hint: "answer:active_problem",
  lookup_api_reference: "lookup_api:api_object",
  note_memory: "persist:preference",
  save_knowledge_note: "persist:knowledge_handbook",
  save_mistake_book_entry: "persist:mistake_book",
};
const EXPECTED_SIDECAR: Readonly<Record<string, OperationSignature[]>> = {
  "traj-v2-natural-multi-debug-run-then-history": [
    "diagnose:current_user_code",
  ],
};
const F1_IMPROVEMENT_GATE = 0.05;
const REQUIRED_IMPROVEMENT_GATE = 2;

export function buildClassifierEvalArm(
  cases: readonly TrajectoryDatasetCase[],
  samples: readonly ClassifierEvalSample[],
): ClassifierEvalArm {
  const byId = new Map(samples.map((sample) => [sample.caseId, sample]));
  const rows = cases.map((item) => buildRow(item, requireSample(byId, item.caseId)));
  return { rows, aggregate: aggregateRows(rows) };
}

export function isClassifierEvalCaseInScope(
  item: TrajectoryDatasetCase,
  deterministic: TurnUnderstanding,
): boolean {
  if (item.category === "preference_requires_note_memory") return true;
  return (
    item.language === "Python" &&
    !deterministic.unsupportedScope.languageMention
  );
}

function buildRow(
  item: TrajectoryDatasetCase,
  sample: ClassifierEvalSample,
): ClassifierEvalRow {
  const expected = expectedOperations(item);
  const optional = new Set(item.optionalTools.flatMap(toolOperation));
  const actual = unique(sample.understanding.operations.map(signature));
  const expectedSet = new Set(expected);
  const truePositive = expected.filter((value) => actual.includes(value)).length;
  const falsePositive = actual.filter(
    (value) => !expectedSet.has(value) && !optional.has(value),
  ).length;
  const capabilities = new Set(sample.capabilities);
  const forbiddenOpened = item.forbiddenTools.filter((tool) => capabilities.has(tool));
  const explicit = new Set(
    sample.understanding.operations
      .filter(({ resolution }) => resolution === "explicit")
      .map(signature),
  );
  return {
    caseId: item.caseId,
    inScope: sample.inScope,
    route: sample.understanding.route,
    expectedOperations: expected,
    actualOperations: actual,
    exact: truePositive === expected.length && falsePositive === 0,
    truePositive,
    falsePositive,
    falseNegative: expected.length - truePositive,
    targetMatched: truePositive,
    targetTotal: expected.length,
    requiredMatched: item.expectedTools.filter((tool) => capabilities.has(tool)).length,
    requiredTotal: item.expectedTools.length,
    forbiddenOpened,
    executeFalsePositive: sideEffectFalsePositive(explicit, item.forbiddenTools, "execute"),
    persistFalsePositive: sideEffectFalsePositive(explicit, item.forbiddenTools, "persist"),
    hintStateFalsePositive:
      sample.understanding.modifiers.deliveryMode === "hint" &&
      item.forbiddenTools.includes("get_algorithm_hint"),
    classifierCalled: sample.classifierCalled,
    provenance: sample.provenance,
    fallbackReason: sample.fallbackReason,
    latencyMs: sample.latencyMs,
  };
}

function aggregateRows(rows: readonly ClassifierEvalRow[]): ClassifierEvalAggregate {
  const scope = rows.filter(({ inScope }) => inScope);
  const sum = (select: (row: ClassifierEvalRow) => number) =>
    scope.reduce((total, row) => total + select(row), 0);
  const truePositive = sum((row) => row.truePositive);
  const falsePositive = sum((row) => row.falsePositive);
  const falseNegative = sum((row) => row.falseNegative);
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  return {
    cases: rows.length,
    inScopeCases: scope.length,
    operationExact: sum((row) => Number(row.exact)),
    operationPrecision: precision,
    operationRecall: recall,
    operationF1: f1(precision, recall),
    targetMatched: sum((row) => row.targetMatched),
    targetTotal: sum((row) => row.targetTotal),
    requiredMatched: sum((row) => row.requiredMatched),
    requiredTotal: sum((row) => row.requiredTotal),
    forbiddenOpened: sum((row) => row.forbiddenOpened.length),
    executeFalsePositives: sum((row) => Number(row.executeFalsePositive)),
    persistFalsePositives: sum((row) => Number(row.persistFalsePositive)),
    hintStateFalsePositives: sum((row) => Number(row.hintStateFalsePositive)),
    fastRouteClassifierCalls: rows.filter(
      (row) => row.route === "fast_path" && row.classifierCalled,
    ).length,
    classifierCalls: rows.filter(({ classifierCalled }) => classifierCalled).length,
    validated: rows.filter(({ provenance }) => provenance === "llm_validated").length,
    fallbacks: rows.filter(({ provenance }) => provenance === "deterministic_fallback").length,
    validatorRejects: rows.filter(({ fallbackReason }) =>
      fallbackReason?.startsWith("validator_"),
    ).length,
    wallLatencyMs: rows.reduce((total, row) => total + row.latencyMs, 0),
  };
}

export function evaluateClassifierEvalGate(
  baseline: ClassifierEvalAggregate,
  classifier: ClassifierEvalAggregate,
  regressedCorrectCaseIds: readonly string[],
): ClassifierEvalGate {
  const failures: string[] = [];
  if (classifier.operationF1 + Number.EPSILON < baseline.operationF1 + F1_IMPROVEMENT_GATE) failures.push("operation_f1_improvement_below_5pp");
  if (classifier.requiredMatched < baseline.requiredMatched + REQUIRED_IMPROVEMENT_GATE) failures.push("required_capability_improvement_below_2");
  if (classifier.forbiddenOpened > baseline.forbiddenOpened) failures.push("forbidden_capability_regression");
  if (classifier.executeFalsePositives > 0) failures.push("execute_false_positive");
  if (classifier.persistFalsePositives > 0) failures.push("persist_false_positive");
  if (classifier.hintStateFalsePositives > 0) failures.push("hint_state_false_positive");
  if (regressedCorrectCaseIds.length > 0) failures.push("baseline_correct_case_regression");
  if (classifier.fastRouteClassifierCalls > 0) failures.push("fast_route_classifier_call");
  return { passed: failures.length === 0, failures };
}

export function buildClassifierEvalReport(args: {
  datasetVersion: string;
  model: string;
  baseline: ClassifierEvalArm;
  classifier: ClassifierEvalArm;
  providerUsage: ProviderUsageDelta;
  limitations: string[];
  generatedAt?: string;
}): ClassifierEvalReport {
  const regressedCorrectCaseIds = correctCaseRegressions(args.baseline, args.classifier);
  return {
    reportVersion: "intent-p4-classifier-eval-v1",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    datasetVersion: args.datasetVersion,
    model: args.model,
    baseline: args.baseline,
    classifier: args.classifier,
    providerUsage: args.providerUsage,
    limitations: args.limitations,
    regressedCorrectCaseIds,
    gate: evaluateClassifierEvalGate(
      args.baseline.aggregate,
      args.classifier.aggregate,
      regressedCorrectCaseIds,
    ),
  };
}

function correctCaseRegressions(
  baseline: ClassifierEvalArm,
  classifier: ClassifierEvalArm,
): string[] {
  const classified = new Map(classifier.rows.map((row) => [row.caseId, row]));
  return baseline.rows.filter(isCorrectRow).filter((row) => {
    const next = classified.get(row.caseId);
    return !next || !isCorrectRow(next);
  }).map(({ caseId }) => caseId);
}

function isCorrectRow(row: ClassifierEvalRow): boolean {
  return row.inScope && row.exact && row.requiredMatched === row.requiredTotal &&
    row.forbiddenOpened.length === 0 && !row.executeFalsePositive &&
    !row.persistFalsePositive && !row.hintStateFalsePositive;
}

function expectedOperations(item: TrajectoryDatasetCase): OperationSignature[] {
  return unique([
    ...item.expectedTools.flatMap(toolOperation),
    ...(item.category === "concept_question_no_tool" ? ["answer:concept" as const] : []),
    ...(EXPECTED_SIDECAR[item.caseId] ?? []),
  ]);
}
function toolOperation(tool: ChatToolName): OperationSignature[] {
  return TOOL_OPERATION[tool] ? [TOOL_OPERATION[tool]] : [];
}
function signature(operation: TurnUnderstanding["operations"][number]): OperationSignature {
  return `${operation.family}:${operation.target}`;
}
function sideEffectFalsePositive(opened: ReadonlySet<OperationSignature>, forbidden: readonly ChatToolName[], family: "execute" | "persist"): boolean {
  return forbidden.some((tool) => TOOL_OPERATION[tool]?.startsWith(`${family}:`) && opened.has(TOOL_OPERATION[tool]!));
}
function requireSample(samples: ReadonlyMap<string, ClassifierEvalSample>, caseId: string): ClassifierEvalSample {
  const sample = samples.get(caseId);
  if (!sample) throw new Error(`Missing classifier eval sample: ${caseId}`);
  return sample;
}
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 1 : numerator / denominator; }
function f1(precision: number, recall: number): number { return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall); }

import { describe, expect, it } from "vitest";

import { loadTrajectoryDataset } from "../../evals/runner/trajectory-dataset";
import {
  assertClassifierEvalEnabled,
} from "../../scripts/eval-turn-classifier";
import {
  buildClassifierEvalArm,
  buildClassifierEvalReport,
  evaluateClassifierEvalGate,
  isClassifierEvalCaseInScope,
  type ClassifierEvalSample,
  type ClassifierEvalAggregate,
} from "../../scripts/turn-classifier-eval-metrics";
import { renderClassifierEvalReport } from "../../scripts/turn-classifier-eval-report";
import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";

function sample(
  item: ReturnType<typeof loadTrajectoryDataset>["cases"][number],
): ClassifierEvalSample {
  const legacy = buildChatTurnPlan(item.userMessage);
  const actions = resolveRequestedActions(item.userMessage);
  const understanding = parseTurnUnderstanding(
    item.userMessage,
    legacy,
    actions,
  );
  const granted = actions
    .filter(({ decision }) => decision === "granted")
    .map(({ toolName }) => toolName);
  return {
    caseId: item.caseId,
    understanding,
    capabilities: [...deriveToolEligibility(understanding), ...granted],
    classifierCalled: false,
    provenance: "deterministic_fast",
    latencyMs: 0,
    inScope: isClassifierEvalCaseInScope(item, understanding),
  };
}

function aggregate(
  overrides: Partial<ClassifierEvalAggregate> = {},
): ClassifierEvalAggregate {
  return {
    cases: 10,
    inScopeCases: 10,
    operationExact: 3,
    operationPrecision: 0.4,
    operationRecall: 0.3,
    operationF1: 0.34,
    targetMatched: 3,
    targetTotal: 10,
    requiredMatched: 3,
    requiredTotal: 10,
    forbiddenOpened: 1,
    executeFalsePositives: 0,
    persistFalsePositives: 0,
    hintStateFalsePositives: 0,
    fastRouteClassifierCalls: 0,
    classifierCalls: 0,
    validated: 0,
    fallbacks: 0,
    validatorRejects: 0,
    wallLatencyMs: 0,
    ...overrides,
  };
}

describe("turn-classifier eval guard", () => {
  it("requires an explicit opt-in value", () => {
    expect(() => assertClassifierEvalEnabled({})).toThrow(
      "RUN_CLASSIFIER_EVAL=1",
    );
    expect(() =>
      assertClassifierEvalEnabled({ RUN_CLASSIFIER_EVAL: "0" }),
    ).toThrow("RUN_CLASSIFIER_EVAL=1");
    expect(() =>
      assertClassifierEvalEnabled({ RUN_CLASSIFIER_EVAL: "1" }),
    ).not.toThrow();
  });
});

describe("dynamic classifier eval metrics", () => {
  it("scores baseline and classifier arms from the same dataset scope", () => {
    const cases = loadTrajectoryDataset().cases.filter((item) =>
      ["concept_question_no_tool", "run_case_requires_run_code"].includes(
        item.category,
      ),
    ).slice(0, 2);
    const samples = cases.map(sample);
    const arm = buildClassifierEvalArm(cases, samples);

    expect(arm.rows).toHaveLength(2);
    expect(arm.aggregate.cases).toBe(2);
    expect(arm.aggregate.inScopeCases).toBe(2);
    expect(arm.aggregate.requiredTotal).toBe(
      cases.reduce((sum, item) => sum + item.expectedTools.length, 0),
    );
    expect(arm.rows.map(({ caseId }) => caseId)).toEqual(
      cases.map(({ caseId }) => caseId),
    );
  });

  it("flags a forbidden hint state independently of execute and persist", () => {
    const item = loadTrajectoryDataset().cases.find(
      ({ category }) => category === "concept_question_no_tool",
    )!;
    const base = sample(item);
    const understanding = {
      ...base.understanding,
      modifiers: { ...base.understanding.modifiers, deliveryMode: "hint" as const },
    };
    const arm = buildClassifierEvalArm(
      [item],
      [{ ...base, understanding, capabilities: ["get_algorithm_hint"] }],
    );

    expect(arm.aggregate).toMatchObject({
      hintStateFalsePositives: 1,
      executeFalsePositives: 0,
      persistFalsePositives: 0,
    });
  });
});

describe("classifier release gate outcome", () => {
  it("passes only with measured improvement and no safety regression", () => {
    const baseline = aggregate();
    const classifier = aggregate({
      operationF1: 0.4,
      requiredMatched: 5,
      forbiddenOpened: 1,
      classifierCalls: 7,
      validated: 7,
    });
    expect(
      evaluateClassifierEvalGate(baseline, classifier, []),
    ).toMatchObject({ passed: true, failures: [] });

    expect(
      evaluateClassifierEvalGate(
        baseline,
        aggregate({ operationF1: 0.38, requiredMatched: 4 }),
        ["regressed-case"],
      ),
    ).toMatchObject({ passed: false });
  });
});

describe("classifier individual release gates", () => {
  it.each([
    [
      { operationF1: 0.38 },
      [],
      "operation_f1_improvement_below_5pp",
    ],
    [
      { requiredMatched: 4 },
      [],
      "required_capability_improvement_below_2",
    ],
    [{ forbiddenOpened: 2 }, [], "forbidden_capability_regression"],
    [{ executeFalsePositives: 1 }, [], "execute_false_positive"],
    [{ persistFalsePositives: 1 }, [], "persist_false_positive"],
    [{ hintStateFalsePositives: 1 }, [], "hint_state_false_positive"],
    [{ fastRouteClassifierCalls: 1 }, [], "fast_route_classifier_call"],
    [{}, ["regressed"], "baseline_correct_case_regression"],
  ] as const)("reports the %s gate", (overrides, regressions, failure) => {
    const classifier = aggregate({
      operationF1: 0.4,
      requiredMatched: 5,
      forbiddenOpened: 1,
      ...overrides,
    });
    expect(
      evaluateClassifierEvalGate(aggregate(), classifier, regressions),
    ).toMatchObject({ passed: false, failures: expect.arrayContaining([failure]) });
  });
});

describe("classifier eval report", () => {
  it("renders metadata, limitations, gate failures, usage, and every row", () => {
    const cases = loadTrajectoryDataset().cases.slice(0, 2);
    const arm = buildClassifierEvalArm(cases, cases.map(sample));
    const report = buildClassifierEvalReport({
      datasetVersion: "chat-trajectory-v2",
      model: "configured-model",
      baseline: arm,
      classifier: arm,
      providerUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      limitations: ["No real history projection in this dataset."],
    });
    const markdown = renderClassifierEvalReport(report);

    expect(report.gate.passed).toBe(false);
    expect(markdown).toContain("configured-model");
    expect(markdown).toContain("No real history projection");
    expect(markdown).toContain("Provider token delta");
    expect(markdown).toContain("FAIL");
    for (const item of cases) expect(markdown).toContain(item.caseId);
  });
});

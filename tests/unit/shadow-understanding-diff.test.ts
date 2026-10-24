import { describe, expect, it } from "vitest";

import { loadTrajectoryDataset } from "../../evals/runner/trajectory-dataset";
import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { deriveToolEligibility } from "@/server/agents/coach-agent/operation-plan/operation-tool-eligibility";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";
import {
  buildShadowDiff,
  detectSideEffectFalsePositives,
  renderShadowDiff,
} from "../../scripts/shadow-understanding-diff";
import type { Operation } from "@/server/agents/coach-agent/turn-understanding/turn-understanding.types";
import type { ChatToolName } from "@/server/tools/chat-tools/chat-tool-contracts";

function explicitOperation(
  family: Operation["family"],
  target: Operation["target"],
  resolution: Operation["resolution"] = "explicit",
): Operation {
  return {
    id: "op0",
    family,
    target,
    sourceClauseId: "c0",
    dependsOn: [],
    evidence: [],
    resolution,
  };
}

function buildReport() {
  return buildShadowDiff(loadTrajectoryDataset().cases);
}

type CapabilityScore = {
  required: number;
  legacyMatched: number;
  operationMatched: number;
  legacyForbidden: number;
  operationForbidden: number;
};

function emptyCapabilityScore(): CapabilityScore {
  return {
    required: 0,
    legacyMatched: 0,
    operationMatched: 0,
    legacyForbidden: 0,
    operationForbidden: 0,
  };
}

function addCaseScore(
  score: CapabilityScore,
  item: ReturnType<typeof loadTrajectoryDataset>["cases"][number],
  legacyEffective: ReadonlySet<ChatToolName>,
  operationEffective: ReadonlySet<ChatToolName>,
): void {
  score.required += item.expectedTools.length;
  score.legacyMatched += item.expectedTools.filter((tool) =>
    legacyEffective.has(tool),
  ).length;
  score.operationMatched += item.expectedTools.filter((tool) =>
    operationEffective.has(tool),
  ).length;
  score.legacyForbidden += item.forbiddenTools.filter((tool) =>
    legacyEffective.has(tool),
  ).length;
  score.operationForbidden += item.forbiddenTools.filter((tool) =>
    operationEffective.has(tool),
  ).length;
}

function measureCapabilityParity() {
  const cases = loadTrajectoryDataset().cases;
  const scopeByCase = new Map(
    buildShadowDiff(cases).rows.map((row) => [row.caseId, row.scopeDisposition]),
  );
  const all = emptyCapabilityScore();
  const inScope = emptyCapabilityScore();
  const regressions: Array<{ caseId: string; missing: ChatToolName[] }> = [];
  const forbiddenRegressions: Array<{
    caseId: string;
    opened: ChatToolName[];
  }> = [];
  for (const item of cases) {
    const legacy = buildChatTurnPlan(item.userMessage);
    const actions = resolveRequestedActions(item.userMessage);
    const granted = actions
      .filter(({ decision }) => decision === "granted")
      .map(({ toolName }) => toolName);
    const legacyEffective = new Set([...legacy.toolCapabilities, ...granted]);
    const operationEffective = new Set([
      ...deriveToolEligibility(
        parseTurnUnderstanding(item.userMessage, legacy, actions),
      ),
      ...granted,
    ]);
    addCaseScore(all, item, legacyEffective, operationEffective);
    if (scopeByCase.get(item.caseId) === "in_scope") {
      addCaseScore(inScope, item, legacyEffective, operationEffective);
    }
    const missing = item.expectedTools.filter(
      (tool) => legacyEffective.has(tool) && !operationEffective.has(tool),
    );
    if (missing.length > 0) regressions.push({ caseId: item.caseId, missing });
    const opened = item.forbiddenTools.filter(
      (tool) => !legacyEffective.has(tool) && operationEffective.has(tool),
    );
    if (opened.length > 0) {
      forbiddenRegressions.push({ caseId: item.caseId, opened });
    }
  }
  return { all, inScope, regressions, forbiddenRegressions };
}

describe("shadow understanding trajectory dataset", () => {
  it("measures all 42 cases as operation sets", () => {
    const report = buildReport();
    const multi = report.rows.find(
      (row) =>
        row.caseId === "traj-v2-natural-multi-debug-run-then-history",
    );

    expect(report.rows).toHaveLength(42);
    expect(new Set(multi?.expectedOperations)).toEqual(
      new Set([
        "execute:current_user_code",
        "recall:past_mistake",
        "diagnose:current_user_code",
      ]),
    );
    expect(multi?.shadowOperations.length).toBeGreaterThan(1);
  });

  it("keeps three active C++ cases visible but outside in-scope accuracy", () => {
    const report = buildReport();
    const unsupported = report.rows.filter(
      (row) => row.scopeDisposition === "unsupported_language",
    );
    const preference = report.rows.find(
      (row) => row.caseId === "traj-v2-natural-preference-python-default",
    );

    expect(unsupported).toHaveLength(3);
    expect(unsupported.map((row) => row.caseId)).toEqual(
      expect.arrayContaining([
        "traj-v2-natural-api-cpp-unordered-map",
        "traj-v2-natural-api-cpp-priority-queue",
        "traj-v2-natural-save-cpp-priority-queue-note",
      ]),
    );
    expect(preference?.scopeDisposition).toBe("in_scope");
    expect(report.aggregate.inScopeCases).toBe(39);
  });
});

describe("shadow understanding side-effect safety", () => {
  it("does not flag legitimate expected execute or persist operations", () => {
    const rows = buildReport().rows;
    const execute = rows.find(
      (row) => row.caseId === "traj-v2-natural-run-abba-uncertain",
    );
    const persist = rows.find(
      (row) => row.caseId === "traj-v2-natural-preference-short-first",
    );

    expect(execute).toMatchObject({ executeFalsePositive: false });
    expect(persist).toMatchObject({ persistFalsePositive: false });
  });

  it.each([
    ["execute", "current_user_code", "run_current_code", "executeFalsePositive"],
    ["execute", "assistant_candidate", "verify_proposed_repair", "executeFalsePositive"],
    ["persist", "preference", "note_memory", "persistFalsePositive"],
    ["persist", "knowledge_handbook", "save_knowledge_note", "persistFalsePositive"],
    ["persist", "mistake_book", "save_mistake_book_entry", "persistFalsePositive"],
  ] as const)(
    "flags forbidden %s:%s as a side-effect false positive",
    (family, target, forbiddenTool, flag) => {
      const result = detectSideEffectFalsePositives(
        [explicitOperation(family, target)],
        [forbiddenTool] as ChatToolName[],
      );

      expect(result[flag]).toBe(true);
    },
  );

  it("does not treat an ambiguous side effect as opened", () => {
    expect(
      detectSideEffectFalsePositives(
        [explicitOperation("persist", "preference", "ambiguous")],
        ["note_memory"],
      ),
    ).toEqual({
      executeFalsePositive: false,
      persistFalsePositive: false,
    });
  });
});

describe("shadow understanding report", () => {
  it("renders a deterministic human-reviewable report with every case", () => {
    const report = buildReport();
    const markdown = renderShadowDiff(report);

    for (const row of report.rows) expect(markdown).toContain(row.caseId);
    expect(markdown).toContain("executeFP");
    expect(markdown).toContain("persistFP");
    expect(markdown).toContain("P0 regression fixtures");
    expect(markdown).toContain(
      "Delivery modifier: 1 mismatch; accuracy 97.4%.",
    );
    expect(markdown).toContain(
      "P2 rendered policy delivery: 1 mismatch; accuracy 97.4% (38/39 in scope).",
    );
    expect(markdown).toContain(
      "P2 rendered policy disclosure: 5/5 fixtures passed; full-wins-hint yes.",
    );
    expect(markdown).toContain("| ✅ | explain again");
    expect(report.aggregate).toMatchObject({
      deliveryMismatches: 1,
      deliveryAccuracy: 38 / 39,
      executeFalsePositives: 0,
      persistFalsePositives: 0,
    });
    expect(report.responsePolicyCompliance.aggregate).toMatchObject({
      inScopeCases: 39,
      deliveryMatches: 38,
      deliveryAccuracy: 38 / 39,
      disclosurePassed: 5,
      contradictionFullWinsHint: true,
    });
    expect(markdown).not.toMatch(/generated at|2026-\d\d-\d\d/iu);
    expect(renderShadowDiff(report)).toBe(markdown);
  });
});

describe("operation tool eligibility no-regression gate", () => {
  it("matches legacy required capability recall on identical case scopes", () => {
    const measurement = measureCapabilityParity();
    const diagnostic = JSON.stringify(measurement);

    expect(measurement.all, diagnostic).toMatchObject({
      required: 46,
      legacyMatched: 21,
      operationMatched: 21,
    });
    expect(measurement.inScope, diagnostic).toMatchObject({
      required: 43,
      legacyMatched: 19,
      operationMatched: 19,
    });
    expect(measurement.regressions, diagnostic).toEqual([]);
  });

  it("narrows pure-persist hint capability without widening side effects", () => {
    const measurement = measureCapabilityParity();
    const report = buildReport();
    const diagnostic = JSON.stringify(measurement.forbiddenRegressions);

    expect(measurement.forbiddenRegressions, diagnostic).toEqual([]);
    expect(measurement.all).toMatchObject({
      legacyForbidden: 7,
      operationForbidden: 6,
    });
    expect(measurement.all.operationForbidden).toBeLessThanOrEqual(
      measurement.all.legacyForbidden,
    );
    expect(report.aggregate).toMatchObject({
      executeFalsePositives: 0,
      persistFalsePositives: 0,
    });
  });
});

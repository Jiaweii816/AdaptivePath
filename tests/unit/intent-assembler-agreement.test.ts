import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileTurnUnderstandingV2 } from "@/server/agents/coach-agent/turn-understanding-v2/compile-turn-understanding-v2";
import { COVERAGE_ESCALATION_THRESHOLD } from "@/server/agents/coach-agent/turn-understanding-v2/coverage/turn-coverage";
import { requestSignature } from "@/server/agents/coach-agent/turn-understanding-v2/evaluation/request-signature";
import {
  modelAssemblerOutputSchema,
  type ModelAssemblerOutput,
} from "@/server/agents/coach-agent/turn-understanding-v2/assembler/model-assembler.types";

type LabeledCase = Readonly<{
  caseId: string;
  message: string;
  workspace: { hasCurrentCode: boolean; hasAssistantCandidate: boolean };
}>;
type Fixture = Readonly<{
  recordingScope: string;
  cases: readonly { caseId: string; output: unknown }[];
}>;

const DATASET = JSON.parse(readFileSync(
  resolve(process.cwd(), "evals/datasets/chat-intent-v3/labeled-intent-v1.json"), "utf8",
)) as { cases: readonly LabeledCase[] };
const FIXTURE = JSON.parse(readFileSync(
  resolve(process.cwd(), "tests/fixtures/intent-assembler/labeled-intent-v1-recorded-model.json"), "utf8",
)) as Fixture;

describe("intent assembler agreement", () => {
  it("keeps high-coverage deterministic and recorded-model requests aligned", () => {
    const modelByCaseId = new Map(FIXTURE.cases.map((entry) => [
      entry.caseId,
      modelAssemblerOutputSchema.parse(entry.output),
    ]));
    const highCoverage = DATASET.cases.filter((item) =>
      compileTurnUnderstandingV2(item.message, { workspace: item.workspace }).coverage.ratio >=
        COVERAGE_ESCALATION_THRESHOLD,
    );
    expect(highCoverage).not.toHaveLength(0);
    expect([...modelByCaseId.keys()].sort()).toEqual(highCoverage.map(({ caseId }) => caseId).sort());

    const comparisons = highCoverage.map((item) => {
      const deterministic = compileTurnUnderstandingV2(item.message, { workspace: item.workspace })
        .requests.map(requestSignature).sort();
      const recorded = modelSignatures(modelByCaseId.get(item.caseId)!).sort();
      return { caseId: item.caseId, deterministic, recorded };
    });
    const disagreements = comparisons.filter(({ deterministic, recorded }) =>
      !sameValues(deterministic, recorded));
    const agreementRate = requestAgreementRate(comparisons);
    process.stdout.write(`${JSON.stringify({
      fixtureScope: FIXTURE.recordingScope,
      highCoverageCases: highCoverage.length,
      agreementRate,
      disagreements,
    })}\n`);
    expect(agreementRate).toBeGreaterThanOrEqual(0.9);
  });
});

function modelSignatures(output: ModelAssemblerOutput): string[] {
  return output.requests.map((request) => {
    if (request.kind === "execute") return `execute:${request.target}`;
    if (request.kind === "persist") return `persist:${request.collection}`;
    return [
      "respond", request.deliverable, request.target, [...request.basis].sort().join("|"),
      request.delivery.depth, request.delivery.form,
    ].join(":");
  });
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requestAgreementRate(
  comparisons: readonly { deterministic: readonly string[]; recorded: readonly string[] }[],
): number {
  const counts = comparisons.reduce((total, { deterministic, recorded }) => {
    const deterministicSet = new Set(deterministic);
    const recordedSet = new Set(recorded);
    return {
      agreed: total.agreed + [...deterministicSet].filter((item) => recordedSet.has(item)).length,
      compared: total.compared + new Set([...deterministicSet, ...recordedSet]).size,
    };
  }, { agreed: 0, compared: 0 });
  return counts.compared === 0 ? 1 : counts.agreed / counts.compared;
}

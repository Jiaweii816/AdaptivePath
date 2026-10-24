import { describe, expect, it } from "vitest";

import { loadTrajectoryDataset } from "../../evals/runner/trajectory-dataset";
import {
  buildResponsePolicyCompliance,
  renderResponsePolicyCompliance,
} from "../../scripts/response-policy-compliance";

function buildCompliance() {
  return buildResponsePolicyCompliance(loadTrajectoryDataset().cases);
}

describe("P2 rendered response-policy compliance", () => {
  it("measures rendered HINT tags at or above the P1 delivery baseline", () => {
    const compliance = buildCompliance();

    expect(compliance.aggregate).toMatchObject({
      inScopeCases: 39,
      deliveryMatches: 38,
      deliveryMismatches: 1,
      deliveryAccuracy: 38 / 39,
    });
    expect(compliance.deliveryRows).toHaveLength(42);
  });

  it("passes every full-code and guided disclosure fixture", () => {
    const compliance = buildCompliance();

    expect(compliance.aggregate).toMatchObject({
      disclosureFixtures: 5,
      disclosurePassed: 5,
      contradictionFullWinsHint: true,
    });
    expect(compliance.disclosureRows.every((row) => row.passed)).toBe(true);
  });

  it("makes full code win over a contradictory hint phrase", () => {
    const contradiction = buildCompliance().disclosureRows.find(
      (row) => row.fixtureId === "full-wins-hint",
    );

    expect(contradiction).toMatchObject({
      expectedDisclosure: "full_code",
      hasExpectedContract: true,
      hasUnexpectedContract: false,
      hasFullCodeTag: true,
      hasHintTag: false,
      passed: true,
    });
  });

  it("renders a deterministic summary distinct from the P1 modifier metric", () => {
    const compliance = buildCompliance();
    const lines = renderResponsePolicyCompliance(compliance);

    expect(lines).toEqual([
      "- P2 rendered policy delivery: 1 mismatch; accuracy 97.4% (38/39 in scope).",
      "- P2 rendered policy disclosure: 5/5 fixtures passed; full-wins-hint yes.",
    ]);
    expect(renderResponsePolicyCompliance(compliance)).toEqual(lines);
  });
});

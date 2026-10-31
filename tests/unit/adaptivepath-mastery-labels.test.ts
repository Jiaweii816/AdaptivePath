import { describe, expect, it } from "vitest";
import { describeLedgerChange, LEVEL_LABELS } from "@/features/adaptivepath/mastery-labels";
import type { LedgerRow } from "@/features/adaptivepath/memory/types";

const row = (overrides: Partial<LedgerRow>): LedgerRow => ({
  conceptId: "b2e-12-2-concept-04", l1EventId: "e", condition: 1, result: "S", effect: "support", reason: null,
  levelBefore: 1, levelAfter: 1, stabilityBefore: 40, stabilityAfter: 70, ruleVersion: "bio-l2-v1", ...overrides,
});

describe("mastery labels", () => {
  it("names the four levels", () => {
    expect(LEVEL_LABELS).toEqual({ 0: "Not yet", 1: "With tutor", 2: "With reference", 3: "Independent" });
  });

  it("describes a ledger change with concept, level, stability, effect and condition", () => {
    expect(describeLedgerChange(row({}))).toBe(
      "Test crosses and sampling uncertainty: With tutor → With tutor, S 40 → 70 (support · tutor used)",
    );
  });

  it("describes a first judgment and an ineligible row", () => {
    expect(describeLedgerChange(row({ effect: "first", levelBefore: null, stabilityBefore: null, levelAfter: 2, stabilityAfter: 40, condition: 2 })))
      .toBe("Test crosses and sampling uncertainty: — → With reference, S — → 40 (first · reference used)");
    expect(describeLedgerChange(row({ effect: "ineligible", reason: "invalid_option", levelBefore: null, levelAfter: null, stabilityBefore: null, stabilityAfter: null, condition: 3 })))
      .toBe("Test crosses and sampling uncertainty: — → —, S — → — (ineligible: invalid_option · no help)");
  });
});

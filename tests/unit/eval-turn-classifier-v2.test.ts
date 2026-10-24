import { describe, expect, it } from "vitest";

import { runTaxonomyAcceptance } from "../../scripts/eval-turn-classifier";

describe("V2 classifier taxonomy eval gate", () => {
  it("emits the exact compound request sets from design sections 6 and 8", () => {
    const result = runTaxonomyAcceptance();

    expect(result.gate).toBe("passed");
    expect(result.cases).toHaveLength(2);
    expect(result.cases.every(({ passed }) => passed)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { onboardingOptions } from "@/features/onboarding/profile-defaults";

describe("profile default options", () => {
  it("does not offer the same pattern as both a strength and a weakness", () => {
    const weakPatterns = new Set<string>(onboardingOptions.weakPatterns);
    const overlappingPatterns = onboardingOptions.strongPatterns.filter((pattern) =>
      weakPatterns.has(pattern),
    );

    expect(overlappingPatterns).toEqual([]);
    expect(onboardingOptions.strongPatterns).not.toContain("Binary Search");
  });
});

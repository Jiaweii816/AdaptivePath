import { describe, expect, it } from "vitest";
import { deriveCampaignPhase } from "@/server/campaign/core";

const base = {
  campaignDate: "2026-08-03",
  endDate: "2026-08-31",
  mixedWindowDays: 7,
  advanceFrontier: [] as readonly unknown[],
  hasDeepFillCandidate: true,
};

describe("Campaign phase derivation", () => {
  it("uses coverage whenever the advance frontier is non-empty", () => {
    expect(deriveCampaignPhase({ ...base, advanceFrontier: [{ nodeId: "N1" }] })).toEqual({
      phase: "coverage",
      remainingDays: 28,
    });
  });

  it("uses deep fill after coverage while never-seen candidates remain", () => {
    expect(deriveCampaignPhase(base).phase).toBe("consolidation_deep_fill");
  });

  it("uses mixed inside the mixed window or after deep-fill exhaustion", () => {
    expect(deriveCampaignPhase({ ...base, campaignDate: "2026-08-24" }).phase).toBe(
      "consolidation_mixed",
    );
    expect(deriveCampaignPhase({ ...base, hasDeepFillCandidate: false }).phase).toBe(
      "consolidation_mixed",
    );
  });

  it("does not return to coverage because health changes, but does for a new frontier", () => {
    const healthOnly = deriveCampaignPhase({ ...base, hasDeepFillCandidate: true });
    expect(healthOnly.phase).toBe("consolidation_deep_fill");
    expect(deriveCampaignPhase({ ...base, advanceFrontier: ["new-included-node"] }).phase).toBe(
      "coverage",
    );
  });

  it("is deterministic and rejects invalid mixed windows", () => {
    expect(deriveCampaignPhase(base)).toEqual(deriveCampaignPhase(base));
    expect(() => deriveCampaignPhase({ ...base, mixedWindowDays: 0 })).toThrow(
      /positive integer/,
    );
  });
});

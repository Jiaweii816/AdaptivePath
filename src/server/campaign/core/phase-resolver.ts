import { campaignDateSchema, type CampaignPhase } from "../domain/contracts";

export type CampaignPhaseDerivationInput = Readonly<{
  advanceFrontier: readonly unknown[];
  campaignDate: string;
  endDate: string;
  mixedWindowDays: number;
  hasDeepFillCandidate: boolean;
}>;

export type CampaignPhaseDerivation = Readonly<{
  phase: CampaignPhase;
  remainingDays: number;
}>;

function utcDayNumber(value: string): number {
  campaignDateSchema.parse(value);
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

/** Campaign phase is recomputed from caller-supplied date/state and is never persisted. */
export function deriveCampaignPhase(
  input: CampaignPhaseDerivationInput,
): CampaignPhaseDerivation {
  if (!Number.isInteger(input.mixedWindowDays) || input.mixedWindowDays < 1) {
    throw new Error("mixedWindowDays must be a positive integer");
  }
  const remainingDays = utcDayNumber(input.endDate) - utcDayNumber(input.campaignDate);
  if (input.advanceFrontier.length > 0) {
    return { phase: "coverage", remainingDays };
  }
  if (remainingDays <= input.mixedWindowDays) {
    return { phase: "consolidation_mixed", remainingDays };
  }
  return {
    phase: input.hasDeepFillCandidate
      ? "consolidation_deep_fill"
      : "consolidation_mixed",
    remainingDays,
  };
}

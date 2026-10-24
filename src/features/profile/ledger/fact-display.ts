import {
  readLearnerClaimSemantics,
  type LearnerClaimFactLike,
} from "@/server/memory/claims/learner-claim-semantics";
import type {
  LedgerFactGroup,
  LedgerLadder,
} from "./ledger-types";

/** Rungs on the confidence ladder; the last one is the cap. */
export const LADDER_RUNGS = 6;
const LADDER_BASE_CONFIDENCE = 0.5;
const LADDER_STEP = 0.08;

/**
 * Process-shaped claims describe how the learner works rather than what they
 * can or cannot do, so they never read as a capability verdict.
 */
const PROCESS_FACT_TYPES = new Set([
  "strategy",
  "learning_trajectory",
  "preference",
]);

/**
 * Deterministic confidence for a fact with `evidenceCount` independent
 * sightings. This mirrors the arbitration the fact store performs; the surface
 * shows it so the number reads as computed rather than chosen by a model.
 */
export function ladderConfidence(evidenceCount: number) {
  const steps = Math.min(Math.max(evidenceCount, 1) - 1, LADDER_RUNGS - 1);
  return LADDER_BASE_CONFIDENCE + LADDER_STEP * steps;
}

export function readLadder(evidenceCount: number): LedgerLadder {
  const sightings = Math.max(evidenceCount, 0);
  const filled = Math.min(sightings, LADDER_RUNGS);
  return {
    filled,
    rungs: LADDER_RUNGS,
    beyondCap: Math.max(sightings - LADDER_RUNGS, 0),
    capped: sightings >= LADDER_RUNGS,
  };
}

/**
 * Collapses the model-facing `factType` vocabulary into the three groups the
 * page shows. Polarity is the driver because polarity is what the memory
 * system actually acts on; the raw type stays available for debugging.
 */
export function factDisplayGroup(fact: LearnerClaimFactLike): LedgerFactGroup {
  if (PROCESS_FACT_TYPES.has(fact.factType)) return "work";
  const { polarity } = readLearnerClaimSemantics(fact);
  if (polarity === "positive") return "can";
  if (polarity === "negative") return "wrong";
  return "work";
}

export const LEDGER_GROUP_LABELS: Record<LedgerFactGroup, string> = {
  can: "can do",
  wrong: "gets wrong",
  work: "how you work",
};

/**
 * Short scanning key for a fact. Prefers the mechanism key when the extraction
 * supplied one, and falls back to the stored tag. Claim-keyed tags carry no
 * meaning for a reader, so they never surface as the label.
 */
export function factMechanismKey(fact: LearnerClaimFactLike) {
  const [mechanism] = readLearnerClaimSemantics(fact).mechanismKeys;
  if (mechanism) return mechanism;
  return fact.tag.startsWith("claim_") ? fact.factType : fact.tag;
}

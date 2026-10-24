import type { LearnerClaimPolarity } from "@/server/memory/claims/learner-claim-semantics";

/**
 * Human-facing grouping for the six internal `factType` labels. The extraction
 * vocabulary is model-facing; only polarity drives system behavior, so the
 * surface collapses to three groups and keeps the raw type for debugging.
 */
export type LedgerFactGroup = "can" | "wrong" | "work";

export type LedgerEvidenceRow = {
  role: string;
  authority: string;
  problemTitle: string | null;
  reviewAttemptId: string | null;
  observedAt: Date;
};

export type LedgerLadder = {
  /** Filled rungs, one per independent sighting, capped at the rung count. */
  filled: number;
  rungs: number;
  /** Sightings beyond the cap; they cannot raise confidence any further. */
  beyondCap: number;
  capped: boolean;
};

export type LedgerFact = {
  id: string;
  factType: string;
  mechanismKey: string;
  statement: string;
  polarity: LearnerClaimPolarity;
  group: LedgerFactGroup;
  confidence: number;
  evidenceCount: number;
  lastSeenAt: Date;
  ladder: LedgerLadder;
  evidence: LedgerEvidenceRow[];
  verifiedCount: number;
  distinctProblemCount: number;
  /**
   * Stored `evidenceCount` minus traceable contribution rows. A positive value
   * means the fact counts sightings the ledger can no longer produce; it is
   * surfaced rather than silently hidden behind the larger number.
   */
  untraceableCount: number;
};

export type LedgerSlotPolarity = "positive" | "negative" | "neutral" | "mixed";

export type LedgerSynthesisSlot = {
  id: string;
  slot: string;
  polarity: LedgerSlotPolarity;
  text: string;
  /**
   * The model's own number. Nothing recomputes it, so it is reported as a
   * proposal and never presented alongside the deterministic fact ladder.
   */
  proposedConfidence: number;
  /** Gate values: the union of evidence clusters across every cited fact. */
  clusterCount: number;
  problemCount: number;
  updatedAt: Date;
  facts: LedgerFact[];
};

export type LedgerEpisode = {
  id: string;
  kind: string;
  title: string;
  outcome: string;
  tags: string[];
  createdAt: Date;
};

export type SelfReportedVerdict =
  | "confirmed"
  | "contradicted"
  | "split"
  | "unobserved";

export type SelfReportedAudit = {
  label: string;
  claimedAs: "strong" | "weak";
  verdict: SelfReportedVerdict;
  positiveFacts: LedgerFact[];
  negativeFacts: LedgerFact[];
};

export type LedgerTotals = {
  activeSlots: number;
  activeFacts: number;
  candidateFacts: number;
  evidenceRows: number;
  verifiedEvidenceRows: number;
  episodes: number;
  reviewEpisodes: number;
  chatEpisodes: number;
  citedProblems: number;
  traceEvents: number;
};

export type LedgerCandidate = {
  id: string;
  factType: string;
  statement: string;
  problemTitle: string | null;
  lastSeenAt: Date;
};

/** Raw onboarding selections, kept so the edit form can preselect them. */
export type SelfReportedSelections = {
  strongPatterns: string[];
  weakPatterns: string[];
  outputPreferences: string[];
};

export type EvidenceLedgerData = {
  displayName: string;
  interviewGoal: string | null;
  selections: SelfReportedSelections;
  totals: LedgerTotals;
  firstObservedAt: Date | null;
  lastObservedAt: Date | null;
  slots: LedgerSynthesisSlot[];
  facts: LedgerFact[];
  candidates: LedgerCandidate[];
  episodes: LedgerEpisode[];
  selfReported: SelfReportedAudit[];
  preferences: string[];
};

import type { SignalEvidence } from "../turn-understanding-v2.types";

export type EvidenceCategory =
  | "deliverable"
  | "target"
  | "basis"
  | "delivery"
  | "effect";

export type EvidencePolarity = "assert" | "deny";

/**
 * The sole output of the rule layer. Rules locate and label evidence; they do
 * not assemble requests. Offsets are UTF-16 indexes into the original message
 * and `end` is exclusive, so every downstream decision stays traceable to text.
 */
export type IntentEvidence = {
  readonly id: string;
  readonly clauseId: string;
  readonly start: number;
  readonly end: number;
  readonly category: EvidenceCategory;
  /** Canonical category value, e.g. "past_problems" for category "basis". */
  readonly value: string;
  readonly polarity: EvidencePolarity;
  readonly strength: SignalEvidence["strength"];
  /** Originating pattern kind, for evaluation attribution and trace. */
  readonly patternKind: string;
};

/**
 * A denial removes capability and never adds it, so a false positive degrades
 * to a more conservative turn while a false negative is the unsafe direction.
 */
export type CategoryDenial = {
  readonly category: EvidenceCategory;
  readonly value: string;
  readonly sourceClauseIds: readonly string[];
  readonly evidence: readonly IntentEvidence[];
};

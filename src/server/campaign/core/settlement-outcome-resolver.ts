import { plannerSelfRatingSchema } from "../domain/contracts";

export type SettlementEvidenceCandidate = Readonly<{
  source: "review" | "local_visible_run";
  referenceId: string;
  evidenceClass: string;
  evidenceAuthority: "authoritative" | "advisory";
  evidenceScope: string;
  subject: string | null;
  canVerdict: boolean;
  verdict: "passed" | "failed" | "unavailable";
  ownershipAligned: boolean;
  revisionAligned: boolean;
  executionFingerprintAligned: boolean;
  suiteAligned: boolean;
  fullVisibleSuite: boolean;
  customInput: boolean;
  assistantCandidate: boolean;
  supersededAfterReview: boolean;
}>;

export type SettlementOutcomeResolution = Readonly<{
  outcome: "no_settlement" | "positive" | "negative" | "neutral";
  passed: boolean;
  positiveForMastery: boolean;
  negativeOutcome: boolean;
  evidence: SettlementEvidenceCandidate | null;
}>;

export const CAMPAIGN_SELF_RATING_CONTRACT = {
  easy: { displayLabel: "Easy", localizedLabel: "简单", polarity: "positive" },
  hesitated: { displayLabel: "Hesitated", localizedLabel: "磕绊", polarity: "positive" },
  struggled: { displayLabel: "Struggled", localizedLabel: "困难", polarity: "negative" },
  unsolved: { displayLabel: "Unsolved", localizedLabel: "没有做出来", polarity: "negative" },
} as const;

const POSITIVE_RATINGS = new Set(
  Object.entries(CAMPAIGN_SELF_RATING_CONTRACT)
    .filter(([, value]) => value.polarity === "positive")
    .map(([rating]) => rating),
);
const NEGATIVE_RATINGS = new Set(
  Object.entries(CAMPAIGN_SELF_RATING_CONTRACT)
    .filter(([, value]) => value.polarity === "negative")
    .map(([rating]) => rating),
);
const LOCAL_CLASSES = new Set(["local_only", "verdict_bearing"]);

function alignedReviewEvidence(candidate: SettlementEvidenceCandidate | null) {
  return Boolean(
    candidate &&
    candidate.source === "review" &&
    candidate.ownershipAligned &&
    candidate.revisionAligned &&
    candidate.executionFingerprintAligned &&
    candidate.suiteAligned &&
    candidate.subject === "current_user_code" &&
    candidate.canVerdict &&
    candidate.verdict !== "unavailable",
  );
}

function alignedLocalEvidence(candidate: SettlementEvidenceCandidate | null) {
  return Boolean(
    candidate &&
    candidate.source === "local_visible_run" &&
    candidate.ownershipAligned &&
    candidate.revisionAligned &&
    candidate.executionFingerprintAligned &&
    candidate.suiteAligned &&
    candidate.fullVisibleSuite &&
    !candidate.customInput &&
    !candidate.assistantCandidate &&
    !candidate.supersededAfterReview &&
    candidate.subject === "current_user_code" &&
    candidate.canVerdict &&
    LOCAL_CLASSES.has(candidate.evidenceClass) &&
    candidate.verdict !== "unavailable",
  );
}

/** The only Campaign Settlement evidence-selection and outcome classifier. */
export function resolveSettlementOutcome(input: Readonly<{
  reviewCompleted: boolean;
  ownershipVerified: boolean;
  selfRating: unknown;
  reviewEvidence: SettlementEvidenceCandidate | null;
  localEvidence: SettlementEvidenceCandidate | null;
}>): SettlementOutcomeResolution {
  const rating = plannerSelfRatingSchema.safeParse(input.selfRating);
  if (!input.reviewCompleted || !input.ownershipVerified || !rating.success) {
    return {
      outcome: "no_settlement",
      passed: false,
      positiveForMastery: false,
      negativeOutcome: false,
      evidence: null,
    };
  }

  const evidence = alignedReviewEvidence(input.reviewEvidence)
    ? input.reviewEvidence
    : alignedLocalEvidence(input.localEvidence)
      ? input.localEvidence
      : null;

  if (NEGATIVE_RATINGS.has(rating.data)) {
    return {
      outcome: "negative",
      passed: evidence?.verdict === "passed",
      positiveForMastery: false,
      negativeOutcome: true,
      evidence,
    };
  }
  if (evidence?.verdict === "failed") {
    return {
      outcome: "negative",
      passed: false,
      positiveForMastery: false,
      negativeOutcome: true,
      evidence,
    };
  }
  if (POSITIVE_RATINGS.has(rating.data) && evidence?.verdict === "passed") {
    return {
      outcome: "positive",
      passed: true,
      positiveForMastery: true,
      negativeOutcome: false,
      evidence,
    };
  }
  return {
    outcome: "neutral",
    passed: false,
    positiveForMastery: false,
    negativeOutcome: false,
    evidence: null,
  };
}

import { normalizedSettlementInputSchema } from "../domain/contracts";
import { resolveSettlementOutcome } from "./settlement-outcome-resolver";

/** No caller-controlled `positiveForMastery` field is accepted by this function. */
export function computePositiveForMastery(input: unknown): boolean {
  return resolveNormalizedSettlementOutcome(input)?.positiveForMastery ?? false;
}

export function resolveNormalizedSettlementOutcome(input: unknown) {
  const normalized = normalizedSettlementInputSchema.safeParse(input);
  if (!normalized.success) {
    return null;
  }

  const data = normalized.data;
  return resolveSettlementOutcome({
    reviewCompleted: data.reviewCompleted,
    ownershipVerified: data.evidenceMatchesTaskProblem,
    selfRating: data.selfRating,
    reviewEvidence: {
      source: "review",
      referenceId: data.evidenceReferenceId ?? "persisted-review",
      evidenceClass: data.evidenceClass ?? "evidence_unavailable",
      evidenceAuthority: data.evidenceAuthority ?? "advisory",
      evidenceScope: data.evidenceScope ?? "selected_suite",
      subject: data.evidenceSubject ?? "current_user_code",
      canVerdict: data.evidenceCanVerdict,
      verdict: data.evidenceCanVerdict ? (data.passed ? "passed" : "failed") : "unavailable",
      ownershipAligned: data.evidenceMatchesTaskProblem,
      revisionAligned: data.evidenceMatchesCurrentRevision,
      executionFingerprintAligned: data.evidenceMatchesCurrentRevision,
      suiteAligned: data.evidenceMatchesCurrentRevision,
      fullVisibleSuite: false,
      customInput: false,
      assistantCandidate: false,
      supersededAfterReview: false,
    },
    localEvidence: data.localEvidence
      ? { source: "local_visible_run", ...data.localEvidence }
      : null,
  });
}

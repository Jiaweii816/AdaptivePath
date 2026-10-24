import type {
  CandidateSource,
  MistakeRecallBasis,
} from "./candidate-core.types";

/** The sole authority that grants a candidate the past_mistake facet. */
export function mistakeRecallBasis(args: {
  source: CandidateSource;
  factPolarity?: string | null;
  factIntegrityTrusted?: boolean;
  factEvidenceTraceIds?: string[];
  acceptedNegativeObservationIds?: string[];
  mistakeBookEntryId?: string;
  synthesisSupportingFacts?: Array<{
    id: string;
    polarity: string | null;
    trusted: boolean;
    evidenceTraceIds: string[];
  }>;
}): MistakeRecallBasis | undefined {
  if (
    args.source === "l2_fact" &&
    args.factPolarity === "negative" &&
    args.factIntegrityTrusted &&
    (args.factEvidenceTraceIds?.length ?? 0) > 0
  ) {
    return {
      kind: "durable_negative_claim",
      evidenceTraceIds: args.factEvidenceTraceIds ?? [],
    };
  }
  if (args.source === "episode" && (args.acceptedNegativeObservationIds?.length ?? 0) > 0) {
    return {
      kind: "accepted_negative_observation",
      observationIds: args.acceptedNegativeObservationIds ?? [],
    };
  }
  if (args.source === "mistake_book" && args.mistakeBookEntryId) {
    return { kind: "learner_confirmed_artifact", entryId: args.mistakeBookEntryId };
  }
  if (args.source === "synthesis") {
    const facts = (args.synthesisSupportingFacts ?? []).filter(
      (fact) => fact.polarity === "negative" && fact.trusted && fact.evidenceTraceIds.length > 0,
    );
    if (facts.length > 0) {
      return {
        kind: "validated_negative_synthesis",
        supportingFactIds: facts.map((fact) => fact.id),
        evidenceTraceIds: [...new Set(facts.flatMap((fact) => fact.evidenceTraceIds))],
      };
    }
  }
  return undefined;
}

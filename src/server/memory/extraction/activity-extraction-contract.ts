import { z } from "zod";
import {
  memoryClaimPolaritySchema,
  memoryClaimRelationSchema,
  memoryClaimScopeSchema,
  memoryClaimTypeSchema,
} from "@/server/memory/claims/open-world-claim-contract";

export const readableActivityItemSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    sourceType: z.enum([
      "practice_run",
      "chat_message",
      "review_attempt",
      "run_evidence",
      "diagnosis_result",
      "l1_event",
      "code_revision",
    ]),
    sourceId: z.string().trim().min(1),
    speaker: z.enum(["learner", "assistant", "system", "evidence"]),
    occurredAt: z.string().datetime(),
    text: z.string().trim().min(1).max(4_000),
    evidenceTraceIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export const existingClaimCandidateSchema = z
  .object({
    targetFactId: z.string().trim().min(1),
    claimType: memoryClaimTypeSchema,
    claimText: z.string().trim().min(3).max(800),
    polarity: memoryClaimPolaritySchema,
    scope: memoryClaimScopeSchema,
  })
  .strict();

export const activityExtractionInputSchema = z
  .object({
    cluster: z
      .object({
        id: z.string().trim().min(1),
        kind: z.enum(["review_rooted", "chat_only"]),
        inputHash: z.string().trim().min(1),
        independentEvidenceKey: z.string().trim().min(1),
        problemId: z.string().trim().min(1).nullable(),
        problemTitle: z.string().trim().min(1).max(300).optional(),
        problemTags: z.array(z.string().trim().min(1)).default([]),
        candidateMechanismKeys: z.array(z.string().trim().min(1)).default([]),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime().nullable(),
      })
      .strict(),
    items: z.array(readableActivityItemSchema).min(1),
    allowedLearnerEvidenceTraceIds: z.array(z.string().trim().min(1)),
    existingClaimCandidates: z.array(existingClaimCandidateSchema).default([]),
  })
  .strict();

export const activityEpisodeExtractionSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().min(3).max(800),
    outcome: z.enum([
      "resolved",
      "unresolved",
      "improved",
      "abandoned",
      "informational",
      "no_semantic_signal",
    ]),
    tags: z.array(z.string().trim().min(1).max(120)).max(16),
    salience: z.number().min(0).max(1),
    // Derivable bookkeeping: the observations already cite their evidence, and
    // told not to restate coverage the model frequently omits this too. Code
    // fills it in; when the model does supply it, the allow-list guard applies.
    evidenceTraceIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export const activityRelationProposalSchema = z
  .object({
    targetFactId: z.string().trim().min(1),
    relation: memoryClaimRelationSchema,
    modelConfidence: z.number().min(0).max(1).optional(),
    rationale: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const activityObservationSchema = z
  .object({
    claimType: memoryClaimTypeSchema,
    claimText: z.string().trim().min(3).max(800),
    polarity: memoryClaimPolaritySchema,
    scope: memoryClaimScopeSchema,
    mechanismKeys: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    evidenceStrength: z.enum(["observed", "inferred", "user_explicit"]),
    evidenceTraceIds: z.array(z.string().trim().min(1)).min(1),
    relationProposal: activityRelationProposalSchema.optional(),
  })
  .strict();

export const ignoredEvidenceSchema = z
  .object({
    evidenceTraceId: z.string().trim().min(1),
    reason: z.enum([
      "social_or_courtesy",
      "navigation_or_workflow",
      "provider_unavailable",
      "assistant_context_only",
      "insufficient_learner_signal",
      "duplicate",
      "not_relevant_to_learning",
      "retrieval_intent_only",
    ]),
  })
  .strict();

export const modelCoverageReceiptSchema = z
  .object({
    status: z.enum(["complete", "episode_only", "no_semantic_signal"]),
    ignoredEvidence: z.array(ignoredEvidenceSchema).default([]),
    noSemanticSignalReason: z.string().trim().max(500).optional(),
  })
  .strict();

export type DerivedCoverageReceipt = {
  status: "complete" | "episode_only" | "no_semantic_signal";
  examinedEvidenceTraceIds: string[];
  usedEvidenceTraceIds: string[];
  ignoredEvidence: Array<z.infer<typeof ignoredEvidenceSchema>>;
  noSemanticSignalReason?: string;
};

export const activityExtractionOutputSchema = z
  .object({
    episode: activityEpisodeExtractionSchema,
    observations: z.array(activityObservationSchema).max(24),
    coverage: modelCoverageReceiptSchema,
  })
  .strict();

const activityExtractionEnvelopeSchema = z
  .object({
    episode: activityEpisodeExtractionSchema,
    observations: z.array(z.unknown()).max(24),
    coverage: modelCoverageReceiptSchema,
  })
  .strict();
const observationListEnvelopeSchema = z
  .object({ observations: z.array(z.unknown()).max(24) })
  .passthrough();

export type ActivityExtractionInput = z.input<
  typeof activityExtractionInputSchema
>;
export type ParsedActivityExtractionInput = z.output<
  typeof activityExtractionInputSchema
>;
export type ModelActivityExtractionOutput = z.output<
  typeof activityExtractionOutputSchema
>;
export type ActivityExtractionOutput = Omit<
  ModelActivityExtractionOutput,
  "coverage"
> & { coverage: DerivedCoverageReceipt };
export type ActivityExtractionEnvelope = Omit<
  ActivityExtractionOutput,
  "observations"
> & { observations: unknown[] };

export function parseActivityExtractionOutput(
  raw: unknown,
  inputValue: ActivityExtractionInput,
): ActivityExtractionOutput {
  const envelope = parseActivityExtractionEnvelope(raw, inputValue);
  const input = activityExtractionInputSchema.parse(inputValue);
  const allowed = new Set(input.allowedLearnerEvidenceTraceIds);
  const targetFactIds = new Set(
    input.existingClaimCandidates.map((candidate) => candidate.targetFactId),
  );

  const observations = envelope.observations
    .map((observation) => activityObservationSchema.parse(observation))
    .filter((observation) =>
      observation.evidenceTraceIds.every((id) => allowed.has(id)),
    );
  for (const observation of observations) {
    if (
      observation.evidenceTraceIds.every((id) =>
        isRecallOnlyEvidence(input, id),
      )
    ) {
      throw new Error("retrieval_intent_cannot_create_l2_observation");
    }
    const relation = observation.relationProposal;
    if (relation && !targetFactIds.has(relation.targetFactId)) {
      throw new Error(`relation_target_not_supplied:${relation.targetFactId}`);
    }
  }

  enforceCoverageStatus(envelope.coverage.status, observations.length);
  return { ...envelope, observations };
}

export function parseActivityExtractionEnvelope(
  raw: unknown,
  inputValue: ActivityExtractionInput,
): ActivityExtractionEnvelope {
  const input = activityExtractionInputSchema.parse(inputValue);
  const output = activityExtractionEnvelopeSchema.parse(raw);
  const validObservations = output.observations.flatMap((observation) => {
    const parsed = activityObservationSchema.safeParse(observation);
    return parsed.success ? [parsed.data] : [];
  });
  const allowed = new Set(input.allowedLearnerEvidenceTraceIds);
  const allowedObservations = validObservations.filter((observation) =>
    observation.evidenceTraceIds.every((id) => allowed.has(id)),
  );
  const episodeEvidence = output.episode.evidenceTraceIds?.filter((id) =>
    allowed.has(id),
  );

  return {
    ...output,
    episode: {
      ...output.episode,
      evidenceTraceIds: deriveEpisodeEvidence(
        input,
        {
          ...output,
          episode: { ...output.episode, evidenceTraceIds: episodeEvidence },
        },
        allowedObservations,
      ),
    },
    coverage: deriveCoverage(input, output.coverage, allowedObservations),
  };
}

export function collectDisallowedObservations(
  raw: unknown,
  inputValue: ActivityExtractionInput,
): Array<{ index: number; reason: string }> {
  const input = activityExtractionInputSchema.parse(inputValue);
  const allowed = new Set(input.allowedLearnerEvidenceTraceIds);
  const output = observationListEnvelopeSchema.parse(raw);
  return output.observations.flatMap((observation, index) => {
    const parsed = activityObservationSchema.safeParse(observation);
    if (!parsed.success) return [];
    const offender = parsed.data.evidenceTraceIds.find(
      (id) => !allowed.has(id),
    );
    return offender
      ? [{ index, reason: `observation_evidence_not_allowed:${offender}` }]
      : [];
  });
}

function deriveEpisodeEvidence(
  input: ParsedActivityExtractionInput,
  output: z.infer<typeof activityExtractionEnvelopeSchema>,
  observations: Array<z.infer<typeof activityObservationSchema>>,
) {
  if (output.episode.evidenceTraceIds?.length) {
    return output.episode.evidenceTraceIds;
  }
  const cited = [
    ...new Set(observations.flatMap((observation) => observation.evidenceTraceIds)),
  ];
  return cited.length > 0 ? cited : [...input.allowedLearnerEvidenceTraceIds];
}

function deriveCoverage(
  input: ParsedActivityExtractionInput,
  coverage: z.infer<typeof modelCoverageReceiptSchema>,
  observations: Array<z.infer<typeof activityObservationSchema>>,
): DerivedCoverageReceipt {
  const observationEvidence = new Set(
    observations.flatMap((observation) => observation.evidenceTraceIds),
  );
  const declaredIgnoreReasons = new Map(
    coverage.ignoredEvidence.map((item) => [item.evidenceTraceId, item.reason]),
  );
  return {
    // Observations are the semantic content of the activity, so their presence
    // decides the status rather than the model's own label. The model still
    // picks between episode_only and no_semantic_signal when it emits none.
    status: deriveCoverageStatus(coverage.status, observations.length),
    examinedEvidenceTraceIds: [...input.allowedLearnerEvidenceTraceIds],
    usedEvidenceTraceIds: [...observationEvidence],
    ignoredEvidence: input.allowedLearnerEvidenceTraceIds
      .filter((id) => !observationEvidence.has(id))
      .map((evidenceTraceId) => ({
        evidenceTraceId,
        reason:
          declaredIgnoreReasons.get(evidenceTraceId) ??
          ("insufficient_learner_signal" as const),
      })),
    noSemanticSignalReason: coverage.noSemanticSignalReason,
  };
}

function deriveCoverageStatus(
  modelStatus: DerivedCoverageReceipt["status"],
  observationCount: number,
): DerivedCoverageReceipt["status"] {
  if (observationCount > 0) return "complete";
  return modelStatus === "complete" ? "no_semantic_signal" : modelStatus;
}

export function enforceCoverageStatus(
  status: DerivedCoverageReceipt["status"],
  observationCount: number,
) {
  if (observationCount === 0) {
    if (!["episode_only", "no_semantic_signal"].includes(status)) {
      throw new Error("empty_observations_require_non_l2_coverage_receipt");
    }
  } else if (status !== "complete") {
    throw new Error("observations_require_complete_coverage_receipt");
  }
}

export function isRecallOnlyEvidence(
  input: ParsedActivityExtractionInput,
  evidenceTraceId: string,
) {
  const citedItems = input.items.filter((item) =>
    item.evidenceTraceIds.includes(evidenceTraceId),
  );
  return (
    citedItems.length > 0 &&
    citedItems.every(
      (item) => item.speaker === "learner" && isRecallOnlyQuestion(item.text),
    )
  );
}

function isRecallOnlyQuestion(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim().toLowerCase();
  const asksPastRecall =
    /(?:上次|之前|以前|过去|曾经).*(?:哪里|哪儿|什么|怎么|栽坑|踩坑|犯错|错误|问题|提醒|记得|回忆)/u.test(
      normalized,
    ) ||
    /(?:提醒|告诉).*(?:上次|之前|以前).*(?:错误|问题|栽坑|踩坑)/u.test(
      normalized,
    ) ||
    /(?:last time|previously|before|past).*(?:where|what|mistake|error|fail|went wrong|remind|recall|remember)/u.test(
      normalized,
    );
  const exposesCurrentEvidence =
    /(?:这次|现在|当前).*(?:失败|报错|忘了|漏了|不会|卡住|做错)/u.test(
      normalized,
    ) ||
    /(?:又|再次).*(?:失败|忘了|漏了|犯错|做错)/u.test(normalized) ||
    /(?:failed|failing|forgot|omitted|stuck|wrong).*(?:again|this time|currently|now)/u.test(
      normalized,
    );
  return asksPastRecall && !exposesCurrentEvidence;
}

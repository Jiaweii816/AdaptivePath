import { z } from "zod";

export const memoryClaimTypeSchema = z.enum([
  "strength",
  "weakness",
  "mistake",
  "preference",
  "strategy",
  "knowledge_state",
  "learning_trajectory",
  "unresolved_confusion",
]);

export const memoryClaimPolaritySchema = z.enum([
  "positive",
  "negative",
  "neutral",
]);

export const memoryClaimScopeSchema = z
  .object({
    level: z.enum(["problem", "mechanism", "cross_problem"]),
    problemIds: z.array(z.string().trim().min(1)).default([]),
    topicHints: z.array(z.string().trim().min(1)).default([]),
    context: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const memoryClaimObservationInputSchema = z
  .object({
    userId: z.string().trim().min(1),
    activityClusterId: z.string().trim().min(1),
    problemId: z.string().trim().min(1).optional(),
    episodeId: z.string().trim().min(1).optional(),
    claimType: memoryClaimTypeSchema,
    claimText: z.string().trim().min(3).max(800),
    polarity: memoryClaimPolaritySchema,
    scope: memoryClaimScopeSchema,
    mechanismKeys: z.array(z.string().trim().min(1)).default([]),
    source: z.string().trim().min(1),
    evidenceStrength: z.enum(["observed", "inferred", "user_explicit"]),
  })
  .strict();

export const memoryClaimRelationSchema = z.enum([
  "equivalent",
  "reinforces",
  "contradicts",
  "refines",
  "related",
  "unrelated",
]);

export const memoryClaimRelationProposalSchema = z
  .object({
    targetClusterFactId: z.string().trim().min(1),
    relation: memoryClaimRelationSchema,
    modelConfidence: z.number().min(0).max(1).optional(),
    rationale: z.string().trim().min(1).max(800).optional(),
  })
  .strict();

export const memoryEvidenceRoleSchema = z.enum([
  "learner_statement",
  "execution_failure",
  "execution_success",
  "assisted_repair",
  "self_correction",
  "assistant_context",
]);

export const memoryEvidenceTransitionSchema = z.enum([
  "support",
  "resolve",
  "contradict",
]);

export const memoryEvidenceInputSchema = z
  .object({
    evidenceRole: memoryEvidenceRoleSchema,
    authority: z.enum(["explicit", "verified", "observed", "context_only"]),
    revisionKey: z.string().trim().min(1),
    evidenceTraceIds: z.array(z.string().trim().min(1)).min(1),
    reviewAttemptId: z.string().trim().min(1).optional(),
  })
  .strict();

export const memoryClaimMaterializationInputSchema = z
  .object({
    observationId: z.string().trim().min(1),
    relation: memoryClaimRelationProposalSchema.optional(),
    evidence: z.array(memoryEvidenceInputSchema).min(1),
  })
  .strict();

export const memoryExtractionReceiptStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partial",
  "no_semantic_signal",
  "failed",
  "policy_rejected",
]);

export type MemoryClaimScope = z.infer<typeof memoryClaimScopeSchema>;
export type MemoryClaimObservationInput = z.infer<
  typeof memoryClaimObservationInputSchema
>;
export type MemoryClaimRelation = z.infer<typeof memoryClaimRelationSchema>;
export type MemoryClaimMaterializationInput = z.infer<
  typeof memoryClaimMaterializationInputSchema
>;

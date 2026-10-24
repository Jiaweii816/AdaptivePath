import { z } from "zod";

export const failureProvenanceSchema = z.enum([
  "user_code",
  "user_input",
  "judge_service",
  "sandbox_service",
  "adapter",
  "network",
  "unknown",
]);

export const evidenceClassSchema = z.enum([
  "verdict_bearing",
  "evidence_unavailable",
  "user_input",
  "local_only",
]);

export const evidenceReplyModeSchema = z.enum([
  "diagnostic",
  "success",
  "unavailable",
  "user_input_fix",
  "local_fallback",
]);

export const evidenceCapabilitySchema = z.object({
  canVerdict: z.boolean(),
  canWriteMistakeMemory: z.boolean(),
  canWriteEpisode: z.boolean(),
  canSignalPlanner: z.boolean(),
  canUseFailureSalience: z.boolean(),
});

export const evidenceVerdictSchema = z.object({
  evidenceClass: evidenceClassSchema,
  replyMode: evidenceReplyModeSchema,
  capabilities: evidenceCapabilitySchema,
  status: z.string(),
  provenance: failureProvenanceSchema.optional(),
  providerUsed: z.string().optional(),
  scopeLabel: z.string(),
  modelInstruction: z.string(),
  fallbackFromProvider: z.string().optional(),
});

export type FailureProvenance = z.infer<typeof failureProvenanceSchema>;
export type EvidenceClass = z.infer<typeof evidenceClassSchema>;
export type EvidenceReplyMode = z.infer<typeof evidenceReplyModeSchema>;
export type EvidenceCapability = z.infer<typeof evidenceCapabilitySchema>;
export type EvidenceVerdict = z.infer<typeof evidenceVerdictSchema>;

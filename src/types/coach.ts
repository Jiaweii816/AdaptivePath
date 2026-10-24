import { z } from "zod";
import { codeRunStatusSchema } from "./code-runner";

export const memoryUpdateCandidateFactSchema = z.object({
  factType: z.string(),
  tag: z.string(),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.6),
  evidenceSummary: z.string().optional(),
});

export const memoryUpdateCandidateSchema = z.object({
  facts: z.array(memoryUpdateCandidateFactSchema).default([]),
  summary: z.string().optional(),
});

export const coachSelfCheckSchema = z.object({
  question: z.string().trim().min(1),
  answer: z.string().trim().min(1),
});

export const coachDiagnosisSchema = z.object({
  problemSlug: z.string(),
  runStatus: codeRunStatusSchema,
  userIssueSummary: z.string(),
  coachSummary: z.string(),
  mistakeTags: z.array(z.string()).default([]),
  skillTags: z.array(z.string()).default([]),
  selfCheck: coachSelfCheckSchema.nullable().optional(),
  memoryUpdateCandidate: memoryUpdateCandidateSchema.default({ facts: [] }),
});

export const coachReviewDegradationSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  reason: z.string(),
  memorySkipped: z.boolean(),
  safetyReplaced: z.boolean().optional(),
});

export const coachReviewResultSchema = z.object({
  diagnosis: coachDiagnosisSchema,
  coachReply: z.string(),
  degraded: coachReviewDegradationSchema.optional(),
});

export const coachChatResultSchema = z.object({
  coachReply: z.string(),
});

export type MemoryUpdateCandidateFact = z.infer<
  typeof memoryUpdateCandidateFactSchema
>;
export type MemoryUpdateCandidate = z.infer<
  typeof memoryUpdateCandidateSchema
>;
export type CoachSelfCheck = z.infer<typeof coachSelfCheckSchema>;
export type CoachDiagnosis = z.infer<typeof coachDiagnosisSchema>;
export type CoachReviewResult = z.infer<typeof coachReviewResultSchema>;
export type CoachReviewDegradation = z.infer<
  typeof coachReviewDegradationSchema
>;
export type CoachChatResult = z.infer<typeof coachChatResultSchema>;

import { z } from "zod";

/**
 * Minimal durable hand-off from the deterministic foreground matcher to the
 * background MemoryAgent. Rich evidence is always reloaded relationally; the
 * L1 payload only names the closed chain.
 */
export const assistedRepairChainClosedPayloadSchema = z
  .object({
    version: z.literal(1),
    repairKey: z.string().trim().min(8).max(200),
    failedPracticeRunLogId: z.string().trim().min(1),
    userChatMessageId: z.string().trim().min(1),
    userChatTraceId: z.string().trim().min(1),
    assistantChatMessageId: z.string().trim().min(1),
    assistantChatTraceId: z.string().trim().min(1),
    passedRunEvidenceId: z.string().trim().min(1),
    failedExecutionFingerprint: z.string().trim().min(1),
    passedExecutionFingerprint: z.string().trim().min(1),
    failedCodeHash: z.string().trim().min(1),
    passedCodeHash: z.string().trim().min(1),
    selectedTestCaseIds: z.array(z.string().trim().min(1)).min(1),
    evidenceScope: z.object({
      evidenceClass: z.enum(["verdict_bearing", "local_only"]),
      providerUsed: z.string().trim().min(1),
    }),
  })
  .strict();

export type AssistedRepairChainClosedPayload = z.infer<
  typeof assistedRepairChainClosedPayloadSchema
>;

export const ASSISTED_REPAIR_CHAIN_EVENT_TYPE =
  "assisted_repair_chain_closed" as const;
export const ASSISTED_REPAIR_CHAIN_EVENT_SOURCE =
  "review_pipeline:assisted_repair_matcher" as const;

export const assistedRepairAttributionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("attributed"),
    canonicalMechanismProposal: z.string().trim().min(1).max(120),
    rationale: z.string().trim().min(1).max(300),
  }),
  z.object({
    status: z.enum(["uncertain", "not_attributable"]),
    rationale: z.string().trim().min(1).max(300),
  }),
]);

export const assistedRepairConsolidationOutputSchema = z.object({
  mistakeSummary: z.string().trim().min(1).max(500),
  coachGuidance: z.string().trim().min(1).max(500),
  repairSummary: z.string().trim().min(1).max(500),
  attribution: assistedRepairAttributionSchema,
});

export type AssistedRepairConsolidationOutput = z.infer<
  typeof assistedRepairConsolidationOutputSchema
>;

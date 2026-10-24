import { z } from "zod";

const requestIdSchema = z.string().regex(/^req(?:0|[1-9]\d*)$/u);
const sourceClauseIdsSchema = z.array(z.string().min(1)).min(1);

const deliverableSchema = z.enum([
  "solve",
  "fix",
  "understand",
  "improve",
  "recommend",
  "recall",
  "chat",
]);

const targetSchema = z.enum(["current", "concept", "api"]);

const basisSchema = z.enum([
  "current_evidence",
  "past_problems",
  "past_mistakes",
  "learner_profile",
  "concept_kb",
  "api_kb",
  "practice_catalog",
]);

const deliverySchema = z.object({
  depth: z.enum(["hint", "normal", "full"]),
  form: z.enum(["prose", "pseudocode", "patch", "trace"]),
  count: z.number().int().positive().optional(),
}).strict();

const requestBase = {
  id: requestIdSchema,
  sourceClauseIds: sourceClauseIdsSchema,
  dependsOn: z.array(requestIdSchema).default([]),
};

const respondProposalSchema = z.object({
  ...requestBase,
  kind: z.literal("respond"),
  deliverable: deliverableSchema,
  target: targetSchema,
  basis: z.array(basisSchema).min(1),
  delivery: deliverySchema,
}).strict();

const executeProposalSchema = z.object({
  ...requestBase,
  kind: z.literal("execute"),
  target: z.enum(["current", "candidate"]),
}).strict();

const persistProposalSchema = z.object({
  ...requestBase,
  kind: z.literal("persist"),
  collection: z.enum(["preference", "knowledge_handbook", "mistake_book"]),
  // This must remain verbatim user-authored text. The backend verifies it
  // against the requested-action ledger before materializing the request.
  content: z.string().min(1),
}).strict();

export const semanticRequestProposalSchema = z.discriminatedUnion("kind", [
  respondProposalSchema,
  executeProposalSchema,
  persistProposalSchema,
]);

const alternativeSchema = z.object({
  kind: z.enum(["respond", "execute", "persist"]),
  summary: z.string().trim().min(1).max(240),
}).strict();

const certaintySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("confident"),
    confidence: z.number().min(0).max(1),
    alternatives: z.array(alternativeSchema).max(3).default([]),
  }).strict(),
  z.object({
    status: z.literal("ambiguous"),
    ambiguityReason: z.enum([
      "request_structure_unclear",
      "response_target_unclear",
      "effect_target_unclear",
      "modifier_scope_unclear",
      "conflicting_requests",
    ]),
    alternatives: z.array(alternativeSchema).min(1).max(3),
  }).strict(),
]);

export const semanticClassifierOutputSchema = z.object({
  schemaVersion: z.literal("turn_semantic_proposal_v2"),
  requests: z.array(semanticRequestProposalSchema).max(8),
  certainty: certaintySchema,
}).strict();

export type SemanticClassifierOutput = z.infer<
  typeof semanticClassifierOutputSchema
>;
export type SemanticRequestProposal = z.infer<
  typeof semanticRequestProposalSchema
>;

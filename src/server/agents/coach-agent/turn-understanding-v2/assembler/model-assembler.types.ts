import { z } from "zod";

const requestBaseSchema = {
  id: z.string().min(1),
  sourceClauseIds: z.array(z.string().min(1)),
  dependsOn: z.array(z.string().min(1)),
};

const basisSchema = z.enum([
  "current_evidence",
  "past_problems",
  "past_mistakes",
  "learner_profile",
  "concept_kb",
  "api_kb",
  "practice_catalog",
]);

const responseSchema = z.object({
  ...requestBaseSchema,
  kind: z.literal("respond"),
  deliverable: z.enum(["solve", "fix", "understand", "improve", "recall", "recommend", "chat"]),
  target: z.enum(["current", "concept", "api"]),
  basis: z.array(basisSchema),
  delivery: z.object({
    depth: z.enum(["hint", "normal", "full"]),
    form: z.enum(["prose", "pseudocode", "patch", "trace"]),
    count: z.number().int().positive().optional(),
  }).strict(),
}).strict();

const executeSchema = z.object({
  ...requestBaseSchema,
  kind: z.literal("execute"),
  target: z.enum(["current", "candidate"]),
}).strict();

const persistSchema = z.object({
  ...requestBaseSchema,
  kind: z.literal("persist"),
  collection: z.enum(["preference", "knowledge_handbook", "mistake_book"]),
  content: z.string(),
}).strict();

/** The model can express categories only; backend projection owns context and capabilities. */
export const modelAssemblerOutputSchema = z.object({
  requests: z.array(z.discriminatedUnion("kind", [responseSchema, executeSchema, persistSchema])),
  denials: z.array(z.object({
    category: z.enum(["deliverable", "target", "basis", "delivery", "effect"]),
    value: z.string(),
  }).strict()),
  certainty: z.object({
    status: z.enum(["confident", "ambiguous"]),
    confidence: z.number().min(0).max(1),
  }).strict(),
}).strict();

export type ModelAssemblerOutput = z.infer<typeof modelAssemblerOutputSchema>;

import { z } from "zod";

import type {
  OperationFamily,
  OperationTarget,
} from "../turn-understanding/turn-understanding.types";

const operationFamilyValues = [
  "answer",
  "lookup_api",
  "diagnose",
  "execute",
  "optimize",
  "recall",
  "profile_meta",
  "recommend",
  "persist",
] as const satisfies readonly OperationFamily[];

const operationTargetValues = [
  "current_user_code",
  "assistant_candidate",
  "current_approach",
  "active_problem",
  "concept",
  "api_object",
  "past_problem",
  "past_mistake",
  "learner_profile",
  "practice_problem",
  "preference",
  "knowledge_handbook",
  "mistake_book",
  "contextual_referent",
  "unspecified",
] as const satisfies readonly OperationTarget[];

export const operationFamilySchema = z.enum(operationFamilyValues);
export const operationTargetSchema = z.enum(operationTargetValues);

const canonicalOperationIdSchema = z.string().regex(/^op(?:0|[1-9]\d*)$/);

const classifierOperationSchema = z
  .object({
    family: operationFamilySchema,
    target: operationTargetSchema,
    topic: z.enum(["concept", "api", "general"]).optional(),
    dependsOn: z.array(canonicalOperationIdSchema).default([]),
  })
  .strict();

const classifierModifiersSchema = z
  .object({
    deliveryMode: z.enum(["direct", "hint"]),
    codeDisclosure: z.enum(["guided", "full_code"]),
    affect: z.enum(["none", "anxious_stuck"]),
    requestedCount: z.number().int().positive().optional(),
  })
  .strict();

export const classifierOutputSchema = z
  .object({
    operations: z.array(classifierOperationSchema).max(6),
    modifiers: classifierModifiersSchema,
  })
  .strict();

export type ClassifierOutput = z.infer<typeof classifierOutputSchema>;

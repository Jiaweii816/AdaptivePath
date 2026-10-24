import { createHash } from "node:crypto";
import { z } from "zod";
import { campaignNodeIdSchema } from "./contracts";

export const LEGACY_CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION = 1 as const;
export const CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION = 2 as const;
export const CAMPAIGN_NODE_PRIORITY_MIN = 0;
export const CAMPAIGN_NODE_PRIORITY_MAX = 100;
export const CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH = 500;
export const CAMPAIGN_PATCH_MAX_OPERATIONS = 50;

const nodeId = campaignNodeIdSchema;
const boundedRationale = z.string().trim().min(1).max(CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH);

const setNodeIncludedSchema = z.object({
  type: z.literal("set_node_included"),
  nodeId,
  included: z.boolean(),
}).strict();

const moveNodeSchema = z.object({
  type: z.literal("move_node"),
  nodeId,
  beforeNodeId: nodeId.optional(),
  afterNodeId: nodeId.optional(),
}).strict().refine(
  (value) => Number(value.beforeNodeId !== undefined) + Number(value.afterNodeId !== undefined) === 1,
  { message: "move_node requires exactly one of beforeNodeId or afterNodeId" },
);

const setNodePrioritySchema = z.object({
  type: z.literal("set_node_priority"),
  nodeId,
  priority: z.number().int().min(CAMPAIGN_NODE_PRIORITY_MIN).max(CAMPAIGN_NODE_PRIORITY_MAX),
}).strict();

const setTargetWeekSchema = z.object({
  type: z.literal("set_target_week"),
  nodeId,
  targetWeek: z.number().int().min(1),
}).strict();

export const campaignGoalDepthSchema = z.enum(["mastery", "exposure"]);
export type CampaignGoalDepth = z.infer<typeof campaignGoalDepthSchema>;

const setGoalDepthSchema = z.object({
  type: z.literal("set_goal_depth"),
  nodeId,
  goalDepth: campaignGoalDepthSchema,
}).strict();

const setTargetByDateSchema = z.object({
  type: z.literal("set_target_by_date"),
  nodeId,
  targetByDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]),
}).strict();

const setNodeRationaleSchema = z.object({
  type: z.literal("set_node_rationale"),
  nodeId,
  rationale: boundedRationale,
}).strict();

const setMixedWindowDaysSchema = z.object({
  type: z.literal("set_mixed_window_days"),
  mixedWindowDays: z.number().int().min(1),
}).strict();

export const campaignSkeletonPatchOperationSchema = z.discriminatedUnion("type", [
  setNodeIncludedSchema,
  moveNodeSchema,
  setNodePrioritySchema,
  setTargetWeekSchema,
  setGoalDepthSchema,
  setTargetByDateSchema,
  setNodeRationaleSchema,
  setMixedWindowDaysSchema,
]);
export type CampaignSkeletonPatchOperation = z.infer<typeof campaignSkeletonPatchOperationSchema>;

export type StoredCampaignSkeletonPatchOperation = CampaignSkeletonPatchOperation & {
  operationId: string;
};
export const storedCampaignSkeletonPatchOperationSchema = z.object({
  operationId: z.string().regex(/^op-\d{3}$/),
}).passthrough().superRefine((value, context) => {
  const operation = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "operationId"),
  );
  const parsed = campaignSkeletonPatchOperationSchema.safeParse(operation);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  }
}).transform((value) => value as StoredCampaignSkeletonPatchOperation);

export const dailyBudgetSuggestionSchema = z.object({
  proposedBudget: z.number().int().min(3),
  rationale: boundedRationale,
}).strict();
export type DailyBudgetSuggestion = z.infer<typeof dailyBudgetSuggestionSchema>;

export const dateBudgetSuggestionSchema = z.object({
  campaignDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maxQuestions: z.number().int().min(3),
  rationale: boundedRationale,
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
export type DateBudgetSuggestion = z.infer<typeof dateBudgetSuggestionSchema>;

export const campaignSkeletonPatchProposalSchema = z.object({
  patchSchemaVersion: z.union([
    z.literal(LEGACY_CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION),
    z.literal(CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION),
  ]),
  baseVersion: z.number().int().min(1),
  trigger: z.string().trim().min(1).max(100).regex(/^[a-z0-9_:-]+$/),
  rationale: boundedRationale,
  operations: z.array(campaignSkeletonPatchOperationSchema).max(CAMPAIGN_PATCH_MAX_OPERATIONS),
  dailyBudgetSuggestion: dailyBudgetSuggestionSchema.nullable().optional(),
  dateBudgetSuggestions: z.array(dateBudgetSuggestionSchema).max(90).optional(),
}).strict().superRefine((value, context) => {
  const dateSuggestions = value.dateBudgetSuggestions ?? [];
  if (value.patchSchemaVersion === LEGACY_CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION) {
    if (value.operations.length === 0) {
      context.addIssue({ code: "custom", path: ["operations"], message: "Patch schema version 1 requires at least one operation" });
    }
    if (dateSuggestions.length > 0) {
      context.addIssue({ code: "custom", path: ["dateBudgetSuggestions"], message: "Date budget suggestions require patch schema version 2" });
    }
    for (const [index, operation] of value.operations.entries()) {
      if (operation.type === "set_goal_depth" || operation.type === "set_target_by_date") {
        context.addIssue({ code: "custom", path: ["operations", index], message: `${operation.type} requires patch schema version 2` });
      }
    }
  }
  if (
    value.patchSchemaVersion === CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION &&
    value.operations.length === 0 &&
    !value.dailyBudgetSuggestion &&
    dateSuggestions.length === 0
  ) {
    context.addIssue({ code: "custom", path: ["operations"], message: "Patch must contain an operation or budget suggestion" });
  }
  const dates = new Set<string>();
  for (const [index, suggestion] of dateSuggestions.entries()) {
    if (dates.has(suggestion.campaignDate)) {
      context.addIssue({ code: "custom", path: ["dateBudgetSuggestions", index, "campaignDate"], message: "Duplicate campaignDate" });
    }
    dates.add(suggestion.campaignDate);
  }
});
export type CampaignSkeletonPatchProposal = z.infer<typeof campaignSkeletonPatchProposalSchema>;

export const storedCampaignSkeletonPatchOperationsSchema = z.object({
  patchSchemaVersion: z.union([
    z.literal(LEGACY_CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION),
    z.literal(CAMPAIGN_SKELETON_PATCH_SCHEMA_VERSION),
  ]),
  operations: z.array(storedCampaignSkeletonPatchOperationSchema).max(CAMPAIGN_PATCH_MAX_OPERATIONS),
}).strict();

export const campaignPatchStatusSchema = z.enum([
  "pending",
  "accepted",
  "partially_accepted",
  "rejected",
]);
export type CampaignPatchStatus = z.infer<typeof campaignPatchStatusSchema>;

export const campaignPatchActorTypeSchema = z.enum(["user", "strategist", "system"]);
export type CampaignPatchActorType = z.infer<typeof campaignPatchActorTypeSchema>;

export const campaignPatchDecisionActionSchema = z.enum([
  "accepted",
  "partially_accepted",
  "rejected",
]);

export const dailyBudgetDecisionSchema = z.enum(["not_present", "accepted", "rejected"]);
export type DailyBudgetDecision = z.infer<typeof dailyBudgetDecisionSchema>;

export function canonicalizePatchOperations(
  operations: readonly CampaignSkeletonPatchOperation[],
): StoredCampaignSkeletonPatchOperation[] {
  return operations.map((operation, index) => ({
    operationId: `op-${String(index + 1).padStart(3, "0")}`,
    ...operation,
  }));
}

/** Stable key ordering makes JSON audit rows and fingerprints portable and replayable. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintCampaignPatch(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

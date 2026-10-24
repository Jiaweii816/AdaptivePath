import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CAMPAIGN_PATCH_MAX_OPERATIONS,
  CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH,
  campaignSkeletonPatchOperationSchema,
  dailyBudgetSuggestionSchema,
} from "./skeleton-patch-contracts";
import { campaignDateSchema, campaignPhaseSchema, masteryHealthSchema, masteryStateSchema } from "./contracts";

export const STRATEGIST_EVALUATOR_VERSION = "strategist-wake-v1";
export const STRATEGIST_PROMPT_VERSION = "strategist-proposal-v1";
export const STRATEGIST_READ_MODEL_VERSION = 1 as const;
export const STRATEGIST_READ_MODEL_MAX_CHARS = 24_000;
export const STRATEGIST_RECEIPT_WINDOW_DAYS = 7;
export const STRATEGIST_PLANNING_HISTORY_LIMIT = 5;
export const STRATEGIST_REPAIR_BACKLOG_THRESHOLD = 3;
export const STRATEGIST_OLDEST_REPAIR_DAYS_THRESHOLD = 3;
export const STRATEGIST_CONSECUTIVE_INCOMPLETE_THRESHOLD = 2;
export const STRATEGIST_PERSISTENT_SHORTFALL_THRESHOLD = 2;
export const STRATEGIST_MAX_OPERATIONS = Math.min(8, CAMPAIGN_PATCH_MAX_OPERATIONS);

export const strategistTriggerSchema = z.enum([
  "goal_changed",
  "significant_state_change",
  "weekly_boundary",
]);
export type StrategistTrigger = z.infer<typeof strategistTriggerSchema>;

export const strategistRunStatusSchema = z.enum([
  "queued",
  "running",
  "needs_clarification",
  "waiting_approval",
  "no_change",
  "proposed",
  "invalid",
  "failed",
  "canceled",
  "stale",
  "budget_exhausted",
]);
export type StrategistRunStatus = z.infer<typeof strategistRunStatusSchema>;

const nodeIdSchema = z.string().regex(/^N(?:[1-9]|1\d|20)$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });

const strategistNodePlanSchema = z.object({
  nodeId: nodeIdSchema,
  nodeName: z.string().min(1).max(100),
  included: z.boolean(),
  order: z.number().int().positive(),
  priority: z.number().int(),
  targetWeek: z.number().int().positive(),
  goalDepth: z.enum(["mastery", "exposure"]).default("mastery"),
  targetByDate: campaignDateSchema.nullable().optional(),
  rationale: z.string().max(500),
  requiredPrerequisites: z.array(nodeIdSchema),
  recommendedPrerequisites: z.array(nodeIdSchema),
}).strict();

const strategistLearnerNodeSchema = z.object({
  nodeId: nodeIdSchema,
  nodeName: z.string().min(1).max(100),
  included: z.boolean(),
  unlocked: z.boolean(),
  started: z.boolean(),
  masteryState: masteryStateSchema,
  masteryHealth: masteryHealthSchema,
  latestPositiveStreak: z.number().int().nonnegative(),
  masteredAt: isoDateTimeSchema.nullable(),
  recentOutcomes: z.array(z.enum(["positive", "negative", "neutral"])).max(5),
  remainingNeverSeenCount: z.number().int().nonnegative(),
  externallySeenCount: z.number().int().nonnegative(),
  cooldownAvailableCount: z.number().int().nonnegative(),
}).strict();

const strategistReceiptSchema = z.object({
  campaignDate: campaignDateSchema,
  plannedCount: z.number().int().nonnegative(),
  settledCount: z.number().int().nonnegative(),
  status: z.enum(["completed", "partial", "skipped", "active"]),
  nodeOutcomes: z.array(z.object({
    nodeId: nodeIdSchema,
    positive: z.number().int().nonnegative(),
    negative: z.number().int().nonnegative(),
    neutral: z.number().int().nonnegative(),
  }).strict()),
  slotRoles: z.array(z.object({
    slotRole: z.enum(["advance", "target", "remedial", "probe", "mixed"]),
    count: z.number().int().nonnegative(),
  }).strict()),
  shortfallCount: z.number().int().nonnegative(),
}).strict();

const strategistRepairSchema = z.object({
  nodeId: nodeIdSchema,
  reason: z.string().min(1).max(160),
  priority: z.number().int(),
  ageDays: z.number().int().nonnegative(),
  status: z.enum(["pending", "scheduled"]),
  accumulatedCount: z.number().int().positive(),
}).strict();

const strategistPlanningHistorySchema = z.object({
  rationale: z.string().max(500).nullable(),
  decision: z.enum(["accepted", "partially_accepted", "rejected"]),
  affectedNodeIds: z.array(nodeIdSchema),
  resultingSkeletonVersion: z.number().int().positive().nullable(),
  createdAt: isoDateTimeSchema,
}).strict();

export const strategistReadModelSchema = z.object({
  readModelVersion: z.literal(STRATEGIST_READ_MODEL_VERSION),
  campaign: z.object({
    campaignId: z.string().min(1),
    startDate: campaignDateSchema,
    endDate: campaignDateSchema,
    campaignDate: campaignDateSchema,
    remainingDays: z.number().int(),
    dailyQuestionBudget: z.number().int().min(3),
    language: z.literal("Python"),
    selfReportedWeakNodes: z.array(nodeIdSchema),
    preferredNodes: z.array(nodeIdSchema),
    mixedWindowDays: z.number().int().positive(),
    goalUpdatedAt: isoDateTimeSchema,
  }).strict(),
  activeSkeleton: z.object({
    version: z.number().int().positive(),
    nodePlans: z.array(strategistNodePlanSchema),
  }).strict(),
  learnerNodes: z.array(strategistLearnerNodeSchema),
  nonTransferableSupply: z.array(z.object({
    nodeId: nodeIdSchema,
    nodeName: z.string().min(1).max(100),
    neverSeenCount: z.number().int().nonnegative(),
    externallySeenCount: z.number().int().nonnegative(),
    cooldownAvailableCount: z.number().int().nonnegative(),
  }).strict()),
  recentReceipts: z.array(strategistReceiptSchema).max(STRATEGIST_RECEIPT_WINDOW_DAYS),
  repairQueue: z.array(strategistRepairSchema),
  planningHistory: z.array(strategistPlanningHistorySchema).max(STRATEGIST_PLANNING_HISTORY_LIMIT),
  operational: z.object({
    phase: campaignPhaseSchema,
    advanceFrontierNodeIds: z.array(nodeIdSchema),
    currentPrimaryNodeId: nodeIdSchema.nullable(),
    dailyTaskGenerated: z.boolean(),
    pendingPatchExists: z.boolean(),
    latestStrategistRunWatermark: isoDateTimeSchema.nullable(),
    shortfallDaysInWindow: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type StrategistReadModel = z.infer<typeof strategistReadModelSchema>;

export const strategistNoChangeOutputSchema = z.object({
  decision: z.literal("no_change"),
  rationale: z.string().trim().min(1).max(CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH),
}).strict();

export const strategistPatchOutputSchema = z.object({
  decision: z.literal("propose_patch"),
  rationale: z.string().trim().min(1).max(CAMPAIGN_PATCH_RATIONALE_MAX_LENGTH),
  operations: z.array(campaignSkeletonPatchOperationSchema).min(1).max(STRATEGIST_MAX_OPERATIONS),
  dailyBudgetSuggestion: dailyBudgetSuggestionSchema.nullable(),
}).strict();

export const strategistProviderOutputSchema = z.discriminatedUnion("decision", [
  strategistNoChangeOutputSchema,
  strategistPatchOutputSchema,
]);
export type StrategistProviderOutput = z.infer<typeof strategistProviderOutputSchema>;

export const strategistWakeSnapshotSchema = z.object({
  campaignDate: campaignDateSchema,
  activeSkeletonVersion: z.number().int().positive(),
  campaignWeek: z.number().int().positive(),
  goalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  frontierDigest: z.string().regex(/^[a-f0-9]{64}$/),
  phase: campaignPhaseSchema,
  receiptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  repairDigest: z.string().regex(/^[a-f0-9]{64}$/),
  masteredNodeIds: z.array(nodeIdSchema),
  pendingRepairCount: z.number().int().nonnegative(),
  oldestPendingRepairAgeDays: z.number().int().nonnegative(),
  consecutiveIncompleteReceipts: z.number().int().nonnegative(),
  consecutiveShortfallReceipts: z.number().int().nonnegative(),
  evaluatedWatermark: isoDateTimeSchema,
}).strict();
export type StrategistWakeSnapshot = z.infer<typeof strategistWakeSnapshotSchema>;

export type StrategistWakeEvaluation = Readonly<{
  shouldWake: boolean;
  trigger: StrategistTrigger | null;
  reasons: readonly string[];
  triggerFingerprint: string | null;
  evaluatedWatermark: string;
  skippedReason: "pending_patch_exists" | "no_trigger" | null;
}>;

export function canonicalStrategistJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalStrategistJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStrategistJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function strategistDigest(value: unknown): string {
  return createHash("sha256").update(canonicalStrategistJson(value)).digest("hex");
}

export function parseStrategistProviderOutput(raw: string): StrategistProviderOutput {
  return strategistProviderOutputSchema.parse(JSON.parse(raw));
}

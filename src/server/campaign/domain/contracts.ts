import { z } from "zod";
import {
  campaignCurriculumGraph,
  CAMPAIGN_SLOT_ROLES,
} from "../curriculum";
import type {
  CampaignSkeletonNodePlan,
  CurriculumSlotRole,
  CurriculumAssets,
} from "../curriculum";
import { plannerSelfRatingSchema } from "@/server/planner/planner.types";
import { codeRunStatusSchema, codeRunnerLanguageSchema } from "@/types/code-runner";
import { evidenceClassSchema } from "@/types/evidence";

const curriculumNodeIds = new Set(
  campaignCurriculumGraph.nodes.map((node) => node.nodeId),
);

export const campaignDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  }, "Expected a real calendar date in YYYY-MM-DD form");

export const campaignNodeIdSchema = z
  .string()
  .refine((nodeId) => curriculumNodeIds.has(nodeId), "Unknown curriculum nodeId");

export const campaignTimeZoneSchema = z.string().trim().min(1).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  },
  "Expected a valid IANA timezone",
);

export const campaignPhaseSchema = z.enum([
  "coverage",
  "consolidation_deep_fill",
  "consolidation_mixed",
]);
export type CampaignPhase = z.infer<typeof campaignPhaseSchema>;

export const exposureStateSchema = z.enum([
  "unknown",
  "externally_seen",
  "internally_attempted",
]);
export type ExposureState = z.infer<typeof exposureStateSchema>;

export const masteryStateSchema = z.enum(["learning", "mastered"]);
export type MasteryState = z.infer<typeof masteryStateSchema>;

export const masteryHealthSchema = z.enum([
  "stable",
  "watch",
  "needs_reinforcement",
]);
export type MasteryHealth = z.infer<typeof masteryHealthSchema>;

export const dailyTaskStatusSchema = z.enum([
  "active",
  "completed",
  "partial",
  "skipped",
]);
export type DailyTaskStatus = z.infer<typeof dailyTaskStatusSchema>;

export const taskItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "deferred",
  "settled",
  "skipped",
]);
export type TaskItemStatus = z.infer<typeof taskItemStatusSchema>;

// The tuple comes from the canonical Curriculum/Campaign role vocabulary.
export const taskSlotRoleSchema = z.enum(CAMPAIGN_SLOT_ROLES);
export type TaskSlotRole = z.infer<typeof taskSlotRoleSchema>;

export const problemExposureTypeSchema = z.enum([
  "never_seen",
  "externally_seen",
  "internally_attempted",
]);
export type ProblemExposureType = z.infer<typeof problemExposureTypeSchema>;

export const repairQueueStatusSchema = z.enum([
  "pending",
  "scheduled",
  "suspended",
  "expired",
  "resolved",
]);
export type RepairQueueStatus = z.infer<typeof repairQueueStatusSchema>;

export const campaignGoalInputSchema = z
  .object({
    endDate: campaignDateSchema,
    dailyQuestionBudget: z.number().int().min(3),
    language: z.literal(codeRunnerLanguageSchema.parse("Python")),
    timezone: campaignTimeZoneSchema,
    selfReportedWeakNodes: z.array(campaignNodeIdSchema).default([]),
    preferredNodes: z.array(campaignNodeIdSchema).default([]),
  })
  .strict();
export type CampaignGoalInput = z.infer<typeof campaignGoalInputSchema>;

export const normalizedSettlementInputSchema = z
  .object({
    reviewCompleted: z.boolean(),
    passed: z.boolean(),
    selfRating: z.unknown().nullable().optional(),
    evidenceCanVerdict: z.boolean(),
    evidenceMatchesCurrentRevision: z.boolean(),
    evidenceMatchesTaskProblem: z.boolean(),
    evidenceClass: evidenceClassSchema.nullable().optional(),
    evidenceAuthority: z.enum(["authoritative", "advisory"]).nullable().optional(),
    evidenceSubject: z.string().nullable().optional(),
    evidenceScope: z.string().nullable().optional(),
    evidenceSource: z.enum(["review", "local_visible_run"]).nullable().optional(),
    evidenceReferenceId: z.string().nullable().optional(),
    localEvidence: z.object({
      referenceId: z.string(),
      evidenceClass: z.string(),
      evidenceAuthority: z.enum(["authoritative", "advisory"]),
      evidenceScope: z.string(),
      subject: z.string().nullable(),
      canVerdict: z.boolean(),
      verdict: z.enum(["passed", "failed", "unavailable"]),
      ownershipAligned: z.boolean(),
      revisionAligned: z.boolean(),
      executionFingerprintAligned: z.boolean(),
      suiteAligned: z.boolean(),
      fullVisibleSuite: z.boolean(),
      customInput: z.boolean(),
      assistantCandidate: z.boolean(),
      supersededAfterReview: z.boolean(),
    }).nullable().optional(),
    verdict: codeRunStatusSchema.nullable().optional(),
    codeRevision: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
export type NormalizedSettlementInput = z.infer<
  typeof normalizedSettlementInputSchema
>;

export type LearnerNodeStateProjection = Readonly<{
  nodeId: string;
  exposureState: ExposureState;
  masteryState: MasteryState;
  masteryHealth: MasteryHealth;
  unlockedAt: Date | null;
  startedAt: Date | null;
  masteredAt: Date | null;
  masteredBySettlementId: string | null;
  latestPositiveStreak: number;
  latestSettlementIds: readonly string[];
}>;

export type SettlementProjection = Readonly<{
  settlementId: string;
  problemSlug: string;
  slotRole: TaskSlotRole;
  positiveForMastery: boolean;
  negativeOutcome: boolean;
  settledAt: Date;
}>;

export type MasteryReductionInput = Readonly<{
  currentState: LearnerNodeStateProjection;
  settlements: readonly SettlementProjection[];
}>;

export type MasteryReductionOutput = Readonly<{
  state: LearnerNodeStateProjection;
  becameMastered: boolean;
  healthChanged: boolean;
  shouldEnqueueRepair: boolean;
  repairReason: RepairReason | null;
}>;

export type SkeletonProjection = Readonly<{
  version: number;
  mixedWindowDays: number;
  nodePlans: readonly CampaignSkeletonNodePlan[];
}>;

export type UnlockResolutionInput = Readonly<{
  curriculum: CurriculumAssets;
  skeleton: SkeletonProjection;
  nodeStates: readonly LearnerNodeStateProjection[];
}>;

export type UnlockResolutionOutput = Readonly<{
  unlockedNodeIds: readonly string[];
  newlyUnlockedNodeIds: readonly string[];
  lockedNodeIds: readonly string[];
}>;

export type ProblemAvailability = Readonly<{
  problemSlug: string;
  nodeId: string;
  eligibleRoles: readonly CurriculumSlotRole[];
  recommendedOrder: number;
  exposureType: ProblemExposureType;
  cooldownUntil?: string | null;
  lastAttemptedAt?: Date | null;
}>;

export type RepairQueueCandidate = Readonly<{
  repairQueueItemId: string;
  nodeId: string;
  priority: number;
  createdAt: Date;
}>;

export type SelectedTaskItem = Readonly<{
  problemSlug: string;
  nodeId: string;
  slotRole: TaskSlotRole;
  exposureType: ProblemExposureType;
  order: number;
  repairQueueItemId?: string;
  carryoverFromTaskItemId?: string;
}>;

/**
 * An unsettled Campaign task deliberately offered again on a later day.
 * It retains the original task id for audit, but cannot itself create a
 * settlement or change mastery until the new TaskItem is reviewed and settled.
 */
export type CarryoverTaskItem = Readonly<{
  carryoverFromTaskItemId: string;
  problemSlug: string;
  nodeId: string;
  slotRole: TaskSlotRole;
  exposureType: ProblemExposureType;
  repairQueueItemId?: string;
}>;

export type DailyTaskShortfall = Readonly<{
  requested: number;
  selected: number;
  missing: number;
  reasons: readonly string[];
}>;

export type ExistingDailyTask = Readonly<{
  campaignDate: string;
  phase: CampaignPhase;
  budget: number;
  primaryNodeId: string | null;
  items: readonly SelectedTaskItem[];
  scheduledRepairQueueItemIds: readonly string[];
  shortfall: DailyTaskShortfall | null;
}>;

export type DailySelectorInput = Readonly<{
  campaignDate: string;
  campaignId: string;
  endDate: string;
  budget: number;
  skeleton: SkeletonProjection;
  curriculum: CurriculumAssets;
  learnerNodeStates: readonly LearnerNodeStateProjection[];
  repairQueueCandidates: readonly RepairQueueCandidate[];
  problemAvailability: readonly ProblemAvailability[];
  carryoverItems?: readonly CarryoverTaskItem[];
  existingDailyTask?: ExistingDailyTask | null;
  exposurePlanning?: Readonly<{
    skeletonVersion: number;
    satisfiedNodeIds: readonly string[];
    pendingProbeNodeIds: readonly string[];
  }>;
  excludedNodeIds?: readonly string[];
  selectorVersion?: number;
}>;

export type DailySelectorOutput =
  | Readonly<{
      kind: "task";
      campaignDate: string;
      phase: CampaignPhase;
      budget: number;
      primaryNodeId: string | null;
      items: readonly SelectedTaskItem[];
      scheduledRepairQueueItemIds: readonly string[];
      shortfall: DailyTaskShortfall | null;
      reusedExisting: boolean;
    }>
  | Readonly<{
      kind: "no_task";
      campaignDate: string;
      reason: "no_primary_node" | "no_primary_problem";
    }>;

export const REPAIR_REASONS = {
  TARGET_NEGATIVE: "target_negative",
  MASTERY_NEEDS_REINFORCEMENT: "mastery_needs_reinforcement",
  REMEDIAL_NEGATIVE: "remedial_negative",
  MIXED_NEGATIVE: "mixed_negative",
  NON_TRANSFERABLE_GAP: "non_transferable_gap",
} as const;
export type RepairReason = (typeof REPAIR_REASONS)[keyof typeof REPAIR_REASONS];

export { plannerSelfRatingSchema };

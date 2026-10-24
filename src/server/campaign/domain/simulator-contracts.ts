import type { CurriculumAssets, CurriculumSlotRole } from "../curriculum";
import type {
  CampaignPhase,
  CarryoverTaskItem,
  DailySelectorOutput,
  ExistingDailyTask,
  MasteryHealth,
  MasteryState,
  ProblemExposureType,
  SkeletonProjection,
  TaskSlotRole,
} from "./contracts";

export type SerializableLearnerNodeState = Readonly<{
  nodeId: string;
  exposureState: "unknown" | "externally_seen" | "internally_attempted";
  masteryState: MasteryState;
  masteryHealth: MasteryHealth;
  unlockedAt: string | null;
  startedAt: string | null;
  masteredAt: string | null;
  masteredBySettlementId: string | null;
  latestPositiveStreak: number;
  latestSettlementIds: readonly string[];
}>;

export type SerializableRepairQueueCandidate = Readonly<{
  repairQueueItemId: string;
  nodeId: string;
  priority: number;
  createdAt: string;
}>;

export type SerializableProblemAvailability = Readonly<{
  problemSlug: string;
  nodeId: string;
  eligibleRoles: readonly CurriculumSlotRole[];
  recommendedOrder: number;
  exposureType: ProblemExposureType;
  cooldownUntil?: string | null;
  lastAttemptedAt?: string | null;
}>;

export type SerializableSettlementProjection = Readonly<{
  settlementId: string;
  problemSlug: string;
  nodeId: string;
  slotRole: TaskSlotRole;
  positiveForMastery: boolean;
  negativeOutcome: boolean;
  settledAt: string;
}>;

export type SerializableCarryoverTaskItem = CarryoverTaskItem;

/** Canonical JSON boundary shared by production materialization and simulation. */
export type DailyTaskProjectionState = Readonly<{
  campaignId: string;
  endDate: string;
  curriculum: CurriculumAssets;
  learnerNodeStates: readonly SerializableLearnerNodeState[];
  repairQueueCandidates: readonly SerializableRepairQueueCandidate[];
  problemAvailability: readonly SerializableProblemAvailability[];
  carryoverItems?: readonly SerializableCarryoverTaskItem[];
  existingDailyTasks?: readonly ExistingDailyTask[];
  exposurePlanning?: Readonly<{
    skeletonVersion: number;
    satisfiedNodeIds: readonly string[];
    pendingProbeNodeIds: readonly string[];
  }>;
  acceptedDailyBudgetOverrides?: readonly Readonly<{
    campaignDate: string;
    maxQuestions: number;
    status: "accepted" | "expired" | "revoked";
    expiresAt?: string | null;
  }>[];
}>;

export type DailyTaskProjectionOptions = Readonly<{
  excludedNodeIds?: readonly string[];
  selectorVersion: number;
}>;

export type ProjectedDailyTask = DailySelectorOutput;

export type CampaignSimulationState = DailyTaskProjectionState & Readonly<{
  /** Full ordered history is needed to reuse the real Mastery Reducer exactly. */
  settlements: readonly SerializableSettlementProjection[];
}>;

export const CAMPAIGN_SIMULATION_BRANCHES = [
  "optimistic",
  "observed_supported",
  "conservative",
] as const;
export type CampaignSimulationBranch =
  (typeof CAMPAIGN_SIMULATION_BRANCHES)[number];

export type CampaignPlanSimulationCandidate = Readonly<{
  candidateId: string;
  /** An in-memory node-level route projection, never a persisted Patch. */
  skeleton: SkeletonProjection;
  excludedNodeIds?: readonly string[];
}>;

export type ObservedPaceInput = Readonly<{
  sampleDays: number;
  observedCapacityRange: Readonly<{ min: number; max: number }> | null;
  /** Explicit date outcomes only; missing future dates remain unknown. */
  supportedPositiveItemsByDate: readonly Readonly<{
    campaignDate: string;
    positiveItemCount: number;
  }>[];
}>;

export type SimulationPaceAssessment = Readonly<{
  date: string;
  plannedCapacity: number;
  observedCapacityRange: Readonly<{ min: number; max: number }> | null;
  sampleDays: number;
  assessment: "supported" | "unknown";
  reason:
    | "within_observed_range"
    | "insufficient_sample"
    | "out_of_observed_range"
    | "missing_supported_outcome";
}>;

export type CampaignSimulationUnknown = Readonly<{
  code:
    | "insufficient_sample"
    | "out_of_observed_range"
    | "missing_supported_outcome"
    | "incomplete_settlement_history";
  message: string;
  campaignDate?: string;
  nodeId?: string;
}>;

export type CampaignSimulationViolation = Readonly<{
  code:
    | "required_edge_violation"
    | "same_day_unlock_violation"
    | "problem_supply_shortfall";
  message: string;
  campaignDate: string;
  nodeId?: string;
}>;

export type SimulatedOutcomeSummary = Readonly<{
  positiveItemCount: number;
  negativeItemCount: number;
  neutralItemCount: number;
}>;

export type InternalDayProjection = Readonly<{
  campaignDate: string;
  budget: number;
  phase: CampaignPhase | null;
  projection: ProjectedDailyTask;
  outcome: SimulatedOutcomeSummary;
  newlyMasteredNodeIds: readonly string[];
  newlyUnlockedNodeIds: readonly string[];
  nextCampaignDate: string;
  paceAssessment: SimulationPaceAssessment;
  violations: readonly CampaignSimulationViolation[];
  unknowns: readonly CampaignSimulationUnknown[];
}>;

export type EarliestReachableDate = Readonly<{
  nodeId: string;
  earliestEligibleDate: string | null;
  firstSelectedDate: string | null;
}>;

export type CampaignSimulationBranchResult = Readonly<{
  branch: CampaignSimulationBranch;
  internalDayProjections: readonly InternalDayProjection[];
  violations: readonly CampaignSimulationViolation[];
  earliestReachableDates: readonly EarliestReachableDate[];
  unknowns: readonly CampaignSimulationUnknown[];
}>;

export type CampaignSimulationCandidateResult = Readonly<{
  candidateId: string;
  branches: Readonly<Record<CampaignSimulationBranch, CampaignSimulationBranchResult>>;
}>;

export type SimulateCampaignPlanInput = Readonly<{
  state: CampaignSimulationState;
  candidates: readonly CampaignPlanSimulationCandidate[];
  startCampaignDate: string;
  horizon: number;
  dailyBudgets: readonly number[];
  observedPace: ObservedPaceInput;
  options: Readonly<{
    selectorVersion: number;
    internalCooldownDays: number;
  }>;
}>;

export type CampaignSimulationResult = Readonly<{
  horizon: Readonly<{
    startCampaignDate: string;
    endCampaignDate: string;
    days: number;
  }>;
  dailyBudgets: readonly Readonly<{ campaignDate: string; budget: number }>[];
  candidates: readonly CampaignSimulationCandidateResult[];
  unknowns: readonly CampaignSimulationUnknown[];
}>;

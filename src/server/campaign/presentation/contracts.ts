import type {
  CampaignPatchStatus,
  CampaignSkeletonPatchOperation,
  CampaignPhase,
  DailyTaskShortfall,
  MasteryHealth,
  ProblemExposureType,
  TaskItemStatus,
  TaskSlotRole,
} from "../domain";
import type { PlannerProposalDto } from "@/server/planner/planner.types";
import type { ReviewFocusBoard } from "@/server/planner/review-focus/review-focus.types";

export type PatchOperationReviewItem = Readonly<{
  operationId: string;
  operationType: CampaignSkeletonPatchOperation["type"];
  title: string;
  readableDescription: string;
  affectedNodeIds: readonly string[];
  beforeValue?: string;
  afterValue?: string;
  warnings: readonly string[];
  selectable: boolean;
  selectedByDefault: boolean;
}>;

export type CampaignPatchReviewView = Readonly<{
  patchId: string;
  status: CampaignPatchStatus;
  triggerLabel: string;
  rationale: string;
  createdAt: string;
  baseVersion: number;
  activeVersion: number;
  isStale: boolean;
  operations: readonly PatchOperationReviewItem[];
  warnings: readonly string[];
  impactSummary: Readonly<{
    affectedNodeCount: number;
    changesMixedWindowDays: boolean;
    currentDailyTaskUnaffected: true;
  }>;
  dailyBudgetSuggestion: Readonly<{
    currentBudget: number;
    proposedBudget: number;
    rationale: string;
  }> | null;
  dateBudgetSuggestions?: readonly Readonly<{
    campaignDate: string;
    currentBudget: number;
    maxQuestions: number;
    rationale: string;
    expiresAt: string | null;
    stale: boolean;
  }>[];
  externalDataAsOf: string | null;
  externalDataValidUntil: string | null;
  externalDataStale: boolean;
  rejectedCandidateReasons: readonly string[];
  canAccept: boolean;
  canPartiallyAccept: boolean;
  canReject: boolean;
}>;

export type CampaignPlanningReviewView = Readonly<{
  status: "idle" | "checking" | "pending_review" | "unavailable";
  pendingPatch: CampaignPatchReviewView | null;
}>;

export type CampaignStrategistCandidateView = Readonly<{
  candidateId: string;
  summary: string;
  accepted: boolean | null;
  patchLegal: boolean;
  nodeChanges: readonly string[];
  goalDepthChanges: readonly Readonly<{ nodeName: string; goalDepth: "mastery" | "exposure" }>[];
  targetByDateChanges: readonly Readonly<{ nodeName: string; targetByDate: string | null }>[];
  dateBudgetSuggestions: readonly Readonly<{ campaignDate: string; maxQuestions: number; rationale: string }>[];
  branches: readonly Readonly<{
    branch: "optimistic" | "observed_supported" | "conservative";
    violations: readonly string[];
    unknowns: readonly string[];
    projectedDates: readonly string[];
    earliestReachable: readonly Readonly<{
      nodeName: string;
      earliestEligibleDate: string | null;
      firstSelectedDate: string | null;
    }>[];
    dayProjections: readonly Readonly<{
      campaignDate: string;
      budget: number | null;
      phase: string | null;
      selectedNodeNames: readonly string[];
      risks: readonly string[];
      unknowns: readonly string[];
    }>[];
    horizonReachability: "reachable" | "partially_reachable" | "unreachable" | "unknown";
  }>[];
}>;

export type CampaignStrategistProductView = Readonly<{
  status: "ready" | "unavailable";
  routeRisk: Readonly<{ level: "clear" | "checking" | "attention"; label: string; detail: string }>;
  calendarConfigured: boolean;
  latestRun: Readonly<{
    runId: string;
    runMode: "proposal" | "simulation";
    status: string;
    statusLabel: string;
    resultKind: "simulation_complete" | "proposal_pending" | "proposal_resolved" | "clarification" | "no_change" | "failed" | "in_progress";
    requestSummary: string | null;
    publicSummary: string | null;
    progress: readonly Readonly<{ key: string; label: string; state: "complete" | "current" | "pending" | "not_needed" | "not_applicable" }>[];
    clarification: Readonly<{ question: string; knownFacts: readonly string[]; tradeoff: string; calendarAuthorizationRequested: boolean; queryRange: Readonly<{ start: string; end: string }> | null }> | null;
    candidates: readonly CampaignStrategistCandidateView[];
    rejectedCandidates: readonly Readonly<{ candidateId: string; reasons: readonly string[] }>[];
    selectedCandidateId: string | null;
    externalDataAsOf: string | null;
    externalDataValidUntil: string | null;
    externalDataStale: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    todayUnaffected: true;
  }> | null;
}>;

export type CampaignTodayItemView = Readonly<{
  taskItemId: string;
  problemSlug: string;
  problemTitle: string;
  order: number;
  slotRole: TaskSlotRole;
  roleLabel: string;
  exposureType: ProblemExposureType;
  exposureLabel: string;
  repeatedExposure: boolean;
  isCarryover: boolean;
  status: TaskItemStatus;
  canStart: boolean;
  canResume: boolean;
  reviewUrl?: string;
  outcome: "positive" | "negative" | "neutral" | null;
  visibleNode?: Readonly<{
    nodeId: string;
    nodeName: string;
    mechanism: string;
    healthImpact: MasteryHealth | null;
  }>;
}>;

export type CampaignMiniMapNodeView = Readonly<{
  nodeName: string;
  statusLabel: string;
  status: CampaignRoadmapNodeView["status"];
}>;

export type CampaignRoutePreviewView = Readonly<{
  previousNode: CampaignMiniMapNodeView | null;
  currentNode: CampaignMiniMapNodeView | null;
  nextNodes: readonly CampaignMiniMapNodeView[];
  currentPositiveStreak: number;
  pendingRepairCount: number;
}>;

export type CampaignProactiveModuleStatus = "ready" | "empty" | "unavailable";

export type CampaignRecoveryOverflowView = Readonly<{
  id: string;
  repairQueueItemId: string;
  nodeId: string;
  nodeName: string;
  reason: string;
  targetProblemSlug: string | null;
  targetProblemTitle: string | null;
  targetLeetcodeNumber: number | null;
}>;

export type CampaignProactiveDashboardView = Readonly<{
  replan: Readonly<{
    status: CampaignProactiveModuleStatus;
    proposals: readonly PlannerProposalDto[];
    overflowRepairs: readonly CampaignRecoveryOverflowView[];
  }>;
  reviewFocus: Readonly<{
    status: CampaignProactiveModuleStatus;
    board: ReviewFocusBoard;
  }>;
}>;

export type CampaignTodayView = Readonly<{
  kind: "campaign";
  displayName: string;
  campaignLabel: string;
  campaignDate: string;
  timezone: string;
  phase: CampaignPhase;
  phaseLabel: string;
  phaseDescription: string;
  endDate: string;
  remainingDays: number;
  ended: boolean;
  dailyBudget: number;
  plannedCount: number;
  settledCount: number;
  hasUnsettledItems: boolean;
  canAdvanceToNextDay: boolean;
  nextCampaignDate: string | null;
  taskStatus: "not_materialized" | "no_task" | "active" | "completed" | "partial" | "skipped";
  masteredTransferableCount: number;
  totalTransferableCount: number;
  shortfall: DailyTaskShortfall | null;
  items: readonly CampaignTodayItemView[];
  planning: CampaignPlanningReviewView;
  strategist: CampaignStrategistProductView;
  proactiveDashboard: CampaignProactiveDashboardView;
  routePreview: CampaignRoutePreviewView;
  repairPool: Readonly<{
    pendingNodeCount: number;
    highestPriorityNode: Readonly<{
      nodeId: string;
      nodeName: string;
      readableReason: string;
      scheduledForTomorrow: boolean;
    }>;
  }> | null;
}>;

export type CampaignTodayState =
  | CampaignTodayView
  | Readonly<{ kind: "empty"; displayName: string }>
  | Readonly<{ kind: "conflict"; displayName: string }>
  | Readonly<{ kind: "error"; displayName: string; message: string }>;

export type CampaignRoadmapNodeView = Readonly<{
  nodeId: string;
  nodeName: string;
  order: number;
  status:
    | "not_included"
    | "locked"
    | "available"
    | "learning"
    | "mastered_stable"
    | "mastered_watch"
    | "mastered_needs_reinforcement";
  statusLabel: string;
  masteryState: "learning" | "mastered" | null;
  masteryHealth: MasteryHealth | null;
  latestPositiveStreak: number;
  attemptedProblemCount: number;
  neverSeenProblemCount: number;
  completedProblems: number;
  totalProblems: number;
  masteryProgressCurrent: number;
  masteryProgressRequired: number;
  pendingRepairCount: number;
  current: boolean;
  available: boolean;
  locked: boolean;
  recentSettlements: readonly Readonly<{
    problemTitle: string;
    slotRole: TaskSlotRole;
    slotRoleLabel: string;
    outcome: "positive" | "negative" | "neutral";
    selfRating: string | null;
    selfRatingLabel: string | null;
    evidenceLabel: string;
    settledAt: string;
  }>[];
  coreInvariant: string;
  requiredPrerequisites: readonly Readonly<{ nodeId: string; nodeName: string; satisfied: boolean }>[];
  recommendedPrerequisites: readonly Readonly<{ nodeId: string; nodeName: string }>[];
  lockedReason: string | null;
}>;

export type CampaignRoadmapView = Readonly<{
  kind: "campaign";
  displayName: string;
  campaignLabel: string;
  campaignDate: string;
  timezone: string;
  phase: CampaignPhase;
  phaseLabel: string;
  endDate: string;
  remainingDays: number;
  masteredTransferableCount: number;
  totalTransferableCount: number;
  currentPrimaryNodeId: string | null;
  nodes: readonly CampaignRoadmapNodeView[];
  requiredDependencies: readonly Readonly<{ fromNodeId: string; toNodeId: string }>[];
  nonTransferablePool: readonly Readonly<{
    nodeId: string;
    nodeName: string;
    problemCount: number;
    attemptedProblemCount: number;
  }>[];
  recentSettlements: readonly Readonly<{
    problemTitle: string;
    nodeName: string;
    outcome: "positive" | "negative" | "neutral";
    settledAt: string;
  }>[];
}>;

export type CampaignRoadmapState =
  | CampaignRoadmapView
  | Readonly<{ kind: "empty"; displayName: string }>
  | Readonly<{ kind: "conflict"; displayName: string }>
  | Readonly<{ kind: "error"; displayName: string; message: string }>;

export type CampaignWorkbenchContextView = Readonly<{
  attemptId: string;
  taskItemId: string;
  problemSlug: string;
  slotRole: TaskSlotRole;
  roleLabel: string;
  taskOrder: number;
  settled: boolean;
  nodeName?: string;
  mixedHidden: boolean;
}>;

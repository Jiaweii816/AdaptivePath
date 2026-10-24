import type { Prisma, PrismaClient } from "@prisma/client";
import { irisDefaultProfile } from "@/features/onboarding/profile-defaults";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { buildActiveIdentityKey } from "@/server/observability/workspace-session";
import {
  campaignCurriculumAssets,
  genericCampaignSkeleton,
  type LearningNode,
} from "../curriculum";
import {
  CAMPAIGN_SELF_RATING_CONTRACT,
  buildAdvanceFrontier,
  buildDeepFillCandidates,
  deriveCampaignCalendar,
  deriveCampaignPhase,
} from "../core";
import {
  campaignTimeZoneSchema,
  taskItemStatusSchema,
  taskSlotRoleSchema,
  type CampaignPhase,
  type CarryoverTaskItem,
  type DailyTaskShortfall,
  type LearnerNodeStateProjection,
  type ProblemExposureType,
} from "../domain";
import type {
  CampaignRoadmapNodeView,
  CampaignRoadmapState,
  CampaignRoutePreviewView,
  CampaignTodayItemView,
  CampaignTodayState,
  CampaignTodayView,
  CampaignWorkbenchContextView,
} from "../presentation";
import { findActiveSkeleton } from "../store";
import {
  CampaignCoreService,
  buildCampaignProblemAvailability,
  projectCampaignNodeState,
  projectCampaignSkeleton,
} from "./campaign-core-service";
import { rebuildCampaignTaskReceipt } from "./task-receipt-service";
import {
  CampaignBindingError,
  startOrResumeCampaignTaskItemAttempt,
} from "./task-evidence-binding";
import { loadCampaignPlanningReviewView } from "./campaign-patch-review-service";
import { loadCampaignStrategistProductView } from "./campaign-strategist-product-service";
import {
  loadCampaignProactiveDashboard,
  type CampaignProactiveDashboardLoaders,
} from "./campaign-proactive-dashboard-service";

const ROLE_LABELS = {
  advance: "Advance",
  target: "Targeted",
  remedial: "Recovery",
  probe: "Baseline check",
  mixed: "Mixed practice",
} as const;

const PHASE_COPY = {
  coverage: {
    label: "Coverage",
    description: "Complete transferable learning nodes one at a time.",
  },
  consolidation_deep_fill: {
    label: "Consolidation · Deep fill",
    description: "Practice unattempted problems within mastered nodes.",
  },
  consolidation_mixed: {
    label: "Consolidation · Mixed practice",
    description: "Practice across nodes without seeing the pattern in advance.",
  },
} as const;

const EXPOSURE_LABELS = {
  never_seen: "New",
  externally_seen: "Seen elsewhere",
  internally_attempted: "Practiced in PatternCoach",
} as const;

const REPAIR_REASON_LABELS: Readonly<Record<string, string>> = {
  target_negative: "Targeted practice indicates this node needs recovery",
  mastery_needs_reinforcement: "Recent performance needs reinforcement",
  remedial_negative: "Recovery practice still needs reinforcement",
  mixed_negative: "Mixed practice showed inconsistent performance",
  non_transferable_gap: "Supplemental-pool performance needs practice",
};

type ActiveCampaign = Prisma.CampaignGetPayload<{
  include: { goal: true; user: { include: { profile: true } } };
}>;

export class CampaignExperienceError extends Error {
  constructor(
    readonly code:
      | "multiple_active_campaigns"
      | "campaign_goal_missing"
      | "invalid_timezone"
      | "stale_task_item"
      | "entry_problem_missing"
      | "daily_task_incomplete"
      | "campaign_ended"
      | "next_day_unavailable",
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "CampaignExperienceError";
  }
}

export async function resolveActiveCampaignForLearner(
  db: PrismaClient,
  userId: string,
): Promise<{ kind: "none" } | { kind: "active"; campaign: ActiveCampaign } | { kind: "conflict" }> {
  const campaigns = await db.campaign.findMany({
    where: { userId, status: "active" },
    include: { goal: true, user: { include: { profile: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 2,
  });
  if (campaigns.length === 0) return { kind: "none" };
  if (campaigns.length > 1) return { kind: "conflict" };
  return { kind: "active", campaign: campaigns[0] };
}

function displayName(campaign: ActiveCampaign | null) {
  return campaign?.user.profile?.displayName ?? irisDefaultProfile.displayName;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addCampaignDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function remainingCampaignDays(campaignDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${campaignDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

export async function resolveActiveCampaignDate(
  db: PrismaClient,
  campaignId: string,
  wallDate: string,
) {
  const latest = await db.campaignDailyTask.findFirst({
    where: { campaignId },
    orderBy: [{ campaignDate: "desc" }, { id: "desc" }],
    select: { campaignDate: true, status: true },
  });
  if (!latest) return wallDate;
  if (latest.campaignDate >= wallDate) return latest.campaignDate;
  return latest.status === "active" || latest.status === "partial"
    ? latest.campaignDate
    : wallDate;
}

function readSelectionMetadata(value: string): {
  shortfall: DailyTaskShortfall | null;
  scheduledRepairs: Array<{ repairQueueItemId: string; problemSlug: string; nodeId: string }>;
} {
  try {
    const parsed = JSON.parse(value) as {
      shortfall?: DailyTaskShortfall | null;
      scheduledRepairs?: unknown;
    };
    return {
      shortfall: parsed.shortfall ?? null,
      scheduledRepairs: Array.isArray(parsed.scheduledRepairs)
        ? parsed.scheduledRepairs.filter((entry): entry is { repairQueueItemId: string; problemSlug: string; nodeId: string } =>
          Boolean(
            entry &&
            typeof entry === "object" &&
            typeof (entry as Record<string, unknown>).repairQueueItemId === "string" &&
            typeof (entry as Record<string, unknown>).problemSlug === "string" &&
            typeof (entry as Record<string, unknown>).nodeId === "string",
          ),
        )
        : [],
    };
  } catch {
    return { shortfall: null, scheduledRepairs: [] };
  }
}

function outcomeFor(settlement: {
  positiveForMastery: boolean;
  negativeOutcome: boolean;
} | null) {
  if (!settlement) return null;
  if (settlement.positiveForMastery) return "positive" as const;
  return settlement.negativeOutcome ? ("negative" as const) : ("neutral" as const);
}

function phaseForPersistedTask(
  task: { primaryNodeId: string | null; createdAt: Date },
  stateByNode: ReadonlyMap<string, LearnerNodeStateProjection>,
): CampaignPhase {
  if (!task.primaryNodeId) return "consolidation_mixed";
  const masteredAt = stateByNode.get(task.primaryNodeId)?.masteredAt;
  return masteredAt && masteredAt <= task.createdAt
    ? "consolidation_deep_fill"
    : "coverage";
}

async function currentPhase(input: {
  db: PrismaClient;
  campaign: ActiveCampaign;
  campaignDate: string;
  skeleton: Awaited<ReturnType<typeof findActiveSkeleton>>;
  states: readonly Prisma.CampaignLearnerNodeStateGetPayload<object>[];
}) {
  const projectedSkeleton = projectCampaignSkeleton(input.skeleton);
  const projectedStates = input.states.map(projectCampaignNodeState);
  const frontier = buildAdvanceFrontier({
    curriculum: campaignCurriculumAssets,
    skeleton: projectedSkeleton,
    nodeStates: projectedStates,
  });
  const availability = await buildCampaignProblemAvailability(
    input.db,
    input.campaign.userId,
    new Map(),
  );
  const deepFill = buildDeepFillCandidates({
    campaignDate: input.campaignDate,
    curriculum: campaignCurriculumAssets,
    skeleton: projectedSkeleton,
    learnerNodeStates: projectedStates,
    problemAvailability: availability,
  });
  return deriveCampaignPhase({
    advanceFrontier: frontier,
    campaignDate: input.campaignDate,
    endDate: dateOnly(input.campaign.goal!.endDate),
    mixedWindowDays: projectedSkeleton.mixedWindowDays,
    hasDeepFillCandidate: deepFill.length > 0,
  }).phase;
}

async function loadTask(db: PrismaClient, campaignId: string, campaignDate: string) {
  return db.campaignDailyTask.findUnique({
    where: { campaignId_campaignDate: { campaignId, campaignDate } },
    include: {
      receipt: true,
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          settlement: true,
          attempts: { orderBy: [{ startedAt: "desc" }, { id: "desc" }] },
        },
      },
    },
  });
}

export async function loadCampaignTodayView(input: {
  db: PrismaClient;
  userId: string;
  now: Date;
  materialize: boolean;
  campaignDateOverride?: string;
  proactiveLoaders?: CampaignProactiveDashboardLoaders;
}): Promise<CampaignTodayState> {
  const active = await resolveActiveCampaignForLearner(input.db, input.userId);
  if (active.kind === "none") return { kind: "empty", displayName: irisDefaultProfile.displayName };
  if (active.kind === "conflict") return { kind: "conflict", displayName: irisDefaultProfile.displayName };
  const { campaign } = active;
  if (!campaign.goal) {
    throw new CampaignExperienceError("campaign_goal_missing", "Active Campaign has no goal.");
  }
  const timezone = campaignTimeZoneSchema.safeParse(campaign.goal.timezone);
  if (!timezone.success) {
    throw new CampaignExperienceError("invalid_timezone", "Campaign timezone is invalid.");
  }
  const wallCalendar = deriveCampaignCalendar({
    now: input.now,
    timezone: timezone.data,
    endDate: dateOnly(campaign.goal.endDate),
  });
  const campaignDate = input.campaignDateOverride ?? await resolveActiveCampaignDate(
    input.db,
    campaign.id,
    wallCalendar.campaignDate,
  );
  const remainingDays = remainingCampaignDays(campaignDate, dateOnly(campaign.goal.endDate));
  const calendar = { campaignDate, remainingDays, ended: remainingDays < 0 };
  let task = await loadTask(input.db, campaign.id, calendar.campaignDate);
  let noTask = false;
  if (!task && input.materialize && !calendar.ended) {
    const result = await new CampaignCoreService(input.db, { now: () => input.now })
      .getOrCreateDailyTask({ campaignId: campaign.id, campaignDate: calendar.campaignDate });
    noTask = "kind" in result && result.kind === "no_task";
    task = await loadTask(input.db, campaign.id, calendar.campaignDate);
  }
  const [skeleton, states, planning, strategist, proactiveDashboard] = await Promise.all([
    findActiveSkeleton(input.db, campaign.id),
    input.db.campaignLearnerNodeState.findMany({ where: { campaignId: campaign.id } }),
    loadCampaignPlanningReviewView({ db: input.db, userId: input.userId, campaignId: campaign.id })
      .catch(() => ({ status: "unavailable" as const, pendingPatch: null })),
    loadCampaignStrategistProductView({
      db: input.db,
      userId: input.userId,
      campaignId: campaign.id,
      now: input.now,
    }).catch(() => ({
      status: "unavailable" as const,
      routeRisk: { level: "attention" as const, label: "Route status unavailable", detail: "Today is unaffected." },
      calendarConfigured: false,
      latestRun: null,
    })),
    loadCampaignProactiveDashboard({
      db: input.db,
      userId: input.userId,
      now: input.now,
      campaignId: campaign.id,
      campaignDate: calendar.campaignDate,
      ...(input.proactiveLoaders ? { loaders: input.proactiveLoaders } : {}),
    }),
  ]);
  const projectedStates = states.map(projectCampaignNodeState);
  const stateByNode = new Map(projectedStates.map((state) => [state.nodeId, state]));
  const phase = task
    ? phaseForPersistedTask(task, stateByNode)
    : await currentPhase({ db: input.db, campaign, campaignDate: calendar.campaignDate, skeleton, states });
  const titleRows = task?.items.length
    ? await input.db.problem.findMany({
        where: { slug: { in: task.items.map((item) => item.problemSlug) } },
        select: { slug: true, title: true },
      })
    : [];
  const titleBySlug = new Map(titleRows.map((row) => [row.slug, row.title]));
  const nodeById = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node]));
  const items: CampaignTodayItemView[] = (task?.items ?? []).map((item) => {
    const slotRole = taskSlotRoleSchema.parse(item.slotRole);
    const status = taskItemStatusSchema.parse(item.status);
    const settled = Boolean(item.settlement);
    const node = nodeById.get(item.nodeId);
    const canResume = !settled && item.attempts.some((attempt) => !attempt.completedAt);
    return {
      taskItemId: item.id,
      problemSlug: item.problemSlug,
      problemTitle: titleBySlug.get(item.problemSlug) ?? item.problemSlug,
      order: item.sortOrder,
      slotRole,
      roleLabel: ROLE_LABELS[slotRole],
      exposureType: item.exposureType as ProblemExposureType,
      exposureLabel: EXPOSURE_LABELS[item.exposureType as ProblemExposureType],
      repeatedExposure: item.exposureType !== "never_seen",
      isCarryover: Boolean(item.carryoverFromTaskItemId),
      status,
      canStart: !settled && status === "pending",
      canResume,
      ...(settled && item.settlement
        ? {
            reviewUrl: `/workbench?${new URLSearchParams({
              problem: item.problemSlug,
              language: "Python",
              campaignAttempt: item.settlement.attemptId,
            }).toString()}`,
          }
        : {}),
      outcome: outcomeFor(item.settlement),
      ...((slotRole !== "mixed" || settled) && node
        ? {
            visibleNode: {
              nodeId: node.nodeId,
              nodeName: node.label.en,
              mechanism: node.description,
              healthImpact: stateByNode.get(node.nodeId)?.masteryHealth ?? null,
            },
          }
        : {}),
    };
  });
  const settledCount = task?.receipt?.settledCount ?? items.filter((item) => item.status === "settled").length;
  const totalTransferableCount = campaignCurriculumAssets.graph.nodes.filter((node) => node.kind === "transferable").length;
  const masteredTransferableCount = projectedStates.filter((state) => state.masteryState === "mastered").length;
  const copy = PHASE_COPY[phase];
  const openRepairs = await input.db.campaignRepairQueueItem.findMany({
    where: { campaignId: campaign.id, status: { in: ["pending", "scheduled"] } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const repairCountByNode = new Map<string, number>();
  for (const repair of openRepairs) {
    repairCountByNode.set(repair.nodeId, (repairCountByNode.get(repair.nodeId) ?? 0) + 1);
  }
  const highestRepair = openRepairs[0];
  const tomorrow = new Date(`${calendar.campaignDate}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  const scheduledForTomorrow = highestRepair
    ? Boolean(await input.db.campaignTaskItem.findFirst({
        where: {
          nodeId: highestRepair.nodeId,
          slotRole: "remedial",
          dailyTask: { campaignId: campaign.id, campaignDate: tomorrowDate },
        },
        select: { id: true },
      }))
    : false;
  const repairNode = highestRepair ? nodeById.get(highestRepair.nodeId) : null;
  return {
    kind: "campaign",
    displayName: displayName(campaign),
    campaignLabel: "Hot-150 Campaign",
    campaignDate: calendar.campaignDate,
    timezone: timezone.data,
    phase,
    phaseLabel: copy.label,
    phaseDescription: copy.description,
    endDate: dateOnly(campaign.goal.endDate),
    remainingDays: calendar.remainingDays,
    ended: calendar.ended,
    dailyBudget: campaign.goal.dailyQuestionBudget,
    plannedCount: items.length,
    settledCount,
    hasUnsettledItems: items.some((item) => item.status !== "settled"),
    canAdvanceToNextDay:
      items.length > 0 && calendar.campaignDate < dateOnly(campaign.goal.endDate),
    nextCampaignDate:
      items.length > 0 && calendar.campaignDate < dateOnly(campaign.goal.endDate)
        ? addCampaignDays(calendar.campaignDate, 1)
        : null,
    taskStatus: calendar.ended && !task
      ? "not_materialized"
      : noTask
        ? "no_task"
        : task
          ? task.status as CampaignTodayView["taskStatus"]
          : "not_materialized",
    masteredTransferableCount,
    totalTransferableCount,
    shortfall: task ? readSelectionMetadata(task.selectionMetadataJson).shortfall : null,
    items,
    planning,
    strategist,
    proactiveDashboard,
    routePreview: buildRoutePreview({
      skeleton,
      stateByNode,
      repairCountByNode,
      currentPrimaryNodeId: task?.primaryNodeId ?? null,
    }),
    repairPool: highestRepair && repairNode ? {
      pendingNodeCount: new Set(openRepairs.map((repair) => repair.nodeId)).size,
      highestPriorityNode: {
        nodeId: highestRepair.nodeId,
        nodeName: repairNode.label.en,
        readableReason: REPAIR_REASON_LABELS[highestRepair.reason] ?? "Recent learning evidence needs another practice cycle",
        scheduledForTomorrow,
      },
    } : null,
  };
}

export async function advanceCampaignDayForLearner(input: {
  db: PrismaClient;
  userId: string;
  now: Date;
}): Promise<CampaignTodayState> {
  const current = await loadCampaignTodayView({
    db: input.db,
    userId: input.userId,
    now: input.now,
    materialize: false,
  });
  if (current.kind !== "campaign") return current;
  if (!current.canAdvanceToNextDay || !current.nextCampaignDate) {
    throw new CampaignExperienceError(
      current.ended ? "campaign_ended" : "daily_task_incomplete",
      current.ended
        ? "The Campaign has reached its end date."
        : "No Campaign task is available to carry into the next day.",
    );
  }
  const active = await resolveActiveCampaignForLearner(input.db, input.userId);
  if (active.kind !== "active") return current;
  const carryoverItems = await input.db.$transaction(async (tx) => {
    const task = await tx.campaignDailyTask.findUniqueOrThrow({
      where: { campaignId_campaignDate: { campaignId: active.campaign.id, campaignDate: current.campaignDate } },
      include: { items: { include: { settlement: true } } },
    });
    const unsettled = task.items.filter((item) => !item.settlement && item.status !== "settled");
    if (unsettled.length > 0) {
      await tx.campaignTaskItem.updateMany({
        where: { id: { in: unsettled.map((item) => item.id) }, status: { in: ["pending", "in_progress"] } },
        data: { status: "deferred", updatedAt: input.now },
      });
      await tx.campaignDailyTask.update({
        where: { id: task.id },
        data: { status: "partial", updatedAt: input.now },
      });
      await rebuildCampaignTaskReceipt(tx, task.id, { now: input.now });
    }

    // A day can contain more unfinished work than the next day's fixed budget.
    // The leaf deferred items are the durable carryover backlog; items that
    // already have a successor are represented by that newer successor instead.
    const [deferredItems, successorRows] = await Promise.all([
      tx.campaignTaskItem.findMany({
        where: {
          status: "deferred",
          settlement: { is: null },
          dailyTask: { campaignId: active.campaign.id },
        },
        include: {
          dailyTask: { select: { campaignDate: true, selectionMetadataJson: true } },
        },
      }),
      tx.campaignTaskItem.findMany({
        where: {
          carryoverFromTaskItemId: { not: null },
          dailyTask: { campaignId: active.campaign.id },
        },
        select: { carryoverFromTaskItemId: true },
      }),
    ]);
    const sourceIdsWithSuccessor = new Set(
      successorRows.flatMap((item) => item.carryoverFromTaskItemId ? [item.carryoverFromTaskItemId] : []),
    );
    return deferredItems
      .filter((item) => !sourceIdsWithSuccessor.has(item.id))
      .sort((left, right) =>
        left.dailyTask.campaignDate.localeCompare(right.dailyTask.campaignDate) ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
      )
      .map((item): CarryoverTaskItem => {
        const repairQueueItemId = readSelectionMetadata(item.dailyTask.selectionMetadataJson)
          .scheduledRepairs
          .find((repair) => repair.problemSlug === item.problemSlug && repair.nodeId === item.nodeId)
          ?.repairQueueItemId;
        return {
          carryoverFromTaskItemId: item.id,
          problemSlug: item.problemSlug,
          nodeId: item.nodeId,
          slotRole: taskSlotRoleSchema.parse(item.slotRole),
          exposureType: item.exposureType as ProblemExposureType,
          ...(repairQueueItemId ? { repairQueueItemId } : {}),
        };
      });
  });
  const next = await new CampaignCoreService(input.db, { now: () => input.now }).getOrCreateDailyTask({
    campaignId: active.campaign.id,
    campaignDate: current.nextCampaignDate,
    carryoverItems,
  });
  if ("kind" in next) {
    throw new CampaignExperienceError(
      "next_day_unavailable",
      "No eligible problem is available for the next Campaign day.",
    );
  }
  return loadCampaignTodayView({
    db: input.db,
    userId: input.userId,
    now: input.now,
    materialize: true,
    campaignDateOverride: current.nextCampaignDate,
  });
}

function nodeStatus(input: {
  included: boolean;
  state: LearnerNodeStateProjection | undefined;
  pendingRepairCount: number;
}): Pick<CampaignRoadmapNodeView, "status" | "statusLabel"> {
  if (!input.included) return { status: "not_included", statusLabel: "Not included" };
  if (!input.state?.unlockedAt) return { status: "locked", statusLabel: "Locked" };
  if (input.state.masteryState === "mastered") {
    if (input.state.masteryHealth === "watch") return { status: "mastered_watch", statusLabel: "Mastered · watch" };
    if (input.state.masteryHealth === "needs_reinforcement") {
      return { status: "mastered_needs_reinforcement", statusLabel: "Mastered · recovery needed" };
    }
    return { status: "mastered_stable", statusLabel: "Mastered · stable" };
  }
  if (input.state.startedAt) return {
    status: "learning",
    statusLabel: input.pendingRepairCount > 0 ? "Learning · recovery needed" : "Learning",
  };
  return { status: "available", statusLabel: "Available" };
}

function buildRoutePreview(input: {
  skeleton: Awaited<ReturnType<typeof findActiveSkeleton>>;
  stateByNode: ReadonlyMap<string, LearnerNodeStateProjection>;
  repairCountByNode: ReadonlyMap<string, number>;
  currentPrimaryNodeId: string | null;
}): CampaignRoutePreviewView {
  const planByNode = new Map(input.skeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const route = campaignCurriculumAssets.graph.nodes
    .filter((node) => node.kind === "transferable" && planByNode.get(node.nodeId)?.included)
    .sort((left, right) => {
      const leftOrder = planByNode.get(left.nodeId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = planByNode.get(right.nodeId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.nodeId.localeCompare(right.nodeId);
    });
  const currentIndex = input.currentPrimaryNodeId
    ? route.findIndex((node) => node.nodeId === input.currentPrimaryNodeId)
    : -1;
  const project = (node: LearningNode) => {
    const projected = nodeStatus({
      included: true,
      state: input.stateByNode.get(node.nodeId),
      pendingRepairCount: input.repairCountByNode.get(node.nodeId) ?? 0,
    });
    return { nodeName: node.label.en, ...projected };
  };
  const previousNode = currentIndex >= 0
    ? route.slice(0, currentIndex).reverse().find((node) => input.stateByNode.get(node.nodeId)?.masteryState === "mastered") ?? null
    : route.slice().reverse().find((node) => input.stateByNode.get(node.nodeId)?.masteryState === "mastered") ?? null;
  const currentNode = currentIndex >= 0 ? route[currentIndex] : null;
  return {
    previousNode: previousNode ? project(previousNode) : null,
    currentNode: currentNode ? project(currentNode) : null,
    nextNodes: currentIndex >= 0 ? route.slice(currentIndex + 1, currentIndex + 3).map(project) : [],
    currentPositiveStreak: currentNode
      ? input.stateByNode.get(currentNode.nodeId)?.latestPositiveStreak ?? 0
      : 0,
    pendingRepairCount: [...input.repairCountByNode.values()].reduce((sum, count) => sum + count, 0),
  };
}

export async function loadCampaignRoadmapView(input: {
  db: PrismaClient;
  userId: string;
  now: Date;
}): Promise<CampaignRoadmapState> {
  const active = await resolveActiveCampaignForLearner(input.db, input.userId);
  if (active.kind === "none") return { kind: "empty", displayName: irisDefaultProfile.displayName };
  if (active.kind === "conflict") return { kind: "conflict", displayName: irisDefaultProfile.displayName };
  const { campaign } = active;
  if (!campaign.goal) throw new CampaignExperienceError("campaign_goal_missing", "Active Campaign has no goal.");
  const timezone = campaignTimeZoneSchema.parse(campaign.goal.timezone);
  const calendar = deriveCampaignCalendar({ now: input.now, timezone, endDate: dateOnly(campaign.goal.endDate) });
  const [skeleton, states, todayTask, settledItems, attemptedItems, openRepairs] = await Promise.all([
    findActiveSkeleton(input.db, campaign.id),
    input.db.campaignLearnerNodeState.findMany({ where: { campaignId: campaign.id } }),
    loadTask(input.db, campaign.id, calendar.campaignDate),
    input.db.campaignTaskItem.findMany({
      where: { dailyTask: { campaignId: campaign.id }, settlement: { isNot: null } },
      include: { settlement: { include: { attempt: true } } },
      orderBy: [{ settlement: { settledAt: "desc" } }, { id: "asc" }],
    }),
    input.db.campaignTaskItem.findMany({
      where: { dailyTask: { campaignId: campaign.id }, attempts: { some: {} } },
      select: { nodeId: true, problemSlug: true },
    }),
    input.db.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id, status: { in: ["pending", "scheduled"] } },
      select: { nodeId: true },
    }),
  ]);
  const projectedStates = states.map(projectCampaignNodeState);
  const stateByNode = new Map(projectedStates.map((state) => [state.nodeId, state]));
  const planByNode = new Map(skeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const nodeById = new Map(campaignCurriculumAssets.graph.nodes.map((node) => [node.nodeId, node]));
  const phase = todayTask
    ? phaseForPersistedTask(todayTask, stateByNode)
    : await currentPhase({ db: input.db, campaign, campaignDate: calendar.campaignDate, skeleton, states });
  const completedByNode = new Map<string, Set<string>>();
  for (const item of settledItems) {
    const slugs = completedByNode.get(item.nodeId) ?? new Set<string>();
    slugs.add(item.problemSlug);
    completedByNode.set(item.nodeId, slugs);
  }
  const attemptedByNode = new Map<string, Set<string>>();
  for (const item of attemptedItems) {
    const slugs = attemptedByNode.get(item.nodeId) ?? new Set<string>();
    slugs.add(item.problemSlug);
    attemptedByNode.set(item.nodeId, slugs);
  }
  const repairCountByNode = new Map<string, number>();
  for (const repair of openRepairs) {
    repairCountByNode.set(repair.nodeId, (repairCountByNode.get(repair.nodeId) ?? 0) + 1);
  }
  const allTitles = settledItems.length
    ? await input.db.problem.findMany({
        where: { slug: { in: settledItems.map((item) => item.problemSlug) } },
        select: { slug: true, title: true },
      })
    : [];
  const allTitleBySlug = new Map(allTitles.map((row) => [row.slug, row.title]));
  const transferable = campaignCurriculumAssets.graph.nodes
    .filter((node) => node.kind === "transferable")
    .sort((left, right) => {
      const leftOrder = planByNode.get(left.nodeId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = planByNode.get(right.nodeId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.nodeId.localeCompare(right.nodeId);
    });
  const dependenciesFor = (node: LearningNode, type: "required" | "recommended") =>
    campaignCurriculumAssets.graph.edges.filter((edge) => edge.toNodeId === node.nodeId && edge.type === type);
  const nodes: CampaignRoadmapNodeView[] = transferable.map((node, index) => {
    const plan = planByNode.get(node.nodeId);
    const state = stateByNode.get(node.nodeId);
    const pendingRepairCount = repairCountByNode.get(node.nodeId) ?? 0;
    const status = nodeStatus({ included: Boolean(plan?.included), state, pendingRepairCount });
    const required = dependenciesFor(node, "required");
    const missingRequired = required.filter((edge) => stateByNode.get(edge.fromNodeId)?.masteryState !== "mastered");
    return {
      nodeId: node.nodeId,
      nodeName: node.label.en,
      order: plan?.sortOrder ?? genericCampaignSkeleton.nodePlans.length + index + 1,
      ...status,
      masteryState: state?.masteryState ?? null,
      masteryHealth: state?.masteryHealth ?? null,
      latestPositiveStreak: state?.latestPositiveStreak ?? 0,
      attemptedProblemCount: attemptedByNode.get(node.nodeId)?.size ?? 0,
      neverSeenProblemCount: Math.max(0, node.primaryProblems.length - (attemptedByNode.get(node.nodeId)?.size ?? 0)),
      completedProblems: completedByNode.get(node.nodeId)?.size ?? 0,
      totalProblems: node.primaryProblems.length,
      masteryProgressCurrent: state?.masteryState === "mastered"
        ? 2
        : Math.min(2, state?.latestPositiveStreak ?? 0),
      masteryProgressRequired: 2,
      pendingRepairCount,
      current: todayTask?.primaryNodeId === node.nodeId,
      available: status.status === "available",
      locked: status.status === "locked",
      recentSettlements: settledItems
        .filter((item) => item.nodeId === node.nodeId)
        .slice(0, 2)
        .flatMap((item) => item.settlement ? [{
          problemTitle: allTitleBySlug.get(item.problemSlug) ?? item.problemSlug,
          slotRole: taskSlotRoleSchema.parse(item.slotRole),
          slotRoleLabel: ROLE_LABELS[taskSlotRoleSchema.parse(item.slotRole)],
          outcome: outcomeFor(item.settlement)!,
          selfRating: item.settlement.selfRating,
          selfRatingLabel: item.settlement.selfRating
            ? CAMPAIGN_SELF_RATING_CONTRACT[
              item.settlement.selfRating as keyof typeof CAMPAIGN_SELF_RATING_CONTRACT
            ]?.displayLabel ?? "Self-rated"
            : null,
          evidenceLabel: item.settlement.attempt.evidenceClass === "local_only"
            ? "Passed local visible tests"
            : item.settlement.positiveForMastery
              ? "Review evidence passed"
              : item.settlement.negativeOutcome
                ? "Learning outcome needs recovery"
                : "Evidence is insufficient for mastery",
          settledAt: item.settlement.settledAt.toISOString(),
        }] : []),
      coreInvariant: node.description,
      requiredPrerequisites: required.map((edge) => ({
        nodeId: edge.fromNodeId,
        nodeName: nodeById.get(edge.fromNodeId)?.label.en ?? edge.fromNodeId,
        satisfied: stateByNode.get(edge.fromNodeId)?.masteryState === "mastered",
      })),
      recommendedPrerequisites: dependenciesFor(node, "recommended").map((edge) => ({
        nodeId: edge.fromNodeId,
        nodeName: nodeById.get(edge.fromNodeId)?.label.en ?? edge.fromNodeId,
      })),
      lockedReason: missingRequired.length
        ? `Master first: ${missingRequired.map((edge) => nodeById.get(edge.fromNodeId)?.label.en ?? edge.fromNodeId).join(", ")}`
        : null,
    };
  });
  const recent = settledItems.slice(0, 5);
  const titles = recent.length
    ? await input.db.problem.findMany({ where: { slug: { in: recent.map((item) => item.problemSlug) } }, select: { slug: true, title: true } })
    : [];
  const titleBySlug = new Map(titles.map((row) => [row.slug, row.title]));
  return {
    kind: "campaign",
    displayName: displayName(campaign),
    campaignLabel: "Hot-150 Campaign",
    campaignDate: calendar.campaignDate,
    timezone,
    phase,
    phaseLabel: PHASE_COPY[phase].label,
    endDate: dateOnly(campaign.goal.endDate),
    remainingDays: calendar.remainingDays,
    masteredTransferableCount: projectedStates.filter((state) => state.masteryState === "mastered").length,
    totalTransferableCount: transferable.length,
    currentPrimaryNodeId: todayTask?.primaryNodeId ?? null,
    nodes,
    requiredDependencies: campaignCurriculumAssets.graph.edges
      .filter((edge) => edge.type === "required")
      .map((edge) => ({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId })),
    nonTransferablePool: campaignCurriculumAssets.graph.nodes
      .filter((node) => node.kind === "non_transferable")
      .map((node) => ({
        nodeId: node.nodeId,
        nodeName: node.label.en,
        problemCount: node.primaryProblems.length,
        attemptedProblemCount: attemptedByNode.get(node.nodeId)?.size ?? 0,
      })),
    recentSettlements: recent.flatMap((item) => item.settlement ? [{
      problemTitle: titleBySlug.get(item.problemSlug) ?? item.problemSlug,
      nodeName: nodeById.get(item.nodeId)?.label.en ?? item.nodeId,
      outcome: outcomeFor(item.settlement)!,
      settledAt: item.settlement.settledAt.toISOString(),
    }] : []),
  };
}

export async function resolveCampaignWorkbenchContext(
  db: PrismaClient,
  input: { userId: string; attemptId: string },
): Promise<CampaignWorkbenchContextView | null> {
  const attempt = await db.campaignTaskItemAttempt.findUnique({
    where: { id: input.attemptId },
    include: {
      settlement: true,
      taskItem: { include: { dailyTask: { include: { campaign: true } } } },
    },
  });
  if (!attempt || attempt.taskItem.dailyTask.campaign.userId !== input.userId) return null;
  const role = taskSlotRoleSchema.parse(attempt.taskItem.slotRole);
  const node = campaignCurriculumAssets.graph.nodes.find((entry) => entry.nodeId === attempt.taskItem.nodeId);
  const settled = Boolean(attempt.settlement);
  return {
    attemptId: attempt.id,
    taskItemId: attempt.taskItemId,
    problemSlug: attempt.taskItem.problemSlug,
    slotRole: role,
    roleLabel: ROLE_LABELS[role],
    taskOrder: attempt.taskItem.sortOrder,
    settled,
    ...((role !== "mixed" || settled) && node ? { nodeName: node.label.en } : {}),
    mixedHidden: role === "mixed" && !settled,
  };
}

export async function startOrResumeCampaignWorkbenchEntry(
  db: PrismaClient,
  input: { userId: string; taskItemId: string; browserInstanceId: string; now: Date },
) {
  const item = await db.campaignTaskItem.findUnique({
    where: { id: input.taskItemId },
    include: { dailyTask: { include: { campaign: true } }, settlement: true },
  });
  if (!item) throw new CampaignBindingError("task_not_found", "Campaign task item was not found.", 404);
  if (item.dailyTask.campaign.userId !== input.userId) {
    throw new CampaignBindingError("wrong_learner", "Campaign task item belongs to another learner.", 403);
  }
  const problem = await db.problem.findUnique({ where: { slug: item.problemSlug }, select: { id: true, slug: true } });
  if (!problem) throw new CampaignExperienceError("entry_problem_missing", "Campaign problem is unavailable.", 409);
  const memoryOrigin = resolveMemoryOrigin();
  const activeIdentityKey = buildActiveIdentityKey({
    userId: input.userId,
    problemId: problem.id,
    browserInstanceId: input.browserInstanceId,
    memoryOrigin,
  });
  const workspace = await db.problemWorkspaceSession.upsert({
    where: { activeIdentityKey },
    update: { lastActivityAt: input.now },
    create: {
      userId: input.userId,
      problemId: problem.id,
      browserInstanceId: input.browserInstanceId,
      activeIdentityKey,
      startTrigger: "campaign_task",
      captureLevel: process.env.NODE_ENV === "development" ? "full" : "summary",
      memoryOrigin,
      startedAt: input.now,
      lastActivityAt: input.now,
    },
  });
  const result = await startOrResumeCampaignTaskItemAttempt(db, {
    userId: input.userId,
    taskItemId: item.id,
    workspaceSessionId: workspace.id,
    now: input.now,
  });
  const context = await resolveCampaignWorkbenchContext(db, {
    userId: input.userId,
    attemptId: result.attempt.id,
  });
  if (!context) throw new CampaignExperienceError("stale_task_item", "Campaign task entry is stale.");
  const params = new URLSearchParams({
    problem: problem.slug,
    language: "Python",
    campaignAttempt: result.attempt.id,
  });
  return {
    attemptId: result.attempt.id,
    workspaceSessionId: workspace.id,
    workbenchUrl: `/workbench?${params.toString()}`,
    status: result.kind,
    context,
  };
}

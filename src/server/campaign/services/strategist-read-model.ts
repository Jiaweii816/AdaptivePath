import type { PrismaClient } from "@prisma/client";
import {
  buildAdvanceFrontier,
  buildDeepFillCandidates,
  deriveCampaignPhase,
} from "../core";
import { campaignCurriculumAssets } from "../curriculum";
import {
  STRATEGIST_PLANNING_HISTORY_LIMIT,
  STRATEGIST_READ_MODEL_VERSION,
  STRATEGIST_READ_MODEL_MAX_CHARS,
  STRATEGIST_RECEIPT_WINDOW_DAYS,
  canonicalStrategistJson,
  strategistDigest,
  strategistReadModelSchema,
  strategistWakeSnapshotSchema,
  storedCampaignSkeletonPatchOperationsSchema,
  type StrategistReadModel,
  type StrategistWakeSnapshot,
} from "../domain";
import { findActiveSkeleton } from "../store";
import {
  buildCampaignProblemAvailability,
  projectCampaignNodeState,
  projectCampaignSkeleton,
} from "./campaign-core-service";

const REPAIR_REASON_COPY: Readonly<Record<string, string>> = {
  target_negative: "Recent transfer evidence exposed an unstable condition or state update.",
  mastery_needs_reinforcement: "Recent evidence indicates focused reinforcement is needed.",
  remedial_negative: "A focused repair attempt remained negative.",
  mixed_negative: "Mixed practice exposed a mechanism recognition or application gap.",
  non_transferable_gap: "A focused attempt exposed a boundary or implementation gap.",
};

type ReceiptItem = {
  nodeId?: unknown;
  slotRole?: unknown;
  outcome?: unknown;
};

function parseStringArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseReceiptItems(value: string): ReceiptItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is ReceiptItem => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

function shortfallCount(value: string) {
  try {
    const parsed = JSON.parse(value) as { shortfall?: { missingCount?: unknown } | null };
    return typeof parsed.shortfall?.missingCount === "number" ? Math.max(0, Math.trunc(parsed.shortfall.missingCount)) : 0;
  } catch {
    return 0;
  }
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function campaignWeek(startDate: string, campaignDate: string) {
  return Math.max(1, Math.floor((dayNumber(campaignDate) - dayNumber(startDate)) / 7) + 1);
}

function outcome(settlement: { positiveForMastery: boolean; negativeOutcome: boolean }) {
  return settlement.positiveForMastery ? "positive" as const : settlement.negativeOutcome ? "negative" as const : "neutral" as const;
}

function maxIso(values: readonly Date[]) {
  return new Date(Math.max(...values.map((value) => value.valueOf()))).toISOString();
}

function affectedNodeIds(operationsJson: string) {
  try {
    const parsed = storedCampaignSkeletonPatchOperationsSchema.parse(JSON.parse(operationsJson));
    return [...new Set(parsed.operations.flatMap((operation) => operation.type === "set_mixed_window_days" ? [] : [operation.nodeId]))]
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export async function buildStrategistReadModel(input: {
  db: PrismaClient;
  campaignId: string;
  campaignDate: string;
}): Promise<{
  readModel: StrategistReadModel;
  inputDigest: string;
  wakeSnapshot: StrategistWakeSnapshot;
}> {
  const campaign = await input.db.campaign.findUniqueOrThrow({
    where: { id: input.campaignId },
    include: { goal: true },
  });
  if (!campaign.goal) throw new Error("Campaign Goal is required for Strategist projection.");
  const skeleton = await findActiveSkeleton(input.db, campaign.id);
  const [states, availability, receipts, repairs, decisions, latestRun, todayTask, settlements] = await Promise.all([
    input.db.campaignLearnerNodeState.findMany({ where: { campaignId: campaign.id }, orderBy: { nodeId: "asc" } }),
    buildCampaignProblemAvailability(input.db, campaign.userId, new Map()),
    input.db.campaignTaskReceipt.findMany({
      where: { campaignId: campaign.id },
      include: { task: true },
      orderBy: [{ campaignDate: "desc" }, { id: "asc" }],
      take: STRATEGIST_RECEIPT_WINDOW_DAYS,
    }),
    input.db.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id, status: { in: ["pending", "scheduled"] } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { nodeId: "asc" }, { id: "asc" }],
    }),
    input.db.campaignSkeletonDecisionLog.findMany({
      where: { campaignId: campaign.id },
      include: { patch: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: STRATEGIST_PLANNING_HISTORY_LIMIT,
    }),
    input.db.campaignStrategistRun.findFirst({
      where: { campaignId: campaign.id, status: { in: ["no_change", "proposed", "invalid"] } },
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    }),
    input.db.campaignDailyTask.findUnique({
      where: { campaignId_campaignDate: { campaignId: campaign.id, campaignDate: input.campaignDate } },
    }),
    input.db.campaignTaskItemSettlement.findMany({
      where: { taskItem: { dailyTask: { campaignId: campaign.id } } },
      include: { taskItem: true },
      orderBy: [{ settledAt: "desc" }, { id: "asc" }],
    }),
  ]);
  const projectedSkeleton = projectCampaignSkeleton(skeleton);
  const projectedStates = states.map(projectCampaignNodeState);
  const stateByNode = new Map(projectedStates.map((state) => [state.nodeId, state]));
  const availabilityByNode = new Map<string, typeof availability>();
  for (const problem of availability) {
    const values = availabilityByNode.get(problem.nodeId) ?? [];
    values.push(problem);
    availabilityByNode.set(problem.nodeId, values);
  }
  const planByNode = new Map(projectedSkeleton.nodePlans.map((plan) => [plan.nodeId, plan]));
  const frontier = buildAdvanceFrontier({
    curriculum: campaignCurriculumAssets,
    skeleton: projectedSkeleton,
    nodeStates: projectedStates,
  });
  const deepFill = buildDeepFillCandidates({
    campaignDate: input.campaignDate,
    curriculum: campaignCurriculumAssets,
    skeleton: projectedSkeleton,
    learnerNodeStates: projectedStates,
    problemAvailability: availability,
  });
  const endDate = campaign.goal.endDate.toISOString().slice(0, 10);
  const phase = deriveCampaignPhase({
    advanceFrontier: frontier,
    campaignDate: input.campaignDate,
    endDate,
    mixedWindowDays: skeleton.mixedWindowDays,
    hasDeepFillCandidate: deepFill.length > 0,
  }).phase;
  const recentOutcomeByNode = new Map<string, Array<"positive" | "negative" | "neutral">>();
  for (const settlement of settlements) {
    const values = recentOutcomeByNode.get(settlement.taskItem.nodeId) ?? [];
    if (values.length < 5) values.push(outcome(settlement));
    recentOutcomeByNode.set(settlement.taskItem.nodeId, values);
  }
  const transferableNodes = campaignCurriculumAssets.graph.nodes
    .filter((node) => node.kind === "transferable")
    .sort((left, right) => (planByNode.get(left.nodeId)?.order ?? 999) - (planByNode.get(right.nodeId)?.order ?? 999) || left.nodeId.localeCompare(right.nodeId));
  const availableCounts = (nodeId: string) => {
    const problems = availabilityByNode.get(nodeId) ?? [];
    return {
      neverSeen: problems.filter((problem) => problem.exposureType === "never_seen").length,
      externallySeen: problems.filter((problem) => problem.exposureType === "externally_seen").length,
      cooldownAvailable: problems.filter((problem) => problem.exposureType === "internally_attempted" && (!problem.cooldownUntil || problem.cooldownUntil <= input.campaignDate)).length,
    };
  };
  const receiptViews = receipts.map((receipt) => {
    const items = parseReceiptItems(receipt.itemsJson);
    const nodeIds = [...new Set(items.flatMap((item) => typeof item.nodeId === "string" ? [item.nodeId] : []))].sort();
    const roles = [...new Set(items.flatMap((item) => typeof item.slotRole === "string" ? [item.slotRole] : []))].sort();
    return {
      campaignDate: receipt.campaignDate,
      plannedCount: receipt.plannedCount,
      settledCount: receipt.settledCount,
      status: receipt.status as "completed" | "partial" | "skipped" | "active",
      nodeOutcomes: nodeIds.map((nodeId) => ({
        nodeId,
        positive: items.filter((item) => item.nodeId === nodeId && item.outcome === "positive").length,
        negative: items.filter((item) => item.nodeId === nodeId && item.outcome === "negative").length,
        neutral: items.filter((item) => item.nodeId === nodeId && item.outcome === "neutral").length,
      })),
      slotRoles: roles.map((slotRole) => ({ slotRole: slotRole as "advance" | "target" | "remedial" | "probe" | "mixed", count: items.filter((item) => item.slotRole === slotRole).length })),
      shortfallCount: shortfallCount(receipt.task.selectionMetadataJson),
    };
  });
  const repairGroups = new Map<string, { nodeId: string; reason: string; priority: number; ageDays: number; status: "pending" | "scheduled"; accumulatedCount: number }>();
  for (const repair of repairs) {
    const key = `${repair.nodeId}:${repair.reason}:${repair.status}`;
    const ageDays = Math.max(0, dayNumber(input.campaignDate) - dayNumber(dateInTimeZone(repair.createdAt, campaign.goal.timezone)));
    const existing = repairGroups.get(key);
    repairGroups.set(key, {
      nodeId: repair.nodeId,
      reason: REPAIR_REASON_COPY[repair.reason] ?? "A recent task produced a deterministic repair signal.",
      priority: Math.max(existing?.priority ?? Number.MIN_SAFE_INTEGER, repair.priority),
      ageDays: Math.max(existing?.ageDays ?? 0, ageDays),
      status: repair.status as "pending" | "scheduled",
      accumulatedCount: (existing?.accumulatedCount ?? 0) + 1,
    });
  }
  const startDate = dateInTimeZone(campaign.createdAt, campaign.goal.timezone);
  const readModel = strategistReadModelSchema.parse({
    readModelVersion: STRATEGIST_READ_MODEL_VERSION,
    campaign: {
      campaignId: campaign.id,
      startDate,
      endDate,
      campaignDate: input.campaignDate,
      remainingDays: dayNumber(endDate) - dayNumber(input.campaignDate),
      dailyQuestionBudget: campaign.goal.dailyQuestionBudget,
      language: campaign.goal.language,
      selfReportedWeakNodes: parseStringArray(campaign.goal.selfReportedWeakNodesJson).sort(),
      preferredNodes: parseStringArray(campaign.goal.preferredNodesJson).sort(),
      mixedWindowDays: skeleton.mixedWindowDays,
      goalUpdatedAt: campaign.goal.updatedAt.toISOString(),
    },
    activeSkeleton: {
      version: skeleton.version,
      nodePlans: transferableNodes.map((node) => {
        const plan = planByNode.get(node.nodeId)!;
        const incoming = campaignCurriculumAssets.graph.edges.filter((edge) => edge.toNodeId === node.nodeId);
        return {
          nodeId: node.nodeId,
          nodeName: node.label.en,
          included: plan.included,
          order: plan.order,
          priority: plan.priority,
          targetWeek: plan.targetWeek,
          goalDepth: plan.goalDepth ?? "mastery",
          targetByDate: plan.targetByDate ?? null,
          rationale: plan.rationale,
          requiredPrerequisites: incoming.filter((edge) => edge.type === "required").map((edge) => edge.fromNodeId).sort(),
          recommendedPrerequisites: incoming.filter((edge) => edge.type === "recommended").map((edge) => edge.fromNodeId).sort(),
        };
      }),
    },
    learnerNodes: transferableNodes.map((node) => {
      const state = stateByNode.get(node.nodeId)!;
      const plan = planByNode.get(node.nodeId)!;
      const counts = availableCounts(node.nodeId);
      return {
        nodeId: node.nodeId,
        nodeName: node.label.en,
        included: plan.included,
        unlocked: Boolean(state.unlockedAt),
        started: Boolean(state.startedAt),
        masteryState: state.masteryState,
        masteryHealth: state.masteryHealth,
        latestPositiveStreak: state.latestPositiveStreak,
        masteredAt: state.masteredAt?.toISOString() ?? null,
        recentOutcomes: recentOutcomeByNode.get(node.nodeId) ?? [],
        remainingNeverSeenCount: counts.neverSeen,
        externallySeenCount: counts.externallySeen,
        cooldownAvailableCount: counts.cooldownAvailable,
      };
    }),
    nonTransferableSupply: campaignCurriculumAssets.graph.nodes
      .filter((node) => node.kind === "non_transferable")
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
      .map((node) => {
        const counts = availableCounts(node.nodeId);
        return { nodeId: node.nodeId, nodeName: node.label.en, neverSeenCount: counts.neverSeen, externallySeenCount: counts.externallySeen, cooldownAvailableCount: counts.cooldownAvailable };
      }),
    recentReceipts: receiptViews,
    repairQueue: [...repairGroups.values()].sort((left, right) => right.priority - left.priority || right.ageDays - left.ageDays || left.nodeId.localeCompare(right.nodeId) || left.reason.localeCompare(right.reason)),
    planningHistory: decisions.map((decision) => ({
      rationale: decision.rationale ?? decision.patch.rationale,
      decision: decision.action,
      affectedNodeIds: affectedNodeIds(decision.patch.operationsJson),
      resultingSkeletonVersion: decision.resultingVersion,
      createdAt: decision.createdAt.toISOString(),
    })),
    operational: {
      phase,
      advanceFrontierNodeIds: frontier.map((entry) => entry.nodeId),
      currentPrimaryNodeId: todayTask?.primaryNodeId ?? null,
      dailyTaskGenerated: Boolean(todayTask),
      pendingPatchExists: await input.db.campaignSkeletonPatch.count({ where: { campaignId: campaign.id, status: "pending" } }) > 0,
      latestStrategistRunWatermark: latestRun?.completedAt?.toISOString() ?? null,
      shortfallDaysInWindow: receiptViews.filter((receipt) => receipt.shortfallCount > 0).length,
    },
  });
  const serialized = canonicalStrategistJson(readModel);
  if (serialized.length > STRATEGIST_READ_MODEL_MAX_CHARS) {
    throw new Error(`Strategist read model exceeds ${STRATEGIST_READ_MODEL_MAX_CHARS} characters.`);
  }
  const goalDigest = strategistDigest({ ...readModel.campaign, campaignId: undefined, campaignDate: undefined, remainingDays: undefined });
  const stateDigest = strategistDigest(readModel.learnerNodes);
  const receiptDigest = strategistDigest(readModel.recentReceipts);
  const repairDigest = strategistDigest(readModel.repairQueue.map((repair) => ({
    nodeId: repair.nodeId,
    reason: repair.reason,
    priority: repair.priority,
    status: repair.status,
    accumulatedCount: repair.accumulatedCount,
  })));
  const pendingRepairs = repairs.filter((repair) => repair.status === "pending");
  const consecutiveCount = (predicate: (receipt: typeof receiptViews[number]) => boolean) => {
    let count = 0;
    for (const receipt of receiptViews) {
      if (!predicate(receipt)) break;
      count += 1;
    }
    return count;
  };
  const watermarkDates = [campaign.updatedAt, campaign.goal.updatedAt, skeleton.createdAt, ...states.map((state) => state.updatedAt), ...repairs.map((repair) => repair.updatedAt), ...receipts.map((receipt) => receipt.updatedAt)];
  const wakeSnapshot = strategistWakeSnapshotSchema.parse({
    campaignDate: input.campaignDate,
    activeSkeletonVersion: skeleton.version,
    campaignWeek: campaignWeek(startDate, input.campaignDate),
    goalDigest,
    stateDigest,
    frontierDigest: strategistDigest(readModel.operational.advanceFrontierNodeIds),
    phase,
    receiptDigest,
    repairDigest,
    masteredNodeIds: readModel.learnerNodes.filter((node) => node.masteryState === "mastered").map((node) => node.nodeId).sort(),
    pendingRepairCount: pendingRepairs.length,
    oldestPendingRepairAgeDays: pendingRepairs.length ? Math.max(...pendingRepairs.map((repair) => Math.max(0, dayNumber(input.campaignDate) - dayNumber(dateInTimeZone(repair.createdAt, campaign.goal!.timezone))))) : 0,
    consecutiveIncompleteReceipts: consecutiveCount((receipt) => receipt.status === "partial" || receipt.status === "skipped"),
    consecutiveShortfallReceipts: consecutiveCount((receipt) => receipt.shortfallCount > 0),
    evaluatedWatermark: maxIso(watermarkDates),
  });
  return { readModel, inputDigest: strategistDigest(readModel), wakeSnapshot };
}

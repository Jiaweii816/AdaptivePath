import type { Prisma, PrismaClient } from "@prisma/client";
import type { SkeletonProjection } from "../domain/contracts";

export const REPAIR_REACTIVATION_WINDOW_DAYS = 14;

function readScheduledRepairIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as { scheduledRepairQueueItemIds?: unknown };
    return Array.isArray(parsed.scheduledRepairQueueItemIds)
      ? parsed.scheduledRepairQueueItemIds.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Reconciles only route-dependent Repair eligibility. The caller supplies a
 * transaction and explicit clock/date; learner truth and task history are read
 * but never rewritten or deleted.
 */
export async function reconcileRouteDependentState(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    resultingSkeleton: SkeletonProjection;
    campaignDate: string;
    now: Date;
  },
) {
  const today = await tx.campaignDailyTask.findUnique({
    where: {
      campaignId_campaignDate: {
        campaignId: input.campaignId,
        campaignDate: input.campaignDate,
      },
    },
    select: { selectionMetadataJson: true },
  });
  const protectedRepairIds = new Set(
    today ? readScheduledRepairIds(today.selectionMetadataJson) : [],
  );
  const masteryNodeIds = new Set(
    input.resultingSkeleton.nodePlans
      .filter((plan) => plan.included && (plan.goalDepth ?? "mastery") === "mastery")
      .map((plan) => plan.nodeId),
  );
  const routeInactiveNodeIds = input.resultingSkeleton.nodePlans
    .filter((plan) => !plan.included || (plan.goalDepth ?? "mastery") === "exposure")
    .map((plan) => plan.nodeId);

  const activeRepairs = await tx.campaignRepairQueueItem.findMany({
    where: {
      campaignId: input.campaignId,
      nodeId: { in: routeInactiveNodeIds },
      status: { in: ["pending", "scheduled"] },
    },
    select: { id: true },
  });
  const suspendIds = activeRepairs
    .map((repair) => repair.id)
    .filter((repairId) => !protectedRepairIds.has(repairId));
  const suspended = suspendIds.length > 0
    ? await tx.campaignRepairQueueItem.updateMany({
        where: { id: { in: suspendIds }, status: { in: ["pending", "scheduled"] } },
        data: { status: "suspended", suspendedAt: input.now, expiredAt: null, updatedAt: input.now },
      })
    : { count: 0 };

  const candidates = await tx.campaignRepairQueueItem.findMany({
    where: {
      campaignId: input.campaignId,
      status: "suspended",
      nodeId: { in: [...masteryNodeIds] },
    },
    select: { id: true, nodeId: true, createdAt: true },
  });
  const positiveEvidence = candidates.length > 0
    ? await tx.campaignTaskItemSettlement.findMany({
        where: {
          positiveForMastery: true,
          taskItem: {
            dailyTask: { campaignId: input.campaignId },
            nodeId: { in: [...new Set(candidates.map((candidate) => candidate.nodeId))] },
          },
        },
        select: { settledAt: true, taskItem: { select: { nodeId: true } } },
      })
    : [];
  const windowMs = REPAIR_REACTIVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const restoreIds: string[] = [];
  const expireIds: string[] = [];
  for (const candidate of candidates) {
    const withinWindow = input.now.valueOf() - candidate.createdAt.valueOf() <= windowMs;
    const superseded = positiveEvidence.some((evidence) =>
      evidence.taskItem.nodeId === candidate.nodeId && evidence.settledAt > candidate.createdAt,
    );
    (withinWindow && !superseded ? restoreIds : expireIds).push(candidate.id);
  }
  const restored = restoreIds.length > 0
    ? await tx.campaignRepairQueueItem.updateMany({
        where: { id: { in: restoreIds }, status: "suspended" },
        data: { status: "pending", suspendedAt: null, expiredAt: null, updatedAt: input.now },
      })
    : { count: 0 };
  const expired = expireIds.length > 0
    ? await tx.campaignRepairQueueItem.updateMany({
        where: { id: { in: expireIds }, status: "suspended" },
        data: { status: "expired", expiredAt: input.now, updatedAt: input.now },
      })
    : { count: 0 };

  return {
    suspendedCount: suspended.count,
    restoredCount: restored.count,
    expiredCount: expired.count,
    protectedRepairIds: [...protectedRepairIds].sort(),
  };
}

export class RouteReconciliationService {
  constructor(private readonly prisma: PrismaClient) {}

  reconcile(input: {
    campaignId: string;
    resultingSkeleton: SkeletonProjection;
    campaignDate: string;
    now: Date;
  }) {
    return this.prisma.$transaction((tx) => reconcileRouteDependentState(tx, input));
  }
}

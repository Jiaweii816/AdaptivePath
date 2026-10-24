import type { PrismaClient } from "@prisma/client";
import {
  CAMPAIGN_SLOT_ROLES,
  campaignLearningNodes,
  type CampaignSlotRole,
} from "../curriculum";
import { resolveCampaignAttemptForWorkspaceSession } from "../services/task-evidence-binding";
import type {
  CampaignCoachingContext,
  CampaignCoachingPolicy,
} from "./contracts";

const nodeById = new Map(
  campaignLearningNodes.map((node) => [node.nodeId, node] as const),
);

/** Loads the trusted static portion before policy derivation. */
export async function resolveCampaignCoachingTaskContext(
  db: PrismaClient,
  input: { workspaceSessionId: string | null; problemSlug: string },
) {
  if (!input.workspaceSessionId) return null;
  const bound = await resolveCampaignAttemptForWorkspaceSession(
    db,
    input.workspaceSessionId,
  );
  if (!bound) return null;
  if (bound.problemSlug !== input.problemSlug) {
    throw new Error("Campaign workspace problem binding is inconsistent.");
  }
  if (!isCampaignSlotRole(bound.slotRole)) {
    throw new Error("Campaign workspace has an invalid slot role.");
  }
  const node = nodeById.get(bound.nodeId);
  if (!node) throw new Error("Campaign workspace references an unknown node.");
  return {
    binding: bound,
    slotRole: bound.slotRole,
    settled: bound.settled,
    nodeKind: node.kind,
    nodeNameInternal: node.label.zh,
    nodeLabelAliasesInternal: [node.label.zh, node.label.en],
    coreInvariantInternal: node.description,
    repairReason:
      bound.slotRole === "remedial"
        ? await resolveTrustedRepairReason(db, {
            taskId: bound.taskId,
            campaignId: bound.campaignId,
            nodeId: bound.nodeId,
          })
        : undefined,
  } as const;
}

export function attachCampaignCoachingPolicy(
  task: NonNullable<
    Awaited<ReturnType<typeof resolveCampaignCoachingTaskContext>>
  >,
  policy: CampaignCoachingPolicy,
): CampaignCoachingContext {
  return {
    taskItemId: task.binding.taskItemId,
    attemptId: task.binding.attemptId,
    slotRole: task.slotRole,
    settled: task.settled,
    nodeKind: task.nodeKind,
    nodeNameInternal: task.nodeNameInternal,
    nodeLabelAliasesInternal: task.nodeLabelAliasesInternal,
    coreInvariantInternal: task.coreInvariantInternal,
    repairReason: task.repairReason,
    policy,
  };
}

async function resolveTrustedRepairReason(
  db: PrismaClient,
  input: { taskId: string; campaignId: string; nodeId: string },
) {
  const task = await db.campaignDailyTask.findUnique({
    where: { id: input.taskId },
    select: { selectionMetadataJson: true },
  });
  const ids = readScheduledRepairIds(task?.selectionMetadataJson);
  if (ids.length === 0) return undefined;
  const candidates = await db.campaignRepairQueueItem.findMany({
    where: {
      id: { in: ids },
      campaignId: input.campaignId,
      nodeId: input.nodeId,
      status: "scheduled",
    },
    orderBy: [
      { priority: "desc" },
      { createdAt: "asc" },
      { nodeId: "asc" },
      { id: "asc" },
    ],
    select: { reason: true },
  });
  return candidates[0] ? humanizeRepairReason(candidates[0].reason) : undefined;
}

function readScheduledRepairIds(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as {
      scheduledRepairQueueItemIds?: unknown;
    };
    return Array.isArray(parsed.scheduledRepairQueueItemIds)
      ? parsed.scheduledRepairQueueItemIds.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function humanizeRepairReason(reason: string) {
  const copy: Record<string, string> = {
    target_negative: "A recent transfer attempt exposed an unstable condition or state update.",
    mastery_needs_reinforcement:
      "Recent evidence suggests this mastered mechanism needs focused reinforcement.",
    remedial_negative:
      "The previous focused repair still left a condition, boundary, or update order unstable.",
    mixed_negative:
      "A mixed-practice attempt exposed a gap in recognizing or applying this mechanism.",
    non_transferable_gap:
      "A recent focused attempt exposed a concrete boundary or implementation gap.",
  };
  return copy[reason];
}

function isCampaignSlotRole(value: string): value is CampaignSlotRole {
  return (CAMPAIGN_SLOT_ROLES as readonly string[]).includes(value);
}

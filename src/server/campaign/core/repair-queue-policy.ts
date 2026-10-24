import {
  REPAIR_REASONS,
  type LearnerNodeStateProjection,
  type MasteryReductionOutput,
  type RepairReason,
  type TaskSlotRole,
} from "../domain/contracts";
import type { LearningNodeKind } from "../curriculum";

export type RepairQueueDecision = Readonly<{
  enqueue: boolean;
  reason: RepairReason | null;
  priority: number | null;
}>;

/** Higher numeric priority is more urgent. Probe failures never enqueue repair. */
export function deriveRepairQueueDecision(input: {
  nodeKind: LearningNodeKind;
  beforeState: LearnerNodeStateProjection | null;
  reduction: MasteryReductionOutput | null;
  slotRole: TaskSlotRole;
  positiveForMastery: boolean;
  negativeOutcome: boolean;
}): RepairQueueDecision {
  if (
    input.positiveForMastery ||
    !input.negativeOutcome ||
    input.slotRole === "probe"
  ) {
    return { enqueue: false, reason: null, priority: null };
  }
  if (input.nodeKind === "non_transferable") {
    return input.slotRole === "mixed" || input.slotRole === "remedial"
      ? {
          enqueue: true,
          reason: REPAIR_REASONS.NON_TRANSFERABLE_GAP,
          priority: 70,
        }
      : { enqueue: false, reason: null, priority: null };
  }
  if (input.reduction?.shouldEnqueueRepair) {
    return {
      enqueue: true,
      reason: REPAIR_REASONS.MASTERY_NEEDS_REINFORCEMENT,
      priority: 100,
    };
  }
  if (input.slotRole === "mixed") {
    return {
      enqueue: true,
      reason: REPAIR_REASONS.MIXED_NEGATIVE,
      priority: 85,
    };
  }
  if (input.beforeState?.masteryState === "learning" && input.slotRole === "target") {
    return {
      enqueue: true,
      reason: REPAIR_REASONS.TARGET_NEGATIVE,
      priority: 80,
    };
  }
  if (input.slotRole === "remedial") {
    return {
      enqueue: true,
      reason: REPAIR_REASONS.REMEDIAL_NEGATIVE,
      priority: 90,
    };
  }
  return { enqueue: false, reason: null, priority: null };
}

export function compareRepairCandidates(
  left: {
    priority: number;
    createdAt: Date;
    nodeId: string;
    repairQueueItemId: string;
  },
  right: {
    priority: number;
    createdAt: Date;
    nodeId: string;
    repairQueueItemId: string;
  },
): number {
  return (
    right.priority - left.priority ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.nodeId.localeCompare(right.nodeId) ||
    left.repairQueueItemId.localeCompare(right.repairQueueItemId)
  );
}

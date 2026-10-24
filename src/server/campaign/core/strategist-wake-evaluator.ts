import {
  STRATEGIST_CONSECUTIVE_INCOMPLETE_THRESHOLD,
  STRATEGIST_EVALUATOR_VERSION,
  STRATEGIST_OLDEST_REPAIR_DAYS_THRESHOLD,
  STRATEGIST_PERSISTENT_SHORTFALL_THRESHOLD,
  STRATEGIST_REPAIR_BACKLOG_THRESHOLD,
  strategistDigest,
  type StrategistTrigger,
  type StrategistWakeEvaluation,
  type StrategistWakeSnapshot,
} from "../domain/strategist-contracts";

export type StrategistWakeInput = Readonly<{
  campaignId: string;
  campaignDate: string;
  activeSkeletonVersion: number;
  pendingPatchExists: boolean;
  current: StrategistWakeSnapshot;
  latestCompleted: StrategistWakeSnapshot | null;
}>;

function fingerprint(input: StrategistWakeInput, trigger: StrategistTrigger) {
  return strategistDigest({
    evaluatorVersion: STRATEGIST_EVALUATOR_VERSION,
    campaignId: input.campaignId,
    trigger,
    activeSkeletonVersion: input.activeSkeletonVersion,
    goalDigest: input.current.goalDigest,
    stateWatermark: input.current.stateDigest,
    frontierDigest: input.current.frontierDigest,
    phase: input.current.phase,
    receiptDigest: input.current.receiptDigest,
    repairDigest: input.current.repairDigest,
    campaignWeek: input.current.campaignWeek,
  });
}

export function evaluateStrategistWake(input: StrategistWakeInput): StrategistWakeEvaluation {
  if (input.pendingPatchExists) {
    return {
      shouldWake: false,
      trigger: null,
      reasons: [],
      triggerFingerprint: null,
      evaluatedWatermark: input.current.evaluatedWatermark,
      skippedReason: "pending_patch_exists",
    };
  }

  const latest = input.latestCompleted;
  let trigger: StrategistTrigger | null = null;
  const reasons: string[] = [];
  if (latest && latest.goalDigest !== input.current.goalDigest) {
    trigger = "goal_changed";
    reasons.push("campaign_goal_changed");
  } else {
    const newlyMastered = latest
      ? input.current.masteredNodeIds.filter((nodeId) => !latest.masteredNodeIds.includes(nodeId))
      : [];
    if (newlyMastered.length > 0) reasons.push(`new_mastery:${newlyMastered.join(",")}`);
    if (latest && latest.activeSkeletonVersion !== input.current.activeSkeletonVersion) reasons.push("active_skeleton_version_changed");
    if (latest && latest.frontierDigest !== input.current.frontierDigest) reasons.push("advance_frontier_changed");
    if (latest && latest.phase !== input.current.phase) reasons.push("campaign_phase_changed");
    if (
      input.current.pendingRepairCount >= STRATEGIST_REPAIR_BACKLOG_THRESHOLD &&
      (!latest || latest.pendingRepairCount < STRATEGIST_REPAIR_BACKLOG_THRESHOLD || latest.repairDigest !== input.current.repairDigest)
    ) reasons.push("repair_backlog");
    if (
      input.current.oldestPendingRepairAgeDays >= STRATEGIST_OLDEST_REPAIR_DAYS_THRESHOLD &&
      (!latest || latest.oldestPendingRepairAgeDays < STRATEGIST_OLDEST_REPAIR_DAYS_THRESHOLD)
    ) reasons.push("aged_pending_repair");
    if (
      input.current.consecutiveIncompleteReceipts >= STRATEGIST_CONSECUTIVE_INCOMPLETE_THRESHOLD &&
      (!latest || latest.receiptDigest !== input.current.receiptDigest)
    ) reasons.push("consecutive_incomplete_days");
    if (
      input.current.consecutiveShortfallReceipts >= STRATEGIST_PERSISTENT_SHORTFALL_THRESHOLD &&
      (!latest || latest.receiptDigest !== input.current.receiptDigest)
    ) reasons.push("persistent_task_shortfall");
    if (reasons.length > 0) trigger = "significant_state_change";
  }
  if (!trigger && (!latest || latest.campaignWeek !== input.current.campaignWeek)) {
    trigger = "weekly_boundary";
    reasons.push("campaign_week_unprocessed");
  }
  if (!trigger) {
    return {
      shouldWake: false,
      trigger: null,
      reasons: [],
      triggerFingerprint: null,
      evaluatedWatermark: input.current.evaluatedWatermark,
      skippedReason: "no_trigger",
    };
  }
  return {
    shouldWake: true,
    trigger,
    reasons: reasons.sort(),
    triggerFingerprint: fingerprint(input, trigger),
    evaluatedWatermark: input.current.evaluatedWatermark,
    skippedReason: null,
  };
}

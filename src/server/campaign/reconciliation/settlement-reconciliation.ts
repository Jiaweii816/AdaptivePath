import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { campaignCurriculumAssets } from "../curriculum";
import {
  deriveRepairQueueDecision,
  reduceLearnerNodeState,
  resolveNormalizedSettlementOutcome,
  resolveUnlockedNodes,
} from "../core";
import type {
  LearnerNodeStateProjection,
  NormalizedSettlementInput,
  SettlementProjection,
} from "../domain";
import type { CampaignDb } from "../store";
import { findActiveSkeleton } from "../store";
import {
  projectCampaignNodeState,
  projectCampaignSkeleton,
} from "../services/campaign-core-service";
import {
  buildCampaignSettlementInputFromReview,
  CampaignBindingError,
} from "../services/task-evidence-binding";
import { rebuildCampaignTaskReceipt } from "../services/task-receipt-service";

export const CURRENT_CAMPAIGN_SETTLEMENT_VERSION = 2;
export const SETTLEMENT_RECONCILIATION_SCRIPT_VERSION = "r1.1-v1";

type Outcome = "positive" | "negative" | "neutral";

export type SettlementCorrection = Readonly<{
  settlementId: string;
  taskItemId: string;
  dailyTaskId: string;
  reviewAttemptId: string;
  campaignId: string;
  nodeId: string;
  problemSlug: string;
  slotRole: string;
  oldOutcome: Outcome;
  newOutcome: Exclude<Outcome, "neutral">;
  selfRating: string;
  passed: boolean;
  positiveForMastery: boolean;
  negativeOutcome: boolean;
  evidenceSource: string | null;
  evidenceReferenceId: string | null;
  evidenceClass: string | null;
  evidenceAuthority: string | null;
  evidenceScope: string | null;
  evidenceSubject: string | null;
  settledAt: Date;
}>;

export type ReconciliationNodePrediction = Readonly<{
  nodeId: string;
  before: Readonly<{
    masteryState: string;
    masteryHealth: string;
    latestPositiveStreak: number;
    pendingRepairCount: number;
  }>;
  after: Readonly<{
    masteryState: string;
    masteryHealth: string;
    latestPositiveStreak: number;
    pendingRepairCount: number;
  }>;
  newlyUnlockedNodeIds: readonly string[];
}>;

export type SettlementReconciliationPlan = Readonly<{
  scriptVersion: string;
  userId: string;
  userHandle: string;
  campaignId: string;
  scannedSettlementCount: number;
  positiveCorrectionCount: number;
  negativeCorrectionCount: number;
  unchangedCount: number;
  corrections: readonly SettlementCorrection[];
  affectedNodeIds: readonly string[];
  affectedDailyTaskIds: readonly string[];
  affectedTaskReceiptIds: readonly string[];
  nodePredictions: readonly ReconciliationNodePrediction[];
  newlyUnlockedNodeIds: readonly string[];
  planDigest: string;
}>;

function oldOutcome(value: { positiveForMastery: boolean; negativeOutcome: boolean }): Outcome {
  return value.positiveForMastery ? "positive" : value.negativeOutcome ? "negative" : "neutral";
}

function initialReducerState(state: LearnerNodeStateProjection): LearnerNodeStateProjection {
  return {
    ...state,
    masteryState: "learning",
    masteryHealth: "stable",
    masteredAt: null,
    masteredBySettlementId: null,
    latestPositiveStreak: 0,
    latestSettlementIds: [],
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function digestReconciliationPlan(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function resolveOneCorrection(
  db: CampaignDb,
  userId: string,
  settlement: Awaited<ReturnType<typeof readCampaignSettlements>>[number],
): Promise<SettlementCorrection | null> {
  if (
    settlement.settlementVersion >= CURRENT_CAMPAIGN_SETTLEMENT_VERSION ||
    !settlement.reviewCompleted ||
    !settlement.attempt.reviewAttemptId
  ) return null;
  try {
    const built = await buildCampaignSettlementInputFromReview(db, {
      userId,
      reviewAttemptId: settlement.attempt.reviewAttemptId,
    });
    if (built.kind !== "campaign" || built.taskItemId !== settlement.taskItemId || built.attemptId !== settlement.attemptId) {
      return null;
    }
    const resolution = resolveNormalizedSettlementOutcome(built.normalized);
    if (!resolution || !["positive", "negative"].includes(resolution.outcome)) return null;
    const previous = oldOutcome(settlement);
    if (previous !== "neutral") return null;
    if (previous === resolution.outcome) return null;
    const selected = resolution.evidence;
    const normalized = built.normalized as NormalizedSettlementInput;
    return {
      settlementId: settlement.id,
      taskItemId: settlement.taskItemId,
      dailyTaskId: settlement.taskItem.dailyTaskId,
      reviewAttemptId: settlement.attempt.reviewAttemptId,
      campaignId: settlement.taskItem.dailyTask.campaignId,
      nodeId: settlement.taskItem.nodeId,
      problemSlug: settlement.taskItem.problemSlug,
      slotRole: settlement.taskItem.slotRole,
      oldOutcome: previous,
      newOutcome: resolution.outcome as "positive" | "negative",
      selfRating: String(normalized.selfRating),
      passed: resolution.passed,
      positiveForMastery: resolution.positiveForMastery,
      negativeOutcome: resolution.negativeOutcome,
      evidenceSource: selected?.source ?? normalized.evidenceSource ?? null,
      evidenceReferenceId: selected?.referenceId ?? normalized.evidenceReferenceId ?? null,
      evidenceClass: selected?.evidenceClass ?? normalized.evidenceClass ?? null,
      evidenceAuthority: selected?.evidenceAuthority ?? normalized.evidenceAuthority ?? null,
      evidenceScope: selected?.evidenceScope ?? normalized.evidenceScope ?? null,
      evidenceSubject: selected?.subject ?? normalized.evidenceSubject ?? null,
      settledAt: settlement.settledAt,
    };
  } catch (error) {
    if (error instanceof CampaignBindingError) return null;
    throw error;
  }
}

function readCampaignSettlements(db: CampaignDb, campaignId: string) {
  return db.campaignTaskItemSettlement.findMany({
    where: { taskItem: { dailyTask: { campaignId } } },
    select: {
      id: true,
      taskItemId: true,
      attemptId: true,
      reviewCompleted: true,
      passed: true,
      selfRating: true,
      positiveForMastery: true,
      negativeOutcome: true,
      settledAt: true,
      settlementVersion: true,
      attempt: {
        select: { id: true, reviewAttemptId: true },
      },
      taskItem: {
        select: {
          id: true,
          dailyTaskId: true,
          problemSlug: true,
          nodeId: true,
          slotRole: true,
          dailyTask: { select: { campaignId: true } },
        },
      },
    },
    orderBy: [{ settledAt: "asc" }, { id: "asc" }],
  });
}

export async function resolveReconciliationLearner(
  db: CampaignDb,
  handle: string,
): Promise<{ id: string; handle: string }> {
  const users = await db.user.findMany({ select: { id: true, handle: true } });
  const matches = users.filter((user) => user.handle.toLocaleLowerCase() === handle.toLocaleLowerCase());
  if (matches.length === 0) throw new Error(`Unknown learner handle: ${handle}`);
  if (matches.length !== 1) throw new Error(`Learner handle is ambiguous: ${handle}`);
  return matches[0]!;
}

export async function resolveReconciliationCampaign(
  db: CampaignDb,
  userId: string,
  explicitCampaignId?: string,
) {
  if (explicitCampaignId) {
    const campaign = await db.campaign.findFirst({ where: { id: explicitCampaignId, userId } });
    if (!campaign) throw new Error("The explicit Campaign was not found for this learner.");
    return campaign;
  }
  const active = await db.campaign.findMany({
    where: { userId, status: "active" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (active.length === 0) throw new Error("Learner has no active Campaign; pass --campaign-id explicitly.");
  if (active.length > 1) throw new Error("Learner has multiple active Campaigns; pass --campaign-id explicitly.");
  return active[0]!;
}

async function projectionsForNode(
  db: CampaignDb,
  campaignId: string,
  nodeId: string,
  correctionBySettlement: ReadonlyMap<string, SettlementCorrection>,
): Promise<SettlementProjection[]> {
  const items = await db.campaignTaskItem.findMany({
    where: { dailyTask: { campaignId }, nodeId, settlement: { isNot: null } },
    include: { settlement: { select: {
      id: true, positiveForMastery: true, negativeOutcome: true, settledAt: true,
    } } },
  });
  return items.flatMap((item) => {
    if (!item.settlement) return [];
    const correction = correctionBySettlement.get(item.settlement.id);
    return [{
      settlementId: item.settlement.id,
      problemSlug: item.problemSlug,
      slotRole: item.slotRole as SettlementProjection["slotRole"],
      positiveForMastery: correction?.positiveForMastery ?? item.settlement.positiveForMastery,
      negativeOutcome: correction?.negativeOutcome ?? item.settlement.negativeOutcome,
      settledAt: item.settlement.settledAt,
    }];
  });
}

async function repairDecisionsForCorrections(
  db: CampaignDb,
  campaignId: string,
  corrections: readonly SettlementCorrection[],
  currentStates: ReadonlyMap<string, LearnerNodeStateProjection>,
  correctionBySettlement: ReadonlyMap<string, SettlementCorrection>,
) {
  const decisions: Array<{
    correction: SettlementCorrection;
    reason: string;
    priority: number;
  }> = [];
  for (const correction of corrections.filter((value) => value.negativeOutcome)) {
    const curriculumNode = campaignCurriculumAssets.graph.nodes.find((node) => node.nodeId === correction.nodeId);
    if (!curriculumNode) continue;
    const state = currentStates.get(correction.nodeId) ?? null;
    const projections = await projectionsForNode(db, campaignId, correction.nodeId, correctionBySettlement);
    const index = projections.findIndex((value) => value.settlementId === correction.settlementId);
    const before = state && curriculumNode.kind === "transferable"
      ? reduceLearnerNodeState({ currentState: initialReducerState(state), settlements: projections.slice(0, index) }).state
      : null;
    const reduction = state && curriculumNode.kind === "transferable"
      ? reduceLearnerNodeState({ currentState: initialReducerState(state), settlements: projections.slice(0, index + 1) })
      : null;
    const decision = deriveRepairQueueDecision({
      nodeKind: curriculumNode.kind,
      beforeState: before,
      reduction,
      slotRole: correction.slotRole as SettlementProjection["slotRole"],
      positiveForMastery: false,
      negativeOutcome: true,
    });
    if (decision.enqueue && decision.reason && decision.priority !== null) {
      decisions.push({ correction, reason: decision.reason, priority: decision.priority });
    }
  }
  return decisions;
}

export async function buildSettlementReconciliationPlan(input: {
  db: CampaignDb;
  userHandle: string;
  campaignId?: string;
}): Promise<SettlementReconciliationPlan> {
  const user = await resolveReconciliationLearner(input.db, input.userHandle);
  const campaign = await resolveReconciliationCampaign(input.db, user.id, input.campaignId);
  const settlements = await readCampaignSettlements(input.db, campaign.id);
  const corrections = (await Promise.all(
    settlements.map((settlement) => resolveOneCorrection(input.db, user.id, settlement)),
  )).filter((value): value is SettlementCorrection => Boolean(value));
  const correctionBySettlement = new Map(corrections.map((value) => [value.settlementId, value]));
  const affectedNodeIds = [...new Set(corrections.map((value) => value.nodeId))].sort();
  const affectedDailyTaskIds = [...new Set(corrections.map((value) => value.dailyTaskId))].sort();
  const stateRows = await input.db.campaignLearnerNodeState.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ nodeId: "asc" }],
  });
  const currentStates = new Map(stateRows.map((row) => [row.nodeId, projectCampaignNodeState(row)]));
  const predictedStates = new Map(currentStates);
  for (const nodeId of affectedNodeIds) {
    const current = currentStates.get(nodeId);
    const curriculumNode = campaignCurriculumAssets.graph.nodes.find((node) => node.nodeId === nodeId);
    if (!current || curriculumNode?.kind !== "transferable") continue;
    predictedStates.set(nodeId, reduceLearnerNodeState({
      currentState: initialReducerState(current),
      settlements: await projectionsForNode(input.db, campaign.id, nodeId, correctionBySettlement),
    }).state);
  }
  const repairs = await input.db.campaignRepairQueueItem.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ id: "asc" }],
  });
  const repairDecisions = await repairDecisionsForCorrections(
    input.db,
    campaign.id,
    corrections,
    currentStates,
    correctionBySettlement,
  );
  const openRepairCounts = new Map<string, number>();
  for (const repair of repairs.filter((value) => value.status !== "resolved")) {
    openRepairCounts.set(repair.nodeId, (openRepairCounts.get(repair.nodeId) ?? 0) + 1);
  }
  const predictedRepairCounts = new Map(openRepairCounts);
  for (const decision of repairDecisions) {
    const exists = repairs.some((repair) =>
      repair.nodeId === decision.correction.nodeId &&
      repair.triggerTaskItemId === decision.correction.taskItemId &&
      repair.reason === decision.reason,
    );
    if (!exists) {
      predictedRepairCounts.set(
        decision.correction.nodeId,
        (predictedRepairCounts.get(decision.correction.nodeId) ?? 0) + 1,
      );
    }
  }
  const skeleton = await findActiveSkeleton(input.db, campaign.id);
  const unlock = resolveUnlockedNodes({
    curriculum: campaignCurriculumAssets,
    skeleton: projectCampaignSkeleton(skeleton),
    nodeStates: [...predictedStates.values()],
  });
  const nodePredictions = affectedNodeIds.map((nodeId) => {
    const before = currentStates.get(nodeId)!;
    const after = predictedStates.get(nodeId)!;
    return {
      nodeId,
      before: {
        masteryState: before.masteryState,
        masteryHealth: before.masteryHealth,
        latestPositiveStreak: before.latestPositiveStreak,
        pendingRepairCount: openRepairCounts.get(nodeId) ?? 0,
      },
      after: {
        masteryState: after.masteryState,
        masteryHealth: after.masteryHealth,
        latestPositiveStreak: after.latestPositiveStreak,
        pendingRepairCount: predictedRepairCounts.get(nodeId) ?? 0,
      },
      newlyUnlockedNodeIds: unlock.newlyUnlockedNodeIds,
    };
  });
  const receipts = await input.db.campaignTaskReceipt.findMany({
    where: { campaignId: campaign.id }, select: { id: true, taskId: true, updatedAt: true }, orderBy: { id: "asc" },
  });
  const affectedTaskReceiptIds = receipts
    .filter((receipt) => affectedDailyTaskIds.includes(receipt.taskId))
    .map((receipt) => receipt.id)
    .sort();
  const digestPayload = {
    scriptVersion: SETTLEMENT_RECONCILIATION_SCRIPT_VERSION,
    user: { id: user.id, handle: user.handle },
    campaign: { id: campaign.id, status: campaign.status, updatedAt: campaign.updatedAt },
    settlements: settlements.map((value) => ({
      id: value.id,
      taskItemId: value.taskItemId,
      attemptId: value.attemptId,
      reviewAttemptId: value.attempt.reviewAttemptId,
      version: value.settlementVersion,
      selfRating: value.selfRating,
      passed: value.passed,
      positive: value.positiveForMastery,
      negative: value.negativeOutcome,
      settledAt: value.settledAt,
    })),
    corrections,
    nodeStates: stateRows.map((value) => ({
      id: value.id,
      nodeId: value.nodeId,
      masteryState: value.masteryState,
      masteryHealth: value.masteryHealth,
      streak: value.latestPositiveStreak,
      unlockedAt: value.unlockedAt,
      updatedAt: value.updatedAt,
    })),
    repairs: repairs.map((value) => ({
      id: value.id, nodeId: value.nodeId, taskItemId: value.triggerTaskItemId,
      reason: value.reason, priority: value.priority, status: value.status, updatedAt: value.updatedAt,
    })),
    receipts,
  };
  return {
    scriptVersion: SETTLEMENT_RECONCILIATION_SCRIPT_VERSION,
    userId: user.id,
    userHandle: user.handle,
    campaignId: campaign.id,
    scannedSettlementCount: settlements.length,
    positiveCorrectionCount: corrections.filter((value) => value.newOutcome === "positive").length,
    negativeCorrectionCount: corrections.filter((value) => value.newOutcome === "negative").length,
    unchangedCount: settlements.length - corrections.length,
    corrections,
    affectedNodeIds,
    affectedDailyTaskIds,
    affectedTaskReceiptIds,
    nodePredictions,
    newlyUnlockedNodeIds: unlock.newlyUnlockedNodeIds,
    planDigest: digestReconciliationPlan(digestPayload),
  };
}

export async function applySettlementReconciliationInTransaction(input: {
  tx: Prisma.TransactionClient;
  plan: SettlementReconciliationPlan;
  now: Date;
}) {
  const correctionBySettlement = new Map(input.plan.corrections.map((value) => [value.settlementId, value]));
  for (const correction of input.plan.corrections) {
    const updated = await input.tx.campaignTaskItemSettlement.updateMany({
      where: { id: correction.settlementId, settlementVersion: { lt: CURRENT_CAMPAIGN_SETTLEMENT_VERSION } },
      data: {
        passed: correction.passed,
        selfRating: correction.selfRating,
        positiveForMastery: correction.positiveForMastery,
        negativeOutcome: correction.negativeOutcome,
        settlementVersion: CURRENT_CAMPAIGN_SETTLEMENT_VERSION,
        evidenceSource: correction.evidenceSource,
        evidenceReferenceId: correction.evidenceReferenceId,
        evidenceClass: correction.evidenceClass,
        evidenceAuthority: correction.evidenceAuthority,
        evidenceScope: correction.evidenceScope,
        evidenceSubject: correction.evidenceSubject,
      },
    });
    if (updated.count !== 1) throw new Error(`Settlement changed during reconciliation: ${correction.settlementId}`);
  }
  const stateRows = await input.tx.campaignLearnerNodeState.findMany({
    where: { campaignId: input.plan.campaignId }, orderBy: { nodeId: "asc" },
  });
  const currentStates = new Map(stateRows.map((row) => [row.nodeId, projectCampaignNodeState(row)]));
  const repairDecisions = await repairDecisionsForCorrections(
    input.tx,
    input.plan.campaignId,
    input.plan.corrections,
    currentStates,
    correctionBySettlement,
  );
  for (const nodeId of input.plan.affectedNodeIds) {
    const row = stateRows.find((value) => value.nodeId === nodeId);
    const current = row ? projectCampaignNodeState(row) : null;
    const curriculumNode = campaignCurriculumAssets.graph.nodes.find((node) => node.nodeId === nodeId);
    if (!row || !current || curriculumNode?.kind !== "transferable") continue;
    const reduction = reduceLearnerNodeState({
      currentState: initialReducerState(current),
      settlements: await projectionsForNode(input.tx, input.plan.campaignId, nodeId, correctionBySettlement),
    });
    await input.tx.campaignLearnerNodeState.update({
      where: { id: row.id },
      data: {
        exposureState: "internally_attempted",
        masteryState: reduction.state.masteryState,
        masteryHealth: reduction.state.masteryHealth,
        masteredAt: reduction.state.masteredAt,
        masteredBySettlementId: reduction.state.masteredBySettlementId,
        latestPositiveStreak: reduction.state.latestPositiveStreak,
        latestSettlementIdsJson: JSON.stringify(reduction.state.latestSettlementIds),
        updatedAt: input.now,
      },
    });
  }
  for (const decision of repairDecisions) {
    await input.tx.campaignRepairQueueItem.upsert({
      where: {
        campaignId_nodeId_triggerTaskItemId_reason: {
          campaignId: input.plan.campaignId,
          nodeId: decision.correction.nodeId,
          triggerTaskItemId: decision.correction.taskItemId,
          reason: decision.reason,
        },
      },
      create: {
        campaignId: input.plan.campaignId,
        nodeId: decision.correction.nodeId,
        triggerTaskItemId: decision.correction.taskItemId,
        reason: decision.reason,
        priority: decision.priority,
        status: "pending",
        createdAt: input.now,
        updatedAt: input.now,
      },
      update: {},
    });
  }
  const skeleton = await findActiveSkeleton(input.tx, input.plan.campaignId);
  const finalStates = await input.tx.campaignLearnerNodeState.findMany({ where: { campaignId: input.plan.campaignId } });
  const unlock = resolveUnlockedNodes({
    curriculum: campaignCurriculumAssets,
    skeleton: projectCampaignSkeleton(skeleton),
    nodeStates: finalStates.map(projectCampaignNodeState),
  });
  if (unlock.newlyUnlockedNodeIds.length > 0) {
    await input.tx.campaignLearnerNodeState.updateMany({
      where: {
        campaignId: input.plan.campaignId,
        nodeId: { in: [...unlock.newlyUnlockedNodeIds] },
        unlockedAt: null,
      },
      data: { unlockedAt: input.now, updatedAt: input.now },
    });
  }
  for (const taskId of input.plan.affectedDailyTaskIds) {
    await rebuildCampaignTaskReceipt(input.tx, taskId, { updateDailyTask: false, now: input.now });
  }
  return { repairDecisions, newlyUnlockedNodeIds: unlock.newlyUnlockedNodeIds };
}

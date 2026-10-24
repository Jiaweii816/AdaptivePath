import { afterEach, describe, expect, it } from "vitest";
import { campaignCurriculumAssets } from "@/server/campaign/curriculum";
import {
  DAILY_SELECTOR_VERSION,
  projectNextDailyTask,
  serializeLearnerNodeState,
  serializeProblemAvailability,
  serializeRepairQueueCandidate,
  simulateCampaignPlan,
} from "@/server/campaign/core";
import type { ExistingDailyTask } from "@/server/campaign/domain";
import {
  buildCampaignProblemAvailability,
  CampaignCoreService,
  projectCampaignNodeState,
  projectCampaignSkeleton,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function campaignBusinessCounts(
  db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"],
) {
  const [
    campaigns,
    goals,
    skeletons,
    nodePlans,
    nodeStates,
    dailyTasks,
    taskItems,
    attempts,
    settlements,
    receipts,
    repairs,
    patches,
    strategistRuns,
    decisionLogs,
  ] = await Promise.all([
    db.campaign.count(),
    db.campaignGoal.count(),
    db.campaignSkeleton.count(),
    db.campaignSkeletonNodePlan.count(),
    db.campaignLearnerNodeState.count(),
    db.campaignDailyTask.count(),
    db.campaignTaskItem.count(),
    db.campaignTaskItemAttempt.count(),
    db.campaignTaskItemSettlement.count(),
    db.campaignTaskReceipt.count(),
    db.campaignRepairQueueItem.count(),
    db.campaignSkeletonPatch.count(),
    db.campaignStrategistRun.count(),
    db.campaignSkeletonDecisionLog.count(),
  ]);
  return {
    campaigns,
    goals,
    skeletons,
    nodePlans,
    nodeStates,
    dailyTasks,
    taskItems,
    attempts,
    settlements,
    receipts,
    repairs,
    patches,
    strategistRuns,
    decisionLogs,
  };
}

describe("Campaign Simulator persistence boundary", () => {
  it("does not write business tables or change an existing Today DailyTask", async () => {
    const testDb = await createCampaignTestDb();
    cleanups.push(testDb.cleanup);
    const now = new Date("2026-08-03T09:00:00.000Z");
    const user = await testDb.prisma.user.create({
      data: { handle: "campaign-m4d1a1-no-write" },
    });
    const service = new CampaignCoreService(testDb.prisma, { now: () => now });
    const campaign = await service.materializeInitialCampaign({
      userId: user.id,
      goal: {
        endDate: "2026-09-30",
        dailyQuestionBudget: 3,
        language: "Python",
        timezone: "America/Chicago",
        selfReportedWeakNodes: [],
        preferredNodes: [],
      },
    });
    const skeletonRecord = await testDb.prisma.campaignSkeleton.findUniqueOrThrow({
      where: {
        campaignId_version: {
          campaignId: campaign.id,
          version: campaign.activeSkeletonVersion,
        },
      },
      include: { nodePlans: { orderBy: [{ sortOrder: "asc" }, { nodeId: "asc" }] } },
    });
    const skeleton = projectCampaignSkeleton(skeletonRecord);
    const projectionNodeStates = await testDb.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: campaign.id },
      orderBy: { nodeId: "asc" },
    });
    const projectionRepairs = await testDb.prisma.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id, status: "pending" },
    });
    const availability = await buildCampaignProblemAvailability(
      testDb.prisma,
      user.id,
      new Map(),
    );
    const expectedProjection = projectNextDailyTask(
      {
        campaignId: campaign.id,
        endDate: "2026-09-30",
        curriculum: campaignCurriculumAssets,
        learnerNodeStates: projectionNodeStates
          .map(projectCampaignNodeState)
          .map(serializeLearnerNodeState),
        repairQueueCandidates: projectionRepairs.map((repair) =>
          serializeRepairQueueCandidate({
            repairQueueItemId: repair.id,
            nodeId: repair.nodeId,
            priority: repair.priority,
            createdAt: repair.createdAt,
          }),
        ),
        problemAvailability: availability.map(serializeProblemAvailability),
      },
      skeleton,
      3,
      "2026-08-03",
      { selectorVersion: DAILY_SELECTOR_VERSION },
    );
    if (expectedProjection.kind !== "task") throw new Error("expected projected task");

    const materialized = await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    });
    if ("kind" in materialized) throw new Error("expected persisted DailyTask");
    expect({
      kind: "task",
      campaignDate: materialized.campaignDate,
      phase: expectedProjection.phase,
      budget: materialized.budget,
      primaryNodeId: materialized.primaryNodeId,
      items: materialized.items.map((item) => ({
        problemSlug: item.problemSlug,
        nodeId: item.nodeId,
        slotRole: item.slotRole,
        exposureType: item.exposureType,
        order: item.sortOrder,
      })),
      scheduledRepairQueueItemIds: [],
      shortfall: null,
      reusedExisting: false,
    }).toEqual(expectedProjection);

    const nodeStates = await testDb.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: campaign.id },
      orderBy: { nodeId: "asc" },
    });
    const repairRows = await testDb.prisma.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id, status: "pending" },
    });
    const existingDailyTask: ExistingDailyTask = {
      campaignDate: materialized.campaignDate,
      phase: "coverage",
      budget: materialized.budget,
      primaryNodeId: materialized.primaryNodeId,
      items: materialized.items.map((item) => ({
        problemSlug: item.problemSlug,
        nodeId: item.nodeId,
        slotRole: item.slotRole as ExistingDailyTask["items"][number]["slotRole"],
        exposureType:
          item.exposureType as ExistingDailyTask["items"][number]["exposureType"],
        order: item.sortOrder,
      })),
      scheduledRepairQueueItemIds: [],
      shortfall: null,
    };
    const persistedBefore = await testDb.prisma.campaignDailyTask.findUniqueOrThrow({
      where: {
        campaignId_campaignDate: {
          campaignId: campaign.id,
          campaignDate: "2026-08-03",
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const countsBefore = await campaignBusinessCounts(testDb.prisma);

    const result = simulateCampaignPlan({
      state: {
        campaignId: campaign.id,
        endDate: "2026-09-30",
        curriculum: campaignCurriculumAssets,
        learnerNodeStates: nodeStates
          .map(projectCampaignNodeState)
          .map(serializeLearnerNodeState),
        repairQueueCandidates: repairRows.map((repair) =>
          serializeRepairQueueCandidate({
            repairQueueItemId: repair.id,
            nodeId: repair.nodeId,
            priority: repair.priority,
            createdAt: repair.createdAt,
          }),
        ),
        problemAvailability: availability.map(serializeProblemAvailability),
        existingDailyTasks: [existingDailyTask],
        settlements: [],
      },
      candidates: [{
        candidateId: "in-memory-priority-change",
        skeleton: {
          ...skeleton,
          version: skeleton.version + 1,
          nodePlans: skeleton.nodePlans.map((plan) => ({
            ...plan,
            priority: plan.priority + 100,
          })),
        },
      }],
      startCampaignDate: "2026-08-03",
      horizon: 1,
      dailyBudgets: [3],
      observedPace: {
        sampleDays: 0,
        observedCapacityRange: null,
        supportedPositiveItemsByDate: [],
      },
      options: { selectorVersion: 1, internalCooldownDays: 7 },
    });

    const countsAfter = await campaignBusinessCounts(testDb.prisma);
    const persistedAfter = await testDb.prisma.campaignDailyTask.findUniqueOrThrow({
      where: {
        campaignId_campaignDate: {
          campaignId: campaign.id,
          campaignDate: "2026-08-03",
        },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    const firstDay =
      result.candidates[0].branches.optimistic.internalDayProjections[0].projection;

    expect(firstDay).toEqual({ kind: "task", ...existingDailyTask, reusedExisting: true });
    expect(countsAfter).toEqual(countsBefore);
    expect(persistedAfter).toEqual(persistedBefore);
  });
});

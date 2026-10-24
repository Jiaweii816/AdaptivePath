import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
  RouteReconciliationService,
  projectCampaignSkeleton,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("reconcileRouteDependentState", () => {
  it("suspends route-inactive Repair, protects Today, and selectively restores idempotently", async () => {
    const testDb = await createCampaignTestDb();
    cleanups.push(testDb.cleanup);
    let now = new Date("2026-08-04T17:00:00.000Z");
    const clock = { now: () => now };
    const user = await testDb.prisma.user.create({ data: { handle: "m4d1a2-reconcile" } });
    const campaign = await new CampaignCoreService(testDb.prisma, clock).materializeInitialCampaign({
      userId: user.id,
      goal: {
        endDate: "2026-10-30",
        dailyQuestionBudget: 3,
        language: "Python",
        timezone: "America/Chicago",
        selfReportedWeakNodes: [],
        preferredNodes: [],
      },
    });
    const today = await new CampaignCoreService(testDb.prisma, clock).getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-04",
    });
    if ("kind" in today) throw new Error("Expected Today task");
    const trigger = await testDb.prisma.campaignTaskItem.create({
      data: {
        dailyTaskId: today.id,
        problemSlug: "m4d1a2-repair-fixture",
        nodeId: "N20",
        slotRole: "probe",
        exposureType: "never_seen",
        sortOrder: 99,
        status: "settled",
      },
    });
    await testDb.prisma.campaignLearnerNodeState.update({
      where: { campaignId_nodeId: { campaignId: campaign.id, nodeId: "N20" } },
      data: { unlockedAt: now },
    });
    const attempt = await testDb.prisma.campaignTaskItemAttempt.create({
      data: {
        taskItemId: trigger.id,
        startedAt: new Date("2026-08-04T14:30:00.000Z"),
        completedAt: new Date("2026-08-04T15:00:00.000Z"),
      },
    });
    await testDb.prisma.campaignTaskItemSettlement.create({
      data: {
        taskItemId: trigger.id,
        attemptId: attempt.id,
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        positiveForMastery: true,
        negativeOutcome: false,
        settledAt: new Date("2026-08-04T15:00:00.000Z"),
      },
    });
    const createRepair = (reason: string, status: string, createdAt: Date) =>
      testDb.prisma.campaignRepairQueueItem.create({
        data: {
          campaignId: campaign.id,
          nodeId: "N20",
          triggerTaskItemId: trigger.id,
          reason,
          priority: 50,
          status,
          createdAt,
          updatedAt: createdAt,
        },
      });
    const valid = await createRepair("valid-window", "pending", new Date("2026-08-04T16:00:00.000Z"));
    const superseded = await createRepair("superseded", "pending", new Date("2026-08-04T14:00:00.000Z"));
    const old = await createRepair("old-window", "pending", new Date("2026-07-01T12:00:00.000Z"));
    const protectedRepair = await createRepair("today-bound", "scheduled", new Date("2026-08-04T16:00:00.000Z"));
    const resolved = await createRepair("already-resolved", "resolved", new Date("2026-08-04T13:00:00.000Z"));
    await testDb.prisma.campaignDailyTask.update({
      where: { id: today.id },
      data: {
        selectionMetadataJson: JSON.stringify({
          skeletonVersion: 1,
          scheduledRepairQueueItemIds: [protectedRepair.id],
        }),
      },
    });

    const patches = new CampaignSkeletonPatchService(testDb.prisma, clock);
    const exposure = await patches.createSkeletonPatchProposal({
      userId: user.id,
      campaignId: campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_policy_fixture",
        rationale: "Change a future node to exposure depth.",
        operations: [{ type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" }],
      },
    });
    await patches.acceptSkeletonPatch({ userId: user.id, patchId: exposure.patch.id, actorType: "user" });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: valid.id } })).toMatchObject({ status: "suspended", suspendedAt: now });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: protectedRepair.id } })).toMatchObject({ status: "scheduled", suspendedAt: null });

    now = new Date("2026-08-04T18:00:00.000Z");
    await createRepair("new-fact", "pending", now);
    const mastery = await patches.createSkeletonPatchProposal({
      userId: user.id,
      campaignId: campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 2,
        trigger: "strategist_policy_fixture",
        rationale: "Restore the node to mastery after new repair evidence.",
        operations: [{ type: "set_goal_depth", nodeId: "N20", goalDepth: "mastery" }],
      },
    });
    await patches.acceptSkeletonPatch({ userId: user.id, patchId: mastery.patch.id, actorType: "user" });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: valid.id } })).toMatchObject({ status: "pending", suspendedAt: null, expiredAt: null });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: superseded.id } })).toMatchObject({ status: "expired", expiredAt: now });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: "expired", expiredAt: now });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: protectedRepair.id } })).toMatchObject({ status: "scheduled" });
    expect(await testDb.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: resolved.id } })).toMatchObject({ status: "resolved", suspendedAt: null, expiredAt: null });

    const active = await testDb.prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: campaign.id, version: 3 } },
      include: { nodePlans: { orderBy: { sortOrder: "asc" } } },
    });
    const before = await testDb.prisma.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: "asc" },
    });
    await new RouteReconciliationService(testDb.prisma).reconcile({
      campaignId: campaign.id,
      resultingSkeleton: projectCampaignSkeleton(active),
      campaignDate: "2026-08-04",
      now,
    });
    expect(await testDb.prisma.campaignRepairQueueItem.findMany({
      where: { campaignId: campaign.id },
      orderBy: { id: "asc" },
    })).toEqual(before);
    expect(await testDb.prisma.campaignDailyTask.findUniqueOrThrow({ where: { id: today.id } }))
      .toMatchObject({ id: today.id, campaignDate: "2026-08-04" });
    expect(await testDb.prisma.campaignLearnerNodeState.count({ where: { campaignId: campaign.id } })).toBe(17);
    expect(await testDb.prisma.campaignRepairQueueItem.count({ where: { campaignId: campaign.id } })).toBe(6);
  });
});

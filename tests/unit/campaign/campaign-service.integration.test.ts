import { afterEach, describe, expect, it } from "vitest";
import { campaignCurriculumAssets } from "@/server/campaign/curriculum";
import { CampaignCoreService } from "@/server/campaign/services";
import type { ProblemAvailability } from "@/server/campaign/domain";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const validEvidence = () => ({
  reviewCompleted: true,
  passed: true,
  selfRating: "easy",
  evidenceCanVerdict: true,
  evidenceMatchesCurrentRevision: true,
  evidenceMatchesTaskProblem: true,
  evidenceClass: "verdict_bearing",
  evidenceAuthority: "authoritative",
  verdict: "passed_visible_tests",
  codeRevision: "revision-1",
});
const negative = () => ({ ...validEvidence(), passed: false, verdict: "failed" });

async function setup(handle: string, budget = 3, endDate = "2026-12-01") {
  const db = await createCampaignTestDb();
  cleanups.push(db.cleanup);
  const user = await db.prisma.user.create({ data: { handle } });
  let current = new Date("2026-08-03T09:00:00.000Z");
  const service = new CampaignCoreService(db.prisma, { now: () => current });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate,
      dailyQuestionBudget: budget,
      timezone: "America/Chicago",
      language: "Python",
      selfReportedWeakNodes: [],
      preferredNodes: [],
    },
  });
  return {
    db: db.prisma,
    service,
    campaign,
    setNow: (value: Date) => { current = value; },
  };
}

type DailyResult = Awaited<ReturnType<CampaignCoreService["getOrCreateDailyTask"]>>;
type PersistedTask = Exclude<DailyResult, { kind: "no_task" }>;

function requireTask(task: DailyResult): PersistedTask {
  if ("kind" in task) throw new Error("Expected a persisted task");
  return task;
}

function availabilityOverrides(
  exposureType: ProblemAvailability["exposureType"],
  perNode?: (nodeId: string) => Partial<ProblemAvailability>,
) {
  return campaignCurriculumAssets.graph.nodes.flatMap((node) =>
    node.primaryProblems.map((problem) => ({
      problemSlug: problem.problemSlug,
      exposureType,
      ...(perNode?.(node.nodeId) ?? {}),
    })),
  );
}

async function markAllTransferableMastered(
  db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"],
  campaignId: string,
) {
  await db.campaignLearnerNodeState.updateMany({
    where: { campaignId },
    data: {
      masteryState: "mastered",
      masteryHealth: "stable",
      masteredAt: new Date("2026-08-01T12:00:00.000Z"),
      masteredBySettlementId: "synthetic-m2r-master",
    },
  });
}

describe("Campaign consolidation service", () => {
  it("materializes only the 17 transferable states", async () => {
    const { campaign } = await setup("campaign-m2r-materialize");
    expect(campaign.learnerNodeStates).toHaveLength(17);
    expect(campaign.learnerNodeStates.map((state) => state.nodeId)).not.toEqual(
      expect.arrayContaining(["N3", "N5", "N6"]),
    );
    expect(campaign.skeletons[0]).toMatchObject({ mixedWindowDays: 7 });
    expect(campaign.skeletons[0]).not.toHaveProperty("phase");
  });

  it("moves from a cleared frontier to deep fill with two mastered-node items", async () => {
    const { db, service, campaign } = await setup("campaign-m2r-deep-fill");
    await markAllTransferableMastered(db, campaign.id);

    const task = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    }));

    expect(task.primaryNodeId).toBe("N12");
    expect(task.items.slice(0, 2).map((item) => item.nodeId)).toEqual(["N12", "N12"]);
    expect(task.items.slice(0, 2).every((item) => item.slotRole === "target")).toBe(true);
  });

  it("moves to mixed when deep fill is exhausted and persists distinct-node mixed items", async () => {
    const { db, service, campaign } = await setup("campaign-m2r-mixed", 5);
    await markAllTransferableMastered(db, campaign.id);

    const task = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
      availabilityOverrides: availabilityOverrides("externally_seen"),
    }));

    expect(task.primaryNodeId).toBeNull();
    expect(task.items).toHaveLength(5);
    expect(task.items.every((item) => item.slotRole === "mixed")).toBe(true);
    expect(new Set(task.items.map((item) => item.nodeId)).size).toBe(task.items.length);
    expect(requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    })).id).toBe(task.id);
  });

  it("returns to coverage when a new skeleton version includes a learning node", async () => {
    const { db, service, campaign } = await setup("campaign-m2r-reopen");
    await markAllTransferableMastered(db, campaign.id);
    const original = await db.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: campaign.id, version: 1 } },
      include: { nodePlans: { orderBy: { sortOrder: "asc" } } },
    });
    await db.campaignSkeletonNodePlan.update({
      where: { skeletonId_nodeId: { skeletonId: original.id, nodeId: "N20" } },
      data: { included: false },
    });
    const next = await db.campaignSkeleton.create({
      data: {
        campaignId: campaign.id,
        version: 2,
        mixedWindowDays: original.mixedWindowDays,
        nodePlans: {
          create: original.nodePlans.map((plan) => ({
            nodeId: plan.nodeId,
            included: plan.nodeId === "N20" ? true : plan.included,
            sortOrder: plan.sortOrder,
            targetWeek: plan.targetWeek,
            priority: plan.priority,
            rationale: plan.rationale,
          })),
        },
      },
    });
    await db.campaign.update({
      where: { id: campaign.id },
      data: { activeSkeletonVersion: next.version },
    });
    await db.campaignLearnerNodeState.update({
      where: { campaignId_nodeId: { campaignId: campaign.id, nodeId: "N20" } },
      data: {
        masteryState: "learning",
        masteryHealth: "stable",
        masteredAt: null,
        masteredBySettlementId: null,
        unlockedAt: new Date("2026-08-04T09:00:00.000Z"),
      },
    });

    const task = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-04",
    }));
    expect(task.primaryNodeId).toBe("N20");
    expect(task.items.slice(0, 2).map((item) => item.nodeId)).toEqual(["N20", "N20"]);
  });

  it("keeps target-negative settlement and repair scheduling idempotent", async () => {
    const { db, service, campaign, setNow } = await setup("campaign-m2r-repair", 4);
    const day1 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    }));
    const target = day1.items.find((item) => item.slotRole === "target")!;
    const attempt = await service.startTaskItemAttempt({ taskItemId: target.id });
    const first = await service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: target.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T12:00:00.000Z"),
      normalized: negative(),
    });
    const replay = await service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: target.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T12:00:00.000Z"),
      normalized: negative(),
    });
    expect(replay.id).toBe(first.id);
    expect(await db.campaignRepairQueueItem.count()).toBe(1);

    setNow(new Date("2026-08-04T09:00:00.000Z"));
    const day2 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-04",
    }));
    expect(day2.items.some((item) => item.slotRole === "remedial")).toBe(true);
    expect((await db.campaignRepairQueueItem.findFirstOrThrow()).status).toBe("scheduled");
  });

  it("requeues an unfinished scheduled recovery when a later Campaign day is materialized", async () => {
    const { db, service, campaign, setNow } = await setup("campaign-m2r-requeue", 4);
    const day1 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    }));
    const trigger = day1.items.find((item) => item.slotRole === "target")!;
    const attempt = await service.startTaskItemAttempt({ taskItemId: trigger.id });
    await service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: trigger.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T12:00:00.000Z"),
      normalized: negative(),
    });

    setNow(new Date("2026-08-04T09:00:00.000Z"));
    const day2 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-04",
    }));
    expect(day2.items.some((item) => item.slotRole === "remedial")).toBe(true);
    const repair = await db.campaignRepairQueueItem.findFirstOrThrow();
    expect(repair.status).toBe("scheduled");

    setNow(new Date("2026-08-05T09:00:00.000Z"));
    const day3 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-05",
    }));
    expect(day3.items.some((item) => item.slotRole === "remedial")).toBe(true);
    expect((await db.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: repair.id } })).status).toBe("scheduled");
  });

  it("resolves the assigned repair after its Recover task settles", async () => {
    const { db, service, campaign, setNow } = await setup("campaign-m2r-resolve", 4);
    const day1 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
    }));
    const trigger = day1.items.find((item) => item.slotRole === "target")!;
    const triggerAttempt = await service.startTaskItemAttempt({ taskItemId: trigger.id });
    await service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: trigger.id,
      attemptId: triggerAttempt.id,
      settledAt: new Date("2026-08-03T12:00:00.000Z"),
      normalized: negative(),
    });
    const repair = await db.campaignRepairQueueItem.findFirstOrThrow();

    setNow(new Date("2026-08-04T09:00:00.000Z"));
    const day2 = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-04",
    }));
    const recover = day2.items.find((item) => item.slotRole === "remedial")!;
    const recoverAttempt = await service.startTaskItemAttempt({ taskItemId: recover.id });
    await service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: recover.id,
      attemptId: recoverAttempt.id,
      settledAt: new Date("2026-08-04T12:00:00.000Z"),
      normalized: validEvidence(),
    });

    expect((await db.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: repair.id } })).status).toBe("resolved");
  });

  it("settles NT mixed failures without mastery state and upserts a gap repair once", async () => {
    const { db, service, campaign } = await setup("campaign-m2r-nt-mixed");
    await markAllTransferableMastered(db, campaign.id);
    const task = requireTask(await service.getOrCreateDailyTask({
      campaignId: campaign.id,
      campaignDate: "2026-08-03",
      availabilityOverrides: availabilityOverrides("externally_seen", (nodeId) =>
        ["N3", "N5", "N6"].includes(nodeId)
          ? { cooldownUntil: null }
          : { cooldownUntil: "2026-09-01" },
      ),
    }));
    expect(task.primaryNodeId).toBeNull();
    expect(task.items.map((item) => item.nodeId).sort()).toEqual(["N3", "N5", "N6"]);

    const item = task.items[0];
    const attempt = await service.startTaskItemAttempt({ taskItemId: item.id });
    const settle = () => service.settleTaskItem({
      campaignId: campaign.id,
      taskItemId: item.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T12:00:00.000Z"),
      normalized: negative(),
    });
    const first = await settle();
    expect((await settle()).id).toBe(first.id);
    expect(await db.campaignLearnerNodeState.findFirst({
      where: { campaignId: campaign.id, nodeId: item.nodeId },
    })).toBeNull();
    expect(await db.campaignRepairQueueItem.findMany()).toMatchObject([
      { nodeId: item.nodeId, reason: "non_transferable_gap", status: "pending" },
    ]);
  });
});

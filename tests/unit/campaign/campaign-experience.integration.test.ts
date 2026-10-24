import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCoreService,
  advanceCampaignDayForLearner,
  loadCampaignRoadmapView,
  loadCampaignTodayView,
  resolveActiveCampaignForLearner,
  startOrResumeCampaignWorkbenchEntry,
} from "@/server/campaign";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function fixture(options: { budget?: number; endDate?: string } = {}) {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({
    data: {
      handle: `m3b-${crypto.randomUUID()}`,
      profile: { create: { displayName: "Campaign Learner" } },
    },
  });
  const now = new Date("2026-08-03T14:00:00.000Z");
  const service = new CampaignCoreService(database.prisma, { now: () => now });
  const campaign = await service.materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: options.endDate ?? "2026-09-30",
      dailyQuestionBudget: options.budget ?? 3,
      timezone: "America/Chicago",
      language: "Python",
      selfReportedWeakNodes: [],
      preferredNodes: [],
    },
  });
  return { ...database, user, now, service, campaign };
}

describe("Campaign M3B experience projections", () => {
  it("returns empty and conflict states instead of guessing an active Campaign", async () => {
    const f = await fixture();
    const other = await f.prisma.user.create({ data: { handle: `empty-${crypto.randomUUID()}` } });
    expect(await resolveActiveCampaignForLearner(f.prisma, other.id)).toEqual({ kind: "none" });
    await f.service.materializeInitialCampaign({
      userId: f.user.id,
      goal: {
        endDate: "2026-10-30",
        dailyQuestionBudget: 3,
        timezone: "America/Chicago",
        language: "Python",
        selfReportedWeakNodes: [],
        preferredNodes: [],
      },
    });
    expect(await resolveActiveCampaignForLearner(f.prisma, f.user.id)).toEqual({ kind: "conflict" });
  });

  it("materializes Today once, projects coverage, progress and shortfall metadata", async () => {
    const f = await fixture();
    const first = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    const second = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    expect(first).toMatchObject({ kind: "campaign", phase: "coverage", plannedCount: 3, settledCount: 0 });
    expect(second).toMatchObject({ kind: "campaign", phase: "coverage", plannedCount: 3 });
    expect(await f.prisma.campaignDailyTask.count()).toBe(1);
    if (first.kind !== "campaign") throw new Error("expected Campaign view");
    expect(first.items.map((item) => item.slotRole))
      .toEqual(["advance", "target", "target"]);
    expect(first.routePreview.currentNode?.nodeName).toBeTruthy();
    expect(first.routePreview.nextNodes).toHaveLength(2);
    expect(first.routePreview.currentPositiveStreak).toBe(0);
    expect(first.routePreview.pendingRepairCount).toBe(0);
  });

  it("projects legacy Replan separately without changing Campaign DailyTask budget or rows", async () => {
    const f = await fixture();
    const materialized = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: true,
    });
    if (materialized.kind !== "campaign") throw new Error("expected Campaign view");
    const goal = await f.prisma.readinessGoal.create({
      data: {
        userId: f.user.id,
        targetLabel: "Legacy readiness compatibility",
        interviewDate: new Date("2026-09-30T00:00:00.000Z"),
        weeklyHours: 8,
      },
    });
    await f.prisma.plannerProposal.create({
      data: {
        userId: f.user.id,
        goalId: goal.id,
        type: "repeated_failure",
        patternTag: "sliding_window",
        reason: "Repeated sliding-window boundary trouble needs one optional reinforcement.",
        proposedChangeJson: JSON.stringify({ action: "insert_reinforcement" }),
        targetProblemSlug: "minimum-window-substring",
        targetProblemTitle: "Minimum Window Substring",
        targetLeetcodeNumber: 76,
      },
    });
    const before = {
      dailyTasks: await f.prisma.campaignDailyTask.count(),
      taskItems: await f.prisma.campaignTaskItem.count(),
      repairs: await f.prisma.campaignRepairQueueItem.count(),
      states: await f.prisma.campaignLearnerNodeState.findMany({
        where: { campaignId: f.campaign.id },
        orderBy: { nodeId: "asc" },
      }),
    };

    const view = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: false,
    });
    if (view.kind !== "campaign") throw new Error("expected Campaign view");

    expect(view.proactiveDashboard.replan).toMatchObject({
      status: "ready",
      proposals: [{ targetProblemSlug: "minimum-window-substring" }],
    });
    expect(view.plannedCount).toBe(materialized.plannedCount);
    expect(view.dailyBudget).toBe(materialized.dailyBudget);
    expect({
      dailyTasks: await f.prisma.campaignDailyTask.count(),
      taskItems: await f.prisma.campaignTaskItem.count(),
      repairs: await f.prisma.campaignRepairQueueItem.count(),
      states: await f.prisma.campaignLearnerNodeState.findMany({
        where: { campaignId: f.campaign.id },
        orderBy: { nodeId: "asc" },
      }),
    }).toEqual(before);
  });

  it("keeps Today available when one proactive module fails and never mutates Mastery", async () => {
    const f = await fixture();
    await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    const masteryBefore = await f.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: f.campaign.id },
      orderBy: { nodeId: "asc" },
    });
    const view = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: false,
      proactiveLoaders: {
        loadReplanProposals: async () => {
          throw new Error("isolated Replan read failure");
        },
        loadReviewFocus: async () => ({
          cards: [{
            problemId: "problem-review-focus",
            slug: "longest-substring-without-repeating-characters",
            title: "Longest Substring Without Repeating Characters",
            difficulty: "Medium",
            leetcodeNumber: 3,
            planItemId: null,
            lastOutcome: "failed",
            trapSummary: "The left boundary moved backward.",
            dueDate: null,
            priority: 1,
            primaryPatternTag: "sliding_window",
            hasFlashcard: false,
            flashcardStatus: "diagnosis_unavailable",
            flashcard: null,
          }],
        }),
        loadRecoveryOverflow: async () => {
          throw new Error("isolated Recovery overflow read failure");
        },
      },
    });
    if (view.kind !== "campaign") throw new Error("expected Campaign view");

    expect(view.items).toHaveLength(3);
    expect(view.proactiveDashboard.replan.status).toBe("unavailable");
    expect(view.proactiveDashboard.reviewFocus).toMatchObject({
      status: "ready",
      board: { cards: [{ slug: "longest-substring-without-repeating-characters" }] },
    });
    expect(await f.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: f.campaign.id },
      orderBy: { nodeId: "asc" },
    })).toEqual(masteryBefore);
  });

  it("carries unfinished work into the next fixed-budget day without treating it as failed", async () => {
    const f = await fixture({ budget: 3 });
    const initial = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: true,
    });
    if (initial.kind !== "campaign") throw new Error("expected Campaign view");
    const task = await f.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate: "2026-08-03" } },
      include: { items: true },
    });
    const advanced = await advanceCampaignDayForLearner({ db: f.prisma, userId: f.user.id, now: f.now });
    expect(advanced).toMatchObject({
      kind: "campaign",
      campaignDate: "2026-08-04",
      settledCount: 0,
      hasUnsettledItems: true,
      canAdvanceToNextDay: true,
    });
    if (advanced.kind !== "campaign") throw new Error("expected Campaign view");
    expect(advanced.items.map((item) => item.isCarryover)).toEqual([true, true, true]);
    expect(advanced.items.map((item) => item.slotRole)).toEqual(task.items.map((item) => item.slotRole));
    expect(await f.prisma.campaignTaskItem.findMany({
      where: { id: { in: task.items.map((item) => item.id) } },
      select: { status: true },
    })).toEqual([{ status: "deferred" }, { status: "deferred" }, { status: "deferred" }]);
    expect(await f.prisma.campaignDailyTask.count()).toBe(2);
    const refreshed = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: false,
    });
    expect(refreshed).toMatchObject({ kind: "campaign", campaignDate: "2026-08-04" });
  });

  it("continues an unfinished Baseline and Recover in their own slots after three New tasks settle", async () => {
    const f = await fixture({ budget: 5 });
    const prior = await f.prisma.campaignDailyTask.create({
      data: {
        campaignId: f.campaign.id,
        campaignDate: "2026-08-02",
        budget: 3,
        primaryNodeId: "N1",
        status: "completed",
        selectionMetadataJson: JSON.stringify({ skeletonVersion: 1, scheduledRepairQueueItemIds: [] }),
        items: {
          create: {
            problemSlug: "remove-element",
            nodeId: "N1",
            slotRole: "target",
            exposureType: "never_seen",
            sortOrder: 1,
            status: "settled",
          },
        },
      },
      include: { items: true },
    });
    await f.prisma.campaignRepairQueueItem.create({
      data: {
        campaignId: f.campaign.id,
        nodeId: "N1",
        triggerTaskItemId: prior.items[0]!.id,
        reason: "target_negative",
        priority: 100,
        status: "pending",
      },
    });
    const first = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    if (first.kind !== "campaign") throw new Error("expected Campaign view");
    expect(first.items.map((item) => item.slotRole)).toEqual(["advance", "target", "target", "probe", "remedial"]);

    const dayOne = await f.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate: "2026-08-03" } },
      include: { items: true },
    });
    for (const item of dayOne.items.slice(0, 3)) {
      const attempt = await f.service.startTaskItemAttempt({ taskItemId: item.id });
      await f.service.settleTaskItem({
        campaignId: f.campaign.id,
        taskItemId: item.id,
        attemptId: attempt.id,
        settledAt: new Date("2026-08-03T16:00:00.000Z"),
        normalized: {
          reviewCompleted: true,
          passed: true,
          selfRating: "easy",
          evidenceCanVerdict: true,
          evidenceMatchesCurrentRevision: true,
          evidenceMatchesTaskProblem: true,
        },
      });
    }

    const advanced = await advanceCampaignDayForLearner({ db: f.prisma, userId: f.user.id, now: f.now });
    if (advanced.kind !== "campaign") throw new Error("expected Campaign view");
    expect(advanced.items.map((item) => item.slotRole)).toEqual(["advance", "target", "target", "probe", "remedial"]);
    expect(advanced.items.slice(3).map((item) => item.isCarryover)).toEqual([true, true]);
    expect(advanced.items.slice(0, 3).map((item) => item.isCarryover)).toEqual([false, false, false]);
    const unfinishedSourceIds = dayOne.items.slice(3).map((item) => item.id);
    expect(await f.prisma.campaignTaskItem.findMany({
      where: { id: { in: unfinishedSourceIds } },
      select: { status: true },
      orderBy: { sortOrder: "asc" },
    })).toEqual([{ status: "deferred" }, { status: "deferred" }]);
    const nextTask = await f.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate: "2026-08-04" } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    expect(nextTask.items.slice(3).map((item) => item.carryoverFromTaskItemId)).toEqual(unfinishedSourceIds);
  });

  it("projects every unscheduled Repair node into optional Replan without changing the DailyTask", async () => {
    const f = await fixture({ budget: 3 });
    const materialized = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: true,
    });
    if (materialized.kind !== "campaign") throw new Error("expected Campaign view");
    const trigger = await f.prisma.campaignTaskItem.findFirstOrThrow({
      where: { dailyTask: { campaignId: f.campaign.id } },
    });
    await f.prisma.campaignRepairQueueItem.createMany({
      data: ["N1", "N2", "N4", "N7"].map((nodeId, index) => ({
        campaignId: f.campaign.id,
        nodeId,
        triggerTaskItemId: trigger.id,
        reason: "target_negative",
        priority: 100 - index,
        status: "pending",
      })),
    });

    const view = await loadCampaignTodayView({
      db: f.prisma,
      userId: f.user.id,
      now: f.now,
      materialize: false,
    });
    if (view.kind !== "campaign") throw new Error("expected Campaign view");
    expect(view.proactiveDashboard.replan.overflowRepairs).toHaveLength(4);
    expect(view.proactiveDashboard.replan.overflowRepairs.map((repair) => repair.nodeId))
      .toEqual(["N1", "N2", "N4", "N7"]);
    expect(view.items).toEqual(materialized.items);
    expect(await f.prisma.campaignTaskItem.count()).toBe(materialized.items.length);
  });

  it("redacts every mixed node field before settlement and reveals it afterward", async () => {
    const f = await fixture({ budget: 4, endDate: "2026-08-06" });
    await f.prisma.campaignLearnerNodeState.updateMany({
      where: { campaignId: f.campaign.id },
      data: {
        masteryState: "mastered",
        masteryHealth: "stable",
        unlockedAt: new Date("2026-07-31T12:00:00.000Z"),
        masteredAt: new Date("2026-08-01T12:00:00.000Z"),
        masteredBySettlementId: "m3b-synthetic",
      },
    });
    const before = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    expect(before).toMatchObject({ kind: "campaign", phase: "consolidation_mixed" });
    if (before.kind !== "campaign") throw new Error("expected Campaign view");
    expect(before.routePreview.currentNode).toBeNull();
    expect(before.routePreview.nextNodes).toEqual([]);
    expect(before.routePreview.previousNode?.status).toBe("mastered_stable");
    const serialized = JSON.stringify(before.items[0]);
    expect(serialized).not.toContain("nodeId");
    expect(serialized).not.toContain("nodeName");
    expect(serialized).not.toContain("mechanism");
    expect(serialized).not.toContain("coreInvariant");
    expect(serialized).not.toContain("dependency");

    const task = await f.prisma.campaignDailyTask.findFirstOrThrow({ include: { items: true } });
    const item = task.items[0];
    const attempt = await f.service.startTaskItemAttempt({ taskItemId: item.id });
    await f.service.settleTaskItem({
      campaignId: f.campaign.id,
      taskItemId: item.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T16:00:00.000Z"),
      normalized: {
        reviewCompleted: true,
        passed: true,
        selfRating: "easy",
        evidenceCanVerdict: true,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
      },
    });
    const after = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: false });
    if (after.kind !== "campaign") throw new Error("expected Campaign view");
    expect(after.items[0].visibleNode).toMatchObject({ nodeId: item.nodeId });
    expect(JSON.stringify(after.items[0])).toContain("nodeName");
  });

  it("projects 17 transferable roadmap nodes and keeps NT outside its denominator", async () => {
    const f = await fixture();
    const view = await loadCampaignRoadmapView({ db: f.prisma, userId: f.user.id, now: f.now });
    expect(view).toMatchObject({ kind: "campaign", totalTransferableCount: 17 });
    if (view.kind !== "campaign") throw new Error("expected roadmap");
    expect(view.nodes).toHaveLength(17);
    expect(view.nonTransferablePool.map((node) => node.nodeId)).toEqual(["N3", "N5", "N6"]);
    expect(view.nonTransferablePool.every((node) => node.attemptedProblemCount === 0)).toBe(true);
    expect(view.requiredDependencies).toEqual([
      { fromNodeId: "N12", toNodeId: "N13" },
      { fromNodeId: "N15", toNodeId: "N17" },
      { fromNodeId: "N19", toNodeId: "N20" },
    ]);
    expect(view.nodes.find((node) => node.nodeId === "N13")).toMatchObject({ status: "locked" });
    expect(view.nodes.find((node) => node.nodeId === "N9")?.recommendedPrerequisites.length).toBe(2);
  });

  it("projects a readable Repair pool and learning-with-repair Roadmap health without raw reason codes", async () => {
    const f = await fixture();
    await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    const target = await f.prisma.campaignTaskItem.findFirstOrThrow({ where: { slotRole: "target" } });
    const attempt = await f.service.startTaskItemAttempt({ taskItemId: target.id });
    await f.service.settleTaskItem({
      campaignId: f.campaign.id,
      taskItemId: target.id,
      attemptId: attempt.id,
      settledAt: new Date("2026-08-03T16:00:00.000Z"),
      normalized: {
        reviewCompleted: true,
        passed: false,
        selfRating: "unsolved",
        evidenceCanVerdict: false,
        evidenceMatchesCurrentRevision: true,
        evidenceMatchesTaskProblem: true,
        evidenceClass: "evidence_unavailable",
      },
    });
    const [today, roadmap] = await Promise.all([
      loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: false }),
      loadCampaignRoadmapView({ db: f.prisma, userId: f.user.id, now: f.now }),
    ]);
    if (today.kind !== "campaign" || roadmap.kind !== "campaign") throw new Error("expected Campaign views");
    expect(today.repairPool).toMatchObject({
      pendingNodeCount: 1,
      highestPriorityNode: { nodeId: target.nodeId, scheduledForTomorrow: false },
    });
    expect(today.routePreview.pendingRepairCount).toBe(1);
    expect(roadmap.nodes.find((node) => node.nodeId === target.nodeId)).toMatchObject({
      status: "learning",
      statusLabel: "Learning · recovery needed",
      pendingRepairCount: 1,
      latestPositiveStreak: 0,
    });
    expect(JSON.stringify({ today: today.repairPool, node: roadmap.nodes.find((node) => node.nodeId === target.nodeId) }))
      .not.toContain("target_negative");
  });

  it("creates/resumes one Attempt per tab identity and returns a canonical Workbench URL", async () => {
    const f = await fixture();
    const view = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now: f.now, materialize: true });
    if (view.kind !== "campaign") throw new Error("expected Today");
    const firstItem = view.items[0];
    await f.prisma.problem.create({
      data: { slug: firstItem.problemSlug, title: firstItem.problemTitle, methodName: "solve" },
    });
    const tabA = await startOrResumeCampaignWorkbenchEntry(f.prisma, {
      userId: f.user.id,
      taskItemId: firstItem.taskItemId,
      browserInstanceId: "campaign-m3b-tab-a",
      now: f.now,
    });
    const resumed = await startOrResumeCampaignWorkbenchEntry(f.prisma, {
      userId: f.user.id,
      taskItemId: firstItem.taskItemId,
      browserInstanceId: "campaign-m3b-tab-a",
      now: f.now,
    });
    const tabB = await startOrResumeCampaignWorkbenchEntry(f.prisma, {
      userId: f.user.id,
      taskItemId: firstItem.taskItemId,
      browserInstanceId: "campaign-m3b-tab-b",
      now: f.now,
    });
    expect(tabA.status).toBe("started");
    expect(resumed.status).toBe("resumed");
    expect(resumed.attemptId).toBe(tabA.attemptId);
    expect(tabB.attemptId).not.toBe(tabA.attemptId);
    expect(tabA.workbenchUrl).toMatch(/^\/workbench\?problem=/);
    expect(tabA.workbenchUrl).toContain(`campaignAttempt=${tabA.attemptId}`);
    expect(await f.prisma.campaignTaskItemAttempt.count()).toBe(2);
  });
});

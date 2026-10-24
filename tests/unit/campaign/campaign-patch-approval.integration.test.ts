import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
  decideCampaignPatch,
  loadCampaignPlanningReviewView,
  loadCampaignRoadmapView,
  loadCampaignTodayView,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-08-04T15:00:00.000Z");
const clock = { now: () => now };

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(handle: string) {
  const testDb = await createCampaignTestDb();
  cleanups.push(testDb.cleanup);
  const user = await testDb.prisma.user.create({ data: { handle } });
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
  return { ...testDb, user, campaign };
}

function proposal(operations: unknown[], extra: Record<string, unknown> = {}) {
  return {
    patchSchemaVersion: 1,
    baseVersion: 1,
    trigger: "weekly_boundary",
    rationale: "根据近期进度，小幅调整尚未开始的后续路线。",
    operations,
    ...extra,
  };
}

describe("Campaign Patch approval experience service", () => {
  it("accepts from an owned safe projection, refreshes Roadmap, and preserves today's persisted task", async () => {
    const f = await fixture("m4c1-accept");
    const core = new CampaignCoreService(f.prisma, clock);
    const today = await core.getOrCreateDailyTask({ campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    if ("kind" in today) throw new Error("Expected a DailyTask");
    const todayIdentity = {
      id: today.id,
      items: today.items.map((item) => item.id),
      budget: today.budget,
    };
    const created = await new CampaignSkeletonPatchService(f.prisma, clock).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: proposal(
        [{ type: "move_node", nodeId: "N19", beforeNodeId: "N18" }],
        { dailyBudgetSuggestion: { proposedBudget: 4, rationale: "仅为未来任务增加一道题。" } },
      ),
    });

    const planning = await loadCampaignPlanningReviewView({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id });
    expect(planning).toMatchObject({ status: "pending_review", pendingPatch: { patchId: created.patch.id, canAccept: true } });
    expect(JSON.stringify(planning)).not.toMatch(/operationsJson|validatorSummaryJson|userId|ownerId|promptVersion/);
    const todayView = await loadCampaignTodayView({ db: f.prisma, userId: f.user.id, now, materialize: false });
    expect(todayView).toMatchObject({
      kind: "campaign",
      planning: { status: "pending_review", pendingPatch: { patchId: created.patch.id } },
    });

    const decision = await decideCampaignPatch({
      db: f.prisma,
      userId: f.user.id,
      patchId: created.patch.id,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: true },
    });
    expect(decision).toMatchObject({ kind: "applied", newVersion: 2 });
    const afterToday = await core.getOrCreateDailyTask({ campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    if ("kind" in afterToday) throw new Error("Expected persisted DailyTask");
    expect({ id: afterToday.id, items: afterToday.items.map((item) => item.id), budget: afterToday.budget }).toEqual(todayIdentity);
    const roadmap = await loadCampaignRoadmapView({ db: f.prisma, userId: f.user.id, now });
    if (roadmap.kind !== "campaign") throw new Error("Expected Roadmap");
    expect(roadmap.nodes.find((node) => node.nodeId === "N19")!.order)
      .toBeLessThan(roadmap.nodes.find((node) => node.nodeId === "N18")!.order);
    const tomorrow = await core.getOrCreateDailyTask({ campaignId: f.campaign.id, campaignDate: "2026-08-05" });
    if ("kind" in tomorrow) throw new Error("Expected future DailyTask");
    expect(tomorrow.budget).toBe(4);
    expect(await f.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: created.patch.id } })).toBe(1);
  });

  it("partially accepts only stored operation ids and rejects an invalid required-edge subset atomically", async () => {
    const valid = await fixture("m4c1-partial-valid");
    const validPatch = await new CampaignSkeletonPatchService(valid.prisma, clock).createSkeletonPatchProposal({
      userId: valid.user.id,
      campaignId: valid.campaign.id,
      proposal: proposal([
        { type: "set_node_priority", nodeId: "N2", priority: 80 },
        { type: "set_target_week", nodeId: "N4", targetWeek: 4 },
        { type: "set_mixed_window_days", mixedWindowDays: 10 },
      ]),
    });
    const applied = await decideCampaignPatch({
      db: valid.prisma,
      userId: valid.user.id,
      patchId: validPatch.patch.id,
      decision: { action: "partial_accept", acceptedOperationIds: ["op-001", "op-002"], acceptDailyBudgetSuggestion: false },
    });
    expect(applied.kind).toBe("applied");
    const decision = await valid.prisma.campaignSkeletonDecisionLog.findUniqueOrThrow({ where: { patchId: validPatch.patch.id } });
    expect(JSON.parse(decision.acceptedOperationIdsJson)).toEqual(["op-001", "op-002"]);
    expect(JSON.parse(decision.rejectedOperationIdsJson)).toEqual(["op-003"]);

    const invalid = await fixture("m4c1-partial-invalid");
    const invalidPatch = await new CampaignSkeletonPatchService(invalid.prisma, clock).createSkeletonPatchProposal({
      userId: invalid.user.id,
      campaignId: invalid.campaign.id,
      proposal: proposal([
        { type: "move_node", nodeId: "N20", beforeNodeId: "N19" },
        { type: "move_node", nodeId: "N19", beforeNodeId: "N18" },
      ]),
    });
    await expect(decideCampaignPatch({
      db: invalid.prisma,
      userId: invalid.user.id,
      patchId: invalidPatch.patch.id,
      decision: { action: "partial_accept", acceptedOperationIds: ["op-001"], acceptDailyBudgetSuggestion: false },
    })).rejects.toMatchObject({
      code: "validation_failed",
      message: "所选改动会破坏必修前置关系，请同时选择相关调整或保留当前路线。",
    });
    expect(await invalid.prisma.campaignSkeleton.count({ where: { campaignId: invalid.campaign.id } })).toBe(1);
    expect(await invalid.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: invalidPatch.patch.id } })).toMatchObject({ status: "pending" });
  });

  it("rejects without changing the active route and enforces owner isolation", async () => {
    const f = await fixture("m4c1-reject");
    const stranger = await f.prisma.user.create({ data: { handle: "m4c1-stranger" } });
    const created = await new CampaignSkeletonPatchService(f.prisma, clock).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N2", priority: 80 }]),
    });
    await expect(decideCampaignPatch({
      db: f.prisma,
      userId: stranger.id,
      patchId: created.patch.id,
      decision: { action: "reject" },
    })).rejects.toMatchObject({ code: "ownership_denied" });
    const rejected = await decideCampaignPatch({
      db: f.prisma,
      userId: f.user.id,
      patchId: created.patch.id,
      decision: { action: "reject", rejectionReason: "希望保持当前学习顺序。" },
    });
    expect(rejected).toMatchObject({ kind: "rejected", message: "已保留当前路线。" });
    expect((await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).activeSkeletonVersion).toBe(1);
    expect(await f.prisma.campaignSkeleton.count({ where: { campaignId: f.campaign.id } })).toBe(1);
    expect(await f.prisma.campaignSkeletonDecisionLog.findUniqueOrThrow({ where: { patchId: created.patch.id } }))
      .toMatchObject({ action: "rejected", rationale: "希望保持当前学习顺序。" });
  });

  it("surfaces stale and concurrent decisions without a second version or Decision Log", async () => {
    const f = await fixture("m4c1-races");
    const patchService = new CampaignSkeletonPatchService(f.prisma, clock);
    const first = await patchService.createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N2", priority: 80 }]),
    });
    const second = await patchService.createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: proposal([{ type: "set_target_week", nodeId: "N4", targetWeek: 5 }]),
    });
    const [winner, loser] = await Promise.all([
      decideCampaignPatch({ db: f.prisma, userId: f.user.id, patchId: first.patch.id, decision: { action: "accept_all", acceptDailyBudgetSuggestion: false } }),
      decideCampaignPatch({ db: f.prisma, userId: f.user.id, patchId: first.patch.id, decision: { action: "accept_all", acceptDailyBudgetSuggestion: false } }),
    ]);
    expect([winner.kind, loser.kind]).toContain("applied");
    expect([winner.kind, loser.kind]).toContain("already_decided");
    expect(await f.prisma.campaignSkeleton.count({ where: { campaignId: f.campaign.id } })).toBe(2);
    expect(await f.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: first.patch.id } })).toBe(1);

    await expect(decideCampaignPatch({
      db: f.prisma,
      userId: f.user.id,
      patchId: second.patch.id,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: false },
    })).rejects.toMatchObject({ code: "stale_base_version" });
    expect(await f.prisma.campaignSkeleton.count({ where: { campaignId: f.campaign.id } })).toBe(2);
    expect(await f.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: second.patch.id } })).toBe(0);
  });

  it("blocks an expired Calendar budget suggestion and keeps the Patch pending", async () => {
    const f = await fixture("m4d3-stale-calendar-approval");
    const core = new CampaignCoreService(f.prisma, clock);
    const today = await core.getOrCreateDailyTask({ campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    if ("kind" in today) throw new Error("Expected a DailyTask");
    const todayIdentity = { id: today.id, itemIds: today.items.map((item) => item.id), budget: today.budget };
    const created = await new CampaignSkeletonPatchService(f.prisma, clock).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_plan_execute_runtime",
        rationale: "保留路线改动，并将 Calendar 题量建议留给用户单独确认。",
        operations: [{ type: "set_node_priority", nodeId: "N20", priority: 82 }],
        dateBudgetSuggestions: [{ campaignDate: "2026-08-07", maxQuestions: 4, rationale: "Calendar 显示额外空档。" }],
      },
    });
    await f.prisma.campaignStrategistRun.create({ data: {
      campaignId: f.campaign.id,
      activeSkeletonVersion: 1,
      trigger: "user_proposal",
      triggerFingerprint: "m4d3-stale-calendar-approval",
      inputDigest: "a".repeat(64),
      wakeSnapshotJson: "{}",
      promptVersion: "strategist-plan-execute-v1",
      evaluatorVersion: "strategist-wake-v1",
      provider: "fixture",
      modelAlias: "fixture",
      status: "waiting_approval",
      proposalPatchId: created.patch.id,
      runtimeStateJson: JSON.stringify({
        runtimeVersion: "plan-execute-v1",
        runMode: "proposal",
        externalDataAsOf: "2026-08-04T13:00:00.000Z",
        externalDataValidUntil: "2026-08-04T15:30:00.000Z",
        rejectedCandidates: [{ candidateId: "candidate-old", codes: ["problem_supply_shortfall"] }],
      }),
    } });

    const planning = await loadCampaignPlanningReviewView({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id });
    expect(planning).toMatchObject({
      status: "pending_review",
      pendingPatch: {
        externalDataStale: true,
        rejectedCandidateReasons: ["problem_supply_shortfall"],
        dateBudgetSuggestions: [{ campaignDate: "2026-08-07", stale: true }],
      },
    });
    await expect(decideCampaignPatch({
      db: f.prisma,
      userId: f.user.id,
      patchId: created.patch.id,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: true },
    })).rejects.toMatchObject({ code: "stale_external_data" });
    expect((await f.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: created.patch.id } })).status).toBe("pending");

    await expect(decideCampaignPatch({
      db: f.prisma,
      userId: f.user.id,
      patchId: created.patch.id,
      decision: { action: "accept_all", acceptDailyBudgetSuggestion: false },
    })).rejects.toMatchObject({ code: "validation_failed" });
    const after = await core.getOrCreateDailyTask({ campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    if ("kind" in after) throw new Error("Expected persisted DailyTask");
    expect({ id: after.id, itemIds: after.items.map((item) => item.id), budget: after.budget }).toEqual(todayIdentity);
    expect(await f.prisma.campaignDailyBudgetOverride.count()).toBe(0);
  });
});

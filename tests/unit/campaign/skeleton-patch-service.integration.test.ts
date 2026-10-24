import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCoreService,
  CampaignSkeletonPatchError,
  CampaignSkeletonPatchService,
} from "@/server/campaign/services";
import {
  canonicalJson,
  canonicalizePatchOperations,
  campaignSkeletonPatchProposalSchema,
  fingerprintCampaignPatch,
} from "@/server/campaign/domain";
import { createCampaignTestDb } from "./campaign-test-db";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const cleanups: Array<() => Promise<void>> = [];
const clock = { now: () => new Date("2026-08-04T15:00:00.000Z") };

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function campaignFixture(handle: string, budget = 3) {
  const testDb = await createCampaignTestDb();
  cleanups.push(testDb.cleanup);
  const user = await testDb.prisma.user.create({ data: { handle } });
  const campaign = await new CampaignCoreService(testDb.prisma, clock).materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: "2026-10-30",
      dailyQuestionBudget: budget,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: [],
      preferredNodes: [],
    },
  });
  return { ...testDb, user, campaign };
}

function proposal(
  operations: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    patchSchemaVersion: 1,
    baseVersion: 1,
    trigger: "user_route_adjustment",
    rationale: "Adjust future route deterministically.",
    operations,
    ...extra,
  };
}

describe("Campaign Skeleton Patch persistence", () => {
  it("keeps the pre-v2 fingerprint for retried v1 proposals", async () => {
    const fixture = await campaignFixture("m4d1a2-v1-fingerprint");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const legacyProposal = proposal([
      { type: "set_node_priority", nodeId: "N2", priority: 77 },
    ]);
    const operations = canonicalizePatchOperations(
      campaignSkeletonPatchProposalSchema.parse(legacyProposal).operations,
    );
    const fingerprint = fingerprintCampaignPatch({
      campaignId: fixture.campaign.id,
      patchSchemaVersion: 1,
      baseVersion: 1,
      trigger: legacyProposal.trigger,
      rationale: legacyProposal.rationale,
      operations,
      dailyBudgetSuggestion: null,
    });
    const persisted = await fixture.prisma.campaignSkeletonPatch.create({
      data: {
        campaignId: fixture.campaign.id,
        baseVersion: 1,
        trigger: legacyProposal.trigger,
        rationale: legacyProposal.rationale,
        patchSchemaVersion: 1,
        operationsJson: canonicalJson({ patchSchemaVersion: 1, operations }),
        proposalFingerprint: fingerprint,
        validatorSummaryJson: "{}",
      },
    });
    const retried = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: legacyProposal,
    });
    expect(retried).toMatchObject({ kind: "existing", patch: { id: persisted.id } });
    expect(await fixture.prisma.campaignSkeletonPatch.count()).toBe(1);
  });

  it("migrates both a fresh database and an existing M3 schema", () => {
    const migrationRoot = join(process.cwd(), "prisma/migrations");
    const names = readdirSync(migrationRoot).sort();
    const m4a = "20260804030000_add_campaign_skeleton_patch_control_plane";
    for (const mode of ["fresh", "m3_upgrade"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "patterncoach-campaign-final-migration-"));
      const db = new Database(join(dir, `${mode}.db`));
      const apply = (name: string) => {
        const path = join(migrationRoot, name, "migration.sql");
        if (existsSync(path)) db.exec(readFileSync(path, "utf8"));
      };
      if (mode === "fresh") {
        names.forEach(apply);
      } else {
        names.filter((name) => name < m4a).forEach(apply);
        db.exec(`
          INSERT INTO "User" ("id", "handle", "createdAt", "updatedAt")
          VALUES ('upgrade-user', 'm4a-upgrade', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO "Campaign" ("id", "userId", "updatedAt")
          VALUES ('upgrade-campaign', 'upgrade-user', CURRENT_TIMESTAMP);
        `);
        apply(m4a);
      }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toEqual(expect.arrayContaining([
        "CampaignSkeletonPatch",
        "CampaignSkeletonDecisionLog",
        ...(mode === "fresh" ? ["CampaignDailyBudgetOverride"] : []),
      ]));
      expect(db.prepare("SELECT id FROM Campaign WHERE id='upgrade-campaign'").get())
        .toEqual(mode === "m3_upgrade" ? { id: "upgrade-campaign" } : undefined);
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates one idempotent pending proposal without changing active Skeleton or Today", async () => {
    const fixture = await campaignFixture("m4a-create");
    const core = new CampaignCoreService(fixture.prisma, clock);
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const today = await core.getOrCreateDailyTask({ campaignId: fixture.campaign.id, campaignDate: "2026-08-04" });
    expect("kind" in today).toBe(false);
    const input = {
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N2", priority: 90 }]),
    };
    const first = await service.createSkeletonPatchProposal(input);
    const second = await service.createSkeletonPatchProposal(input);
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("existing");
    expect(second.patch.id).toBe(first.patch.id);
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(1);
    expect((await fixture.prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).activeSkeletonVersion).toBe(1);
    expect(await core.getOrCreateDailyTask({ campaignId: fixture.campaign.id, campaignDate: "2026-08-04" })).toEqual(today);
  });

  it("rejects invalid and foreign-owner proposals without persistence", async () => {
    const fixture = await campaignFixture("m4a-invalid");
    const stranger = await fixture.prisma.user.create({ data: { handle: "m4a-stranger" } });
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    await expect(service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "move_node", nodeId: "N19", afterNodeId: "N20" }]),
    })).rejects.toMatchObject({ code: "invalid_patch" });
    await expect(service.createSkeletonPatchProposal({
      userId: stranger.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N1", priority: 4 }]),
    })).rejects.toMatchObject({ code: "campaign_not_found" });
    expect(await fixture.prisma.campaignSkeletonPatch.count()).toBe(0);
  });
});

describe("Campaign Skeleton Patch decisions", () => {
  it("accepts a v2 date-budget-only Patch without changing the global budget", async () => {
    const fixture = await campaignFixture("m4d1a2-date-only");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_policy_fixture",
        rationale: "Suggest capacity for one future date without a route operation.",
        operations: [],
        dateBudgetSuggestions: [{
          campaignDate: "2026-08-05",
          maxQuestions: 4,
          rationale: "Explicit future-date capacity.",
        }],
      },
    });
    expect(created.kind).toBe("created");
    await service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "user",
      acceptDailyBudgetSuggestion: true,
    });
    expect(await fixture.prisma.campaignDailyBudgetOverride.findUniqueOrThrow({
      where: {
        campaignId_campaignDate: {
          campaignId: fixture.campaign.id,
          campaignDate: "2026-08-05",
        },
      },
    })).toMatchObject({ maxQuestions: 4, status: "accepted" });
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({
      where: { campaignId: fixture.campaign.id },
    })).dailyQuestionBudget).toBe(3);
  });

  it("persists v2 planning fields and applies an approved date budget only to its future date", async () => {
    const fixture = await campaignFixture("m4d1a2-planning-contracts");
    const core = new CampaignCoreService(fixture.prisma, clock);
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const today = await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-04",
    });
    if ("kind" in today) throw new Error("Expected Today task");
    await expect(service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_policy_fixture",
        rationale: "This same-day override must not affect materialized Today.",
        operations: [{ type: "set_node_priority", nodeId: "N18", priority: 80 }],
        dateBudgetSuggestions: [{
          campaignDate: "2026-08-04",
          maxQuestions: 4,
          rationale: "Too late for an existing Today task.",
        }],
      },
    })).rejects.toMatchObject({ code: "invalid_patch" });
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_policy_fixture",
        rationale: "Set an exposure target and one approved future-date budget.",
        operations: [
          { type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" },
          { type: "set_target_by_date", nodeId: "N20", targetByDate: "2026-08-20" },
        ],
        dateBudgetSuggestions: [{
          campaignDate: "2026-08-05",
          maxQuestions: 5,
          rationale: "Use the explicitly approved capacity for this date only.",
        }],
      },
    });
    expect(await fixture.prisma.campaignDailyBudgetOverride.count()).toBe(0);

    await service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "user",
      acceptDailyBudgetSuggestion: true,
    });
    const version = await fixture.prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: fixture.campaign.id, version: 2 } },
      include: { nodePlans: true },
    });
    expect(version.nodePlans.find((plan) => plan.nodeId === "N20")).toMatchObject({
      goalDepth: "exposure",
      targetByDate: "2026-08-20",
      targetWeek: expect.any(Number),
    });
    expect(await fixture.prisma.campaignDailyBudgetOverride.findUniqueOrThrow({
      where: {
        campaignId_campaignDate: {
          campaignId: fixture.campaign.id,
          campaignDate: "2026-08-05",
        },
      },
    })).toMatchObject({ maxQuestions: 5, source: "strategist_patch", status: "accepted" });
    expect(await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-04",
    })).toEqual(today);
    const tomorrow = await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-05",
    });
    if ("kind" in tomorrow) throw new Error("Expected tomorrow task");
    expect(tomorrow.budget).toBe(5);
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({
      where: { campaignId: fixture.campaign.id },
    })).dailyQuestionBudget).toBe(3);

    const conflicting = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 2,
        trigger: "strategist_policy_fixture",
        rationale: "Do not silently overwrite an already approved date owner.",
        operations: [{ type: "set_node_priority", nodeId: "N18", priority: 81 }],
        dateBudgetSuggestions: [{
          campaignDate: "2026-08-05",
          maxQuestions: 4,
          rationale: "Conflicts with the accepted override.",
        }],
      },
    });
    await expect(service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: conflicting.patch.id,
      actorType: "user",
      acceptDailyBudgetSuggestion: true,
    })).rejects.toMatchObject({ code: "invalid_patch" });
    expect(await fixture.prisma.campaignDailyBudgetOverride.count({
      where: { campaignId: fixture.campaign.id, campaignDate: "2026-08-05" },
    })).toBe(1);
  });

  it("derives exposure satisfaction from settled task facts without changing mastery truth", async () => {
    const fixture = await campaignFixture("m4d1a2-exposure-facts", 4);
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const core = new CampaignCoreService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: {
        patchSchemaVersion: 2,
        baseVersion: 1,
        trigger: "strategist_policy_fixture",
        rationale: "Collect one exposure probe without asserting mastery.",
        operations: [{ type: "set_goal_depth", nodeId: "N20", goalDepth: "exposure" }],
      },
    });
    await service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "user",
    });
    await fixture.prisma.campaignLearnerNodeState.update({
      where: { campaignId_nodeId: { campaignId: fixture.campaign.id, nodeId: "N20" } },
      data: { unlockedAt: clock.now() },
    });
    const first = await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-05",
    });
    if ("kind" in first) throw new Error("Expected a projected task");
    const probe = first.items.find((item) => item.nodeId === "N20" && item.slotRole === "probe");
    expect(probe).toBeTruthy();
    const whilePending = await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-06",
    });
    expect("kind" in whilePending
      ? false
      : whilePending.items.some((item) => item.nodeId === "N20")).toBe(false);
    const attempt = await fixture.prisma.campaignTaskItemAttempt.create({
      data: {
        taskItemId: probe!.id,
        startedAt: new Date("2026-08-05T15:00:00.000Z"),
        completedAt: new Date("2026-08-05T15:10:00.000Z"),
      },
    });
    await fixture.prisma.campaignTaskItemSettlement.create({
      data: {
        taskItemId: probe!.id,
        attemptId: attempt.id,
        reviewCompleted: true,
        passed: false,
        selfRating: "struggled",
        positiveForMastery: false,
        negativeOutcome: false,
        settledAt: new Date("2026-08-05T15:10:00.000Z"),
      },
    });
    await fixture.prisma.campaignTaskItem.update({
      where: { id: probe!.id },
      data: { status: "settled" },
    });
    const second = await core.getOrCreateDailyTask({
      campaignId: fixture.campaign.id,
      campaignDate: "2026-08-07",
    });
    expect("kind" in second
      ? false
      : second.items.some((item) => item.nodeId === "N20")).toBe(false);
    expect(await fixture.prisma.campaignLearnerNodeState.findUniqueOrThrow({
      where: { campaignId_nodeId: { campaignId: fixture.campaign.id, nodeId: "N20" } },
    })).toMatchObject({ masteryState: "learning", masteredAt: null });
  });

  it("accepts atomically, preserves old version/state/Today, and changes future task budget/route", async () => {
    const fixture = await campaignFixture("m4a-accept");
    const core = new CampaignCoreService(fixture.prisma, clock);
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const today = await core.getOrCreateDailyTask({ campaignId: fixture.campaign.id, campaignDate: "2026-08-04" });
    if ("kind" in today) throw new Error("Expected Today task");
    expect(today.primaryNodeId).toBe("N1");
    const statesBefore = await fixture.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: fixture.campaign.id },
      orderBy: { nodeId: "asc" },
    });
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal(
        [{ type: "set_node_included", nodeId: "N1", included: false }],
        { dailyBudgetSuggestion: { proposedBudget: 4, rationale: "Use four questions on future days." } },
      ),
    });
    const accepted = await service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "user",
      acceptDailyBudgetSuggestion: true,
      rationale: "Accept route and future budget.",
    });
    expect(accepted).toMatchObject({ kind: "applied", status: "accepted", newVersion: 2 });
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(2);
    const skeletons = await fixture.prisma.campaignSkeleton.findMany({
      where: { campaignId: fixture.campaign.id },
      include: { nodePlans: true },
      orderBy: { version: "asc" },
    });
    expect(skeletons[0].nodePlans.find((plan) => plan.nodeId === "N1")?.included).toBe(true);
    expect(skeletons[1].nodePlans.find((plan) => plan.nodeId === "N1")?.included).toBe(false);
    expect((await fixture.prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).activeSkeletonVersion).toBe(2);
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: fixture.campaign.id } })).dailyQuestionBudget).toBe(4);
    expect(await core.getOrCreateDailyTask({ campaignId: fixture.campaign.id, campaignDate: "2026-08-04" })).toEqual(today);
    const statesAfterPatch = await fixture.prisma.campaignLearnerNodeState.findMany({
      where: { campaignId: fixture.campaign.id },
      orderBy: { nodeId: "asc" },
    });
    expect(statesAfterPatch).toEqual(statesBefore);
    const tomorrow = await core.getOrCreateDailyTask({ campaignId: fixture.campaign.id, campaignDate: "2026-08-05" });
    if ("kind" in tomorrow) throw new Error("Expected next-day task");
    expect(tomorrow).toMatchObject({ budget: 4, primaryNodeId: "N2" });
    expect(await fixture.prisma.campaignSkeletonDecisionLog.findUnique({ where: { patchId: created.patch.id } }))
      .toMatchObject({ action: "accepted", actorType: "user", baseVersion: 1, resultingVersion: 2, dailyBudgetDecision: "accepted" });

    const duplicate = await service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "user",
      acceptDailyBudgetSuggestion: true,
    });
    expect(duplicate.kind).toBe("already_decided");
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(2);
    expect(await fixture.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: created.patch.id } })).toBe(1);
  });

  it("partially accepts only stored operation ids and independently rejects budget", async () => {
    const fixture = await campaignFixture("m4a-partial");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([
        { type: "move_node", nodeId: "N19", beforeNodeId: "N18" },
        { type: "set_node_priority", nodeId: "N20", priority: 99 },
        { type: "set_mixed_window_days", mixedWindowDays: 14 },
      ], { dailyBudgetSuggestion: { proposedBudget: 5, rationale: "Future-only suggestion." } }),
    });
    const result = await service.partiallyAcceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      acceptedOperationIds: ["op-001", "op-002"],
      actorType: "user",
      acceptDailyBudgetSuggestion: false,
    });
    expect(result).toMatchObject({ kind: "applied", status: "partially_accepted", newVersion: 2 });
    const skeleton = await fixture.prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: fixture.campaign.id, version: 2 } },
      include: { nodePlans: true },
    });
    expect(skeleton.mixedWindowDays).toBe(7);
    expect(skeleton.nodePlans.find((plan) => plan.nodeId === "N20")?.priority).toBe(99);
    expect(skeleton.nodePlans.find((plan) => plan.nodeId === "N19")!.sortOrder)
      .toBeLessThan(skeleton.nodePlans.find((plan) => plan.nodeId === "N18")!.sortOrder);
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: fixture.campaign.id } })).dailyQuestionBudget).toBe(3);
    const decision = await fixture.prisma.campaignSkeletonDecisionLog.findUniqueOrThrow({ where: { patchId: created.patch.id } });
    expect(JSON.parse(decision.acceptedOperationIdsJson)).toEqual(["op-001", "op-002"]);
    expect(JSON.parse(decision.rejectedOperationIdsJson)).toEqual(["op-003"]);
    expect(decision.dailyBudgetDecision).toBe("rejected");
  });

  it("revalidates a partial subset and applies no partial write when it is illegal", async () => {
    const fixture = await campaignFixture("m4a-invalid-subset");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([
        { type: "set_node_included", nodeId: "N20", included: false },
        { type: "move_node", nodeId: "N19", afterNodeId: "N20" },
      ]),
    });
    await expect(service.partiallyAcceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      acceptedOperationIds: ["op-002"],
      actorType: "user",
    })).rejects.toMatchObject({ code: "invalid_patch" });
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(1);
    expect((await fixture.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: created.patch.id } })).status).toBe("pending");
    expect(await fixture.prisma.campaignSkeletonDecisionLog.count()).toBe(0);
  });

  it("rejects idempotently without creating a version or changing budget", async () => {
    const fixture = await campaignFixture("m4a-reject");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal(
        [{ type: "set_node_priority", nodeId: "N1", priority: 8 }],
        { dailyBudgetSuggestion: { proposedBudget: 4, rationale: "Rejected suggestion." } },
      ),
    });
    expect((await service.rejectSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "user", rationale: "Keep current route." })).kind).toBe("rejected");
    expect((await service.rejectSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "user" })).kind).toBe("already_decided");
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(1);
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: fixture.campaign.id } })).dailyQuestionBudget).toBe(3);
    expect(await fixture.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: created.patch.id } })).toBe(1);
    await expect(service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "user" }))
      .resolves.toMatchObject({ kind: "already_decided" });
  });

  it("keeps a second patch stale and never auto-rebases", async () => {
    const fixture = await campaignFixture("m4a-stale");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const patchA = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N1", priority: 10 }]),
    });
    const patchB = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N2", priority: 11 }]),
    });
    await service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: patchA.patch.id, actorType: "user" });
    const stale = await service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: patchB.patch.id, actorType: "user" });
    expect(stale).toMatchObject({ kind: "stale_base_version", activeVersion: 2 });
    expect((await fixture.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: patchB.patch.id } })).status).toBe("pending");
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(2);
    expect(await fixture.prisma.campaignSkeletonDecisionLog.count()).toBe(1);
  });

  it("allows only one winner when the same patch is accepted concurrently", async () => {
    const fixture = await campaignFixture("m4a-concurrent");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_priority", nodeId: "N2", priority: 88 }]),
    });
    const results = await Promise.all([
      service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "user" }),
      service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "user" }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["already_decided", "applied"]);
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(2);
    expect(await fixture.prisma.campaignSkeletonDecisionLog.count({ where: { patchId: created.patch.id } })).toBe(1);
    expect((await fixture.prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } })).activeSkeletonVersion).toBe(2);
  });

  it("validates partial operation ids", async () => {
    const fixture = await campaignFixture("m4a-partial-ids");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([
        { type: "set_node_priority", nodeId: "N1", priority: 10 },
        { type: "set_node_priority", nodeId: "N2", priority: 20 },
      ]),
    });
    for (const acceptedOperationIds of [[], ["op-999"], ["op-001", "op-002"]]) {
      await expect(service.partiallyAcceptSkeletonPatch({
        userId: fixture.user.id,
        patchId: created.patch.id,
        acceptedOperationIds,
        actorType: "user",
      })).rejects.toBeInstanceOf(CampaignSkeletonPatchError);
    }
    expect((await fixture.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: created.patch.id } })).status).toBe("pending");
  });

  it("does not let a strategist or system silently accept a daily budget suggestion", async () => {
    const fixture = await campaignFixture("m4a-budget-authority");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal(
        [{ type: "set_node_priority", nodeId: "N2", priority: 7 }],
        { dailyBudgetSuggestion: { proposedBudget: 4, rationale: "Suggestion only." } },
      ),
    });
    await expect(service.acceptSkeletonPatch({
      userId: fixture.user.id,
      patchId: created.patch.id,
      actorType: "strategist",
      acceptDailyBudgetSuggestion: true,
    })).rejects.toMatchObject({ code: "budget_acceptance_requires_user" });
    expect((await fixture.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: fixture.campaign.id } })).dailyQuestionBudget).toBe(3);
    expect((await fixture.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: created.patch.id } })).status).toBe("pending");
    expect(await fixture.prisma.campaignSkeleton.count({ where: { campaignId: fixture.campaign.id } })).toBe(1);
  });

  it("materializes a missing transferable state without inventing mastery evidence", async () => {
    const fixture = await campaignFixture("m4a-state-materialization");
    const service = new CampaignSkeletonPatchService(fixture.prisma, clock);
    const skeleton = await fixture.prisma.campaignSkeleton.findUniqueOrThrow({
      where: { campaignId_version: { campaignId: fixture.campaign.id, version: 1 } },
      include: { nodePlans: true },
    });
    await fixture.prisma.campaignSkeletonNodePlan.update({
      where: { skeletonId_nodeId: { skeletonId: skeleton.id, nodeId: "N18" } },
      data: { included: false },
    });
    await fixture.prisma.campaignLearnerNodeState.delete({
      where: { campaignId_nodeId: { campaignId: fixture.campaign.id, nodeId: "N18" } },
    });
    const created = await service.createSkeletonPatchProposal({
      userId: fixture.user.id,
      campaignId: fixture.campaign.id,
      proposal: proposal([{ type: "set_node_included", nodeId: "N18", included: true }]),
    });
    await service.acceptSkeletonPatch({ userId: fixture.user.id, patchId: created.patch.id, actorType: "system" });
    const state = await fixture.prisma.campaignLearnerNodeState.findUniqueOrThrow({
      where: { campaignId_nodeId: { campaignId: fixture.campaign.id, nodeId: "N18" } },
    });
    expect(state).toMatchObject({
      exposureState: "unknown",
      masteryState: "learning",
      masteryHealth: "stable",
      latestPositiveStreak: 0,
      masteredAt: null,
    });
    expect(state.unlockedAt).toEqual(clock.now());
    expect(JSON.parse(state.latestSettlementIdsJson)).toEqual([]);
  });
});

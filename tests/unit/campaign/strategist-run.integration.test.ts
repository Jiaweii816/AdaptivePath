import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CampaignCoreService,
  CampaignSkeletonPatchService,
  buildStrategistReadModel,
  createStubStrategistProvider,
  maybeEnqueueStrategistWake,
  reconcileStaleCampaignStrategistRuns,
} from "@/server/campaign/services";
import { createCampaignTestDb } from "./campaign-test-db";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const cleanups: Array<() => Promise<void>> = [];
const now = new Date("2026-08-04T15:00:00.000Z");

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(handle: string) {
  const database = await createCampaignTestDb();
  cleanups.push(database.cleanup);
  const user = await database.prisma.user.create({ data: { handle } });
  const campaign = await new CampaignCoreService(database.prisma, { now: () => now }).materializeInitialCampaign({
    userId: user.id,
    goal: {
      endDate: "2026-10-30",
      dailyQuestionBudget: 3,
      language: "Python",
      timezone: "America/Chicago",
      selfReportedWeakNodes: ["N2"],
      preferredNodes: ["N4"],
    },
  });
  await new CampaignCoreService(database.prisma, { now: () => now }).getOrCreateDailyTask({ campaignId: campaign.id, campaignDate: "2026-08-04" });
  return { ...database, user, campaign };
}

async function waitForStatus(db: Awaited<ReturnType<typeof createCampaignTestDb>>["prisma"], runId: string, statuses: string[]) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const run = await db.campaignStrategistRun.findUniqueOrThrow({ where: { id: runId } });
    if (statuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Strategist run ${runId} did not reach ${statuses.join(",")}.`);
}

describe("Strategist read model", () => {
  it("is bounded, stable, and excludes prohibited free-text sources", async () => {
    const f = await fixture("m4b-read-model");
    const task = await f.prisma.campaignDailyTask.findUniqueOrThrow({
      where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate: "2026-08-04" } },
      include: { items: true },
    });
    await new CampaignCoreService(f.prisma, { now: () => now }).rebuildTaskReceipt(task.id);
    await f.prisma.campaignRepairQueueItem.create({
      data: { campaignId: f.campaign.id, nodeId: task.items[0].nodeId, triggerTaskItemId: task.items[0].id, reason: "target_negative", priority: 10, status: "pending", createdAt: new Date("2026-08-01T15:00:00.000Z"), updatedAt: now },
    });
    const patch = await new CampaignSkeletonPatchService(f.prisma, { now: () => now }).createSkeletonPatchProposal({
      userId: f.user.id,
      campaignId: f.campaign.id,
      proposal: { patchSchemaVersion: 1, baseVersion: 1, trigger: "test_projection", rationale: "Exercise bounded planning history.", operations: [{ type: "set_node_priority", nodeId: "N2", priority: 42 }] },
    });
    await new CampaignSkeletonPatchService(f.prisma, { now: () => now }).rejectSkeletonPatch({ userId: f.user.id, patchId: patch.patch.id, actorType: "user", rationale: "Keep the current route." });
    const first = await buildStrategistReadModel({ db: f.prisma, campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    const second = await buildStrategistReadModel({ db: f.prisma, campaignId: f.campaign.id, campaignDate: "2026-08-04" });
    expect(first).toEqual(second);
    expect(first.readModel.learnerNodes).toHaveLength(17);
    expect(first.readModel.nonTransferableSupply.map((node) => node.nodeId)).toEqual(["N3", "N5", "N6"]);
    expect(first.readModel.recentReceipts).toHaveLength(1);
    expect(first.readModel.repairQueue).toMatchObject([{ nodeId: task.items[0].nodeId, status: "pending", accumulatedCount: 1 }]);
    expect(first.readModel.planningHistory).toMatchObject([{ decision: "rejected", affectedNodeIds: ["N2"] }]);
    expect(first.readModel.activeSkeleton.nodePlans.every((plan) => !["N3", "N5", "N6"].includes(plan.nodeId))).toBe(true);
    const serialized = JSON.stringify(first.readModel);
    expect(serialized.length).toBeLessThanOrEqual(24_000);
    expect(serialized).not.toContain("TracePayload");
    expect(serialized).not.toContain("stdout");
    expect(serialized).not.toContain("codeSnapshot");
    expect(serialized).not.toContain("MemoryEpisode");
  });

  it("derives Campaign week from the persisted timezone rather than the UTC creation date", async () => {
    const f = await fixture("m4b-timezone-week");
    await f.prisma.campaign.update({ where: { id: f.campaign.id }, data: { createdAt: new Date("2026-08-02T02:00:00.000Z") } });
    const projection = await buildStrategistReadModel({ db: f.prisma, campaignId: f.campaign.id, campaignDate: "2026-08-08" });
    expect(projection.readModel.campaign.startDate).toBe("2026-08-01");
    expect(projection.wakeSnapshot.campaignWeek).toBe(2);
  });
});

describe("Strategist durable wake and proposal", () => {
  it("migrates fresh and M4A databases", () => {
    const migrationRoot = join(process.cwd(), "prisma/migrations");
    const names = readdirSync(migrationRoot).sort();
    const m4b = "20260804050000_add_campaign_strategist_runs";
    for (const mode of ["fresh", "m4a_upgrade"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "patterncoach-campaign-final-migration-"));
      const db = new Database(join(dir, `${mode}.db`));
      const apply = (name: string) => {
        const path = join(migrationRoot, name, "migration.sql");
        if (existsSync(path)) db.exec(readFileSync(path, "utf8"));
      };
      if (mode === "fresh") names.forEach(apply);
      else {
        names.filter((name) => name < m4b).forEach(apply);
        db.exec(`INSERT INTO "User" ("id","handle","createdAt","updatedAt") VALUES ('u','m4b-upgrade',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP); INSERT INTO "Campaign" ("id","userId","updatedAt") VALUES ('c','u',CURRENT_TIMESTAMP);`);
        apply(m4b);
      }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).toContain("CampaignStrategistRun");
      if (mode === "m4a_upgrade") expect(db.prepare("SELECT id FROM Campaign WHERE id='c'").get()).toEqual({ id: "c" });
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records one no-change run/provider call and never repeats the fingerprint", async () => {
    const f = await fixture("m4b-no-change");
    let calls = 0;
    const provider = createStubStrategistProvider({ decision: "no_change", rationale: "The current route remains coherent." }, { onCall: () => { calls += 1; } });
    const options = { schedule: (task: () => void) => task(), processInstanceId: "m4b-test-process" };
    const first = await maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider, dispatchOptions: options });
    expect(first.kind).toBe("queued");
    if (first.kind !== "queued") throw new Error("Expected queued Strategist run");
    expect((await waitForStatus(f.prisma, first.run.id, ["no_change"])).status).toBe("no_change");
    const again = await maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider, dispatchOptions: options });
    expect(again.kind).toBe("skipped");
    expect(calls).toBe(1);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(1);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
    expect(await f.prisma.backgroundJob.count({ where: { kind: "campaign_strategist" } })).toBe(1);
  });

  it("turns one valid output into a pending M4A Patch without changing active Skeleton or Today", async () => {
    const f = await fixture("m4b-proposal");
    const todayBefore = await f.prisma.campaignDailyTask.findUniqueOrThrow({ where: { campaignId_campaignDate: { campaignId: f.campaign.id, campaignDate: "2026-08-04" } }, include: { items: true } });
    const result = await maybeEnqueueStrategistWake({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate: "2026-08-04",
      now,
      provider: createStubStrategistProvider({
        decision: "propose_patch",
        rationale: "Raise the priority of a future preferred mechanism.",
        operations: [{ type: "set_node_priority", nodeId: "N4", priority: 90 }],
        dailyBudgetSuggestion: { proposedBudget: 4, rationale: "Offer a future budget increase for approval." },
      }),
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4b-proposal-process" },
    });
    if (result.kind !== "queued") throw new Error("Expected queued Strategist run");
    const run = await waitForStatus(f.prisma, result.run.id, ["proposed"]);
    expect(run.proposalPatchId).toBeTruthy();
    expect(await f.prisma.campaignSkeletonPatch.findUniqueOrThrow({ where: { id: run.proposalPatchId! } })).toMatchObject({ status: "pending", baseVersion: 1 });
    expect((await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).activeSkeletonVersion).toBe(1);
    expect(await f.prisma.campaignDailyTask.findUniqueOrThrow({ where: { id: todayBefore.id }, include: { items: true } })).toEqual(todayBefore);
    expect((await f.prisma.campaignGoal.findUniqueOrThrow({ where: { campaignId: f.campaign.id } })).dailyQuestionBudget).toBe(3);
    expect(await f.prisma.campaignSkeletonDecisionLog.count()).toBe(0);
  });

  it("records invalid output once and does not create a Patch", async () => {
    const f = await fixture("m4b-invalid");
    let calls = 0;
    const result = await maybeEnqueueStrategistWake({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate: "2026-08-04",
      now,
      provider: createStubStrategistProvider('{"decision":"propose_patch","rationale":"forged","operations":[{"type":"set_mastery","nodeId":"N2"}],"dailyBudgetSuggestion":null}', { onCall: () => { calls += 1; } }),
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4b-invalid-process" },
    });
    if (result.kind !== "queued") throw new Error("Expected queued Strategist run");
    expect((await waitForStatus(f.prisma, result.run.id, ["invalid"])).errorClass).toMatch(/invalid_output_schema/);
    await maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider: createStubStrategistProvider("{}"), dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4b-invalid-process" } });
    expect(calls).toBe(1);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
  });

  it("enforces automatic future-node policy and the M4A validator after parsing", async () => {
    for (const [handle, operation, expectedError] of [
      ["m4b-started-invalid", { type: "set_node_priority", nodeId: "N1", priority: 99 }, "automatic_policy"],
      ["m4b-required-invalid", { type: "move_node", nodeId: "N20", beforeNodeId: "N19" }, "m4a_validator_rejected"],
    ] as const) {
      const f = await fixture(handle);
      const result = await maybeEnqueueStrategistWake({
        db: f.prisma,
        userId: f.user.id,
        campaignId: f.campaign.id,
        campaignDate: "2026-08-04",
        now,
        provider: createStubStrategistProvider({ decision: "propose_patch", rationale: "Attempt a bounded route change.", operations: [operation], dailyBudgetSuggestion: null }),
        dispatchOptions: { schedule: (task) => task(), processInstanceId: `${handle}-process` },
      });
      if (result.kind !== "queued") throw new Error("Expected queued Strategist run");
      expect((await waitForStatus(f.prisma, result.run.id, ["invalid"])).errorClass).toContain(expectedError);
      expect(await f.prisma.campaignSkeletonPatch.count({ where: { campaignId: f.campaign.id } })).toBe(0);
    }
  });

  it("records provider failure without changing Today, Skeleton, or learner state", async () => {
    const f = await fixture("m4b-provider-failure");
    const statesBefore = await f.prisma.campaignLearnerNodeState.findMany({ where: { campaignId: f.campaign.id }, orderBy: { nodeId: "asc" } });
    const provider = {
      name: "failing-stub",
      modelAlias: "failing-stub-v1",
      propose: async () => { throw new Error("provider unavailable"); },
    };
    const result = await maybeEnqueueStrategistWake({
      db: f.prisma,
      userId: f.user.id,
      campaignId: f.campaign.id,
      campaignDate: "2026-08-04",
      now,
      provider,
      dispatchOptions: { schedule: (task) => task(), processInstanceId: "m4b-failure-process", onError: () => undefined },
    });
    if (result.kind !== "queued") throw new Error("Expected queued Strategist run");
    expect((await waitForStatus(f.prisma, result.run.id, ["failed"])).errorClass).toBe("Error");
    expect((await f.prisma.backgroundJob.findFirstOrThrow({ where: { kind: "campaign_strategist" } })).status).toBe("failed");
    expect((await f.prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).activeSkeletonVersion).toBe(1);
    expect(await f.prisma.campaignSkeletonPatch.count()).toBe(0);
    expect(await f.prisma.campaignLearnerNodeState.findMany({ where: { campaignId: f.campaign.id }, orderBy: { nodeId: "asc" } })).toEqual(statesBefore);
  });

  it("deduplicates concurrent Today checks and never waits for provider completion", async () => {
    const f = await fixture("m4b-concurrency");
    let release!: () => void;
    const delay = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const provider = createStubStrategistProvider({ decision: "no_change", rationale: "No route change." }, { delay, onCall: () => { calls += 1; } });
    const options = { schedule: (task: () => void) => task(), processInstanceId: "m4b-concurrent-process" };
    const results = await Promise.all([
      maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider, dispatchOptions: options }),
      maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider, dispatchOptions: options }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["already_queued", "queued"]);
    const callDeadline = Date.now() + 1_000;
    while (calls === 0 && Date.now() < callDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(calls).toBe(1);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(1);
    release();
    const run = await f.prisma.campaignStrategistRun.findFirstOrThrow();
    await waitForStatus(f.prisma, run.id, ["no_change"]);
  });

  it("skips without a run or provider call while a pending Patch exists", async () => {
    const f = await fixture("m4b-pending-skip");
    await f.prisma.campaignSkeletonPatch.create({
      data: {
        campaignId: f.campaign.id,
        baseVersion: 1,
        trigger: "fixture",
        rationale: "Existing pending proposal.",
        operationsJson: JSON.stringify({ patchSchemaVersion: 1, operations: [{ operationId: "op-001", type: "set_node_priority", nodeId: "N2", priority: 10 }] }),
        proposalFingerprint: "pending-fixture",
        validatorSummaryJson: "{}",
        updatedAt: now,
      },
    });
    let calls = 0;
    const result = await maybeEnqueueStrategistWake({ db: f.prisma, userId: f.user.id, campaignId: f.campaign.id, campaignDate: "2026-08-04", now, provider: createStubStrategistProvider("{}", { onCall: () => { calls += 1; } }) });
    expect(result).toMatchObject({ kind: "skipped", evaluation: { skippedReason: "pending_patch_exists" } });
    expect(calls).toBe(0);
    expect(await f.prisma.campaignStrategistRun.count()).toBe(0);
  });

  it("records stale queued and running in-process work as failed without retrying", async () => {
    const f = await fixture("m4b-stale-runs");
    const old = new Date("2026-08-04T12:00:00.000Z");
    const base = {
      campaignId: f.campaign.id,
      activeSkeletonVersion: 1,
      trigger: "weekly_boundary",
      inputDigest: "a".repeat(64),
      wakeSnapshotJson: "{}",
      promptVersion: "v1",
      evaluatorVersion: "v1",
      provider: "stub",
      modelAlias: "stub",
      createdAt: old,
      updatedAt: old,
    };
    await f.prisma.campaignStrategistRun.createMany({ data: [
      { ...base, id: "stale-queued", triggerFingerprint: "b".repeat(64), status: "queued" },
      { ...base, id: "stale-running", triggerFingerprint: "c".repeat(64), status: "running", startedAt: old },
    ] });
    expect(await reconcileStaleCampaignStrategistRuns(f.prisma, { now, staleAfterMs: 60_000 })).toEqual({ queued: 1, running: 1 });
    expect((await f.prisma.campaignStrategistRun.findMany({ where: { id: { in: ["stale-queued", "stale-running"] } }, orderBy: { id: "asc" } })).map((run) => [run.status, run.errorClass])).toEqual([
      ["failed", "stale_dispatch"],
      ["failed", "stale_worker"],
    ]);
  });
});

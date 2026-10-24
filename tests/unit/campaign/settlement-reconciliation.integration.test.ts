import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../../prisma/seed";
import { fingerprintCodeForExecution, hashSelectedTestSuite } from "@/server/code/code-hash";
import {
  applySettlementReconciliationInTransaction,
  buildSettlementReconciliationPlan,
  digestReconciliationPlan,
} from "@/server/campaign/reconciliation/settlement-reconciliation";
import {
  createConsistentSqliteBackup,
  assertSqliteWritableAndUnlocked,
  sqliteIntegrityCheck,
  validateAbsoluteSqliteUrl,
  validateBackupPath,
} from "@/server/campaign/reconciliation/sqlite-reconciliation-safety";
import { CampaignCoreService } from "@/server/campaign/services/campaign-core-service";
import { buildActiveIdentityKey } from "@/server/observability/workspace-session";
import { createCampaignTestDb } from "./campaign-test-db";

type TestDb = Awaited<ReturnType<typeof createCampaignTestDb>>;
const require = createRequire(import.meta.url);
let current: TestDb | undefined;

afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

function evidenceVerdict(status: string, evidenceClass: "verdict_bearing" | "evidence_unavailable" | "local_only") {
  const canVerdict = evidenceClass !== "evidence_unavailable";
  return {
    evidenceClass,
    replyMode: evidenceClass === "evidence_unavailable" ? "unavailable" : evidenceClass === "local_only" ? "local_fallback" : status === "passed_visible_tests" ? "success" : "diagnostic",
    capabilities: {
      canVerdict,
      canWriteMistakeMemory: canVerdict,
      canWriteEpisode: canVerdict,
      canSignalPlanner: true,
      canUseFailureSalience: canVerdict,
    },
    status,
    providerUsed: evidenceClass === "local_only" ? "local_hot150" : "leetcode",
    scopeLabel: evidenceClass === "local_only" ? "local visible-test evidence" : "review evidence",
    modelInstruction: "Fixture evidence.",
  };
}

function runResult(status: "passed_visible_tests" | "failed" | "runner_error", evidenceClass: "verdict_bearing" | "evidence_unavailable" | "local_only") {
  return {
    status,
    passedCount: status === "passed_visible_tests" ? 2 : 0,
    failedCount: status === "failed" ? 1 : 0,
    stdout: "",
    stderr: "",
    testResults: [],
    rawResult: { providerUsed: evidenceClass === "local_only" ? "local_hot150" : "leetcode", evidenceVerdict: evidenceVerdict(status, evidenceClass) },
  };
}

async function addLegacySettlement(
  db: TestDb["prisma"],
  input: {
    campaignId: string;
    userId: string;
    problemSlug: string;
    date: string;
    slotRole: "advance" | "target" | "probe";
    rating: "easy" | "hesitated" | "struggled" | "unsolved";
    reviewStatus: "passed_visible_tests" | "failed" | "runner_error";
    localStatus?: "passed_visible_tests" | "failed";
  },
) {
  const problem = await db.problem.findUniqueOrThrow({ where: { slug: input.problemSlug } });
  const tests = await db.problemTestCase.findMany({ where: { problemId: problem.id, userId: null, isVisible: true }, orderBy: { id: "asc" } });
  const selected = tests.map((test) => test.id);
  const code = "class Solution:\n    def solve(self, *args):\n        return 1";
  const revision = fingerprintCodeForExecution({ language: "Python", code });
  const suite = hashSelectedTestSuite(selected);
  const startedAt = new Date(`${input.date}T09:00:00.000Z`);
  const runAt = new Date(`${input.date}T09:10:00.000Z`);
  const reviewAt = new Date(`${input.date}T09:20:00.000Z`);
  const settledAt = new Date(`${input.date}T09:30:00.000Z`);
  const daily = await db.campaignDailyTask.create({
    data: { campaignId: input.campaignId, campaignDate: input.date, budget: 3, primaryNodeId: "N7", status: "completed" },
  });
  const item = await db.campaignTaskItem.create({
    data: {
      dailyTaskId: daily.id, problemSlug: input.problemSlug, nodeId: "N7", slotRole: input.slotRole,
      exposureType: "never_seen", sortOrder: 0, status: "settled",
    },
  });
  const workspace = await db.problemWorkspaceSession.create({
    data: {
      userId: input.userId, problemId: problem.id, browserInstanceId: `r11-${input.problemSlug}`,
      activeIdentityKey: buildActiveIdentityKey({ userId: input.userId, problemId: problem.id, browserInstanceId: `r11-${input.problemSlug}`, memoryOrigin: "test" }),
      startTrigger: "review", captureLevel: "full", memoryOrigin: "test", startedAt,
    },
  });
  const chat = await db.chatSession.create({
    data: { userId: input.userId, problemId: problem.id, primaryLanguage: "Python", memoryOrigin: "test" },
  });
  const review = await db.reviewAttempt.create({
    data: {
      userId: input.userId, problemId: problem.id, chatSessionId: chat.id, language: "Python",
      codeSnapshot: code, selectedTestCaseIds: JSON.stringify(selected), selectedTestsJson: "[]", memoryOrigin: "test", createdAt: reviewAt,
    },
  });
  const reviewClass = input.reviewStatus === "runner_error" ? "evidence_unavailable" : "verdict_bearing";
  const reviewRun = await db.runEvidence.create({
    data: {
      reviewAttemptId: review.id, source: "review", executionFingerprint: revision,
      status: input.reviewStatus, passedCount: input.reviewStatus === "passed_visible_tests" ? selected.length : 0,
      failedCount: input.reviewStatus === "failed" ? 1 : 0,
      rawResultJson: JSON.stringify(runResult(input.reviewStatus, reviewClass)), memoryOrigin: "test", createdAt: reviewAt,
    },
  });
  const history = await db.problemHistory.create({
    data: {
      userId: input.userId, problemId: problem.id, reviewAttemptId: review.id, chatSessionId: chat.id,
      language: "Python", runStatus: input.reviewStatus, memoryOrigin: "test", createdAt: reviewAt,
    },
  });
  await db.plannerOutcome.create({
    data: {
      userId: input.userId, problemId: problem.id, reviewAttemptId: review.id,
      problemHistoryId: history.id, selfRating: input.rating, createdAt: settledAt,
    },
  });
  const attempt = await db.campaignTaskItemAttempt.create({
    data: {
      taskItemId: item.id, workspaceSessionId: workspace.id, reviewAttemptId: review.id,
      codeRevision: revision, executionFingerprint: revision, selectedSuiteFingerprint: suite,
      evidenceProblemSlug: input.problemSlug, evidenceSubject: "current_user_code", evidenceScope: "selected_suite",
      evidenceClass: reviewClass, evidenceAuthority: "authoritative",
      evidenceCanVerdict: reviewClass === "verdict_bearing", verdict: input.reviewStatus,
      startedAt, completedAt: settledAt,
    },
  });
  if (input.localStatus) {
    const local = await db.practiceRunLog.create({
      data: {
        userId: input.userId, problemId: problem.id, language: "Python", codeSnapshot: code,
        executionFingerprint: revision, runOrdinal: 1, selectedTestCaseIds: JSON.stringify(selected),
        status: input.localStatus, passedCount: input.localStatus === "passed_visible_tests" ? selected.length : 0,
        totalCount: selected.length, summary: "fixture", provider: "local_hot150",
        rawResultJson: JSON.stringify(runResult(input.localStatus, "local_only")), createdAt: runAt,
      },
    });
    await db.agentTraceRun.create({
      data: {
        id: `trace-${input.problemSlug}`, userId: input.userId, problemId: problem.id,
        workspaceSessionId: workspace.id, path: "practice_run", actionKind: "practice_run", memoryOrigin: "test",
        status: "succeeded", processInstanceId: "test", runId: local.id, startedAt: runAt, endedAt: runAt,
      },
    });
  }
  const settlement = await db.campaignTaskItemSettlement.create({
    data: {
      taskItemId: item.id, attemptId: attempt.id, reviewCompleted: true, passed: false,
      selfRating: input.rating, positiveForMastery: false, negativeOutcome: false,
      settledAt, settlementVersion: 1,
    },
  });
  await db.campaignTaskReceipt.create({
    data: {
      taskId: daily.id, campaignId: input.campaignId, campaignDate: input.date,
      status: "completed", plannedCount: 1, settledCount: 1,
      itemsJson: JSON.stringify([{ taskItemId: item.id, outcome: "neutral" }]),
    },
  });
  return { item, daily, settlement, reviewRun };
}

async function fixture() {
  current = await createCampaignTestDb();
  await seedDatabase(current.prisma);
  const user = await current.prisma.user.findUniqueOrThrow({ where: { handle: "try" } });
  const campaign = await new CampaignCoreService(current.prisma, { now: () => new Date("2026-08-01T00:00:00.000Z") })
    .materializeInitialCampaign({
      userId: user.id,
      goal: { endDate: "2026-12-01", dailyQuestionBudget: 3, timezone: "America/Chicago", language: "Python", selfReportedWeakNodes: [], preferredNodes: [] },
    });
  const first = await addLegacySettlement(current.prisma, {
    campaignId: campaign.id, userId: user.id, problemSlug: "majority-element", date: "2026-08-01",
    slotRole: "advance", rating: "easy", reviewStatus: "runner_error", localStatus: "passed_visible_tests",
  });
  const second = await addLegacySettlement(current.prisma, {
    campaignId: campaign.id, userId: user.id, problemSlug: "jump-game-ii", date: "2026-08-02",
    slotRole: "target", rating: "hesitated", reviewStatus: "passed_visible_tests",
  });
  const third = await addLegacySettlement(current.prisma, {
    campaignId: campaign.id, userId: user.id, problemSlug: "gas-station", date: "2026-08-03",
    slotRole: "target", rating: "unsolved", reviewStatus: "runner_error",
  });
  await current.prisma.campaignLearnerNodeState.update({
    where: { campaignId_nodeId: { campaignId: campaign.id, nodeId: "N7" } },
    data: { masteryState: "learning", masteryHealth: "stable", latestPositiveStreak: 0, masteredAt: null, masteredBySettlementId: null, latestSettlementIdsJson: "[]" },
  });
  return { ...current, user, campaign, first, second, third };
}

describe("R1.1 Settlement reconciliation", () => {
  it("builds a canonical no-write plan with positive, negative, and failed-evidence corrections", async () => {
    const f = await fixture();
    const before = await f.prisma.campaignTaskItemSettlement.findMany({ orderBy: { id: "asc" } });
    const plan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    const again = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });

    expect(plan.planDigest).toBe(again.planDigest);
    expect(plan.corrections.map((value) => [value.problemSlug, value.newOutcome, value.evidenceSource])).toEqual([
      ["majority-element", "positive", "local_visible_run"],
      ["jump-game-ii", "positive", "review"],
      ["gas-station", "negative", "review"],
    ]);
    expect(plan.nodePredictions[0]).toMatchObject({
      after: { masteryState: "mastered", masteryHealth: "needs_reinforcement", latestPositiveStreak: 2, pendingRepairCount: 1 },
    });
    expect(await f.prisma.campaignTaskItemSettlement.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    await expect(buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "missing" })).rejects.toThrow("Unknown learner");

    await f.prisma.campaignTaskItemSettlement.update({
      where: { id: f.third.settlement.id }, data: { selfRating: "easy" },
    });
    await f.prisma.plannerOutcome.update({
      where: { reviewAttemptId: f.third.reviewRun.reviewAttemptId! }, data: { selfRating: "easy" },
    });
    const failedPlan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    expect(failedPlan.planDigest).not.toBe(plan.planDigest);
    expect(failedPlan.corrections.find((value) => value.problemSlug === "gas-station")).toBeUndefined();
    await f.prisma.runEvidence.update({
      where: { id: f.third.reviewRun.id },
      data: { status: "failed", rawResultJson: JSON.stringify(runResult("failed", "verdict_bearing")) },
    });
    await f.prisma.campaignTaskItemAttempt.updateMany({
      where: { taskItemId: f.third.item.id }, data: { evidenceClass: "verdict_bearing", evidenceCanVerdict: true, verdict: "failed" },
    });
    const explicitFailed = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    expect(explicitFailed.corrections.find((value) => value.problemSlug === "gas-station")?.newOutcome).toBe("negative");
    await f.prisma.user.create({ data: { handle: "TRY" } });
    await expect(buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "TrY" })).rejects.toThrow("ambiguous");
  });

  it("applies in one transaction, fully recomputes state, repair, unlock and receipts without changing DailyTask rows", async () => {
    const f = await fixture();
    const plan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    const dailyBefore = await f.prisma.campaignDailyTask.findMany({ orderBy: { id: "asc" } });
    const settlementCount = await f.prisma.campaignTaskItemSettlement.count();
    await f.prisma.$transaction(async (tx) => {
      const inside = await buildSettlementReconciliationPlan({ db: tx, userHandle: "try" });
      expect(inside.planDigest).toBe(plan.planDigest);
      await applySettlementReconciliationInTransaction({ tx, plan: inside, now: new Date("2026-08-04T00:00:00.000Z") });
    });

    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(settlementCount);
    expect(await f.prisma.campaignTaskItemSettlement.findMany({ orderBy: { settledAt: "asc" }, select: { positiveForMastery: true, negativeOutcome: true, settlementVersion: true } })).toEqual([
      { positiveForMastery: true, negativeOutcome: false, settlementVersion: 2 },
      { positiveForMastery: true, negativeOutcome: false, settlementVersion: 2 },
      { positiveForMastery: false, negativeOutcome: true, settlementVersion: 2 },
    ]);
    expect(await f.prisma.campaignLearnerNodeState.findUniqueOrThrow({ where: { campaignId_nodeId: { campaignId: f.campaign.id, nodeId: "N7" } } })).toMatchObject({
      masteryState: "mastered", masteryHealth: "needs_reinforcement", latestPositiveStreak: 2,
    });
    expect(await f.prisma.campaignRepairQueueItem.findMany()).toMatchObject([
      { nodeId: "N7", triggerTaskItemId: f.third.item.id, status: "pending", reason: "mastery_needs_reinforcement" },
    ]);
    expect(await f.prisma.campaignDailyTask.findMany({ orderBy: { id: "asc" } })).toEqual(dailyBefore);
    expect((await f.prisma.campaignTaskReceipt.findUniqueOrThrow({ where: { taskId: f.first.daily.id } })).itemsJson).toContain('"outcome":"positive"');
    expect((await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" })).corrections).toHaveLength(0);
  });

  it("recomputes two historical positives without a later negative to mastered stable", async () => {
    const f = await fixture();
    await f.prisma.plannerOutcome.update({
      where: { reviewAttemptId: f.third.reviewRun.reviewAttemptId! }, data: { selfRating: "easy" },
    });
    await f.prisma.campaignTaskItemSettlement.update({
      where: { id: f.third.settlement.id }, data: { selfRating: "easy", settlementVersion: 2 },
    });
    const plan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    expect(plan.corrections).toHaveLength(2);
    await f.prisma.$transaction((tx) =>
      applySettlementReconciliationInTransaction({ tx, plan, now: new Date("2026-08-04T00:00:00.000Z") }),
    );
    expect(await f.prisma.campaignLearnerNodeState.findUniqueOrThrow({
      where: { campaignId_nodeId: { campaignId: f.campaign.id, nodeId: "N7" } },
    })).toMatchObject({ masteryState: "mastered", masteryHealth: "stable", latestPositiveStreak: 2 });
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(0);
  });

  it("does not reopen or overwrite a later resolved Repair for the same historical trigger", async () => {
    const f = await fixture();
    const resolvedAt = new Date("2026-08-05T00:00:00.000Z");
    const repair = await f.prisma.campaignRepairQueueItem.create({
      data: {
        campaignId: f.campaign.id, nodeId: "N7", triggerTaskItemId: f.third.item.id,
        reason: "mastery_needs_reinforcement", priority: 77, status: "resolved",
        createdAt: resolvedAt, updatedAt: resolvedAt,
      },
    });
    const plan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    await f.prisma.$transaction((tx) =>
      applySettlementReconciliationInTransaction({ tx, plan, now: new Date("2026-08-06T00:00:00.000Z") }),
    );
    expect(await f.prisma.campaignRepairQueueItem.findUniqueOrThrow({ where: { id: repair.id } })).toMatchObject({
      status: "resolved", priority: 77, updatedAt: resolvedAt,
    });
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(1);
  });

  it("rolls back every change on transaction failure and allows at most one concurrent apply", async () => {
    const f = await fixture();
    const plan = await buildSettlementReconciliationPlan({ db: f.prisma, userHandle: "try" });
    await expect(f.prisma.$transaction(async (tx) => {
      await applySettlementReconciliationInTransaction({ tx, plan, now: new Date() });
      throw new Error("injected failure");
    })).rejects.toThrow("injected failure");
    expect(await f.prisma.campaignTaskItemSettlement.count({ where: { settlementVersion: 1 } })).toBe(3);

    const attempts = await Promise.allSettled([0, 1].map(() => f.prisma!.$transaction(async (tx) => {
      const currentPlan = await buildSettlementReconciliationPlan({ db: tx, userHandle: "try" });
      if (currentPlan.planDigest !== plan.planDigest) throw new Error("stale_plan");
      return applySettlementReconciliationInTransaction({ tx, plan: currentPlan, now: new Date() });
    })));
    expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(await f.prisma.campaignTaskItemSettlement.count()).toBe(3);
    expect(await f.prisma.campaignRepairQueueItem.count()).toBe(1);
  });

  it("creates a checked non-overwriting backup and rejects unsafe paths", async () => {
    const f = await fixture();
    const backupPath = join(f.dir, "backup.db");
    const backup = await createConsistentSqliteBackup(f.dbPath, backupPath);
    expect(backup.integrity).toBe("ok");
    expect(sqliteIntegrityCheck(backupPath)).toBe("ok");
    expect(backup.source.sha256).not.toBe("");
    expect(backup.backup.sha256).not.toBe("");
    expect(backup.source.inode).not.toBe(backup.backup.inode);
    await expect(createConsistentSqliteBackup(f.dbPath, backupPath)).rejects.toThrow("already exists");
    expect(() => validateAbsoluteSqliteUrl("file:relative.db")).toThrow("absolute");
    expect(() => validateBackupPath({ backupPath: f.dbPath, sourcePath: f.dbPath, repositoryRoot: process.cwd() })).toThrow("differ");
    const corrupt = join(f.dir, "corrupt-backup.db");
    writeFileSync(corrupt, "not sqlite");
    expect(() => sqliteIntegrityCheck(corrupt)).toThrow();
    const Database = require("better-sqlite3");
    const lock = new Database(f.dbPath);
    try {
      lock.exec("BEGIN IMMEDIATE");
      expect(() => assertSqliteWritableAndUnlocked(f.dbPath)).toThrow("database_locked");
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }
  });

  it("runs the CLI dry-run and guarded apply against only the isolated /tmp database", async () => {
    const f = await fixture();
    await f.prisma.$disconnect();
    const dry = execFileSync("npm", ["run", "campaign:reconcile-settlements", "--", "--database-url", `file:${f.dbPath}`, "--user", "try", "--dry-run"], {
      cwd: process.cwd(), encoding: "utf8",
    });
    const json = JSON.parse(dry.slice(dry.indexOf("{"))) as { candidateCount: number; planDigest: string; writesPerformed: number };
    expect(json).toMatchObject({ candidateCount: 3, writesPerformed: 0 });
    const backupPath = join(f.dir, "cli-backup.db");
    const stale = spawnSync("npm", [
      "run", "campaign:reconcile-settlements", "--", "--database-url", `file:${f.dbPath}`, "--user", "try",
      "--apply", "--plan-digest", "wrong", "--expected-count", "2", "--confirm-user", "try", "--backup-path", backupPath,
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain("expected candidate count changed");
    expect(existsSync(backupPath)).toBe(false);
    const badDigest = spawnSync("npm", [
      "run", "campaign:reconcile-settlements", "--", "--database-url", `file:${f.dbPath}`, "--user", "try",
      "--apply", "--plan-digest", "wrong", "--expected-count", "3", "--confirm-user", "try", "--backup-path", backupPath,
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(badDigest.status).toBe(1);
    expect(badDigest.stderr).toContain("plan digest changed");
    expect(existsSync(backupPath)).toBe(false);
    const applied = execFileSync("npm", [
      "run", "campaign:reconcile-settlements", "--", "--database-url", `file:${f.dbPath}`, "--user", "try",
      "--apply", "--plan-digest", json.planDigest, "--expected-count", "3", "--confirm-user", "try", "--backup-path", backupPath,
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(applied).toContain('"status": "applied"');
    expect(existsSync(backupPath)).toBe(true);
    const receiptPath = `${backupPath}.receipt.json`;
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({ remainingCandidateCount: 0, finalIntegrityCheck: "ok" });
    const second = spawnSync("npm", [
      "run", "campaign:reconcile-settlements", "--", "--database-url", `file:${f.dbPath}`, "--user", "try",
      "--apply", "--plan-digest", json.planDigest, "--expected-count", "3", "--confirm-user", "try", "--backup-path", `${backupPath}.second`,
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("already_reconciled");
  }, 30_000);

  it("keeps digest canonical and detects changed plans", () => {
    expect(digestReconciliationPlan({ b: 2, a: 1 })).toBe(digestReconciliationPlan({ a: 1, b: 2 }));
    expect(digestReconciliationPlan({ a: 1 })).not.toBe(digestReconciliationPlan({ a: 2 }));
  });
});

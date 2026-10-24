import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  applySettlementReconciliationInTransaction,
  buildSettlementReconciliationPlan,
} from "@/server/campaign/reconciliation/settlement-reconciliation";
import {
  assertCurrentReconciliationSchema,
  assertSqliteWritableAndUnlocked,
  createConsistentSqliteBackup,
  inspectReconciliationSchema,
  protectedTableSummary,
  sqliteIntegrityCheck,
  validateAbsoluteSqliteUrl,
  validateBackupPath,
} from "@/server/campaign/reconciliation/sqlite-reconciliation-safety";

type Args = Readonly<{
  databaseUrl: string;
  user: string;
  campaignId?: string;
  apply: boolean;
  planDigest?: string;
  expectedCount?: number;
  confirmUser?: string;
  backupPath?: string;
}>;

const VALUE_FLAGS = new Set([
  "--database-url", "--user", "--campaign-id", "--plan-digest",
  "--expected-count", "--confirm-user", "--backup-path",
]);

export function parseReconciliationArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  let apply = false;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--apply") { apply = true; continue; }
    if (flag === "--dry-run") { dryRun = true; continue; }
    if (!VALUE_FLAGS.has(flag)) throw new Error(`Unknown reconciliation option: ${flag}`);
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate reconciliation option: ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  if (apply && dryRun) throw new Error("Choose either --apply or --dry-run, not both.");
  const databaseUrl = values.get("--database-url");
  const user = values.get("--user");
  if (!databaseUrl) throw new Error("An explicit --database-url is required.");
  if (!user) throw new Error("An explicit --user is required.");
  const expectedText = values.get("--expected-count");
  const expectedCount = expectedText === undefined ? undefined : Number(expectedText);
  if (expectedText !== undefined && (!Number.isSafeInteger(expectedCount) || expectedCount! < 0)) {
    throw new Error("--expected-count must be a non-negative integer.");
  }
  if (apply) {
    for (const flag of ["--plan-digest", "--expected-count", "--confirm-user", "--backup-path"]) {
      if (!values.has(flag)) throw new Error(`${flag} is required with --apply.`);
    }
  }
  return {
    databaseUrl,
    user,
    campaignId: values.get("--campaign-id"),
    apply,
    planDigest: values.get("--plan-digest"),
    expectedCount,
    confirmUser: values.get("--confirm-user"),
    backupPath: values.get("--backup-path"),
  };
}

function shortId(id: string) {
  return id.length <= 12 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function publicPlan(
  plan: Awaited<ReturnType<typeof buildSettlementReconciliationPlan>>,
  databasePath: string,
  schema: ReturnType<typeof inspectReconciliationSchema>,
) {
  return {
    mode: "dry-run",
    databasePath,
    learner: plan.userHandle,
    campaignId: shortId(plan.campaignId),
    scannedSettlementCount: plan.scannedSettlementCount,
    positiveCorrectionCount: plan.positiveCorrectionCount,
    negativeCorrectionCount: plan.negativeCorrectionCount,
    unchangedCount: plan.unchangedCount,
    candidateCount: plan.corrections.length,
    candidates: plan.corrections.map((value) => ({
      taskItemId: shortId(value.taskItemId),
      problemSlug: value.problemSlug,
      slotRole: value.slotRole,
      oldOutcome: value.oldOutcome,
      newOutcome: value.newOutcome,
      selfRating: value.selfRating,
      evidenceSource: value.evidenceSource,
      nodeId: value.nodeId,
    })),
    affectedNodeIds: plan.affectedNodeIds,
    nodePredictions: plan.nodePredictions,
    affectedTaskReceipts: plan.affectedTaskReceiptIds.map(shortId),
    newlyUnlockedNodeIds: plan.newlyUnlockedNodeIds,
    tablesNotModified: [
      "ReviewAttempt", "RunEvidence", "ProblemWorkspaceSession", "ChatMessage",
      "ActivityCluster", "ExtractionReceipt", "Memory/L2/L3", "CampaignDailyTask",
      "CampaignSkeleton", "Curriculum Graph",
    ],
    planDigest: plan.planDigest,
    applyReadiness: schema.current
      ? { ready: true }
      : { ready: false, missingColumns: schema.missingColumns, missingMigrations: schema.missingMigrations },
    writesPerformed: 0,
    privacy: "No code, Chat, Memory prose, full workspace identifiers, or secrets are included.",
  };
}

async function createClient(databaseUrl: string, readonly: boolean) {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl, readonly, fileMustExist: true }),
    log: ["error"],
  });
}

async function main() {
  const args = parseReconciliationArgs(process.argv.slice(2));
  const repositoryRoot = process.cwd();
  const databasePath = validateAbsoluteSqliteUrl(args.databaseUrl);
  const schema = inspectReconciliationSchema(databasePath, repositoryRoot);
  if (args.apply) assertCurrentReconciliationSchema(databasePath, repositoryRoot);

  const readonlyDb = await createClient(args.databaseUrl, true);
  let preflight;
  try {
    preflight = await buildSettlementReconciliationPlan({
      db: readonlyDb,
      userHandle: args.user,
      campaignId: args.campaignId,
    });
  } finally {
    await readonlyDb.$disconnect();
  }
  if (!args.apply) {
    console.log(JSON.stringify(publicPlan(preflight, databasePath, schema), null, 2));
    return;
  }
  if (args.confirmUser !== args.user) throw new Error("--confirm-user must exactly match --user.");
  if (preflight.corrections.length === 0) throw new Error("already_reconciled: candidate count is zero; apply was refused.");
  if (args.expectedCount !== preflight.corrections.length) throw new Error("stale_plan: expected candidate count changed.");
  if (args.planDigest !== preflight.planDigest) throw new Error("stale_plan: plan digest changed.");
  const paths = validateBackupPath({
    backupPath: args.backupPath!,
    sourcePath: databasePath,
    repositoryRoot,
  });
  const protectedBefore = protectedTableSummary(databasePath);
  const backup = await createConsistentSqliteBackup(databasePath, paths.backupPath);
  assertSqliteWritableAndUnlocked(databasePath);

  const writableDb = await createClient(args.databaseUrl, false);
  const appliedAt = new Date();
  let transactionResult;
  try {
    transactionResult = await writableDb.$transaction(async (tx) => {
      const currentPlan = await buildSettlementReconciliationPlan({
        db: tx,
        userHandle: args.user,
        campaignId: args.campaignId,
      });
      if (currentPlan.corrections.length !== args.expectedCount || currentPlan.planDigest !== args.planDigest) {
        throw new Error("stale_plan: database changed after backup; transaction rolled back.");
      }
      return applySettlementReconciliationInTransaction({ tx, plan: currentPlan, now: appliedAt });
    }, { maxWait: 5_000, timeout: 30_000 });
  } finally {
    await writableDb.$disconnect();
  }

  const finalIntegrityCheck = sqliteIntegrityCheck(databasePath);
  if (finalIntegrityCheck !== "ok") throw new Error(`Post-apply integrity_check failed: ${finalIntegrityCheck}`);
  const protectedAfter = protectedTableSummary(databasePath);
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) {
    throw new Error("Protected Review/RunEvidence/Memory table summaries changed unexpectedly.");
  }
  const verifyDb = await createClient(args.databaseUrl, true);
  let verification;
  let finalStates;
  let finalSettlements;
  let finalReceipts;
  let finalRepairs;
  try {
    verification = await buildSettlementReconciliationPlan({
      db: verifyDb, userHandle: args.user, campaignId: args.campaignId,
    });
    finalStates = await verifyDb.campaignLearnerNodeState.findMany({
      where: { campaignId: preflight.campaignId, nodeId: { in: [...preflight.affectedNodeIds] } },
      select: { nodeId: true, masteryState: true, masteryHealth: true, latestPositiveStreak: true, unlockedAt: true },
      orderBy: { nodeId: "asc" },
    });
    finalSettlements = await verifyDb.campaignTaskItemSettlement.findMany({
      where: { id: { in: preflight.corrections.map((value) => value.settlementId) } },
      select: { id: true, positiveForMastery: true, negativeOutcome: true, settlementVersion: true },
      orderBy: { id: "asc" },
    });
    finalReceipts = await verifyDb.campaignTaskReceipt.findMany({
      where: { taskId: { in: [...preflight.affectedDailyTaskIds] } },
      select: { id: true, taskId: true, status: true }, orderBy: { id: "asc" },
    });
    finalRepairs = await verifyDb.campaignRepairQueueItem.findMany({
      where: { campaignId: preflight.campaignId, nodeId: { in: [...preflight.affectedNodeIds] } },
      select: { nodeId: true, status: true, priority: true }, orderBy: [{ nodeId: "asc" }, { priority: "desc" }],
    });
  } finally {
    await verifyDb.$disconnect();
  }
  if (verification.corrections.length !== 0) throw new Error("Post-apply verification found remaining reconciliation candidates.");

  const receipt = {
    appliedAt: appliedAt.toISOString(),
    learner: preflight.userHandle,
    databasePathDigest: createHash("sha256").update(databasePath).digest("hex"),
    backupPath: paths.backupPath,
    backup,
    planDigest: preflight.planDigest,
    changedSettlements: preflight.corrections.map((value) => ({
      settlementId: shortId(value.settlementId), oldOutcome: value.oldOutcome, newOutcome: value.newOutcome,
    })),
    affectedNodes: preflight.nodePredictions,
    finalNodeStates: finalStates,
    affectedTaskReceipts: finalReceipts.map((value) => ({ ...value, id: shortId(value.id), taskId: shortId(value.taskId) })),
    newlyUnlockedNodeIds: transactionResult.newlyUnlockedNodeIds,
    repairSummary: finalRepairs,
    finalSettlements: finalSettlements.map((value) => ({ ...value, id: shortId(value.id) })),
    protectedTableSummary: protectedAfter,
    finalIntegrityCheck,
    remainingCandidateCount: verification.corrections.length,
    scriptVersion: preflight.scriptVersion,
    commitHash: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
  };
  try {
    writeFileSync(paths.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    console.error(JSON.stringify({
      status: "applied_but_receipt_failed",
      planDigest: preflight.planDigest,
      backupPath: paths.backupPath,
      error: error instanceof Error ? error.message : "unknown receipt error",
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    status: "applied",
    planDigest: preflight.planDigest,
    changedSettlementCount: preflight.corrections.length,
    backupPath: paths.backupPath,
    receiptPath: paths.receiptPath,
    finalIntegrityCheck,
    remainingCandidateCount: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

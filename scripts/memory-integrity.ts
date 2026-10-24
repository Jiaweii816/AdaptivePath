import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "@/lib/env";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import {
  applyMemoryRepairPlan,
  auditMemoryDatabase,
  buildMemoryRepairPlan,
  createMemoryRepairBackup,
  cutoverMemoryDatabase,
  hashRepairPlan,
  migrateMemoryStagingFromSnapshot,
  readRepairPlan,
  rebuildMemoryFtsIndex,
  rollbackMemoryCutover,
  verifyMemoryRepair,
} from "@/server/memory/repair/memory-integrity-repair";

type Command =
  | "backup"
  | "audit"
  | "plan"
  | "apply"
  | "verify"
  | "rebuild-index"
  | "cutover"
  | "rollback"
  | "migrate-staging";

type CliArgs = {
  command: Command;
  dbPath: string;
  outPath?: string;
  stagingPath?: string;
  planPath?: string;
  expectedPlanSha256?: string;
  expectedDbSha256?: string;
  expectedStagingDbSha256?: string;
  expectedReceiptFileSha256?: string;
  backupPath?: string;
  receiptPath?: string;
  safetyBackupPath?: string;
  migrationReceiptPath?: string;
  expectedMigrationReceiptFileSha256?: string;
  apply: boolean;
};

export async function runMemoryIntegrityCli(argv = process.argv.slice(2)) {
  loadLocalEnv();
  const args = parseMemoryIntegrityArgs(argv);
  const liveDbPath = resolveSqliteFilePath(
    process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    process.cwd(),
  );
  let result: unknown;

  switch (args.command) {
    case "backup": {
      if (!args.outPath) throw new Error("backup requires --out <snapshot-db-path>.");
      result = await createMemoryRepairBackup({
        sourceDbPath: args.dbPath,
        snapshotDbPath: args.outPath,
        stagingDbPath: args.stagingPath,
      });
      break;
    }
    case "audit": {
      result = await auditMemoryDatabase(args.dbPath);
      break;
    }
    case "plan": {
      if (!args.outPath) throw new Error("plan requires --out <plan-json-path>.");
      const built = await buildMemoryRepairPlan(args.dbPath);
      await writeJson(args.outPath, built.plan);
      result = {
        planPath: resolve(args.outPath),
        planSha256: built.planSha256,
        repairRunId: built.plan.repairRunId,
        source: built.plan.source,
        actionCounts: {
          quarantineFacts: built.plan.actions.quarantineFacts.length,
          invalidateSynthesis: built.plan.actions.invalidateSynthesis.length,
        },
        expectedIndexTruth: built.plan.expectedIndexTruth,
      };
      break;
    }
    case "apply": {
      const plan = await requirePlan(args);
      result = await applyMemoryRepairPlan({
        dbPath: args.dbPath,
        liveDbPath,
        plan,
        expectedPlanSha256: requireValue(
          args.expectedPlanSha256,
          "apply requires --expected-plan-sha256 <sha256>.",
        ),
        expectedDbSha256: requireValue(
          args.expectedDbSha256,
          "apply requires --expected-db-sha256 <snapshot-sha256>.",
        ),
        mode: args.apply ? "apply" : "dry-run",
      });
      break;
    }
    case "rebuild-index": {
      const plan = await requirePlan(args);
      result = await rebuildMemoryFtsIndex({
        dbPath: args.dbPath,
        liveDbPath,
        plan,
        expectedPlanSha256: requireValue(
          args.expectedPlanSha256,
          "rebuild-index requires --expected-plan-sha256 <sha256>.",
        ),
        mode: args.apply ? "apply" : "dry-run",
      });
      break;
    }
    case "verify": {
      const plan = await requirePlan(args);
      result = await verifyMemoryRepair({
        dbPath: args.dbPath,
        plan,
        expectedPlanSha256: requireValue(
          args.expectedPlanSha256,
          "verify requires --expected-plan-sha256 <sha256>.",
        ),
      });
      if (!(result as { ok: boolean }).ok) process.exitCode = 2;
      break;
    }
    case "cutover": {
      const plan = await requirePlan(args);
      result = await cutoverMemoryDatabase({
        liveDbPath: args.dbPath,
        stagingDbPath: requireValue(
          args.stagingPath,
          "cutover requires --staging <verified-staging-db-path>.",
        ),
        retainedBackupPath: requireValue(
          args.backupPath,
          "cutover requires --backup <new-retained-backup-path>.",
        ),
        receiptPath: requireValue(
          args.receiptPath,
          "cutover requires --receipt <new-cutover-receipt-path>.",
        ),
        stagingMigrationReceiptPath: requireValue(
          args.migrationReceiptPath,
          "cutover requires --migration-receipt <staging-migration-receipt-path>.",
        ),
        expectedStagingMigrationReceiptFileSha256: requireValue(
          args.expectedMigrationReceiptFileSha256,
          "cutover requires --expected-migration-receipt-file-sha256 <sha256>.",
        ),
        plan,
        expectedPlanSha256: requireValue(
          args.expectedPlanSha256,
          "cutover requires --expected-plan-sha256 <sha256>.",
        ),
        expectedStagingDbSha256: requireValue(
          args.expectedStagingDbSha256,
          "cutover requires --expected-staging-db-sha256 <sha256>.",
        ),
        mode: args.apply ? "apply" : "dry-run",
      });
      break;
    }
    case "migrate-staging": {
      result = await migrateMemoryStagingFromSnapshot({
        sourceSnapshotPath: args.dbPath,
        stagingDbPath: requireValue(
          args.stagingPath,
          "migrate-staging requires --staging <new-staging-db-path>.",
        ),
        receiptPath: requireValue(
          args.migrationReceiptPath,
          "migrate-staging requires --migration-receipt <new-receipt-path>.",
        ),
        expectedSourceSnapshotSha256: requireValue(
          args.expectedDbSha256,
          "migrate-staging requires --expected-db-sha256 <snapshot-sha256>.",
        ),
        mode: args.apply ? "apply" : "dry-run",
      });
      break;
    }
    case "rollback": {
      result = await rollbackMemoryCutover({
        liveDbPath: args.dbPath,
        receiptPath: requireValue(
          args.receiptPath,
          "rollback requires --receipt <cutover-receipt-path>.",
        ),
        expectedReceiptFileSha256: requireValue(
          args.expectedReceiptFileSha256,
          "rollback requires --expected-receipt-file-sha256 <sha256>.",
        ),
        safetyBackupPath: requireValue(
          args.safetyBackupPath,
          "rollback requires --safety-backup <new-pre-rollback-backup-path>.",
        ),
        mode: args.apply ? "apply" : "dry-run",
      });
      break;
    }
  }

  if (args.outPath && args.command !== "backup" && args.command !== "plan") {
    await writeJson(args.outPath, result);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export function parseMemoryIntegrityArgs(argv: string[]): CliArgs {
  const command = argv[0] as Command | undefined;
  if (
    !command ||
    ![
      "backup",
      "audit",
      "plan",
      "apply",
      "verify",
      "rebuild-index",
      "cutover",
      "rollback",
      "migrate-staging",
    ].includes(command)
  ) {
    throw new Error(
      "First argument must be backup | audit | plan | apply | verify | rebuild-index | migrate-staging | cutover | rollback.",
    );
  }

  let dbInput: string | undefined;
  let outInput: string | undefined;
  let stagingInput: string | undefined;
  let planInput: string | undefined;
  let expectedPlanSha256: string | undefined;
  let expectedDbSha256: string | undefined;
  let expectedStagingDbSha256: string | undefined;
  let expectedReceiptFileSha256: string | undefined;
  let backupInput: string | undefined;
  let receiptInput: string | undefined;
  let safetyBackupInput: string | undefined;
  let migrationReceiptInput: string | undefined;
  let expectedMigrationReceiptFileSha256: string | undefined;
  let apply = false;
  const providedFlags = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      providedFlags.add("--apply");
      continue;
    }
    const match = /^(--[a-z0-9-]+)=(.*)$/.exec(arg);
    const flag = match?.[1] ?? arg;
    const inlineValue = match?.[2];
    providedFlags.add(flag);
    const readValue = () => {
      if (inlineValue !== undefined) {
        if (!inlineValue) throw new Error(`Missing value for ${flag}.`);
        return inlineValue;
      }
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}.`);
      }
      index += 1;
      return value;
    };

    switch (flag) {
      case "--db":
        dbInput = readValue();
        break;
      case "--out":
        outInput = readValue();
        break;
      case "--staging":
        stagingInput = readValue();
        break;
      case "--plan":
        planInput = readValue();
        break;
      case "--expected-plan-sha256":
        expectedPlanSha256 = readValue();
        break;
      case "--expected-db-sha256":
        expectedDbSha256 = readValue();
        break;
      case "--expected-staging-db-sha256":
        expectedStagingDbSha256 = readValue();
        break;
      case "--expected-receipt-file-sha256":
        expectedReceiptFileSha256 = readValue();
        break;
      case "--backup":
        backupInput = readValue();
        break;
      case "--receipt":
        receiptInput = readValue();
        break;
      case "--safety-backup":
        safetyBackupInput = readValue();
        break;
      case "--migration-receipt":
        migrationReceiptInput = readValue();
        break;
      case "--expected-migration-receipt-file-sha256":
        expectedMigrationReceiptFileSha256 = readValue();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!dbInput) {
    throw new Error("--db <sqlite-db-path> is required; no default database is used.");
  }
  assertOnlyCommandFlags(command, providedFlags);

  return {
    command,
    dbPath: resolveDbInput(dbInput),
    outPath: outInput ? resolve(outInput) : undefined,
    stagingPath: stagingInput ? resolve(stagingInput) : undefined,
    planPath: planInput ? resolve(planInput) : undefined,
    expectedPlanSha256,
    expectedDbSha256,
    expectedStagingDbSha256,
    expectedReceiptFileSha256,
    backupPath: backupInput ? resolve(backupInput) : undefined,
    receiptPath: receiptInput ? resolve(receiptInput) : undefined,
    safetyBackupPath: safetyBackupInput
      ? resolve(safetyBackupInput)
      : undefined,
    migrationReceiptPath: migrationReceiptInput
      ? resolve(migrationReceiptInput)
      : undefined,
    expectedMigrationReceiptFileSha256,
    apply,
  };
}

function assertOnlyCommandFlags(command: Command, provided: Set<string>) {
  const common = ["--db", "--out"];
  const allowed: Record<Command, string[]> = {
    backup: [...common, "--staging"],
    audit: common,
    plan: common,
    apply: [
      ...common,
      "--plan",
      "--expected-plan-sha256",
      "--expected-db-sha256",
      "--apply",
    ],
    verify: [...common, "--plan", "--expected-plan-sha256"],
    "rebuild-index": [
      ...common,
      "--plan",
      "--expected-plan-sha256",
      "--apply",
    ],
    cutover: [
      ...common,
      "--staging",
      "--plan",
      "--expected-plan-sha256",
      "--expected-staging-db-sha256",
      "--backup",
      "--receipt",
      "--migration-receipt",
      "--expected-migration-receipt-file-sha256",
      "--apply",
    ],
    rollback: [
      ...common,
      "--receipt",
      "--expected-receipt-file-sha256",
      "--safety-backup",
      "--apply",
    ],
    "migrate-staging": [
      ...common,
      "--staging",
      "--migration-receipt",
      "--expected-db-sha256",
      "--apply",
    ],
  };
  const allowedSet = new Set(allowed[command]);
  const invalid = [...provided].filter((flag) => !allowedSet.has(flag));
  if (invalid.length > 0) {
    throw new Error(`${command} does not accept ${invalid.join(", ")}.`);
  }
}

async function requirePlan(args: CliArgs) {
  if (!args.planPath) throw new Error(`${args.command} requires --plan <plan-json-path>.`);
  const plan = await readRepairPlan(args.planPath);
  const expected = args.expectedPlanSha256;
  if (expected && hashRepairPlan(plan) !== expected) {
    throw new Error("Repair plan checksum does not match --expected-plan-sha256.");
  }
  return plan;
}

function resolveDbInput(input: string) {
  return input.startsWith("file:")
    ? resolveSqliteFilePath(input, process.cwd())
    : resolve(input);
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMemoryIntegrityCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import {
  sealHistoricalReplayActivityCluster,
} from "@/server/memory/activity-clusters";
import { runActivityExtraction } from "@/server/memory/extraction";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";

type BackfillArgs = {
  dbPath: string;
  outputPath: string;
  replayRunId: string;
  userHandle: string;
  limit?: number;
  dryRun: boolean;
};

type BackfillTarget = {
  reviewAttemptId: string;
  slug: string;
  createdAt: Date;
  existingClusterId: string | null;
};

type ReviewOutcome =
  | {
      reviewAttemptId: string;
      slug: string;
      clusterId: string;
      receiptStatus: string;
      observations: number;
      changedFacts: number;
      rejected: number;
    }
  | { reviewAttemptId: string; slug: string; clusterId?: string; error: string };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseWorkspaceLearnerDatabase(args.dbPath);
  if (!args.dryRun && process.env.PATTERNCOACH_MEMORY_ORIGIN !== "learner") {
    throw new Error("Backfill writes require PATTERNCOACH_MEMORY_ORIGIN=learner.");
  }

  const adapter = new PrismaBetterSqlite3({ url: `file:${args.dbPath}` });
  const prisma = new PrismaClient({ adapter, log: ["error"] });
  let ftsStore: FtsStore | undefined;
  const startedAt = new Date();
  try {
    const candidates = await loadTargets(prisma, args);
    const selectedCandidates = applyLimit(candidates, args.limit);
    const selected = selectedCandidates.filter(
      (target) => !target.existingClusterId,
    );
    if (!args.dryRun) ftsStore = createFtsStore(args.dbPath);
    const outcomes = args.dryRun
      ? []
      : await backfillTargets(prisma, selected, args.replayRunId, ftsStore);
    const report = buildReport(args, startedAt, candidates, selected, outcomes);
    await writeJson(args.outputPath, report);
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.summary.errors > 0) process.exitCode = 1;
    if (!args.dryRun) await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    ftsStore?.close();
    await prisma.$disconnect();
  }
}

export function parseArgs(argv: string[]): BackfillArgs {
  let dbInput: string | undefined;
  let outputInput: string | undefined;
  let replayRunId: string | undefined;
  let userHandle = "Iris904";
  let limit: number | undefined;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value.`);
    switch (arg) {
      case "--db":
        dbInput = value;
        break;
      case "--out":
        outputInput = value;
        break;
      case "--replay-run":
        replayRunId = value;
        break;
      case "--user":
        userHandle = value;
        break;
      case "--limit":
        limit = parseLimit(value);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  if (!dbInput || !outputInput || !replayRunId) {
    throw new Error(
      "Usage: --db <isolated.sqlite> --out <report.json> --replay-run <id> [--user <handle>] [--limit <n>] [--dry-run]",
    );
  }
  return {
    dbPath: resolveSqliteFilePath(dbInput, process.cwd()),
    outputPath: resolve(outputInput),
    replayRunId,
    userHandle,
    limit,
    dryRun,
  };
}

async function loadTargets(prisma: PrismaClient, args: BackfillArgs) {
  return prisma.$queryRaw<BackfillTarget[]>(Prisma.sql`
    SELECT
      r.id AS reviewAttemptId,
      p.slug AS slug,
      r.createdAt AS createdAt,
      c.id AS existingClusterId
    FROM ReviewAttempt r
    JOIN User u ON u.id = r.userId
    JOIN Problem p ON p.id = r.problemId
    LEFT JOIN MemoryActivityCluster c ON c.rootReviewAttemptId = r.id
    WHERE u.handle = ${args.userHandle}
      AND EXISTS (
        SELECT 1
        FROM L1MemoryEvent e
        WHERE e.reviewAttemptId = r.id
          AND e.eventType = 'historical_replay_attestation'
          AND e.memoryOrigin = 'learner'
          AND json_extract(e.eventJson, '$.replayRunId') = ${args.replayRunId}
      )
    ORDER BY r.createdAt ASC, r.id ASC
  `);
}

function applyLimit(targets: BackfillTarget[], limit: number | undefined) {
  return limit === undefined ? targets : targets.slice(0, limit);
}

async function backfillTargets(
  prisma: PrismaClient,
  targets: BackfillTarget[],
  replayRunId: string,
  ftsStore: FtsStore | undefined,
) {
  const outcomes: ReviewOutcome[] = [];
  for (const target of targets) {
    outcomes.push(await backfillOne(prisma, target, replayRunId, ftsStore));
  }
  return outcomes;
}

async function backfillOne(
  prisma: PrismaClient,
  target: BackfillTarget,
  replayRunId: string,
  ftsStore: FtsStore | undefined,
): Promise<ReviewOutcome> {
  let clusterId: string | undefined;
  try {
    const sealed = await sealHistoricalReplayActivityCluster(prisma, {
      reviewAttemptId: target.reviewAttemptId,
      replayRunId,
    });
    clusterId = sealed.cluster.id;
    const extracted = await runActivityExtraction(prisma, {
      activityClusterId: clusterId,
      ftsStore,
    });
    return {
      reviewAttemptId: target.reviewAttemptId,
      slug: target.slug,
      clusterId,
      receiptStatus: extracted.receiptStatus,
      observations: extracted.observationIds.length,
      changedFacts: extracted.changedFactIds.length,
      rejected: extracted.rejectedObservations.length,
    };
  } catch (error) {
    return {
      reviewAttemptId: target.reviewAttemptId,
      slug: target.slug,
      clusterId,
      error: errorMessage(error),
    };
  }
}

function buildReport(
  args: BackfillArgs,
  startedAt: Date,
  candidates: BackfillTarget[],
  selectedTargets: BackfillTarget[],
  outcomes: ReviewOutcome[],
) {
  const completedAt = new Date();
  return {
    manifestVersion: 1,
    mode: args.dryRun ? "dry-run" : "apply",
    replayRunId: args.replayRunId,
    learnerHandle: args.userHandle,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    database: { path: args.dbPath },
    summary: summarize(candidates, selectedTargets, outcomes),
    firstTenSlugs: selectedTargets.slice(0, 10).map((target) => target.slug),
    outcomes,
  };
}

function summarize(
  candidates: BackfillTarget[],
  selectedTargets: BackfillTarget[],
  outcomes: ReviewOutcome[],
) {
  const errors = outcomes.filter((outcome) => "error" in outcome).length;
  const statuses = outcomes.flatMap((outcome) =>
    "receiptStatus" in outcome ? [outcome.receiptStatus] : [],
  );
  return {
    eligibleBeforeLimit: candidates.filter((target) => !target.existingClusterId)
      .length,
    targeted: selectedTargets.length,
    sealed: outcomes.filter((outcome) => outcome.clusterId).length,
    succeeded: statuses.filter((status) => status === "succeeded").length,
    partial: statuses.filter((status) => status === "partial").length,
    failed: statuses.filter((status) => status === "failed").length,
    errors,
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseLimit(value: string) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return limit;
}

function refuseWorkspaceLearnerDatabase(dbPath: string) {
  const workspaceLearnerDb = resolve(process.cwd(), "dev.db");
  if (resolve(dbPath) === workspaceLearnerDb) {
    throw new Error(
      `Historical claim backfill refuses workspace learner database: ${workspaceLearnerDb}. Create an isolated copy first.`,
    );
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

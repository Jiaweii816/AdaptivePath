import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import { runReflection } from "@/server/agents/memory-agent/tasks/reflect";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import {
  HISTORICAL_REPLAY_RULE_VERSION,
  runHistoricalReviewReplay,
  type HistoricalReplayDecision,
} from "@/server/memory/replay/historical-review-replay";
import { parseManualProvenanceManifest } from "@/server/memory/replay/manual-provenance-review";
import { replacePriorHistoricalReplayMemory } from "@/server/memory/replay/replace-prior-replay-memory";

type ReplayCliArgs = {
  dbPath: string;
  userHandle: string;
  replayRunId: string;
  outputPath: string;
  approvalPath: string;
  apply: boolean;
  reflect: boolean;
  minimumAcceptedNonShowcaseProblems: number;
  replacePriorReplay: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseWorkspaceLearnerDatabase(args.dbPath);
  if (args.apply && process.env.PATTERNCOACH_MEMORY_ORIGIN !== "learner") {
    throw new Error(
      "--apply requires PATTERNCOACH_MEMORY_ORIGIN=learner on an isolated database.",
    );
  }
  if (args.apply && !args.replacePriorReplay) {
    throw new Error(
      "--apply requires --replace-prior-replay so manual replay cannot stack on earlier heuristic memory.",
    );
  }
  if (args.reflect && !args.apply) {
    throw new Error("--reflect requires --apply.");
  }
  if (args.reflect && process.env.REFLECTION_PROVIDER === "mock") {
    throw new Error("Historical replay --reflect refuses REFLECTION_PROVIDER=mock.");
  }

  const sourceDbSha256 = await sha256File(args.dbPath);
  const approvalManifest = parseManualProvenanceManifest(
    JSON.parse(await readFile(args.approvalPath, "utf8")),
  );
  if (approvalManifest.learnerHandle !== args.userHandle) {
    throw new Error(
      `Approval manifest belongs to ${approvalManifest.learnerHandle}, not ${args.userHandle}.`,
    );
  }
  const adapter = new PrismaBetterSqlite3({ url: `file:${args.dbPath}` });
  const prisma = new PrismaClient({ adapter, log: ["error"] });
  let ftsStore: FtsStore | undefined;
  const startedAt = new Date();
  try {
    const user = await prisma.user.findUnique({
      where: { handle: args.userHandle },
      select: { id: true, handle: true },
    });
    if (!user) throw new Error(`User handle not found: ${args.userHandle}`);
    const replacement = await replacePriorHistoricalReplayMemory(prisma, {
      userId: user.id,
      provenanceDecisionFingerprint: approvalManifest.decisionFingerprint,
      apply: args.apply && args.replacePriorReplay,
    });
    ftsStore = args.apply ? createFtsStore(args.dbPath) : undefined;
    const result = await runHistoricalReviewReplay(prisma, {
      userId: user.id,
      replayRunId: args.replayRunId,
      apply: args.apply,
      ftsStore,
      minimumAcceptedNonShowcaseProblems:
        args.minimumAcceptedNonShowcaseProblems,
      provenanceDecisions: approvalManifest.decisions,
      provenanceDecisionFingerprint: approvalManifest.decisionFingerprint,
    });
    let reflectionResult: Awaited<ReturnType<typeof runReflection>> | null = null;
    if (args.reflect) {
      const factRows = await prisma.l2MemoryFact.findMany({
        where: { userId: user.id, memoryOrigin: "learner" },
      });
      const changedFactIds = factRows
        .filter(isTrustedL2FactForConsumption)
        .map((fact) => fact.id);
      if (changedFactIds.length === 0) {
        throw new Error(
          "Historical replay produced no trusted L2 facts for real Reflection.",
        );
      }
      reflectionResult = await runReflection(prisma, {
        userId: user.id,
        changedFactIds,
        ftsStore,
      });
    }
    const activeL3Count = await prisma.synthesisSlot.count({
      where: {
        userId: user.id,
        memoryOrigin: "learner",
        status: "active",
      },
    });
    if (args.apply) {
      ftsStore?.close();
      ftsStore = undefined;
      await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    const completedAt = new Date();
    const targetDbSha256 = await sha256File(args.dbPath);
    const manifest = {
      manifestVersion: 1,
      replayRuleVersion: HISTORICAL_REPLAY_RULE_VERSION,
      appVersion: "0.1.0",
      replayRunId: args.replayRunId,
      approval: {
        path: args.approvalPath,
        sourceMarkdownSha256: approvalManifest.sourceMarkdownSha256,
        decisionFingerprint: approvalManifest.decisionFingerprint,
        counts: approvalManifest.counts,
      },
      mode: args.apply ? "apply" : "dry-run",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      database: {
        path: args.dbPath,
        sourceDbSha256,
        targetDbSha256,
      },
      learner: user,
      summary: {
        ...result.summary,
        activeL3Count,
      },
      reflection: reflectionResult,
      priorReplayReplacement: replacement,
      reasonDistribution: countReasons(result.decisions),
      acceptedByProblem: countAccepted(result.decisions, "problemSlug"),
      acceptedByOutcome: countAccepted(result.decisions, "outcome"),
      acceptedByEvidenceScope: countAccepted(
        result.decisions,
        "evidenceScope",
      ),
      blockedCandidateDistribution: countBlockedCandidates(result.decisions),
      sourceToTargetMapping: result.decisions.map((decision) => ({
        sourceReviewAttemptId: decision.sourceReviewAttemptId,
        sourceRunEvidenceIds: decision.sourceRunEvidenceIds,
        sourceDiagnosisId: decision.sourceDiagnosisId,
        sourceProblemHistoryId: decision.sourceProblemHistoryId,
        clusterId: decision.clusterId,
        decision: decision.decision,
      })),
      samples: sampleDecisions(result.decisions),
      decisions: result.decisions,
    };
    await mkdir(dirname(args.outputPath), { recursive: true });
    await writeFile(args.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({
      manifestPath: args.outputPath,
      ...manifest.summary,
      sourceDbSha256,
      targetDbSha256,
    }, null, 2));
  } finally {
    ftsStore?.close();
    await prisma.$disconnect();
  }
}

export function parseArgs(argv: string[]): ReplayCliArgs {
  let dbInput: string | undefined;
  let userHandle: string | undefined;
  let replayRunId = `historical-replay-${randomUUID()}`;
  let outputInput: string | undefined;
  let approvalInput: string | undefined;
  let apply = false;
  let reflect = false;
  let minimumAcceptedNonShowcaseProblems = 90;
  let replacePriorReplay = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--reflect") {
      reflect = true;
      continue;
    }
    if (arg === "--replace-prior-replay") {
      replacePriorReplay = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value.`);
    switch (arg) {
      case "--db":
        dbInput = value;
        break;
      case "--user":
        userHandle = value;
        break;
      case "--run-id":
        replayRunId = value;
        break;
      case "--out":
        outputInput = value;
        break;
      case "--approval":
        approvalInput = value;
        break;
      case "--min-non-showcase":
        minimumAcceptedNonShowcaseProblems = Number(value);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }
  if (!dbInput || !userHandle || !outputInput || !approvalInput) {
    throw new Error(
      "Usage: --db <isolated.sqlite> --user <handle> --approval <manifest.json> --out <manifest.json> [--run-id <id>] [--min-non-showcase <n>] [--apply --replace-prior-replay] [--reflect]",
    );
  }
  if (
    !Number.isInteger(minimumAcceptedNonShowcaseProblems) ||
    minimumAcceptedNonShowcaseProblems < 0
  ) {
    throw new Error("--min-non-showcase must be a non-negative integer.");
  }
  return {
    dbPath: resolveSqliteFilePath(dbInput, process.cwd()),
    userHandle,
    replayRunId,
    outputPath: resolve(outputInput),
    approvalPath: resolve(approvalInput),
    apply,
    reflect,
    minimumAcceptedNonShowcaseProblems,
    replacePriorReplay,
  };
}

function refuseWorkspaceLearnerDatabase(dbPath: string) {
  const workspaceLearnerDb = resolve(process.cwd(), "dev.db");
  if (resolve(dbPath) === workspaceLearnerDb) {
    throw new Error(
      `Historical replay refuses workspace learner database: ${workspaceLearnerDb}. Create an isolated online snapshot first.`,
    );
  }
}

async function sha256File(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function countReasons(decisions: HistoricalReplayDecision[]) {
  return countValues(decisions.flatMap((decision) => decision.decisionReasons));
}

function countAccepted(
  decisions: HistoricalReplayDecision[],
  key: "problemSlug" | "outcome" | "evidenceScope",
) {
  return countValues(
    decisions
      .filter((decision) => decision.decision.startsWith("accept_"))
      .flatMap((decision) => {
        const value = decision[key];
        return typeof value === "string" ? [value] : [];
      }),
  );
}

function countBlockedCandidates(decisions: HistoricalReplayDecision[]) {
  return countValues(
    decisions.flatMap((decision) => decision.blockedCandidateTags),
  );
}

function countValues(values: string[]) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function sampleDecisions(decisions: HistoricalReplayDecision[]) {
  const buckets = new Map<string, HistoricalReplayDecision[]>();
  for (const decision of decisions) {
    const key = `${decision.decision}:${decision.isShowcaseProblem ? "showcase" : "non_showcase"}`;
    const bucket = buckets.get(key) ?? [];
    if (bucket.length < 3) bucket.push(decision);
    buckets.set(key, bucket);
  }
  return Object.fromEntries(buckets);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

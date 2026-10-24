import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { createTraceContext } from "@/server/llm/trace-context";
import {
  buildCoachMemoryContext,
  type CoachMemoryAssembly,
} from "@/server/memory";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import {
  loadSeedLearnerManifest,
  type SeedLearnerManifest,
} from "../seed-learner/manifest";
import { evalReportPaths } from "./report";
import {
  DEFAULT_MEMORY_RETRIEVAL_DATASET_PATH,
  loadMemoryRetrievalDataset,
  validateMemoryDatasetAgainstManifest,
  type MemoryRetrievalCase,
  type MemoryRetrievalDataset,
} from "./memory-retrieval-dataset";
import {
  buildMemoryManifestLookup,
  mapRetrievedItemsToManifest,
  scoreMemoryRetrievalSuite,
  type MemoryManifestLookup,
  type RetrievedMemoryItem,
} from "./memory-retrieval-metrics";
import {
  buildMemoryRetrievalReport,
  MEMORY_RETRIEVAL_SUITE_NAME,
  type MemoryRetrievalReport,
  type MemoryRetrievalRunResult,
  writeMemoryRetrievalReport,
} from "./memory-retrieval-report";

type SqliteDatabase = {
  backup: (destinationFile: string) => Promise<void>;
  close: () => void;
};

type SqliteConstructor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

export type MemoryRetrievalSuiteOptions = {
  dbInput?: string;
  manifestPath?: string;
  datasetPath?: string;
  keepDb?: boolean;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  devDatabaseUrl?: string;
};

export async function runMemoryRetrievalSuite(
  options: MemoryRetrievalSuiteOptions,
): Promise<MemoryRetrievalReport> {
  const cwd = options.cwd ?? process.cwd();
  const timestamp = options.now ?? new Date();
  const seedDbPath = resolveRequiredSeedDbPath({
    dbInput: options.dbInput,
    cwd,
    devDatabaseUrl: options.devDatabaseUrl,
  });
  const manifestPath = resolveRequiredManifestPath(options.manifestPath, cwd);
  const datasetPath = resolve(
    cwd,
    options.datasetPath ?? DEFAULT_MEMORY_RETRIEVAL_DATASET_PATH,
  );
  const manifest = loadSeedLearnerManifest(manifestPath);
  const dataset = loadMemoryRetrievalDataset({ datasetPath });
  const retrievalNow = resolveRetrievalNow(manifest, timestamp);
  const lookup = buildMemoryManifestLookup(manifest);
  validateMemoryDatasetAgainstManifest({
    dataset,
    factKeys: new Set(manifest.facts.map((fact) => fact.scenarioFactKey)),
    episodeKeys: new Set(
      manifest.episodes.map((episode) => episode.scenarioEpisodeKey),
    ),
  });

  const runId = `eval-${MEMORY_RETRIEVAL_SUITE_NAME}-${randomUUID()}`;
  const runDbPath = resolve(
    cwd,
    "evals",
    "tmp",
    `${runId}.db`,
  );
  const reportPaths = evalReportPaths({
    suiteName: MEMORY_RETRIEVAL_SUITE_NAME,
    timestamp,
    outputDir: options.outputDir,
  });
  mkdirSync(dirname(runDbPath), { recursive: true });
  await backupSqliteDatabase(seedDbPath, runDbPath);

  let prisma: PrismaClient | undefined;
  let ftsStore: ReturnType<typeof createFtsStore> | undefined;
  let report: MemoryRetrievalReport | undefined;
  let success = false;

  try {
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${runDbPath}` }),
    });
    ftsStore = createFtsStore(runDbPath);
    const seeded = await loadSeedRuntimeContext(prisma, manifest);
    const runs: MemoryRetrievalRunResult[] = [];
    const retrievalRuns: Array<{
      queryId: string;
      retrieved: RetrievedMemoryItem[];
      injected: RetrievedMemoryItem[];
      profilePreferenceMarkersMatched?: string[];
    }> = [];
    const warnings: string[] = [];

    await withEmbeddingsDisabled(async () => {
      for (const query of dataset.cases) {
        const run = await runMemoryQuery({
          prisma: prisma as PrismaClient,
          ftsStore: ftsStore as ReturnType<typeof createFtsStore>,
          manifest,
          lookup,
          dataset,
          query,
          seeded,
        });
        runs.push(run.reportRun);
        retrievalRuns.push({
          queryId: query.queryId,
          retrieved: run.retrieved,
          injected: run.injected,
          profilePreferenceMarkersMatched:
            run.reportRun.profilePreferenceMarkersMatched,
        });
        if (run.warning) {
          warnings.push(run.warning);
        }
      }
    });

    const score = scoreMemoryRetrievalSuite({
      cases: dataset.cases,
      runs: retrievalRuns,
      defaultK: dataset.defaultK,
    });
    const dbKept = Boolean(options.keepDb);
    report = buildMemoryRetrievalReport({
      runId,
      generatedAt: timestamp,
      seedDbPath,
      runDbPath,
      manifestPath,
      datasetPath,
      retrievalNow,
      dbKept,
      dataset,
      score,
      runs,
      itemLabels: buildReportItemLabels(manifest),
      warnings,
      reportPaths,
    });
    writeMemoryRetrievalReport(report);

    success = true;
    return report;
  } finally {
    ftsStore?.close();
    await prisma?.$disconnect().catch(() => undefined);

    if (success && !options.keepDb) {
      removeSqliteFiles(runDbPath);
    }
  }
}

async function runMemoryQuery(args: {
  prisma: PrismaClient;
  ftsStore: ReturnType<typeof createFtsStore>;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  dataset: MemoryRetrievalDataset;
  query: MemoryRetrievalCase;
  seeded: Awaited<ReturnType<typeof loadSeedRuntimeContext>>;
}) {
  const problem = args.seeded.problemsBySlug.get(args.query.problemSlug);
  if (!problem) {
    throw new Error(`Memory query ${args.query.queryId} references missing problem ${args.query.problemSlug}.`);
  }

  const traceCorrelationId = `memory-retrieval:${args.dataset.datasetVersion}:${args.query.queryId}:${randomUUID()}`;
  const traceContext = createTraceContext({
    prisma: args.prisma,
    userId: args.manifest.userId,
    problemId: problem.id,
    memoryOrigin: "evaluation",
    path: "memory_background",
    task: "eval.memory_retrieval",
    traceRunId: traceCorrelationId,
    captureLevel: "full",
  });
  const memory = await buildCoachMemoryContext(args.prisma, {
    userId: args.manifest.userId,
    problemId: problem.id,
    problemTags: problem.tags,
    queryText: args.query.userQuestion,
    entry: args.query.entry,
    profile: args.seeded.profile,
    ftsStore: args.ftsStore,
    traceContext,
  });
  const retrieved = projectSelectedLearnerMemory(memory, args.lookup);
  const injected = projectInjectedLearnerMemory(memory, args.lookup);
  const matchedPreferenceMarkers = args.query.expectedProfilePreferenceMarkers.filter(
    (marker) =>
      memory.brief.outputPreferences.some((preference) =>
        preference.toLowerCase().includes(marker.toLowerCase()),
      ),
  );

  return {
    retrieved,
    injected,
    warning:
      memory.brief.retrievalStatus === "partial_failure" ||
      memory.brief.retrievalStatus === "failed"
        ? `${args.query.queryId}: retrieval status ${memory.brief.retrievalStatus}`
        : undefined,
    reportRun: {
      queryId: args.query.queryId,
      category: args.query.category,
      problemSlug: args.query.problemSlug,
      entry: args.query.entry,
      userQuestion: args.query.userQuestion,
      profileOutputPreferences: memory.brief.outputPreferences,
      profilePreferenceMarkersMatched: matchedPreferenceMarkers,
      retrieved,
      injected,
      memoryContext: {
        teachableMemories: memory.brief.teachableMemories,
        domainReferences: memory.brief.domainReferences,
        outputPreferences: memory.brief.outputPreferences,
        teachingStrategy: memory.brief.teachingStrategy,
      },
      assembly: {
        candidateFingerprint: memory.candidateFingerprint,
        candidateCount: memory.candidates.length,
        decisions: memory.decisions,
        droppedTags: memory.queryPlan.concepts.droppedTags,
      },
      retrievalStatus: memory.brief.retrievalStatus,
    },
  };
}

function projectSelectedLearnerMemory(
  memory: CoachMemoryAssembly,
  lookup: MemoryManifestLookup,
) {
  const selectedIds = new Set(
    memory.decisions
      .filter((decision) => decision.selected)
      .map((decision) => decision.candidateId),
  );
  const selected = memory.candidates.filter((candidate) =>
    selectedIds.has(candidate.id),
  );
  return mapRetrievedItemsToManifest({
    lookup,
    facts: selected
      .filter((candidate) => candidate.source === "l2_fact")
      .map((candidate, index) => ({
        id: candidate.id,
        tag: candidate.title,
        score: 1 / (index + 1),
      })),
    episodes: selected
      .filter((candidate) => candidate.source === "episode")
      .map((candidate, index) => ({
        id: candidate.id,
        title: candidate.title,
        score: 1 / (index + 1),
      })),
  });
}

function projectInjectedLearnerMemory(
  memory: CoachMemoryAssembly,
  lookup: MemoryManifestLookup,
) {
  const injectedRefs = new Set(
    memory.brief.teachableMemories.flatMap((item) => item.evidenceRefs),
  );
  const selectedIds = new Set(
    memory.decisions
      .filter((decision) => decision.selected)
      .map((decision) => decision.candidateId),
  );
  const injected = memory.candidates.filter(
    (candidate) =>
      selectedIds.has(candidate.id) &&
      candidate.evidenceRefs.some((ref) => injectedRefs.has(ref)),
  );

  return mapRetrievedItemsToManifest({
    lookup,
    facts: injected
      .filter((candidate) => candidate.source === "l2_fact")
      .map((candidate, index) => ({
        id: candidate.id,
        tag: candidate.title,
        score: 1 / (index + 1),
      })),
    episodes: injected
      .filter((candidate) => candidate.source === "episode")
      .map((candidate, index) => ({
        id: candidate.id,
        title: candidate.title,
        score: 1 / (index + 1),
      })),
  });
}

async function loadSeedRuntimeContext(
  prisma: PrismaClient,
  manifest: SeedLearnerManifest,
) {
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { userId: manifest.userId },
  });
  const problems = await prisma.problem.findMany();

  return {
    profile: {
      strongPatterns: parseStringArray(profile.strongPatterns),
      weakPatterns: parseStringArray(profile.weakPatterns),
      outputPreferences: parseStringArray(profile.outputPreferences),
    },
    problemsBySlug: new Map(
      problems.map((problem) => [
        problem.slug,
        {
          id: problem.id,
          slug: problem.slug,
          tags: parseStringArray(problem.tags),
        },
      ]),
    ),
  };
}

function resolveRequiredSeedDbPath(args: {
  dbInput?: string;
  cwd: string;
  devDatabaseUrl?: string;
}) {
  if (!args.dbInput) {
    throw new Error("memory-retrieval requires an explicit --db <seeded-eval-db>.");
  }

  const dbPath = args.dbInput.startsWith("file:")
    ? resolveSqliteFilePath(args.dbInput, args.cwd)
    : resolve(args.cwd, args.dbInput);
  const devDbPath = resolveSqliteFilePath(
    args.devDatabaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    args.cwd,
  );

  if (resolve(dbPath) === resolve(devDbPath)) {
    throw new Error(`Refusing to use development DB as memory retrieval seed DB: ${resolve(dbPath)}`);
  }
  if (!existsSync(dbPath)) {
    throw new Error(`Seed DB does not exist: ${dbPath}`);
  }

  return resolve(dbPath);
}

function resolveRequiredManifestPath(manifestPath: string | undefined, cwd: string) {
  if (!manifestPath) {
    throw new Error("memory-retrieval requires an explicit --manifest <manifest-json>.");
  }

  const resolved = resolve(cwd, manifestPath);
  if (!existsSync(resolved)) {
    throw new Error(`Manifest does not exist: ${resolved}`);
  }

  return resolved;
}

function resolveRetrievalNow(manifest: SeedLearnerManifest, fallback: Date) {
  const generatedAt = new Date(manifest.generatedAt);

  return Number.isNaN(generatedAt.getTime()) ? fallback : generatedAt;
}

function buildReportItemLabels(manifest: SeedLearnerManifest) {
  const labels: Record<string, string> = {};

  for (const fact of manifest.facts) {
    labels[fact.scenarioFactKey] =
      fact.label ?? fact.value ?? `${fact.factType}:${fact.tag}`;
  }
  for (const episode of manifest.episodes) {
    labels[episode.scenarioEpisodeKey] = episode.title;
  }

  return labels;
}

async function backupSqliteDatabase(sourcePath: string, destinationPath: string) {
  removeSqliteFiles(destinationPath);
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
}

async function withEmbeddingsDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.EMBEDDING_API_KEY;
  process.env.EMBEDDING_API_KEY = "";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.EMBEDDING_API_KEY;
    } else {
      process.env.EMBEDDING_API_KEY = previous;
    }
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function removeSqliteFiles(dbPath: string) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(path, { force: true });
  }
}

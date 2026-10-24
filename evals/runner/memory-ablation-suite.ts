import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
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
import { createChatClient } from "@/server/llm/client";
import { getChatModel } from "@/server/llm/models";
import {
  loadSeedLearnerManifest,
  type SeedLearnerManifest,
} from "../seed-learner/manifest";
import { evalReportPaths } from "./report";
import {
  DEFAULT_MEMORY_CITATION_DATASET_PATH,
  loadMemoryCitationDataset,
  validateMemoryCitationDatasetAgainstManifest,
  type MemoryCitationCase,
} from "./memory-citation-dataset";
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
  buildEvalOnlyFullHistoryContext,
  type FullHistoryContext,
} from "./memory-ablation-full-history";
import {
  calculateTokenReduction,
  estimatePromptTokens,
  scoreMemoryCitationSuite,
  summarizeTokenEstimates,
  type DeferredAblationArm,
  type MemoryAblationArmName,
} from "./memory-ablation-metrics";
import {
  buildMemoryAblationReport,
  MEMORY_ABLATION_SUITE_NAME,
  writeMemoryAblationReport,
  type MemoryAblationArmReport,
  type MemoryAblationQueryRun,
  type MemoryAblationReport,
} from "./memory-ablation-report";

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

const ABLATION_ARMS: Array<{
  arm: MemoryAblationArmName;
  label: string;
  evalOnly: boolean;
  includeL2Facts: boolean;
  retrievalMode: "fts_only" | "prompt_order";
  builder: "focused" | "full_history";
}> = [
  {
    arm: "focused_l2_fts",
    label: "Focused context with L2 facts, FTS-only",
    evalOnly: false,
    includeL2Facts: true,
    retrievalMode: "fts_only",
    builder: "focused",
  },
  {
    arm: "focused_no_l2_fts",
    label: "Focused context without L2 facts, FTS-only",
    evalOnly: true,
    includeL2Facts: false,
    retrievalMode: "fts_only",
    builder: "focused",
  },
  {
    arm: "full_history_l2_eval_only",
    label: "Eval-only full history with L2 facts",
    evalOnly: true,
    includeL2Facts: true,
    retrievalMode: "prompt_order",
    builder: "full_history",
  },
  {
    arm: "full_history_no_l2_eval_only",
    label: "Eval-only full history without L2 facts",
    evalOnly: true,
    includeL2Facts: false,
    retrievalMode: "prompt_order",
    builder: "full_history",
  },
];

export type MemoryAblationSuiteOptions = {
  dbInput?: string;
  manifestPath?: string;
  datasetPath?: string;
  citationDatasetPath?: string;
  keepDb?: boolean;
  outputDir?: string;
  now?: Date;
  cwd?: string;
  devDatabaseUrl?: string;
  skipCitationLlm?: boolean;
};

export type MemoryAblationCitationLlmRun = {
  caseId: string;
  status: "ok" | "error";
  model: string;
  responseModel?: string | null;
  latencyMs: number;
  outputText?: string;
  allowedFactIds: string[];
  allowedEpisodeIds: string[];
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  error?: string;
};

export async function runMemoryAblationSuite(
  options: MemoryAblationSuiteOptions,
): Promise<MemoryAblationReport> {
  const cwd = options.cwd ?? process.cwd();
  const timestamp = options.now ?? new Date();
  const seedDbPath = resolveRequiredSeedDbPath({
    dbInput: options.dbInput,
    cwd,
    devDatabaseUrl: options.devDatabaseUrl,
  });
  const manifestPath = resolveRequiredManifestPath(options.manifestPath, cwd);
  const queryDatasetPath = resolve(
    cwd,
    options.datasetPath ?? DEFAULT_MEMORY_RETRIEVAL_DATASET_PATH,
  );
  const citationDatasetPath = resolve(
    cwd,
    options.citationDatasetPath ?? DEFAULT_MEMORY_CITATION_DATASET_PATH,
  );
  const manifest = loadSeedLearnerManifest(manifestPath);
  const queryDataset = loadMemoryRetrievalDataset({
    datasetPath: queryDatasetPath,
  });
  const citationDataset = loadMemoryCitationDataset({
    datasetPath: citationDatasetPath,
  });
  const retrievalNow = resolveRetrievalNow(manifest, timestamp);
  const lookup = buildMemoryManifestLookup(manifest);
  const factKeys = new Set(manifest.facts.map((fact) => fact.scenarioFactKey));
  const episodeKeys = new Set(
    manifest.episodes.map((episode) => episode.scenarioEpisodeKey),
  );
  validateMemoryDatasetAgainstManifest({
    dataset: queryDataset,
    factKeys,
    episodeKeys,
  });
  validateMemoryCitationDatasetAgainstManifest({
    dataset: citationDataset,
    factKeys,
    episodeKeys,
  });

  const runId = `eval-${MEMORY_ABLATION_SUITE_NAME}-${randomUUID()}`;
  const runDbPath = resolve(cwd, "evals", "tmp", `${runId}.db`);
  const reportPaths = evalReportPaths({
    suiteName: MEMORY_ABLATION_SUITE_NAME,
    timestamp,
    outputDir: options.outputDir,
  });
  mkdirSync(dirname(runDbPath), { recursive: true });
  await backupSqliteDatabase(seedDbPath, runDbPath);

  let prisma: PrismaClient | undefined;
  let ftsStore: ReturnType<typeof createFtsStore> | undefined;
  let success = false;

  try {
    prisma = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: `file:${runDbPath}` }),
    });
    ftsStore = createFtsStore(runDbPath);
    const seeded = await loadSeedRuntimeContext(prisma, manifest);
    const armReports: MemoryAblationArmReport[] = [];
    const queryRuns: MemoryAblationQueryRun[] = [];
    const citationRuns: MemoryAblationCitationLlmRun[] = [];
    const warnings: string[] = [];

    await withEmbeddingsDisabled(async () => {
      for (const arm of ABLATION_ARMS) {
        const armRun = await runAblationArm({
          arm,
          prisma: prisma as PrismaClient,
          ftsStore: ftsStore as ReturnType<typeof createFtsStore>,
          manifest,
          lookup,
          queryDataset,
          seeded,
          retrievalNow,
        });
        armReports.push(armRun.report);
        queryRuns.push(...armRun.queryRuns);
        warnings.push(...armRun.warnings);
      }
    });

    const armByName = new Map(armReports.map((arm) => [arm.arm, arm]));
    const tokenReductions = [
      calculateTokenReduction({
        baselineArm: "full_history_l2_eval_only",
        baselineTokens: armByName.get("full_history_l2_eval_only")?.promptTokens ??
          summarizeTokenEstimates([]),
        comparisonArm: "focused_l2_fts",
        comparisonTokens: armByName.get("focused_l2_fts")?.promptTokens ??
          summarizeTokenEstimates([]),
      }),
      calculateTokenReduction({
        baselineArm: "full_history_no_l2_eval_only",
        baselineTokens:
          armByName.get("full_history_no_l2_eval_only")?.promptTokens ??
          summarizeTokenEstimates([]),
        comparisonArm: "focused_no_l2_fts",
        comparisonTokens:
          armByName.get("focused_no_l2_fts")?.promptTokens ??
          summarizeTokenEstimates([]),
      }),
    ];
    const deferredArms: DeferredAblationArm[] = [
      {
        arm: "focused_l2_hybrid",
        reason:
          "Deferred because this deterministic suite disables embeddings and the seed DB has no stable vector index for episode hybrid retrieval.",
      },
    ];
    if (options.skipCitationLlm) {
      warnings.push(
        "Personalized citation LLM calls were skipped by explicit test option; hallucinated memory rate is unscorable for this run.",
      );
    } else {
      citationRuns.push(
        ...(await runPersonalizedCitationCases({
          prisma,
          ftsStore,
          manifest,
          lookup,
          citationCases: citationDataset.cases,
          seeded,
          retrievalNow,
        })),
      );
    }
    const citationScore = scoreMemoryCitationSuite({
      dataset: citationDataset,
      manifest,
      runs: citationRuns.map((run) => ({
        caseId: run.caseId,
        outputText: run.outputText,
        allowedFactIds: run.allowedFactIds,
        allowedEpisodeIds: run.allowedEpisodeIds,
      })),
    });
    const report = buildMemoryAblationReport({
      runId,
      generatedAt: timestamp,
      seedDbPath,
      runDbPath,
      manifestPath,
      queryDatasetPath,
      citationDatasetPath,
      retrievalNow,
      dbKept: Boolean(options.keepDb),
      queryDataset,
      citationDataset,
      arms: armReports,
      deferredArms,
      tokenReductions,
      citationScore,
      citationRuns,
      llmUsed: !options.skipCitationLlm,
      runs: queryRuns,
      warnings,
      reportPaths,
    });

    writeMemoryAblationReport(report);
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

async function runAblationArm(args: {
  arm: (typeof ABLATION_ARMS)[number];
  prisma: PrismaClient;
  ftsStore: ReturnType<typeof createFtsStore>;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  queryDataset: MemoryRetrievalDataset;
  seeded: Awaited<ReturnType<typeof loadSeedRuntimeContext>>;
  retrievalNow: Date;
}) {
  const retrievalRuns: Array<{
    queryId: string;
    retrieved: RetrievedMemoryItem[];
  }> = [];
  const promptTokens: number[] = [];
  const warnings: string[] = [];

  for (const query of args.queryDataset.cases) {
    const run =
      args.arm.builder === "focused"
        ? await runFocusedArmQuery({
            ...args,
            query,
            includeL2Facts: args.arm.includeL2Facts,
          })
        : await runFullHistoryArmQuery({
            ...args,
            query,
            includeL2Facts: args.arm.includeL2Facts,
          });

    retrievalRuns.push({
      queryId: query.queryId,
      retrieved: run.retrieved,
    });
    promptTokens.push(run.promptTokens);
    warnings.push(...run.warnings);
  }

  const retrieval = scoreMemoryRetrievalSuite({
    cases: args.queryDataset.cases,
    runs: retrievalRuns,
    defaultK: args.queryDataset.defaultK,
  });
  const queryRuns = retrieval.queries.map((query) => ({
    arm: args.arm.arm,
    queryId: query.queryId,
    promptTokens:
      promptTokens[
        args.queryDataset.cases.findIndex((item) => item.queryId === query.queryId)
      ] ?? 0,
    retrievedKeys: query.retrievedTopK
      .map((item) => item.key)
      .filter((key): key is string => Boolean(key)),
    missingExpectedFactKeys: query.missingExpectedFactKeys,
    missingExpectedEpisodeKeys: query.missingExpectedEpisodeKeys,
    surfacedForbiddenKeys: [
      ...query.surfacedForbiddenFactKeys,
      ...query.surfacedForbiddenEpisodeKeys,
    ],
  }));

  return {
    report: {
      arm: args.arm.arm,
      label: args.arm.label,
      evalOnly: args.arm.evalOnly,
      includeL2Facts: args.arm.includeL2Facts,
      retrievalMode: args.arm.retrievalMode,
      retrieval,
      promptTokens: summarizeTokenEstimates(promptTokens),
    },
    queryRuns,
    warnings,
  };
}

async function runPersonalizedCitationCases(args: {
  prisma: PrismaClient;
  ftsStore: ReturnType<typeof createFtsStore>;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  citationCases: MemoryCitationCase[];
  seeded: Awaited<ReturnType<typeof loadSeedRuntimeContext>>;
  retrievalNow: Date;
}): Promise<MemoryAblationCitationLlmRun[]> {
  const client = createChatClient();
  const model = getChatModel();
  const runs: MemoryAblationCitationLlmRun[] = [];

  for (const citationCase of args.citationCases) {
    runs.push(
      await runPersonalizedCitationCase({
        ...args,
        citationCase,
        client,
        model,
      }),
    );
  }

  return runs;
}

async function runPersonalizedCitationCase(args: {
  prisma: PrismaClient;
  ftsStore: ReturnType<typeof createFtsStore>;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  citationCase: MemoryCitationCase;
  seeded: Awaited<ReturnType<typeof loadSeedRuntimeContext>>;
  retrievalNow: Date;
  client: OpenAI;
  model: string;
}): Promise<MemoryAblationCitationLlmRun> {
  const problem = args.seeded.problemsBySlug.get(args.citationCase.problemSlug);
  if (!problem) {
    throw new Error(
      `Memory citation case ${args.citationCase.caseId} references missing problem ${args.citationCase.problemSlug}.`,
    );
  }

  const traceCorrelationId = `memory-ablation-citation:${args.citationCase.caseId}:${randomUUID()}`;
  const traceContext = createTraceContext({
    prisma: args.prisma,
    userId: args.manifest.userId,
    problemId: problem.id,
    memoryOrigin: "evaluation",
    path: "memory_background",
    task: "eval.memory_ablation_citation",
    traceRunId: traceCorrelationId,
    captureLevel: "full",
  });
  const memory = await buildCoachMemoryContext(args.prisma, {
    userId: args.manifest.userId,
    problemId: problem.id,
    problemTags: problem.tags,
    queryText: args.citationCase.userQuestion,
    entry: citationEntryForCategory(args.citationCase.category),
    profile: args.seeded.profile,
    ftsStore: args.ftsStore,
    traceContext,
  });
  const retrieved = projectSelectedLearnerMemory(memory, args.lookup, true);
  const messages = buildCitationMessages({
    citationCase: args.citationCase,
    retrieved,
    outputPreferences: memory.brief.outputPreferences,
  });
  const startedAt = Date.now();

  try {
    const completion = await args.client.chat.completions.create({
      model: args.model,
      temperature: 0,
      messages,
    });
    const latencyMs = Date.now() - startedAt;
    const outputText = completion.choices[0]?.message.content ?? "";

    if (!outputText.trim()) {
      return {
        caseId: args.citationCase.caseId,
        status: "error",
        model: args.model,
        responseModel: completion.model,
        latencyMs,
        allowedFactIds: retrieved
          .filter((item) => item.kind === "fact")
          .map((item) => item.id),
        allowedEpisodeIds: retrieved
          .filter((item) => item.kind === "episode")
          .map((item) => item.id),
        usage: normalizeUsage(completion.usage),
        error: "empty_llm_response",
      };
    }

    return {
      caseId: args.citationCase.caseId,
      status: "ok",
      model: args.model,
      responseModel: completion.model,
      latencyMs,
      outputText,
      allowedFactIds: retrieved
        .filter((item) => item.kind === "fact")
        .map((item) => item.id),
      allowedEpisodeIds: retrieved
        .filter((item) => item.kind === "episode")
        .map((item) => item.id),
      usage: normalizeUsage(completion.usage),
    };
  } catch (error) {
    return {
      caseId: args.citationCase.caseId,
      status: "error",
      model: args.model,
      responseModel: null,
      latencyMs: Date.now() - startedAt,
      allowedFactIds: retrieved
        .filter((item) => item.kind === "fact")
        .map((item) => item.id),
      allowedEpisodeIds: retrieved
        .filter((item) => item.kind === "episode")
        .map((item) => item.id),
      usage: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runFocusedArmQuery(args: {
  arm: (typeof ABLATION_ARMS)[number];
  prisma: PrismaClient;
  ftsStore: ReturnType<typeof createFtsStore>;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  queryDataset: MemoryRetrievalDataset;
  query: MemoryRetrievalCase;
  seeded: Awaited<ReturnType<typeof loadSeedRuntimeContext>>;
  retrievalNow: Date;
  includeL2Facts: boolean;
}) {
  const problem = args.seeded.problemsBySlug.get(args.query.problemSlug);
  if (!problem) {
    throw new Error(
      `Memory ablation query ${args.query.queryId} references missing problem ${args.query.problemSlug}.`,
    );
  }

  const traceCorrelationId = `memory-ablation:${args.arm.arm}:${args.queryDataset.datasetVersion}:${args.query.queryId}:${randomUUID()}`;
  const traceContext = createTraceContext({
    prisma: args.prisma,
    userId: args.manifest.userId,
    problemId: problem.id,
    memoryOrigin: "evaluation",
    path: "memory_background",
    task: "eval.memory_ablation_retrieval",
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
  const mapped = projectSelectedLearnerMemory(
    memory,
    args.lookup,
    args.includeL2Facts,
  );
  const promptText = renderFocusedPrompt({
    problemSlug: args.query.problemSlug,
    userQuestion: args.query.userQuestion,
    includeL2Facts: args.includeL2Facts,
    retrieved: mapped,
    memory: focusedBrief(memory, args.includeL2Facts),
  });

  return {
    retrieved: mapped,
    promptTokens: estimatePromptTokens(promptText),
    warnings:
      memory.brief.retrievalStatus === "partial_failure" ||
      memory.brief.retrievalStatus === "failed"
        ? [
            `${args.arm.arm}/${args.query.queryId}: retrieval status ${memory.brief.retrievalStatus}`,
          ]
        : [],
  };
}

function buildCitationMessages(args: {
  citationCase: MemoryCitationCase;
  retrieved: RetrievedMemoryItem[];
  outputPreferences: string[];
}): ChatCompletionMessageParam[] {
  const facts = args.retrieved.filter((item) => item.kind === "fact");
  const episodes = args.retrieved.filter((item) => item.kind === "episode");

  return [
    {
      role: "system",
      content: [
        "You are PatternCoach's personalized memory citation evaluator.",
        "Answer the learner briefly using only the memory items listed in the user message.",
        "Do not invent user history. If the provided memory does not support the answer, say that there is no grounded memory evidence.",
        "After the natural-language answer, append exactly this sentinel line followed by one JSON object:",
        "<<<MEMORY_CITATIONS_JSON>>>",
        "{\"citedFactIds\":[],\"citedEpisodeIds\":[],\"noCitationReason\":null}",
        "Only cite factId or episodeId values that appear in the provided memory list.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Case id: ${args.citationCase.caseId}`,
        `Problem: ${args.citationCase.problemSlug}`,
        `Learner question: ${args.citationCase.userQuestion}`,
        `Profile output preferences: ${args.outputPreferences.join(", ") || "none"}`,
        "",
        "Provided memory facts:",
        facts.length === 0
          ? "- none"
          : facts
              .map(
                (fact) =>
                  `- factId=${fact.id}; key=${fact.key ?? "unknown"}; label=${fact.label}`,
              )
              .join("\n"),
        "",
        "Provided memory episodes:",
        episodes.length === 0
          ? "- none"
          : episodes
              .map(
                (episode) =>
                  `- episodeId=${episode.id}; key=${episode.key ?? "unknown"}; title=${episode.label}`,
              )
              .join("\n"),
      ].join("\n"),
    },
  ];
}

function citationEntryForCategory(category: MemoryCitationCase["category"]) {
  if (category === "api_confusion_memory") {
    return { kind: "chat" as const, intent: "api_reference_question" };
  }
  if (category === "preference_memory") {
    return { kind: "chat" as const, intent: "general_followup" };
  }
  if (category === "skill_memory") {
    return { kind: "chat" as const, intent: "concept_question" };
  }

  return { kind: "chat" as const, intent: "past_mistake_recall_request" };
}

async function runFullHistoryArmQuery(args: {
  prisma: PrismaClient;
  manifest: SeedLearnerManifest;
  lookup: MemoryManifestLookup;
  query: MemoryRetrievalCase;
  includeL2Facts: boolean;
}) {
  const context: FullHistoryContext = await buildEvalOnlyFullHistoryContext(
    args.prisma,
    {
      manifest: args.manifest,
      lookup: args.lookup,
      problemSlug: args.query.problemSlug,
      userQuestion: args.query.userQuestion,
      includeL2Facts: args.includeL2Facts,
    },
  );

  return {
    retrieved: context.retrieved,
    promptTokens: estimatePromptTokens(context.promptText),
    warnings: [],
  };
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

function renderFocusedPrompt(args: {
  problemSlug: string;
  userQuestion: string;
  includeL2Facts: boolean;
  retrieved: RetrievedMemoryItem[];
  memory: CoachMemoryAssembly["brief"];
}) {
  const lines = [
    "FOCUSED MEMORY CONTEXT",
    `Problem: ${args.problemSlug}`,
    `User question: ${args.userQuestion}`,
    `L2 facts included: ${args.includeL2Facts ? "yes" : "no"}`,
    "",
  ];

  if (args.includeL2Facts) {
    const facts = args.retrieved.filter((item) => item.kind === "fact");
    lines.push("Retrieved facts:");
    if (facts.length === 0) {
      lines.push("- none");
    }
    for (const fact of facts) {
      lines.push(
        `- factId=${fact.id}; key=${fact.key ?? "unknown"}; label=${fact.label}`,
      );
    }
    lines.push("");
  }

  lines.push("Teachable memories:");
  if (args.memory.teachableMemories.length === 0) lines.push("- none");
  for (const item of args.memory.teachableMemories) {
    lines.push(`- ${item.kind}: ${item.cue} (${item.sourceLabel})`);
  }

  const episodes = args.retrieved.filter((item) => item.kind === "episode");
  lines.push("Retrieved episodes:");
  if (episodes.length === 0) {
    lines.push("- none");
  }
  for (const episode of episodes) {
    lines.push(
      `- episodeId=${episode.id}; key=${episode.key ?? "unknown"}; title=${episode.label}`,
    );
  }
  lines.push(
    `Output preferences: ${args.memory.outputPreferences.join(", ") || "none"}`,
  );
  lines.push("Domain references:");
  if (args.memory.domainReferences.length === 0) lines.push("- none");
  for (const reference of args.memory.domainReferences) {
    lines.push(`- ${reference.title}: ${reference.content}`);
  }

  return lines.join("\n");
}

function projectSelectedLearnerMemory(
  memory: CoachMemoryAssembly,
  lookup: MemoryManifestLookup,
  includeL2Facts: boolean,
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
    facts: includeL2Facts
      ? selected
          .filter((candidate) => candidate.source === "l2_fact")
          .map((candidate, index) => ({
            id: candidate.id,
            tag: candidate.title,
            score: 1 / (index + 1),
          }))
      : [],
    episodes: selected
      .filter((candidate) => candidate.source === "episode")
      .map((candidate, index) => ({
        id: candidate.id,
        title: candidate.title,
        score: 1 / (index + 1),
      })),
  });
}

function focusedBrief(
  memory: CoachMemoryAssembly,
  includeL2Facts: boolean,
): CoachMemoryAssembly["brief"] {
  if (includeL2Facts) return memory.brief;
  const l2EvidenceRefs = new Set(
    memory.candidates
      .filter((candidate) => candidate.source === "l2_fact")
      .flatMap((candidate) => candidate.evidenceRefs),
  );
  return {
    ...memory.brief,
    teachableMemories: memory.brief.teachableMemories.filter(
      (item) => !item.evidenceRefs.some((ref) => l2EvidenceRefs.has(ref)),
    ),
  };
}

function resolveRequiredSeedDbPath(args: {
  dbInput?: string;
  cwd: string;
  devDatabaseUrl?: string;
}) {
  if (!args.dbInput) {
    throw new Error("memory-ablation requires an explicit --db <seeded-eval-db>.");
  }

  const dbPath = args.dbInput.startsWith("file:")
    ? resolveSqliteFilePath(args.dbInput, args.cwd)
    : resolve(args.cwd, args.dbInput);
  const devDbPath = resolveSqliteFilePath(
    args.devDatabaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    args.cwd,
  );

  if (resolve(dbPath) === resolve(devDbPath)) {
    throw new Error(
      `Refusing to use development DB as memory ablation seed DB: ${resolve(dbPath)}`,
    );
  }
  if (!existsSync(dbPath)) {
    throw new Error(`Seed DB does not exist: ${dbPath}`);
  }

  return resolve(dbPath);
}

function resolveRequiredManifestPath(manifestPath: string | undefined, cwd: string) {
  if (!manifestPath) {
    throw new Error("memory-ablation requires an explicit --manifest <manifest-json>.");
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

function normalizeUsage(
  usage:
    | {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        total_tokens?: number | null;
      }
    | null
    | undefined,
) {
  if (!usage) {
    return null;
  }

  return {
    inputTokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    totalTokens:
      typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

function removeSqliteFiles(dbPath: string) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(path, { force: true });
  }
}

import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import * as sqliteVec from "sqlite-vec";
import { getCoachProvider } from "@/server/agents/coach-agent/coach-provider";
import { createTraceContext } from "@/server/llm/trace-context";
import { finalizeTraceRun } from "@/server/observability/trace-store";
import { buildCoachMemoryContext } from "@/server/memory";
import { runEmbedBackfill } from "@/server/memory/consolidation/embed-backfill";
import {
  createEmbedClient,
  getEmbeddingDim,
  isEmbeddingConfigured,
} from "@/server/memory/retrieval/embed-client";
import { searchCandidateRanks } from "@/server/memory/retrieval/hybrid-candidate-recall";
import { buildMemoryPromptReceipt } from "@/server/memory/retrieval/memory-prompt-receipt";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { buildLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import { createVectorStore } from "@/server/memory/store/vector-store";

const require = createRequire(import.meta.url);

type SqliteStatement = {
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
};

type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const Database = require("better-sqlite3") as SqliteConstructor;

type CliArgs = {
  dbPath: string;
  userHandle: string;
  outputPath: string;
  batchSize: number;
};

const L2_QUERY = "二分查找每次边界更新都把循环不变量搞坏";
const L3_QUERY = "哪些跨题证据说明我在折半定位时能稳定维护候选范围？";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSafeAcceptanceProcess(args);
  const startedAt = new Date();
  const sourceDbSha256 = await sha256File(args.dbPath);
  const configuredDim = getEmbeddingDim();
  const embedClient = createEmbedClient();
  const probe = await embedClient.embedWithUsage?.([
    "PatternCoach embedding dimension compatibility probe",
  ]);
  const probeVectors = probe?.vectors ?? (await embedClient.embed([
    "PatternCoach embedding dimension compatibility probe",
  ]));
  const probeDim = probeVectors[0]?.length ?? 0;
  assert(
    probeVectors.length === 1 &&
      probeDim === configuredDim &&
      embedClient.dim === configuredDim,
    `Embedding dimension gate failed: returned=${probeDim}, client=${embedClient.dim}, configured=${configuredDim}`,
  );

  const adapter = new PrismaBetterSqlite3({ url: `file:${args.dbPath}` });
  const prisma = new PrismaClient({ adapter, log: ["error"] });
  const ftsStore = createFtsStore(args.dbPath);
  const vectorStore = createVectorStore(args.dbPath, configuredDim);
  let manifestBody: Record<string, unknown> | undefined;

  try {
    assert(
      vectorStore.dim === configuredDim,
      `Vector index dim ${vectorStore.dim} does not match configured dim ${configuredDim}`,
    );
    const user = await prisma.user.findUnique({
      where: { handle: args.userHandle },
      include: { profile: true },
    });
    assert(user, `User handle not found: ${args.userHandle}`);

    const documents = (
      await buildLearnerMemoryRetrievalDocuments(prisma, { userId: user.id })
    ).filter((document) =>
      ["fact", "episode", "synthesis"].includes(document.ftsKind),
    );
    const expectedByKind = countBy(
      documents.map((document) => document.ftsKind),
    );
    for (const kind of ["fact", "episode", "synthesis"] as const) {
      assert(
        (expectedByKind[kind] ?? 0) > 0,
        `No eligible ${kind} retrieval documents before backfill.`,
      );
    }

    const batches: Array<{
      embedded: number;
      remaining: number;
      documentIds: string[];
    }> = [];
    for (;;) {
      const result = await runEmbedBackfill(prisma, {
        embedClient,
        vectorStore,
        batchSize: args.batchSize,
      });
      batches.push({
        embedded: result.embedded,
        remaining: result.remaining,
        documentIds: result.affectedDocumentIds,
      });
      if (result.remaining === 0) break;
      assert(result.embedded > 0, "Embedding backlog made no progress.");
    }

    const vectorCounts = countBy(
      vectorStore.listProjectionState().map((row) => row.kind),
    );
    for (const kind of ["fact", "episode", "synthesis"] as const) {
      assert(
        (vectorCounts[kind] ?? 0) === (expectedByKind[kind] ?? 0),
        `${kind} vector coverage mismatch: expected ${expectedByKind[kind] ?? 0}, got ${vectorCounts[kind] ?? 0}`,
      );
    }

    const facts = await prisma.l2MemoryFact.findMany({
      where: { userId: user.id, memoryOrigin: "learner", status: "active" },
      include: { problem: true },
    });
    const targetWeakness = facts.find(
      (fact) =>
        fact.factType === "mistake" &&
        fact.tag === "binary_search_invariant" &&
        isTrustedL2FactForConsumption(fact),
    );
    const targetStrength = facts.find(
      (fact) =>
        fact.factType === "strength" &&
        fact.tag === "binary_search_invariant" &&
        isTrustedL2FactForConsumption(fact),
    );
    assert(targetWeakness, "Trusted binary-search weakness L2 not found.");
    assert(targetStrength, "Trusted binary-search strength L2 not found.");
    const targetSynthesis = await prisma.synthesisSlot.findFirst({
      where: {
        userId: user.id,
        memoryOrigin: "learner",
        status: "active",
        slot: "strengths",
        synthesisKey: "binary_search_invariant",
      },
    });
    assert(targetSynthesis, "Active binary-search strength L3 not found.");
    assert(
      parseStrings(targetSynthesis.evidenceFactIds).includes(targetStrength.id),
      "Target L3 does not cite the trusted binary-search strength L2.",
    );

    const l2Recall = await semanticAcceptance({
      query: L2_QUERY,
      targetKind: "fact",
      targetId: targetWeakness.id,
      ftsStore,
      vectorStore,
      embedClient,
    });
    const l3Recall = await semanticAcceptance({
      query: L3_QUERY,
      targetKind: "synthesis",
      targetId: targetSynthesis.id,
      ftsStore,
      vectorStore,
      embedClient,
    });

    const contextProblem = await prisma.problem.findFirst({
      where: {
        id: {
          notIn: [
            ...new Set(
              facts.flatMap((fact) =>
                fact.problemId ? [fact.problemId] : [],
              ),
            ),
          ],
        },
      },
      orderBy: { slug: "asc" },
    });
    assert(contextProblem, "No context problem available for hybrid acceptance.");

    const l2Prompt = await briefAndPromptAcceptance({
      prisma,
      user: {
        id: user.id,
        handle: user.handle,
        profile: user.profile,
      },
      problem: contextProblem,
      targetRootMemoryId: targetWeakness.id,
      query: L2_QUERY,
      intent: "debug_followup",
      ftsStore,
      vectorStore,
      embedClient,
    });
    const l3Prompt = await briefAndPromptAcceptance({
      prisma,
      user: {
        id: user.id,
        handle: user.handle,
        profile: user.profile,
      },
      problem: contextProblem,
      targetRootMemoryId: targetSynthesis.id,
      query: L3_QUERY,
      intent: "profile_meta_question",
      ftsStore,
      vectorStore,
      embedClient,
    });

    const embeddingTraceCounts = await prisma.agentTraceEvent.groupBy({
      by: ["model", "responseModel", "status"],
      where: {
        kind: "llm",
        title: "LLM · memory.embed_backfill",
        occurredAt: { gte: startedAt },
      },
      _count: { _all: true },
    });
    assert(
      embeddingTraceCounts.some(
        (row) => row.model === embedClient.model && row.status === "succeeded",
      ),
      "No succeeded real embedding backfill trace was persisted.",
    );

    manifestBody = {
      manifestVersion: 1,
      acceptance: "real_fts_vec_hybrid",
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      database: {
        path: args.dbPath,
        sourceDbSha256,
      },
      process: {
        memoryOrigin: process.env.PATTERNCOACH_MEMORY_ORIGIN,
        localHandle: process.env.PATTERNCOACH_LOCAL_USER_HANDLE,
        targetLearner: user.handle,
      },
      embedding: {
        configured: isEmbeddingConfigured(),
        requestedModel: embedClient.model,
        responseModel: probe?.responseModel ?? embedClient.model,
        configuredDim,
        clientDim: embedClient.dim,
        probeReturnedDim: probeDim,
        probeUsage: probe?.usage ?? null,
        fakeClientUsed: false,
      },
      projection: {
        expectedByKind,
        vectorCounts,
        batches,
        totalEmbeddedThisRun: batches.reduce(
          (sum, batch) => sum + batch.embedded,
          0,
        ),
      },
      recall: {
        l2: {
          targetId: targetWeakness.id,
          targetTag: targetWeakness.tag,
          targetLabel: targetWeakness.label,
          replayProblemCount: readClusterProblemCount(
            targetWeakness.validationJson,
          ),
          ...l2Recall,
        },
        l3: {
          targetId: targetSynthesis.id,
          targetKey: targetSynthesis.synthesisKey,
          targetText: targetSynthesis.text,
          citedFactIds: parseStrings(targetSynthesis.evidenceFactIds),
          ...l3Recall,
        },
      },
      endToEnd: {
        l2: l2Prompt,
        l3: l3Prompt,
      },
      traces: embeddingTraceCounts,
    };
  } finally {
    vectorStore.close();
    ftsStore.close();
    await prisma.$disconnect();
  }

  assert(manifestBody, "Acceptance manifest was not built.");
  const physical = readPhysicalVectorEvidence(args.dbPath);
  for (const kind of ["fact", "episode", "synthesis"] as const) {
    assert(
      (physical.counts[kind] ?? 0) > 0,
      `Physical memory_vec has no ${kind} rows.`,
    );
  }
  assert(
    physical.declaredDim === configuredDim,
    `Physical memory_vec dim ${physical.declaredDim} does not match ${configuredDim}`,
  );
  const checkpointedDbSha256 = await sha256File(args.dbPath);
  const walPath = `${args.dbPath}-wal`;
  const walBytes = await fileSizeOrZero(walPath);
  assert(walBytes === 0, `Staging WAL is not empty after checkpoint: ${walBytes}`);

  const manifest = {
    ...manifestBody,
    database: {
      ...(manifestBody.database as Record<string, unknown>),
      checkpointedDbSha256,
      vectorStorage: {
        sameSqliteFile: true,
        file: args.dbPath,
        walFile: walPath,
        walBytes,
        schemaObjects: physical.schemaObjects,
        declaredDim: physical.declaredDim,
        counts: physical.counts,
      },
    },
  };
  await mkdir(dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        manifestPath: args.outputPath,
        checkpointedDbSha256,
        dimension: configuredDim,
        vectorCounts: physical.counts,
        l2: (manifestBody.recall as Record<string, unknown>).l2,
        l3: (manifestBody.recall as Record<string, unknown>).l3,
        l2PromptReceipt: (
          (manifestBody.endToEnd as Record<string, unknown>)
            .l2 as Record<string, unknown>
        ).providerPromptReceipt,
        l3PromptReceipt: (
          (manifestBody.endToEnd as Record<string, unknown>)
            .l3 as Record<string, unknown>
        ).providerPromptReceipt,
      },
      null,
      2,
    ),
  );
}

async function semanticAcceptance(args: {
  query: string;
  targetKind: "fact" | "synthesis";
  targetId: string;
  ftsStore: ReturnType<typeof createFtsStore>;
  vectorStore: ReturnType<typeof createVectorStore>;
  embedClient: ReturnType<typeof createEmbedClient>;
}) {
  const full = await searchCandidateRanks({
    fts: args.ftsStore,
    query: args.query,
    semanticQuery: args.query,
    vectorStore: args.vectorStore,
    embedClient: args.embedClient,
  });
  const lexicalOnly = await searchCandidateRanks({
    fts: args.ftsStore,
    query: args.query,
    semanticQuery: args.query,
    vectorMode: "disabled",
    vectorStore: args.vectorStore,
    embedClient: args.embedClient,
  });
  const lexicalRanks =
    args.targetKind === "fact" ? full.factRanks : full.synthesisRanks;
  const vectorRanks =
    args.targetKind === "fact"
      ? full.vectorFactRanks
      : full.vectorSynthesisRanks;
  const controlRanks =
    args.targetKind === "fact"
      ? lexicalOnly.factRanks
      : lexicalOnly.synthesisRanks;
  assert(full.mode === "full", `Expected full recall, got ${full.mode}.`);
  assert(
    full.vectorFactRanks.size > 0 && full.vectorSynthesisRanks.size > 0,
    "Full recall did not return both fact and synthesis vector ranks.",
  );
  assert(
    vectorRanks.has(args.targetId),
    `${args.targetKind} target ${args.targetId} was not recalled by vector rank.`,
  );
  assert(
    !lexicalRanks.has(args.targetId),
    `${args.targetKind} target ${args.targetId} also matched lexical rank; cross-semantic control is invalid.`,
  );
  assert(
    lexicalOnly.mode === "lexical_only" && !controlRanks.has(args.targetId),
    `${args.targetKind} lexical-only control unexpectedly recalled the target.`,
  );
  return {
    query: args.query,
    fullMode: full.mode,
    vectorFactRankCount: full.vectorFactRanks.size,
    vectorSynthesisRankCount: full.vectorSynthesisRanks.size,
    targetVectorRank: vectorRanks.get(args.targetId),
    targetLexicalRank: lexicalRanks.get(args.targetId) ?? null,
    lexicalControlMode: lexicalOnly.mode,
    lexicalControlTargetRank: controlRanks.get(args.targetId) ?? null,
    vectorGain: "target_present_only_with_vector",
  };
}

async function briefAndPromptAcceptance(args: {
  prisma: PrismaClient;
  user: {
    id: string;
    handle: string;
    profile: {
      displayName: string;
      strongPatterns: string;
      weakPatterns: string;
      outputPreferences: string;
    } | null;
  };
  problem: {
    id: string;
    slug: string;
    title: string;
    leetcodeNumber: number | null;
    tags: string;
    methodName: string;
  };
  targetRootMemoryId: string;
  query: string;
  intent: "debug_followup" | "profile_meta_question";
  ftsStore: ReturnType<typeof createFtsStore>;
  vectorStore: ReturnType<typeof createVectorStore>;
  embedClient: ReturnType<typeof createEmbedClient>;
}) {
  const traceRunId = randomUUID();
  await args.prisma.agentTraceRun.create({
    data: {
      id: traceRunId,
      userId: args.user.id,
      problemId: args.problem.id,
      path: "chat",
      actionKind: `vector_acceptance.${args.intent}`,
      status: "running",
      traceCompleteness: "open",
      processInstanceId:
        process.env.PATTERNCOACH_LOCAL_USER_HANDLE ?? "vector-acceptance",
      memoryOrigin: "learner",
    },
  });
  const traceContext = createTraceContext({
    prisma: args.prisma,
    userId: args.user.id,
    problemId: args.problem.id,
    traceRunId,
    path: "chat",
    task: `vector_acceptance.${args.intent}`,
    captureLevel: "full",
    bufferedRecorder: false,
    memoryOrigin: "learner",
  });
  let succeeded = false;
  try {
    const assembly = await buildCoachMemoryContext(args.prisma, {
      userId: args.user.id,
      problemId: args.problem.id,
      problemTags: [],
      queryText: args.query,
      entry: { kind: "chat", intent: args.intent },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: args.ftsStore,
      vectorStore: args.vectorStore,
      embedClient: args.embedClient,
      traceContext,
    });
    const targetCandidates = assembly.candidates.filter(
      (candidate) => candidate.id === args.targetRootMemoryId,
    );
    assert(
      targetCandidates.length === 1,
      `Expected one hydrated root ${args.targetRootMemoryId}, got ${targetCandidates.length}.`,
    );
    assert(
      targetCandidates[0].retrievalSignals.vectorRank !== undefined,
      `Root ${args.targetRootMemoryId} lost its vectorRank during hydration.`,
    );
    assert(
      assembly.decisions.some(
        (decision) =>
          decision.candidateId === args.targetRootMemoryId && decision.selected,
      ),
      `Root ${args.targetRootMemoryId} did not enter CoachMemoryBrief.`,
    );
    assert(
      assembly.brief.teachableMemories.length > 0 &&
        assembly.brief.teachableMemories.length <= 2,
      `Brief cue count is ${assembly.brief.teachableMemories.length}.`,
    );
    assert(
      assembly.brief.retrievalStatus === "full",
      `Brief retrieval status is ${assembly.brief.retrievalStatus}.`,
    );
    const expectedReceipt = buildMemoryPromptReceipt(assembly.brief);
    const provider = getCoachProvider();
    const result = await provider.chat({
      problem: {
        slug: args.problem.slug,
        title: args.problem.title,
        leetcodeNumber: args.problem.leetcodeNumber,
        tags: parseStrings(args.problem.tags),
        methodName: args.problem.methodName,
      },
      user: {
        displayName: args.user.profile?.displayName ?? args.user.handle,
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      memory: assembly.brief,
      messages: [{ role: "user", content: args.query }],
      responseLanguage: "zh",
      thinking: false,
      toolMode: "finalize_without_tools",
      tools: [],
      traceContext,
    });
    assert(result.type === "final", `Provider returned ${result.type}.`);

    const llmEvent = await args.prisma.agentTraceEvent.findFirst({
      where: { traceRunId, kind: "llm", status: "succeeded" },
      include: { payload: true },
      orderBy: { occurredAt: "desc" },
    });
    assert(llmEvent?.payload, "Provider LLM trace payload is missing.");
    const detailMetadata = parseRecord(llmEvent.payload.detailMetadataJson);
    const providerReceipt = parseRecord(detailMetadata.memoryPromptReceipt);
    assert(
      JSON.stringify(providerReceipt) === JSON.stringify(expectedReceipt),
      "Provider prompt receipt does not match the selected brief.",
    );
    const promptJson = llmEvent.payload.promptJson ?? "";
    for (const memory of assembly.brief.teachableMemories) {
      assert(
        promptJson.includes(memory.cue),
        "Selected memory cue is absent from the captured provider prompt.",
      );
    }
    const output = parseRecord(llmEvent.payload.outputJson);
    const rawResponse = parseRecord(output.rawResponse);
    succeeded = true;
    return {
      traceRunId,
      selectedRootMemoryId: args.targetRootMemoryId,
      hydratedCandidateCount: targetCandidates.length,
      targetVectorRank: targetCandidates[0].retrievalSignals.vectorRank,
      targetLexicalRank:
        targetCandidates[0].retrievalSignals.lexicalRank ?? null,
      cueCount: assembly.brief.teachableMemories.length,
      cues: assembly.brief.teachableMemories.map((memory) => memory.cue),
      retrievalStatus: assembly.brief.retrievalStatus,
      retrievalPromptReceipt: expectedReceipt,
      providerPromptReceipt: providerReceipt,
      promptContainsEveryCue: true,
      providerModel: llmEvent.model,
      responseModel: llmEvent.responseModel,
      providerCallId:
        typeof rawResponse.id === "string" ? rawResponse.id : null,
      providerResultType: result.type,
      visibleReply: result.coachReply,
      fakeProviderUsed: false,
    };
  } finally {
    await finalizeTraceRun(args.prisma, {
      traceRunId,
      status: succeeded ? "succeeded" : "failed",
      traceCompleteness: succeeded ? "complete" : "degraded",
      endedAt: new Date(),
      traceOverheadMs: 0,
    });
  }
}

function readPhysicalVectorEvidence(dbPath: string) {
  const db = new Database(dbPath);
  sqliteVec.load(db as unknown as Parameters<typeof sqliteVec.load>[0]);
  try {
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
    const rows = db
      .prepare("SELECT kind, COUNT(*) AS count FROM memory_vec GROUP BY kind ORDER BY kind")
      .all() as Array<{ kind: string; count: number }>;
    const schemaRows = db
      .prepare(
        "SELECT name, type, sql FROM sqlite_master WHERE name LIKE 'memory_vec%' ORDER BY name",
      )
      .all() as Array<{ name: string; type: string; sql: string | null }>;
    const memoryVecSql = schemaRows.find((row) => row.name === "memory_vec")?.sql;
    const dimMatch = memoryVecSql?.match(/embedding\s+float\[(\d+)\]/i);
    return {
      counts: Object.fromEntries(rows.map((row) => [row.kind, row.count])),
      declaredDim: dimMatch ? Number.parseInt(dimMatch[1], 10) : null,
      schemaObjects: schemaRows.map((row) => ({
        name: row.name,
        type: row.type,
      })),
    };
  } finally {
    db.close();
  }
}

function assertSafeAcceptanceProcess(args: CliArgs) {
  const livePath = resolve(process.cwd(), "dev.db");
  if (resolve(args.dbPath) === livePath) {
    throw new Error("Vector acceptance refuses workspace dev.db.");
  }
  if (process.env.PATTERNCOACH_MEMORY_ORIGIN !== "learner") {
    throw new Error("Vector acceptance requires PATTERNCOACH_MEMORY_ORIGIN=learner.");
  }
  const localHandle = process.env.PATTERNCOACH_LOCAL_USER_HANDLE?.trim();
  if (!localHandle || localHandle === "Iris904") {
    throw new Error("Vector acceptance requires an explicit non-Iris local handle.");
  }
  if (!isEmbeddingConfigured()) {
    throw new Error("Vector acceptance requires EMBEDDING_API_KEY.");
  }
  if (process.env.COACH_PROVIDER === "mock") {
    throw new Error("Vector acceptance refuses COACH_PROVIDER=mock.");
  }
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(`Invalid argument near ${flag ?? "<end>"}.`);
    }
    values.set(flag, value);
  }
  const dbPath = values.get("--db");
  const userHandle = values.get("--user");
  const outputPath = values.get("--out");
  const batchSize = Number.parseInt(values.get("--batch-size") ?? "10", 10);
  if (!dbPath || !userHandle || !outputPath) {
    throw new Error(
      "Usage: --db <isolated.db> --user <handle> --out <manifest.json> [--batch-size 10]",
    );
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("--batch-size must be a positive integer.");
  }
  return {
    dbPath: resolve(dbPath),
    userHandle,
    outputPath: resolve(outputPath),
    batchSize,
  };
}

function parseStrings(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readClusterProblemCount(validationJson: string) {
  const validation = parseRecord(validationJson);
  const integrity = parseRecord(validation.integrity);
  const clusters = Array.isArray(integrity.evidenceClusters)
    ? integrity.evidenceClusters.map(parseRecord)
    : [];
  return new Set(
    clusters
      .map((cluster) => cluster.problemId)
      .filter((value): value is string => typeof value === "string"),
  ).size;
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sha256File(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileSizeOrZero(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

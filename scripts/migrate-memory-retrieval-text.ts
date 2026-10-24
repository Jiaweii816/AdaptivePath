import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { createChatClient } from "@/server/llm/client";
import { getChatThinkingModel } from "@/server/llm/models";
import {
  isTrustedL2FactForConsumption,
  readDurableFactIntegrity,
} from "@/server/memory/integrity/memory-integrity-policy";
import {
  RETRIEVAL_TEXT_VERSION,
  buildRetrievalTextPrompt,
  deterministicRetrievalText,
  retrievalTextInputHash,
  validateRetrievalText,
  type RetrievalTextSource,
} from "@/server/memory/retrieval-text/retrieval-text";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";

type Layer = "episode" | "l2" | "l3" | "all";
type Writer = "llm" | "deterministic" | "artifact";
type Args = {
  dbPath: string;
  userHandle: string;
  outputPath: string;
  apply: boolean;
  batchSize: number;
  limit?: number;
  layer: Layer;
  writer: Writer;
  model?: string;
  artifactPath?: string;
};

type RowResult = {
  layer: Exclude<Layer, "all">;
  sourceId: string;
  state: "ready" | "skipped" | "failed";
  reason?: string;
  inputHash: string;
  writer?: string;
  retrievalText?: string;
  evidenceSourceIds: string[];
};

/**
 * Backfills source-owned retrieval prose in dependency order. It intentionally
 * refuses dev.db: the real learner database needs an explicit backup/cutover
 * run owned by the caller, while this script is designed for an isolated copy.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseWorkspaceLearnerDatabase(args.dbPath);
  if (args.apply && process.env.PATTERNCOACH_MEMORY_ORIGIN !== "learner") {
    throw new Error(
      "--apply requires PATTERNCOACH_MEMORY_ORIGIN=learner on an isolated database.",
    );
  }
  const sourceSha256 = await sha256File(args.dbPath);
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${args.dbPath}` }),
    log: ["error"],
  });
  const startedAt = new Date();
  try {
    const user = await prisma.user.findUnique({
      where: { handle: args.userHandle },
      select: { id: true, handle: true },
    });
    if (!user) throw new Error(`User handle not found: ${args.userHandle}.`);
    const rewriter = await createRewriter(args);
    const results: RowResult[] = [];
    const virtualEpisodeText = new Map<string, string>();
    const virtualFactText = new Map<string, string>();
    if (args.layer === "all" || args.layer === "episode") {
      const phase = await migrateEpisodes(prisma, user.id, args, rewriter);
      results.push(...phase);
      recordReadyText(virtualEpisodeText, phase);
    }
    if (args.layer === "all" || args.layer === "l2") {
      const phase = await migrateFacts(
        prisma,
        user.id,
        args,
        rewriter,
        virtualEpisodeText,
      );
      results.push(...phase);
      recordReadyText(virtualFactText, phase);
    }
    if (args.layer === "all" || args.layer === "l3") {
      results.push(
        ...(await migrateSlots(
          prisma,
          user.id,
          args,
          rewriter,
          virtualFactText,
        )),
      );
    }
    if (args.apply)
      await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const targetSha256 = await sha256File(args.dbPath);
    const grouped = groupResults(results);
    const manifest = {
      manifestVersion: 1,
      retrievalTextVersion: RETRIEVAL_TEXT_VERSION,
      mode: args.apply ? "apply" : "dry-run",
      writer: rewriter.name,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      database: { path: args.dbPath, sourceSha256, targetSha256 },
      learner: user,
      requestedLayer: args.layer,
      summary: grouped.summary,
      results: grouped.byLayer,
      samples: results.filter((result) => result.state === "ready").slice(0, 5),
      failures: results.filter((result) => result.state === "failed"),
    };
    await mkdir(dirname(args.outputPath), { recursive: true });
    await writeFile(args.outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      JSON.stringify(
        {
          manifestPath: args.outputPath,
          ...manifest.summary,
          sourceSha256,
          targetSha256,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

type Rewriter = {
  name: string;
  acceptsSourceId?(sourceId: string): boolean;
  accepts?(source: RetrievalTextSource): boolean;
  rewrite(source: RetrievalTextSource): Promise<string>;
};

async function createRewriter(args: Args): Promise<Rewriter> {
  if (args.writer === "deterministic") {
    return {
      name: "deterministic-explicit-fallback",
      rewrite: async (source) => deterministicRetrievalText(source),
    };
  }
  if (args.writer === "artifact") {
    if (!args.artifactPath) {
      throw new Error("--writer artifact requires --artifact <cards.json>.");
    }
    const artifact = parseArtifact(
      JSON.parse(await readFile(args.artifactPath, "utf8")),
    );
    return {
      name: `artifact:${args.artifactPath}`,
      acceptsSourceId: (sourceId) => artifact.has(sourceId),
      accepts: (source) => artifact.has(source.sourceId),
      async rewrite(source) {
        const card = artifact.get(source.sourceId);
        if (!card) throw new Error("artifact_missing_source_id");
        if (card.inputHash !== retrievalTextInputHash(source)) {
          throw new Error("artifact_input_hash_mismatch");
        }
        const retrievalText = validateRetrievalText(card.retrievalText);
        if (!retrievalText) throw new Error("artifact_invalid_retrieval_text");
        return retrievalText;
      },
    };
  }
  const client = createChatClient();
  const model =
    args.model ??
    process.env.LLM_RETRIEVAL_TEXT_MODEL ??
    getChatThinkingModel();
  return {
    name: `llm:${model}`,
    async rewrite(source) {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a careful memory editor. Return only the requested JSON object.",
          },
          { role: "user", content: buildRetrievalTextPrompt(source) },
        ],
      });
      const raw = completion.choices[0]?.message.content;
      const parsed = raw ? parseJsonObject(raw) : undefined;
      const text =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? validateRetrievalText(
              (parsed as { retrievalText?: unknown }).retrievalText,
            )
          : undefined;
      if (!text) throw new Error("LLM returned invalid retrievalText.");
      return text;
    },
  };
}

async function migrateEpisodes(
  prisma: PrismaClient,
  userId: string,
  args: Args,
  rewriter: Rewriter,
) {
  const rows = await prisma.memoryEpisode.findMany({
    where: { userId, memoryOrigin: "learner" },
    include: { problem: { select: { title: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  const results: RowResult[] = [];
  for (const batch of chunks(
    args.limit ? rows.slice(0, args.limit) : rows,
    args.batchSize,
  )) {
    results.push(
      ...(await Promise.all(
        batch.map(async (row) => {
          const source: RetrievalTextSource = {
            layer: "episode",
            sourceId: row.id,
            sourceText: compact([
              row.problem
                ? `Problem: ${row.problem.title} (${row.problem.slug}).`
                : "Problem was not retained.",
              `Episode title: ${row.title}`,
              `Summary: ${row.summary}`,
              `Outcome: ${row.outcome}`,
            ]),
          };
          return processRow({
            layer: "episode",
            source,
            existing: row,
            evidenceSourceIds: [],
            rewriter,
            apply: args.apply,
            write: (data) =>
              prisma.memoryEpisode.update({ where: { id: row.id }, data }),
          });
        }),
      )),
    );
  }
  return results;
}

async function migrateFacts(
  prisma: PrismaClient,
  userId: string,
  args: Args,
  rewriter: Rewriter,
  virtualEpisodeText: ReadonlyMap<string, string>,
) {
  const [facts, episodes] = await Promise.all([
    prisma.l2MemoryFact.findMany({
      where: {
        userId,
        memoryOrigin: "learner",
        status: { in: ["active", "improving"] },
      },
      include: { problem: { select: { title: true, slug: true } } },
      orderBy: { lastSeenAt: "asc" },
    }),
    prisma.memoryEpisode.findMany({
      // Include unpersisted rows too: dry-run carries this phase's proposed
      // text in virtualEpisodeText so L2 sees the same dependency graph as apply.
      where: { userId, memoryOrigin: "learner" },
      select: {
        id: true,
        activityClusterId: true,
        activityCluster: { select: { rootReviewAttemptId: true } },
        retrievalText: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const results: RowResult[] = [];
  const eligibleFacts = facts.filter(isTrustedL2FactForConsumption);
  for (const batch of chunks(
    args.limit ? eligibleFacts.slice(0, args.limit) : eligibleFacts,
    args.batchSize,
  )) {
    results.push(
      ...(await Promise.all(
        batch.map(async (row) => {
          const evidenceClusters =
            readDurableFactIntegrity(row.validationJson)?.evidenceClusters ??
            [];
          const evidenceClusterIds = new Set(
            evidenceClusters.map((cluster) => cluster.key),
          );
          const evidenceReviewIds = new Set(
            evidenceClusters.flatMap((cluster) =>
              cluster.reviewAttemptId ? [cluster.reviewAttemptId] : [],
            ),
          );
          // Only matching evidence lineage may enrich an L2 search text. Sharing
          // a problem alone does not prove that an Episode supports this Fact.
          const representative = episodes
            .filter(
              (episode) =>
                (episode.activityClusterId &&
                  evidenceClusterIds.has(episode.activityClusterId)) ||
                (episode.activityCluster?.rootReviewAttemptId &&
                  evidenceReviewIds.has(
                    episode.activityCluster.rootReviewAttemptId,
                  )),
            )
            .slice(0, 3);
          const source: RetrievalTextSource = {
            layer: "l2_fact",
            sourceId: row.id,
            sourceText: compact([
              `Claim: ${row.claimText ?? row.label ?? row.value ?? "Learner memory fact."}`,
              row.polarity ? `Observed direction: ${row.polarity}.` : "",
              row.lastEvidenceSummary
                ? `Latest evidence summary: ${row.lastEvidenceSummary}`
                : "",
              row.problem
                ? `Associated problem: ${row.problem.title} (${row.problem.slug}).`
                : "",
            ]),
            representativeEvidence: representative.flatMap((episode) => {
              const retrievalText =
                virtualEpisodeText.get(episode.id) ?? episode.retrievalText;
              return retrievalText ? [`Related episode: ${retrievalText}`] : [];
            }),
          };
          return processRow({
            layer: "l2",
            source,
            existing: row,
            evidenceSourceIds: representative.map((episode) => episode.id),
            rewriter,
            apply: args.apply,
            write: (data) =>
              prisma.l2MemoryFact.update({ where: { id: row.id }, data }),
          });
        }),
      )),
    );
  }
  return results;
}

async function migrateSlots(
  prisma: PrismaClient,
  userId: string,
  args: Args,
  rewriter: Rewriter,
  virtualFactText: ReadonlyMap<string, string>,
) {
  const [slots, facts] = await Promise.all([
    prisma.synthesisSlot.findMany({
      where: { userId, memoryOrigin: "learner", status: "active" },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.l2MemoryFact.findMany({
      where: { userId, memoryOrigin: "learner" },
      select: { id: true, retrievalText: true },
    }),
  ]);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const results: RowResult[] = [];
  for (const batch of chunks(
    args.limit ? slots.slice(0, args.limit) : slots,
    args.batchSize,
  )) {
    results.push(
      ...(await Promise.all(
        batch.map(async (row) => {
          if (rewriter.acceptsSourceId && !rewriter.acceptsSourceId(row.id)) {
            return {
              layer: "l3",
              sourceId: row.id,
              state: "skipped",
              reason: "not_selected_by_artifact",
              inputHash: "",
              evidenceSourceIds: [],
            } as RowResult;
          }
          const cited = parseStrings(row.evidenceFactIds).flatMap((id) => {
            const fact = factById.get(id);
            const retrievalText = fact
              ? (virtualFactText.get(id) ?? fact.retrievalText)
              : undefined;
            return retrievalText ? [{ id, text: retrievalText }] : [];
          });
          if (cited.length === 0) {
            return {
              layer: "l3",
              sourceId: row.id,
              state: "failed",
              reason: "no_migrated_cited_l2_retrieval_text",
              inputHash: "",
              evidenceSourceIds: [],
            } as RowResult;
          }
          const source: RetrievalTextSource = {
            layer: "l3_synthesis",
            sourceId: row.id,
            sourceText: compact([
              `Synthesis slot: ${row.slot}.`,
              `Existing synthesis: ${row.text}`,
            ]),
            representativeEvidence: cited.map(
              (fact) => `Cited learner pattern: ${fact.text}`,
            ),
          };
          return processRow({
            layer: "l3",
            source,
            existing: row,
            evidenceSourceIds: cited.map((fact) => fact.id),
            rewriter,
            apply: args.apply,
            write: (data) =>
              prisma.synthesisSlot.update({ where: { id: row.id }, data }),
          });
        }),
      )),
    );
  }
  return results;
}

async function processRow(args: {
  layer: Exclude<Layer, "all">;
  source: RetrievalTextSource;
  existing: {
    retrievalText: string | null;
    retrievalTextVersion: number;
    retrievalInputHash: string | null;
  };
  evidenceSourceIds: string[];
  rewriter: Rewriter;
  apply: boolean;
  write: (data: {
    retrievalText: string;
    retrievalTextVersion: number;
    retrievalInputHash: string;
  }) => Promise<unknown>;
}): Promise<RowResult> {
  const inputHash = retrievalTextInputHash(args.source);
  if (args.rewriter.accepts && !args.rewriter.accepts(args.source)) {
    return {
      layer: args.layer,
      sourceId: args.source.sourceId,
      state: "skipped",
      reason: "not_selected_by_artifact",
      inputHash,
      evidenceSourceIds: args.evidenceSourceIds,
    };
  }
  if (
    args.existing.retrievalText &&
    args.existing.retrievalTextVersion === RETRIEVAL_TEXT_VERSION &&
    args.existing.retrievalInputHash === inputHash
  ) {
    return {
      layer: args.layer,
      sourceId: args.source.sourceId,
      state: "skipped",
      reason: "current_version_and_input_hash",
      inputHash,
      evidenceSourceIds: args.evidenceSourceIds,
    };
  }
  try {
    const retrievalText = await args.rewriter.rewrite(args.source);
    if (args.apply)
      await args.write({
        retrievalText,
        retrievalTextVersion: RETRIEVAL_TEXT_VERSION,
        retrievalInputHash: inputHash,
      });
    return {
      layer: args.layer,
      sourceId: args.source.sourceId,
      state: "ready",
      inputHash,
      writer: args.rewriter.name,
      retrievalText,
      evidenceSourceIds: args.evidenceSourceIds,
    };
  } catch (error) {
    return {
      layer: args.layer,
      sourceId: args.source.sourceId,
      state: "failed",
      reason: error instanceof Error ? error.message : String(error),
      inputHash,
      evidenceSourceIds: args.evidenceSourceIds,
    };
  }
}

function groupResults(results: RowResult[]) {
  const byLayer = Object.fromEntries(
    ["episode", "l2", "l3"].map((layer) => [
      layer,
      results.filter((result) => result.layer === layer),
    ]),
  );
  const count = (state: RowResult["state"]) =>
    results.filter((result) => result.state === state).length;
  return {
    byLayer,
    summary: {
      total: results.length,
      eligible: count("ready"),
      skipped: count("skipped"),
      failed: count("failed"),
    },
  };
}

function recordReadyText(target: Map<string, string>, results: RowResult[]) {
  for (const result of results) {
    if (result.state === "ready" && result.retrievalText) {
      target.set(result.sourceId, result.retrievalText);
    }
  }
}

function parseArgs(argv: string[]): Args {
  let db: string | undefined;
  let userHandle: string | undefined;
  let out: string | undefined;
  let apply = false;
  let batchSize = 10;
  let limit: number | undefined;
  let layer: Layer = "all";
  let writer: Writer | undefined;
  let model: string | undefined;
  let artifactPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value.`);
    if (arg === "--db") db = value;
    else if (arg === "--user") userHandle = value;
    else if (arg === "--out") out = value;
    else if (arg === "--batch-size") batchSize = Number(value);
    else if (arg === "--limit") limit = Number(value);
    else if (
      arg === "--layer" &&
      ["episode", "l2", "l3", "all"].includes(value)
    )
      layer = value as Layer;
    else if (
      arg === "--writer" &&
      ["llm", "deterministic", "artifact"].includes(value)
    )
      writer = value as Writer;
    else if (arg === "--model") model = value;
    else if (arg === "--artifact") artifactPath = resolve(value);
    else throw new Error(`Unknown or invalid argument: ${arg}`);
    index += 1;
  }
  if (!db || !userHandle || !out || !writer)
    throw new Error(
      "Usage: --db <isolated.sqlite> --user <handle> --out <manifest.json> --writer llm|deterministic|artifact [--artifact <cards.json>] [--apply] [--model <model>] [--layer episode|l2|l3|all] [--batch-size N] [--limit N]",
    );
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error("--batch-size must be an integer from 1 to 100.");
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error("--limit must be a positive integer.");
  return {
    dbPath: resolveSqliteFilePath(db, process.cwd()),
    userHandle,
    outputPath: resolve(out),
    apply,
    batchSize,
    limit,
    layer,
    writer,
    model,
    artifactPath,
  };
}

function refuseWorkspaceLearnerDatabase(dbPath: string) {
  const live = resolve(process.cwd(), "dev.db");
  if (resolve(dbPath) === live)
    throw new Error(
      `Retrieval-text migration refuses workspace learner database: ${live}. Use an isolated snapshot.`,
    );
}

function parseJsonObject(value: string) {
  const unfenced = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(unfenced) as unknown;
}

function parseArtifact(value: unknown) {
  const cards = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { cards?: unknown }).cards)
      ? (value as { cards: unknown[] }).cards
      : undefined;
  if (!cards) {
    throw new Error("artifact must be an array or { cards: [...] }.");
  }
  const indexed = new Map<
    string,
    { inputHash: string; retrievalText: unknown }
  >();
  for (const card of cards) {
    if (!card || typeof card !== "object" || Array.isArray(card)) continue;
    const sourceId = (card as { sourceId?: unknown }).sourceId;
    const inputHash = (card as { inputHash?: unknown }).inputHash;
    if (typeof sourceId === "string" && typeof inputHash === "string") {
      indexed.set(sourceId, {
        inputHash,
        retrievalText: (card as { retrievalText?: unknown }).retrievalText,
      });
    }
  }
  return indexed;
}
function compact(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.replace(/\s+/g, " ").trim()),
    ),
  ];
}
function parseStrings(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}
async function sha256File(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

void main();

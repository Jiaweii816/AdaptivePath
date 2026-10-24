import { createRequire } from "node:module";
import { loadLocalEnv } from "@/lib/env";
import {
  assertSafeDatabaseForProcess,
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import type { MemoryDocumentKind } from "./fts-store";

// vec0 virtual tables are not Prisma-owned. Relational tables remain the source
// of truth, and this index can be rebuilt at any time.
const require = createRequire(import.meta.url);
// Next/Turbopack rewrites the ESM build of sqlite-vec and drops
// import.meta.resolve. The package's CJS entrypoint uses require.resolve and
// remains a true runtime dependency, matching better-sqlite3 below.
const sqliteVec = require("sqlite-vec") as typeof import("sqlite-vec");

type SqliteRunResult = {
  lastInsertRowid: number | bigint;
};

type SqliteStatement = {
  run: (...args: unknown[]) => SqliteRunResult;
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const Database = require("better-sqlite3") as SqliteConstructor;

export type VectorHit = {
  refId: string;
  kind: MemoryDocumentKind;
  distance: number;
};

export type VectorStore = {
  dim: number;
  upsertEmbedding: (doc: {
    kind: MemoryDocumentKind;
    refId: string;
    embedding: number[];
    contentHash?: string;
    embeddingModel?: string;
    learnerId?: string;
  }) => void;
  removeEmbedding: (refId: string) => void;
  listProjectionState: (kind?: MemoryDocumentKind) => Array<{
    refId: string;
    kind: MemoryDocumentKind;
    contentHash: string;
    embeddingModel: string;
    learnerId: string;
  }>;
  reconcileProjectionRefs: (args: {
    kind: MemoryDocumentKind;
    refIds: string[];
    learnerId?: string;
  }) => { removed: number };
  searchSimilar: (
    embedding: number[],
    options: { kind?: MemoryDocumentKind; learnerId?: string; limit: number },
  ) => VectorHit[];
  close: () => void;
};

export function createVectorStore(dbFilePath: string, dim: number): VectorStore {
  const db = new Database(dbFilePath);
  db.exec("PRAGMA journal_mode = WAL;");
  sqliteVec.load(db as unknown as Parameters<typeof sqliteVec.load>[0]);

  const existingVecColumns = db.prepare("PRAGMA table_info(memory_vec)").all() as Array<{ name: string }>;
  if (
    existingVecColumns.length > 0 &&
    !existingVecColumns.some((column) => column.name === "learner_id")
  ) {
    db.exec("DROP TABLE memory_vec; DROP TABLE IF EXISTS memory_vec_map; DROP TABLE IF EXISTS memory_vec_projection;");
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
    embedding float[${dim}] distance_metric=cosine,
    +kind text,
    +ref_id text,
    +learner_id text
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS memory_vec_map (
    ref_id TEXT PRIMARY KEY,
    vec_rowid INTEGER NOT NULL
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS memory_vec_projection (
    ref_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    learner_id TEXT NOT NULL DEFAULT '',
    embedded_at TEXT NOT NULL
  );`);

  const findRowid = db.prepare("SELECT vec_rowid FROM memory_vec_map WHERE ref_id = ?");
  const deleteVec = db.prepare("DELETE FROM memory_vec WHERE rowid = ?");
  const deleteMap = db.prepare("DELETE FROM memory_vec_map WHERE ref_id = ?");
  const deleteProjection = db.prepare(
    "DELETE FROM memory_vec_projection WHERE ref_id = ?",
  );
  const upsertProjection = db.prepare(`INSERT INTO memory_vec_projection
    (ref_id, kind, content_hash, embedding_model, learner_id, embedded_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref_id) DO UPDATE SET
      kind = excluded.kind,
      content_hash = excluded.content_hash,
      embedding_model = excluded.embedding_model,
      learner_id = excluded.learner_id,
      embedded_at = excluded.embedded_at`);
  const listProjection = db.prepare(`SELECT ref_id, kind, content_hash, embedding_model, learner_id
    FROM memory_vec_projection`);
  const listProjectionByKind = db.prepare(`SELECT ref_id, kind, content_hash, embedding_model, learner_id
    FROM memory_vec_projection WHERE kind = ?`);
  const listProjectionByKindAndLearner = db.prepare(`SELECT ref_id, kind, content_hash, embedding_model, learner_id
    FROM memory_vec_projection WHERE kind = ? AND learner_id = ?`);
  const insertVec = db.prepare(
    "INSERT INTO memory_vec (embedding, kind, ref_id, learner_id) VALUES (?, ?, ?, ?)",
  );
  const insertMap = db.prepare(
    "INSERT INTO memory_vec_map (ref_id, vec_rowid) VALUES (?, ?)",
  );
  const countVectors = db.prepare("SELECT count(*) AS count FROM memory_vec");
  const knn = db.prepare(`SELECT ref_id, kind, learner_id, distance
    FROM memory_vec
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance`);

  function remove(refId: string) {
    const row = findRowid.get(refId) as { vec_rowid: number } | undefined;
    deleteProjection.run(refId);
    if (!row) {
      return;
    }

    deleteVec.run(row.vec_rowid);
    deleteMap.run(refId);
  }

  return {
    dim,
    upsertEmbedding(doc) {
      if (doc.embedding.length !== dim) {
        throw new Error(
          `vector-store: embedding dim ${doc.embedding.length} does not match index dim ${dim}`,
        );
      }

      remove(doc.refId);
      const learnerId = doc.learnerId ?? "";
      const result = insertVec.run(JSON.stringify(doc.embedding), doc.kind, doc.refId, learnerId);
      insertMap.run(doc.refId, Number(result.lastInsertRowid));
      if (doc.contentHash && doc.embeddingModel) {
        upsertProjection.run(
          doc.refId,
          doc.kind,
          doc.contentHash,
          doc.embeddingModel,
          learnerId,
          new Date().toISOString(),
        );
      }
    },
    removeEmbedding: remove,
    listProjectionState(kind) {
      const rows = (kind
        ? listProjectionByKind.all(kind)
        : listProjection.all()) as Array<{
        ref_id: string;
        kind: MemoryDocumentKind;
        content_hash: string;
        embedding_model: string;
        learner_id: string;
      }>;
      return rows.map((row) => ({
        refId: row.ref_id,
        kind: row.kind,
        contentHash: row.content_hash,
        embeddingModel: row.embedding_model,
        learnerId: row.learner_id,
      }));
    },
    reconcileProjectionRefs(args) {
      const desired = new Set(args.refIds);
      const stale = ((args.learnerId !== undefined
        ? listProjectionByKindAndLearner.all(args.kind, args.learnerId)
        : listProjectionByKind.all(args.kind)) as Array<{
        ref_id: string;
      }>).filter((row) => !desired.has(row.ref_id));
      for (const row of stale) remove(row.ref_id);
      return { removed: stale.length };
    },
    searchSimilar(embedding, options) {
      if (embedding.length !== dim) {
        throw new Error(
          `vector-store: query dim ${embedding.length} does not match index dim ${dim}`,
        );
      }

      // sqlite-vec does not permit constraints on auxiliary columns in a KNN
      // WHERE clause. Query the complete local projection, then owner/kind
      // filter before LIMIT. This prevents a different learner's nearer rows
      // from crowding the requested learner out of the pre-hydration pool.
      const total = countVectors.get() as { count: number };
      const k = Math.max(0, Number(total.count));
      if (k <= 0) {
        return [];
      }

      const rows = knn.all(JSON.stringify(embedding), k) as Array<{
        ref_id: string;
        kind: MemoryDocumentKind;
        learner_id: string;
        distance: number;
      }>;
      const hits = rows
        .filter((row) => !options.kind || row.kind === options.kind)
        .filter(
          (row) =>
            options.learnerId === undefined ||
            row.learner_id === options.learnerId,
        )
        .map((row) => ({
          refId: row.ref_id,
          kind: row.kind,
          distance: row.distance,
        }));
      return hits.slice(0, options.limit);
    },
    close() {
      db.close();
    },
  };
}

let defaultStore: VectorStore | undefined;

export function getDefaultVectorStore(dim: number): VectorStore | undefined {
  loadLocalEnv();
  assertSafeDatabaseForProcess({
    configuredDatabaseUrl: process.env.DATABASE_URL,
  });
  if (!process.env.EMBEDDING_API_KEY?.trim()) {
    return undefined;
  }

  if (!defaultStore) {
    const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const dbFilePath = resolveSqliteFilePath(url);
    defaultStore = createVectorStore(dbFilePath, dim);
  }

  return defaultStore;
}

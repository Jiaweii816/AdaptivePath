import { createRequire } from "node:module";
import { loadLocalEnv } from "@/lib/env";
import {
  assertSafeDatabaseForProcess,
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";

// FTS5 virtual tables are not Prisma-owned. Relational tables remain the source
// of truth, and this index can be rebuilt at any time.
const require = createRequire(import.meta.url);

type SqliteStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const Database = require("better-sqlite3") as SqliteConstructor;

export type MemoryDocumentKind =
  | "episode"
  | "fact"
  | "claim_cluster"
  | "synthesis"
  | "problem_history"
  | "kb"
  | "knowledge_note"
  | "mistake_book"
  /** Isolated, rebuildable Coach learning-experience Pilot projection. */
  | "learning_experience_card";

export type FtsHit = {
  refId: string;
  kind: MemoryDocumentKind;
  rank: number;
};

export type FtsStore = {
  indexMemoryDocument: (doc: {
    kind: MemoryDocumentKind;
    refId: string;
    content: string;
    learnerId?: string;
  }) => void;
  removeMemoryDocument: (refId: string) => void;
  reconcileMemoryDocuments: (args: {
    kind: MemoryDocumentKind;
    documents: Array<{ refId: string; content: string }>;
    learnerId?: string;
  }) => { indexed: number; removed: number };
  searchMemoryFts: (
    query: string,
    options: { kind?: MemoryDocumentKind; learnerId?: string; limit: number },
  ) => FtsHit[];
  close: () => void;
};

export function createFtsStore(dbFilePath: string): FtsStore {
  const db = new Database(dbFilePath);

  db.exec("PRAGMA journal_mode = WAL;");
  const existingFtsColumns = db.prepare("PRAGMA table_info(memory_fts)").all() as Array<{ name: string }>;
  if (
    existingFtsColumns.length > 0 &&
    !existingFtsColumns.some((column) => column.name === "learner_id")
  ) {
    // The FTS table is a rebuildable projection. Recreate the legacy global
    // index once so owner filtering happens before LIMIT, not after hydration.
    db.exec("DROP TABLE memory_fts;");
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    content,
    kind UNINDEXED,
    ref_id UNINDEXED,
    learner_id UNINDEXED,
    tokenize = 'unicode61'
  );`);

  const deleteByRefId = db.prepare("DELETE FROM memory_fts WHERE ref_id = ?");
  const deleteByKindAndRefId = db.prepare(
    "DELETE FROM memory_fts WHERE kind = ? AND ref_id = ? AND learner_id = ?",
  );
  const listRefsByKind = db.prepare(
    "SELECT ref_id FROM memory_fts WHERE kind = ? AND learner_id = ?",
  );
  const insertDocument = db.prepare(
    "INSERT INTO memory_fts (content, kind, ref_id, learner_id) VALUES (?, ?, ?, ?)",
  );
  const searchAll = db.prepare(`SELECT ref_id, kind, bm25(memory_fts) AS rank
    FROM memory_fts
    WHERE memory_fts MATCH ?
    ORDER BY rank
    LIMIT ?`);
  const searchByKind = db.prepare(`SELECT ref_id, kind, bm25(memory_fts) AS rank
    FROM memory_fts
    WHERE memory_fts MATCH ? AND kind = ?
    ORDER BY rank
    LIMIT ?`);
  const searchByLearner = db.prepare(`SELECT ref_id, kind, bm25(memory_fts) AS rank
    FROM memory_fts
    WHERE memory_fts MATCH ? AND learner_id = ?
    ORDER BY rank
    LIMIT ?`);
  const searchByKindAndLearner = db.prepare(`SELECT ref_id, kind, bm25(memory_fts) AS rank
    FROM memory_fts
    WHERE memory_fts MATCH ? AND kind = ? AND learner_id = ?
    ORDER BY rank
    LIMIT ?`);

  return {
    indexMemoryDocument(doc) {
      deleteByRefId.run(doc.refId);
      insertDocument.run(doc.content, doc.kind, doc.refId, doc.learnerId ?? "");
    },
    removeMemoryDocument(refId) {
      deleteByRefId.run(refId);
    },
    reconcileMemoryDocuments(args) {
      const learnerId = args.learnerId ?? "";
      const desired = new Map(
        args.documents.map((document) => [document.refId, document.content]),
      );
      const existing = listRefsByKind.all(args.kind, learnerId) as Array<{
        ref_id: string;
      }>;
      const stale = existing.filter((row) => !desired.has(row.ref_id));
      db.exec("BEGIN;");
      try {
        for (const row of stale) {
          deleteByKindAndRefId.run(args.kind, row.ref_id, learnerId);
        }
        for (const [refId, content] of desired) {
          deleteByKindAndRefId.run(args.kind, refId, learnerId);
          insertDocument.run(content, args.kind, refId, learnerId);
        }
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
      return { indexed: desired.size, removed: stale.length };
    },
    searchMemoryFts(query, options) {
      const match = toFtsMatchQuery(query);
      const limit = normalizeLimit(options.limit);

      if (!match || limit === 0) {
        return [];
      }

      const rows = (options.kind && options.learnerId !== undefined
        ? searchByKindAndLearner.all(match, options.kind, options.learnerId, limit)
        : options.kind
          ? searchByKind.all(match, options.kind, limit)
          : options.learnerId !== undefined
            ? searchByLearner.all(match, options.learnerId, limit)
            : searchAll.all(match, limit)) as Array<{
        ref_id: string;
        kind: MemoryDocumentKind;
        rank: number;
      }>;

      return rows.map((row) => ({
        refId: row.ref_id,
        kind: row.kind,
        rank: row.rank,
      }));
    },
    close() {
      db.close();
    },
  };
}

let defaultStore: FtsStore | undefined;

export function getDefaultFtsStore(): FtsStore {
  if (!defaultStore) {
    loadLocalEnv();

    assertSafeDatabaseForProcess({
      configuredDatabaseUrl: process.env.DATABASE_URL,
    });
    const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
    const dbFilePath = resolveSqliteFilePath(url);
    defaultStore = createFtsStore(dbFilePath);
  }

  return defaultStore;
}

export function toFtsMatchQuery(query: string): string | undefined {
  const tokens = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

  if (tokens.length === 0) {
    return undefined;
  }

  return tokens
    .map((token) => {
      const cleaned = token.replaceAll('"', "");
      const cjk = /\p{Script=Han}/u.test(cleaned);
      return cjk && cleaned.length >= 2 ? `"${cleaned}"*` : `"${cleaned}"`;
    })
    .join(" OR ");
}

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 0;
  }

  return Math.max(0, Math.floor(limit));
}

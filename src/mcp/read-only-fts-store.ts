import { createRequire } from "node:module";
import type {
  FtsHit,
  FtsStore,
  MemoryDocumentKind,
} from "@/server/memory/store/fts-store";
import { toFtsMatchQuery } from "@/server/memory/store/fts-store";

const require = createRequire(import.meta.url);

type ReadStatement = {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
};

type ReadOnlyDatabase = {
  prepare(sql: string): ReadStatement;
  close(): void;
};

type ReadOnlyDatabaseConstructor = new (
  path: string,
  options: { readonly: true; fileMustExist: true },
) => ReadOnlyDatabase;

const Database = require("better-sqlite3") as ReadOnlyDatabaseConstructor;
const WRITE_ERROR = "Operation is not available on the read-only MCP FTS store.";

type FtsRow = {
  ref_id: string;
  kind: MemoryDocumentKind;
  rank: number;
};

/**
 * Opens the rebuildable FTS projection without executing PRAGMA, DDL, or any
 * repair path. A missing index is an explicit degraded-state error; MCP never
 * creates or migrates it as a side effect of a read.
 */
export function createReadOnlyFtsStore(dbFilePath: string): FtsStore {
  let db: ReadOnlyDatabase;
  try {
    db = new Database(dbFilePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new Error(
      `Read-only MCP retrieval requires an existing SQLite database: ${errorMessage(error)}`,
    );
  }

  const table = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get("memory_fts");
  const hasMemoryFts = Boolean(table);

  return {
    indexMemoryDocument() {
      throw new Error(WRITE_ERROR);
    },
    removeMemoryDocument() {
      throw new Error(WRITE_ERROR);
    },
    reconcileMemoryDocuments() {
      throw new Error(WRITE_ERROR);
    },
    searchMemoryFts(query, options) {
      if (!hasMemoryFts) {
        throw new Error(
          "Read-only MCP retrieval is unavailable: memory_fts table does not exist. Rebuild the index outside the MCP process.",
        );
      }
      const match = toFtsMatchQuery(query);
      const limit = normalizeLimit(options.limit);
      if (!match || limit === 0) return [];

      const { sql, args } = searchQuery(match, options);
      return db
        .prepare(sql)
        .all(...args, limit)
        .map(toFtsHit);
    },
    close() {
      db.close();
    },
  };
}

function searchQuery(
  match: string,
  options: {
    kind?: MemoryDocumentKind;
    learnerId?: string;
    limit: number;
  },
) {
  const where = ["memory_fts MATCH ?"];
  const args: Array<string | number> = [match];
  if (options.kind) {
    where.push("kind = ?");
    args.push(options.kind);
  }
  if (options.learnerId !== undefined) {
    where.push("learner_id = ?");
    args.push(options.learnerId);
  }
  return {
    sql: `SELECT ref_id, kind, bm25(memory_fts) AS rank
      FROM memory_fts
      WHERE ${where.join(" AND ")}
      ORDER BY rank
      LIMIT ?`,
    args,
  };
}

function toFtsHit(row: unknown): FtsHit {
  if (!isFtsRow(row)) {
    throw new Error("Read-only MCP retrieval returned an invalid FTS row.");
  }
  return { refId: row.ref_id, kind: row.kind, rank: row.rank };
}

function isFtsRow(value: unknown): value is FtsRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.ref_id === "string" &&
    typeof row.kind === "string" &&
    typeof row.rank === "number"
  );
}

function normalizeLimit(limit: number) {
  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

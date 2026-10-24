import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number },
) => {
  backup: (path: string) => Promise<unknown>;
  close: () => void;
  exec: (source: string) => void;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
  prepare: (source: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
};

export type FileIdentity = Readonly<{
  size: number;
  mtimeMs: number;
  sha256: string;
  device: number;
  inode: number;
}>;

export function validateAbsoluteSqliteUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) throw new Error("--database-url must be an explicit SQLite file: URL.");
  const raw = databaseUrl.slice("file:".length).split("?")[0];
  if (!raw || !isAbsolute(raw)) throw new Error("--database-url must contain an absolute SQLite path.");
  const path = resolve(raw);
  if (!existsSync(path)) throw new Error(`SQLite database does not exist: ${path}`);
  return path;
}

export function validateBackupPath(input: {
  backupPath: string;
  sourcePath: string;
  repositoryRoot: string;
}) {
  if (!isAbsolute(input.backupPath)) throw new Error("--backup-path must be absolute.");
  const backupPath = resolve(input.backupPath);
  const sourcePath = resolve(input.sourcePath);
  if (backupPath === sourcePath) throw new Error("Backup path must differ from the source database.");
  if (existsSync(backupPath)) throw new Error("Backup path already exists; refusing to overwrite it.");
  const insideRepository = relative(resolve(input.repositoryRoot), backupPath);
  if (insideRepository === "" || (!insideRepository.startsWith("..") && !isAbsolute(insideRepository))) {
    throw new Error("Backup path must be outside the Git repository.");
  }
  const receiptPath = `${backupPath}.receipt.json`;
  if (existsSync(receiptPath)) throw new Error("Audit receipt path already exists; refusing to overwrite it.");
  accessSync(dirname(backupPath), constants.W_OK);
  return { backupPath, receiptPath };
}

export function fileIdentity(path: string): FileIdentity {
  const stat = statSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { size: stat.size, mtimeMs: stat.mtimeMs, sha256, device: stat.dev, inode: stat.ino };
}

export function sqliteIntegrityCheck(path: string): string {
  const db = new Database(path, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    return String(db.pragma("integrity_check", { simple: true }));
  } finally {
    db.close();
  }
}

export async function createConsistentSqliteBackup(sourcePath: string, backupPath: string) {
  if (existsSync(backupPath)) throw new Error("Backup path already exists; refusing to overwrite it.");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }
  const integrity = sqliteIntegrityCheck(backupPath);
  if (integrity !== "ok") throw new Error(`Backup integrity_check failed: ${integrity}`);
  return {
    source: fileIdentity(sourcePath),
    backup: fileIdentity(backupPath),
    integrity,
  };
}

export function assertSqliteWritableAndUnlocked(path: string) {
  const db = new Database(path, { fileMustExist: true, timeout: 0 });
  try {
    db.exec("BEGIN IMMEDIATE; ROLLBACK;");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`database_locked: unable to acquire SQLite write lock (${message})`);
  } finally {
    db.close();
  }
}

export function inspectReconciliationSchema(databasePath: string, repositoryRoot: string) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const names = new Set(tables.map((row) => row.name));
    if (!names.has("CampaignTaskItemSettlement") || !names.has("_prisma_migrations")) {
      return { current: false, missingColumns: ["CampaignTaskItemSettlement"], missingMigrations: ["Prisma migration history"] };
    }
    const columns = db.prepare("PRAGMA table_info('CampaignTaskItemSettlement')").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((row) => row.name));
    const missingColumns = ["settlementVersion", "evidenceSource", "evidenceReferenceId", "evidenceScope", "evidenceSubject"]
      .filter((column) => !columnNames.has(column));
    const migrationNames = readdirSync(resolve(repositoryRoot, "prisma/migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const applied = db.prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    ).all() as Array<{ migration_name: string }>;
    const appliedNames = new Set(applied.map((row) => row.migration_name));
    const missingMigrations = migrationNames.filter((name) => !appliedNames.has(name));
    return { current: missingColumns.length === 0 && missingMigrations.length === 0, missingColumns, missingMigrations };
  } finally {
    db.close();
  }
}

export function assertCurrentReconciliationSchema(databasePath: string, repositoryRoot: string) {
  const result = inspectReconciliationSchema(databasePath, repositoryRoot);
  if (!result.current) {
    throw new Error(
      `Database schema/migrations are not current (columns: ${result.missingColumns.join(", ") || "none"}; migrations: ${result.missingMigrations.join(", ") || "none"}).`,
    );
  }
}

const PROTECTED_TABLES = [
  "ReviewAttempt",
  "RunEvidence",
  "ProblemWorkspaceSession",
  "ChatMessage",
  "MemoryActivityCluster",
  "MemoryActivityItem",
  "MemoryExtractionReceipt",
  "MemoryEpisode",
  "MemoryClaimObservation",
  "MemoryClaimRelation",
  "MemoryEvidenceContribution",
  "L2MemoryFact",
  "SynthesisSlot",
];

export function protectedTableSummary(databasePath: string) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 0 });
  try {
    const existing = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
    );
    return Object.fromEntries(PROTECTED_TABLES.filter((table) => existing.has(table)).map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(MAX(rowid), 0) AS maxRowId FROM "${table}"`).get() as {
        count: number | bigint;
        maxRowId: number | bigint;
      };
      return [table, { count: Number(row.count), maxRowId: Number(row.maxRowId) }];
    }));
  } finally {
    db.close();
  }
}

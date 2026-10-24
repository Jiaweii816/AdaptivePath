import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

export type FileChecksumSnapshot = Record<string, string | null>;

export function createIsolatedTestDatabase(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const databasePath = join(directory, "test.db");
  const db = new Database(databasePath);
  try {
    applyPrismaMigrations(db);
  } finally {
    db.close();
  }
  return {
    directory,
    databasePath,
    databaseUrl: `file:${databasePath}`,
  };
}

export function removeIsolatedTestDatabase(directory: string) {
  rmSync(directory, { recursive: true, force: true });
}

export function snapshotWorkspaceDevDatabase(
  cwd = process.cwd(),
): FileChecksumSnapshot {
  return Object.fromEntries(
    ["dev.db", "dev.db-wal", "dev.db-shm"].map((name) => {
      const path = join(cwd, name);
      return [name, existsSync(path) ? sha256(path) : null];
    }),
  );
}

export function assertWorkspaceDevDatabaseUnchanged(
  before: FileChecksumSnapshot,
  cwd = process.cwd(),
) {
  const after = snapshotWorkspaceDevDatabase(cwd);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `E2E isolation failure: workspace dev.db changed. Before=${JSON.stringify(before)} After=${JSON.stringify(after)}`,
    );
  }
}

function applyPrismaMigrations(db: SqliteDatabase) {
  const migrationsDir = join(process.cwd(), "prisma/migrations");
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = join(migrationsDir, migrationName, "migration.sql");
    if (existsSync(migrationPath)) {
      db.exec(readFileSync(migrationPath, "utf8"));
    }
  }
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

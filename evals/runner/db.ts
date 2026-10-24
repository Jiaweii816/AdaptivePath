import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";

type SqliteDatabase = {
  close: () => void;
  exec: (source: string) => void;
};

type SqliteConstructor = new (path: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as SqliteConstructor;

export type EvalDatabaseConfig = {
  dbPath: string;
  dbUrl: string;
  explicit: boolean;
};

export function resolveEvalDatabaseConfig(args: {
  suiteName: string;
  dbInput?: string;
  timestamp: Date;
  cwd?: string;
  devDatabaseUrl?: string;
}): EvalDatabaseConfig {
  const cwd = args.cwd ?? process.cwd();
  const explicit = Boolean(args.dbInput);
  const dbPath = args.dbInput
    ? resolveDbInput(args.dbInput, cwd)
    : defaultEvalDbPath({
        cwd,
        suiteName: args.suiteName,
        timestamp: args.timestamp,
      });
  const devDbPath = resolveSqliteFilePath(
    args.devDatabaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    cwd,
  );

  if (resolve(dbPath) === resolve(devDbPath)) {
    throw new Error(
      `Refusing to use development DB as eval DB: ${resolve(dbPath)}`,
    );
  }

  return {
    dbPath: resolve(dbPath),
    dbUrl: `file:${resolve(dbPath)}`,
    explicit,
  };
}

export function initializeEvalDatabase(config: EvalDatabaseConfig): PrismaClient {
  removeSqliteFiles(config.dbPath);
  mkdirSync(dirname(config.dbPath), { recursive: true });

  const raw = new Database(config.dbPath);
  applyPrismaMigrations(raw);
  raw.close();

  const adapter = new PrismaBetterSqlite3({ url: config.dbUrl });
  return new PrismaClient({ adapter });
}

export function removeEvalDatabase(dbPath: string) {
  removeSqliteFiles(dbPath);
}

function applyPrismaMigrations(db: Pick<SqliteDatabase, "exec">) {
  const migrationsDir = join(process.cwd(), "prisma", "migrations");
  const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = join(migrationsDir, migrationName, "migration.sql");
    if (!existsSync(migrationPath)) {
      continue;
    }

    db.exec(readFileSync(migrationPath, "utf8"));
  }
}

function defaultEvalDbPath(args: {
  cwd: string;
  suiteName: string;
  timestamp: Date;
}) {
  return resolve(
    args.cwd,
    "evals",
    "tmp",
    `eval-${args.suiteName}-${formatTimestamp(args.timestamp)}.db`,
  );
}

function resolveDbInput(input: string, cwd: string) {
  if (input.startsWith("file:")) {
    return resolveSqliteFilePath(input, cwd);
  }

  return resolve(cwd, input);
}

function removeSqliteFiles(dbPath: string) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(path, { force: true });
  }
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

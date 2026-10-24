import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "@/lib/env";
import { resolveSqliteFilePath } from "@/server/db/sqlite-path";
import { migrateL1Telemetry } from "@/server/observability/migrate-l1-telemetry";

export type RuntimeTraceMigrationCliArgs = {
  dbPath: string;
  mode: "dry-run" | "apply";
  deleteSource: boolean;
};

export function parseRuntimeTraceMigrationArgs(
  argv: string[],
): RuntimeTraceMigrationCliArgs {
  let dbInput: string | undefined;
  let mode: RuntimeTraceMigrationCliArgs["mode"] | undefined;
  let deleteSource = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --db <sqlite-db-path>.");
      }
      dbInput = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbInput = arg.slice("--db=".length);
      continue;
    }
    if (arg === "--dry-run" || arg === "--apply") {
      const nextMode = arg === "--dry-run" ? "dry-run" : "apply";
      if (mode && mode !== nextMode) {
        throw new Error("Choose exactly one of --dry-run or --apply.");
      }
      mode = nextMode;
      continue;
    }
    if (arg === "--delete-source") {
      deleteSource = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!dbInput) {
    throw new Error("--db <sqlite-db-path> is required; no default database is used.");
  }
  if (!mode) {
    throw new Error("Choose exactly one of --dry-run or --apply.");
  }
  if (deleteSource && mode !== "apply") {
    throw new Error("--delete-source requires --apply.");
  }

  return {
    dbPath: resolveSqliteFilePath(dbInput, process.cwd()),
    mode,
    deleteSource,
  };
}

export async function buildBackupRecommendation(
  dbPath: string,
  now = new Date(),
) {
  const sourceDatabaseFileSha256 = await sha256File(dbPath);
  const extension = extname(dbPath);
  const filename = basename(dbPath, extension);
  const backupPath = join(
    dirname(dbPath),
    `${filename}.pre-runtime-trace-${formatTimestamp(now)}${extension || ".db"}.bak`,
  );
  const backupDotCommand = `.backup ${sqliteDotQuote(backupPath)}`;
  return {
    databasePath: dbPath,
    sourceDatabaseBytes: statSync(dbPath).size,
    sourceDatabaseFileSha256,
    sourceChecksumScope:
      "base SQLite file only; create and checksum the consistent backup before cutover",
    recommendedBackupPath: backupPath,
    requiresStoppedWriters: true,
    backupCommand: `sqlite3 ${shellQuote(dbPath)} ${shellQuote(backupDotCommand)}`,
    backupChecksumCommand: `sha256sum -- ${shellQuote(backupPath)}`,
    restoreCommands: [
      `rm -f -- ${shellQuote(`${dbPath}-wal`)} ${shellQuote(`${dbPath}-shm`)}`,
      `cp -- ${shellQuote(backupPath)} ${shellQuote(dbPath)}`,
    ],
  };
}

async function main() {
  loadLocalEnv();
  const args = parseRuntimeTraceMigrationArgs(process.argv.slice(2));
  const backup = await buildBackupRecommendation(args.dbPath);
  console.error(JSON.stringify({ backupRecommendation: backup }, null, 2));

  const adapter = new PrismaBetterSqlite3({
    url: `file:${resolve(args.dbPath)}`,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await migrateL1Telemetry(prisma, {
      mode: args.mode,
      deleteSource: args.deleteSource,
    });
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

function sha256File(path: string) {
  return new Promise<string>((resolveChecksum, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveChecksum(hash.digest("hex")));
  });
}

function formatTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sqliteDotQuote(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

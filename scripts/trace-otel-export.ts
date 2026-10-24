import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "@/lib/env";
import { mapRowsToSpans } from "@/observability/otel/span-mapping";
import {
  exportSpans,
  resolvePhoenixTraceEndpoint,
} from "@/observability/otel/export-to-phoenix";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import { loadAgentObservabilityRows } from "@/server/observability/agent-observability";

type ParsedArgs = {
  dbInput?: string;
  dryRun: boolean;
  endpoint?: string;
};

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const database = resolveReadOnlyDatabase(args.dbInput);
  const adapter = new PrismaBetterSqlite3({
    url: database.url,
    readonly: true,
    fileMustExist: true,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    await enforceQueryOnly(prisma);
    const rows = await loadAgentObservabilityRows(prisma);
    const spans = mapRowsToSpans(rows);
    const endpoint = resolvePhoenixTraceEndpoint(args.endpoint);

    console.log(`database: ${database.path} (read-only)`);
    console.log(`mapped ${rows.length} rows to ${spans.length} spans`);
    assertHasExportableSpans({ rowCount: rows.length, spanCount: spans.length });
    if (args.dryRun) {
      console.log(`dry-run: would export to ${endpoint}; no network request sent`);
      return;
    }

    console.log(`exporting ${spans.length} spans to ${endpoint}...`);
    await exportSpans(spans, { endpoint: args.endpoint });
    console.log("done");
  } finally {
    await prisma.$disconnect();
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { dryRun: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--db" || arg === "--endpoint") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      if (arg === "--db") parsed.dbInput = value;
      else parsed.endpoint = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      parsed.dbInput = arg.slice("--db=".length);
      continue;
    }
    if (arg.startsWith("--endpoint=")) {
      parsed.endpoint = arg.slice("--endpoint=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function resolveReadOnlyDatabase(dbInput: string | undefined) {
  const candidate = dbInput ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const normalized = normalizeDatabaseInput(candidate);
  const path = resolveSqliteFilePath(normalized);
  if (!existsSync(path)) {
    throw new Error(`SQLite database does not exist: ${path}`);
  }

  return {
    path,
    // Keep the adapter URL query-free: read-only/fileMustExist are native
    // better-sqlite3 options, not SQLite URI query parameters.
    url: `file:${path}`,
  };
}

export function assertHasExportableSpans(args: {
  rowCount: number;
  spanCount: number;
}) {
  if (args.spanCount > 0) return;
  throw new Error(
    `No exportable spans were mapped from ${args.rowCount} observability rows; refusing to report a successful export.`,
  );
}

async function enforceQueryOnly(prisma: PrismaClient) {
  await prisma.$queryRawUnsafe("PRAGMA query_only = ON");
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, bigint | number>>>(
    "PRAGMA query_only",
  );
  const enabled = Number(rows[0]?.query_only ?? 0) === 1;
  if (!enabled) {
    throw new Error("Failed to enable SQLite PRAGMA query_only.");
  }
}

function normalizeDatabaseInput(input: string) {
  if (input.startsWith("file:")) return input;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    throw new Error(`SQLite database URL must start with file:, got ${input}`);
  }
  return `file:${isAbsolute(input) ? input : resolve(process.cwd(), input)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

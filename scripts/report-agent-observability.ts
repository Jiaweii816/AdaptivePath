import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "@/lib/env";
import {
  DEFAULT_DATABASE_URL,
  resolveSqliteFilePath,
} from "@/server/db/sqlite-path";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import {
  renderAgentObservabilityJson,
  renderAgentObservabilityMarkdown,
} from "@/server/observability/agent-observability-report";

type ParsedArgs = {
  dbInput?: string;
};

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const database = resolveDatabase(args.dbInput);
  const adapter = new PrismaBetterSqlite3({ url: database.url });
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await loadAgentObservabilityRows(prisma);
    const report = buildAgentObservabilityReport({
      rows,
      dbPath: database.path,
      explicitDb: database.explicit,
    });
    const markdown = renderAgentObservabilityMarkdown(report);
    const json = renderAgentObservabilityJson(report);
    const outputDir = resolve(process.cwd(), "evals", "reports");
    const stamp = formatTimestamp(new Date(report.generatedAt));
    const markdownPath = resolve(outputDir, `agent-observability-${stamp}.md`);
    const jsonPath = resolve(outputDir, `agent-observability-${stamp}.json`);

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(markdownPath, markdown, "utf8");
    writeFileSync(jsonPath, json, "utf8");

    console.log(markdown);
    console.error(`\nWrote ${markdownPath}`);
    console.error(`Wrote ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--db") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --db <sqlite-db-path>.");
      }
      parsed.dbInput = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--db=")) {
      parsed.dbInput = arg.slice("--db=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function resolveDatabase(dbInput: string | undefined) {
  const explicit = Boolean(dbInput);
  const candidate = dbInput ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const url = candidate.startsWith("file:")
    ? candidate
    : `file:${resolve(process.cwd(), candidate)}`;

  return {
    explicit,
    url,
    path: resolveSqliteFilePath(url),
  };
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

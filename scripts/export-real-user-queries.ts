import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUTPUT = resolve(
  process.cwd(),
  "evals/datasets/chat-intent-v3/real-user-queries-v1.json",
);

/** Read-only by construction: the learner database is opened through a
 * mode=ro URI and only SELECT is issued. See AGENTS.md learner-db boundary. */
const QUERY = `
SELECT DISTINCT contentMarkdown, memoryOrigin
FROM ChatMessage
WHERE role = 'user'
ORDER BY contentMarkdown;
`;

type QueryRow = {
  readonly contentMarkdown: string;
  readonly memoryOrigin: string;
};

function stripCode(message: string) {
  return message
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]*`/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function main() {
  const raw = execFileSync(
    "sqlite3",
    ["-json", "file:dev.db?mode=ro", QUERY],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const rows = JSON.parse(raw) as QueryRow[];
  const queries = rows
    .map((row, index) => ({
      caseId: `real-${String(index).padStart(3, "0")}`,
      message: stripCode(row.contentMarkdown),
      memoryOrigin: row.memoryOrigin,
    }))
    .filter((item) => item.message.length > 0);

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(
    OUTPUT,
    `${JSON.stringify(
      {
        datasetVersion: "real-user-queries-v1",
        exportedAt: new Date().toISOString().slice(0, 10),
        sourceRowCount: rows.length,
        distinctCount: queries.length,
        queries,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`exported ${queries.length} queries to ${OUTPUT}\n`);
}

main();

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
type Statement = { run: (...args: unknown[]) => { changes: number }; get: (...args: unknown[]) => Record<string, unknown> | undefined };
type DatabaseHandle = {
  exec: (sql: string) => void;
  prepare: (sql: string) => Statement;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  close: () => void;
};
type DatabaseConstructor = new (path: string) => DatabaseHandle;
const Database = require("better-sqlite3") as DatabaseConstructor;

const DESTINATION = resolve(process.argv[2] ?? "");
const SOURCE = resolve(process.argv[3] ?? "");
const APPLY = process.argv.includes("--apply");

if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: tsx scripts/merge-iris-campaign-memory.ts <destination.db> <source.db> [--apply]");
}
if (realpathSync(DESTINATION) === realpathSync(SOURCE)) {
  throw new Error("Destination and source databases must differ.");
}
if (!APPLY) {
  throw new Error("This tool is write-capable. Run it only against a disposable dry-run copy or pass --apply after backup verification.");
}

function quoteSql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

const db = new Database(DESTINATION);
const inserted: Record<string, number> = {};

function scalar(sql: string, ...args: unknown[]) {
  const row = db.prepare(sql).get(...args);
  return Number(Object.values(row ?? {})[0] ?? 0);
}

function columns(table: string) {
  const rows = db.prepare(`PRAGMA main.table_info(${quoteSql(table)})`).get as unknown;
  void rows;
  const statement = db.prepare(`SELECT name FROM pragma_table_info(${quoteSql(table)}) ORDER BY cid`);
  return (statement as unknown as { all: () => Array<{ name: string }> }).all().map((row) => row.name);
}

function copyRows(
  table: string,
  where: string,
  transforms: Record<string, string> = {},
) {
  const names = columns(table);
  const destinationColumns = names.map(quoteIdentifier).join(", ");
  const sourceColumns = names
    .map((name) => `${transforms[name] ?? `s.${quoteIdentifier(name)}`} AS ${quoteIdentifier(name)}`)
    .join(", ");
  const result = db.prepare(`
    INSERT OR IGNORE INTO main.${quoteIdentifier(table)} (${destinationColumns})
    SELECT ${sourceColumns}
    FROM source.${quoteIdentifier(table)} s
    WHERE ${where}
  `).run();
  inserted[table] = (inserted[table] ?? 0) + result.changes;
}

const transaction = db.transaction(() => {
  db.exec("PRAGMA defer_foreign_keys = ON;");
  const destinationUser = db.prepare("SELECT id FROM main.User WHERE handle = 'Iris904'").get();
  const sourceUser = db.prepare("SELECT id FROM source.User WHERE handle = 'Iris904'").get();
  if (!destinationUser?.id || destinationUser.id !== sourceUser?.id) {
    throw new Error("Iris904 must exist with the same user id in both databases.");
  }
  const userId = String(destinationUser.id);

  const problemMismatch = scalar(`
    SELECT count(*) FROM source.Problem s
    JOIN main.Problem d ON d.slug = s.slug
    WHERE d.id <> s.id
  `);
  if (problemMismatch > 0) throw new Error("Problem ids differ between databases.");

  // Preserve source drafts that do not exist in the destination, then map any
  // same-problem draft to the destination's canonical unique row.
  copyRows("CodeDraft", `s.userId = ${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.CodeDraft d WHERE d.id = s.id)`);
  db.exec(`
    CREATE TEMP TABLE _code_map(sourceId TEXT PRIMARY KEY, destinationId TEXT NOT NULL);
    INSERT INTO _code_map
    SELECT s.id, d.id
    FROM source.CodeDraft s
    JOIN main.CodeDraft d
      ON d.userId = s.userId AND d.problemId = s.problemId AND d.language = s.language
    WHERE s.userId = ${quoteSql(userId)};

    CREATE TEMP TABLE _chat_map(sourceId TEXT PRIMARY KEY, destinationId TEXT NOT NULL);
    INSERT INTO _chat_map
    SELECT s.id, COALESCE(d.id, s.id)
    FROM source.ChatSession s
    LEFT JOIN main.ChatSession d
      ON d.userId = s.userId AND d.problemId = s.problemId AND d.memoryOrigin = s.memoryOrigin
    WHERE s.userId = ${quoteSql(userId)};
  `);
  copyRows("ChatSession", `s.userId = ${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.ChatSession d WHERE d.id = s.id) AND NOT EXISTS (SELECT 1 FROM main.ChatSession d WHERE d.userId=s.userId AND d.problemId=s.problemId AND d.memoryOrigin=s.memoryOrigin)`);

  db.exec(`
    CREATE TEMP TABLE _message_map(sourceId TEXT PRIMARY KEY, destinationSessionId TEXT NOT NULL, destinationSequence INTEGER NOT NULL);
    INSERT INTO _message_map
    SELECT staged.id, staged.destinationSessionId,
           staged.destinationMaxSequence + ROW_NUMBER() OVER (
             PARTITION BY staged.sourceSessionId ORDER BY staged.sourceSequence, staged.createdAt, staged.id
           )
    FROM (
      SELECT s.id, s.sessionId AS sourceSessionId, s.sequence AS sourceSequence, s.createdAt,
             cm.destinationId AS destinationSessionId,
             COALESCE((SELECT max(d.sequence) FROM main.ChatMessage d WHERE d.sessionId=cm.destinationId), 0) AS destinationMaxSequence
      FROM source.ChatMessage s
      JOIN source.ChatSession cs ON cs.id=s.sessionId
      JOIN _chat_map cm ON cm.sourceId=s.sessionId
      WHERE cs.userId=${quoteSql(userId)}
        AND NOT EXISTS (SELECT 1 FROM main.ChatMessage d WHERE d.id=s.id)
    ) staged;
  `);
  copyRows("ChatMessage", `EXISTS (SELECT 1 FROM _message_map mm WHERE mm.sourceId=s.id)`, {
    sessionId: "(SELECT destinationSessionId FROM _message_map mm WHERE mm.sourceId=s.id)",
    sequence: "(SELECT destinationSequence FROM _message_map mm WHERE mm.sourceId=s.id)",
  });

  const mapChat = `(SELECT destinationId FROM _chat_map m WHERE m.sourceId=s.chatSessionId)`;
  const mapDraft = `(SELECT destinationId FROM _code_map m WHERE m.sourceId=s.codeDraftId)`;
  copyRows("ReviewAttempt", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.ReviewAttempt d WHERE d.id=s.id)`, {
    chatSessionId: mapChat,
    codeDraftId: `CASE WHEN s.codeDraftId IS NULL THEN NULL ELSE ${mapDraft} END`,
  });
  copyRows("DiagnosisResult", `EXISTS (SELECT 1 FROM source.ReviewAttempt r WHERE r.id=s.reviewAttemptId AND r.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.DiagnosisResult d WHERE d.id=s.id)`);
  copyRows("RunEvidence", `(EXISTS (SELECT 1 FROM source.ReviewAttempt r WHERE r.id=s.reviewAttemptId AND r.userId=${quoteSql(userId)}) OR EXISTS (SELECT 1 FROM source.ChatSession c WHERE c.id=s.chatSessionId AND c.userId=${quoteSql(userId)})) AND NOT EXISTS (SELECT 1 FROM main.RunEvidence d WHERE d.id=s.id)`, {
    chatSessionId: `CASE WHEN s.chatSessionId IS NULL THEN NULL ELSE ${mapChat} END`,
  });
  copyRows("ProblemHistory", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.ProblemHistory d WHERE d.id=s.id)`, { chatSessionId: mapChat });
  copyRows("L1MemoryEvent", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.L1MemoryEvent d WHERE d.id=s.id)`, {
    chatSessionId: `CASE WHEN s.chatSessionId IS NULL THEN NULL ELSE ${mapChat} END`,
  });

  copyRows("ProblemWorkspaceSession", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.ProblemWorkspaceSession d WHERE d.id=s.id)`, {
    activeIdentityKey: "NULL",
  });
  copyRows("AgentTraceRun", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.AgentTraceRun d WHERE d.id=s.id)`, {
    chatSessionId: `CASE WHEN s.chatSessionId IS NULL THEN NULL ELSE ${mapChat} END`,
  });
  copyRows("BackgroundJob", `EXISTS (SELECT 1 FROM source.AgentTraceRun r WHERE r.id=s.originatingTraceRunId AND r.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.BackgroundJob d WHERE d.id=s.id)`);
  copyRows("AgentTraceEvent", `EXISTS (SELECT 1 FROM source.AgentTraceRun r WHERE r.id=s.traceRunId AND r.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.AgentTraceEvent d WHERE d.id=s.id)`);
  copyRows("AgentTracePayload", `EXISTS (SELECT 1 FROM source.AgentTraceEvent e JOIN source.AgentTraceRun r ON r.id=e.traceRunId WHERE e.id=s.traceEventId AND r.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.AgentTracePayload d WHERE d.id=s.id)`);

  db.exec(`
    CREATE TEMP TABLE _cluster_map(sourceId TEXT PRIMARY KEY, destinationId TEXT NOT NULL);
    INSERT INTO _cluster_map
    SELECT s.id, COALESCE(d.id, s.id)
    FROM source.MemoryActivityCluster s
    LEFT JOIN main.MemoryActivityCluster d
      ON d.userId=s.userId AND d.sourceKey=s.sourceKey AND d.memoryOrigin=s.memoryOrigin
    WHERE s.userId=${quoteSql(userId)};
  `);
  copyRows("MemoryActivityCluster", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.MemoryActivityCluster d WHERE d.id=s.id) AND NOT EXISTS (SELECT 1 FROM main.MemoryActivityCluster d WHERE d.userId=s.userId AND d.sourceKey=s.sourceKey AND d.memoryOrigin=s.memoryOrigin)`, {
    chatSessionId: `CASE WHEN s.chatSessionId IS NULL THEN NULL ELSE ${mapChat} END`,
  });
  const mapCluster = `(SELECT destinationId FROM _cluster_map m WHERE m.sourceId=s.activityClusterId)`;
  copyRows("MemoryActivityItem", `EXISTS (SELECT 1 FROM source.MemoryActivityCluster c WHERE c.id=s.activityClusterId AND c.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.MemoryActivityItem d WHERE d.id=s.id)`, { activityClusterId: mapCluster });
  copyRows("MemoryExtractionReceipt", `EXISTS (SELECT 1 FROM source.MemoryActivityCluster c WHERE c.id=s.activityClusterId AND c.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.MemoryExtractionReceipt d WHERE d.id=s.id)`, { activityClusterId: mapCluster });
  copyRows("MemoryEpisode", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.MemoryEpisode d WHERE d.id=s.id)`, {
    chatSessionId: `CASE WHEN s.chatSessionId IS NULL THEN NULL ELSE ${mapChat} END`,
    activityClusterId: `CASE WHEN s.activityClusterId IS NULL THEN NULL ELSE ${mapCluster} END`,
  });

  const conflictingFacts = scalar(`
    SELECT count(*) FROM source.L2MemoryFact s
    WHERE s.userId=${quoteSql(userId)}
      AND NOT EXISTS (SELECT 1 FROM main.L2MemoryFact d WHERE d.id=s.id)
      AND EXISTS (
        SELECT 1 FROM main.L2MemoryFact d WHERE d.userId=s.userId AND d.memoryOrigin=s.memoryOrigin
          AND ((s.clusterKey IS NOT NULL AND d.clusterKey=s.clusterKey) OR (d.factType=s.factType AND d.tag=s.tag))
      )
  `);
  if (conflictingFacts > 0) throw new Error(`Refusing ${conflictingFacts} source-only L2 fact natural-key conflicts.`);
  copyRows("L2MemoryFact", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.L2MemoryFact d WHERE d.id=s.id)`);
  copyRows("MemoryClaimObservation", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.MemoryClaimObservation d WHERE d.id=s.id)`, {
    activityClusterId: mapCluster,
  });
  copyRows("MemoryClaimRelation", `EXISTS (SELECT 1 FROM source.MemoryClaimObservation o WHERE o.id=s.observationId AND o.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.MemoryClaimRelation d WHERE d.id=s.id)`);
  copyRows("MemoryEvidenceContribution", `EXISTS (SELECT 1 FROM source.MemoryClaimObservation o WHERE o.id=s.observationId AND o.userId=${quoteSql(userId)}) AND NOT EXISTS (SELECT 1 FROM main.MemoryEvidenceContribution d WHERE d.id=s.id)`, {
    activityClusterId: mapCluster,
  });

  const conflictingSynthesis = scalar(`
    SELECT count(*) FROM source.SynthesisSlot s
    WHERE s.userId=${quoteSql(userId)}
      AND NOT EXISTS (SELECT 1 FROM main.SynthesisSlot d WHERE d.id=s.id)
      AND EXISTS (SELECT 1 FROM main.SynthesisSlot d WHERE d.userId=s.userId AND d.slot=s.slot AND d.synthesisKey=s.synthesisKey AND d.memoryOrigin=s.memoryOrigin)
  `);
  if (conflictingSynthesis > 0) throw new Error(`Refusing ${conflictingSynthesis} source-only synthesis natural-key conflicts.`);
  copyRows("SynthesisSlot", `s.userId=${quoteSql(userId)} AND NOT EXISTS (SELECT 1 FROM main.SynthesisSlot d WHERE d.id=s.id)`);

  const removedUsers = db.prepare("DELETE FROM main.User WHERE id <> ?").run(userId).changes;
  inserted.removedNonIrisUsers = removedUsers;

  const foreignKeyIssues = scalar("SELECT count(*) FROM pragma_foreign_key_check");
  if (foreignKeyIssues > 0) throw new Error(`Merge produced ${foreignKeyIssues} foreign-key violations.`);
});

try {
  db.exec(`ATTACH DATABASE ${quoteSql(SOURCE)} AS source;`);
  transaction();
  const integrity = db.prepare("PRAGMA integrity_check").get();
  console.log(JSON.stringify({ destination: DESTINATION, source: SOURCE, inserted, integrity }, null, 2));
} finally {
  db.close();
}

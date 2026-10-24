import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@prisma/client";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { buildKbDocuments } from "@/server/memory/kb/kb-catalog";
import { normalizeMemoryTag } from "@/server/memory/memory.types";
import {
  episodeFtsContent,
  isSafeEpisodeForIndexing,
} from "@/server/memory/store/episode-store";
import {
  knowledgeNoteFtsContent,
  knowledgeNoteFtsRefId,
} from "@/server/memory/store/knowledge-note-store";
import {
  factFtsContent,
  type ProblemSearchMetadata,
} from "@/server/memory/store/memory-document-content";

const require = createRequire(import.meta.url);

type SqliteRunResult = { changes: number | bigint };
type SqliteStatement = {
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => SqliteRunResult;
};
type SqliteDatabase = {
  backup: (destinationPath: string) => Promise<unknown>;
  close: () => void;
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
  transaction: <T>(fn: () => T) => () => T;
};
type SqliteConstructor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

const Database = require("better-sqlite3") as SqliteConstructor;

export const MEMORY_REPAIR_PLAN_VERSION = 2;
export const LEGACY_MEMORY_REPAIR_PLAN_VERSION = 1;
export const MEMORY_CUTOVER_RECEIPT_VERSION = 1;
export const MEMORY_STAGING_MIGRATION_RECEIPT_VERSION = 1;
export const MEMORY_CUTOVER_WEB_UI_PORT = 3000;
export const MEMORY_ORIGIN_MIGRATION_NAME =
  "20260716150000_memory_origin_provenance";
export const BLOCKED_MEMORY_TAGS = new Set([
  "no_search_logic",
  "hardcoded_return",
]);

type JsonRow = Record<string, unknown>;

export type MemoryIntegrityAudit = {
  version: 1;
  databaseFileSha256: string;
  memoryStateSha256: string;
  integrityCheck: string[];
  foreignKeyViolations: JsonRow[];
  counts: {
    users: number;
    l1Events: number;
    l2Facts: number;
    episodes: number;
    synthesisSlots: number;
    knowledgeNotes: number;
    ftsDocuments: number;
  };
  facts: {
    blocked: FactAuditRow[];
    invalidEvidence: FactAuditRow[];
    assistantOnlyPreferences: FactAuditRow[];
  };
  synthesis: {
    active: number;
    byStatus: Record<string, number>;
  };
  fts: {
    exists: boolean;
    byKind: Record<string, number>;
    eligibleFactDocuments: number;
    orphanFactDocuments: number;
    missingFactDocuments: number;
    eligibleEpisodeDocuments: number;
    orphanEpisodeDocuments: number;
    missingEpisodeDocuments: number;
    duplicateDocumentKeys: number;
  };
  vector: {
    mode: "fts_only" | "vector_present";
    tablePresent: boolean;
    mapTablePresent: boolean;
    mapRows: number;
    embeddedEpisodes: number;
    pendingEmbeddingCount: number;
    vectorOrphanCount: number;
    vectorMapDriftCount: number;
  };
  schema: MemorySchemaParity;
};

export type MemorySchemaParity = {
  ok: boolean;
  missingTables: string[];
  missingColumns: string[];
  missingIndexes: string[];
  mismatchedIndexes: string[];
  forbiddenLegacyIndexesPresent: string[];
  missingMigrationRecords: string[];
  invalidMigrationRecords: string[];
};

export type FactAuditRow = {
  id: string;
  userId: string;
  factType: string;
  tag: string;
  status: string;
  memoryOrigin: string;
  reasons: string[];
};

export type FactQuarantineAction = {
  id: string;
  userId: string;
  factType: string;
  tag: string;
  reasons: string[];
  before: {
    status: string;
    validationJson: string;
  };
};

export type SynthesisInvalidateAction = {
  id: string;
  userId: string;
  slot: string;
  synthesisKey: string;
  beforeStatus: string;
  reason: "legacy_synthesis_requires_trusted_rebuild";
};

export type MemoryRepairPlan = {
  version: 2;
  repairRunId: string;
  source: {
    databaseFileSha256: string;
    memoryStateSha256: string;
  };
  actions: {
    quarantineFacts: FactQuarantineAction[];
    invalidateSynthesis: SynthesisInvalidateAction[];
  };
  expectedIndexTruth: {
    factDocuments: number;
    episodeDocuments: number;
    knowledgeBaseDocuments: number;
    activeKnowledgeNoteDocuments: number;
    totalDocuments: number;
    factEligibilityMode: "trusted_learner_fact_with_human_teaching_text_fail_closed";
    episodeEligibilityMode: "learner_origin_and_blocked_text_safe_fail_closed";
    vectorMode: "fts_only";
  };
  warnings: string[];
};

export type RepairApplyResult = {
  mode: "dry-run" | "apply";
  repairRunId: string;
  planSha256: string;
  alreadyApplied: boolean;
  factRowsChanged: number;
  synthesisRowsChanged: number;
  factsRemainingVisibleFromPlan: number;
  synthesisRemainingActiveFromPlan: number;
};

export type IndexRebuildResult = {
  mode: "dry-run" | "apply";
  planSha256: string;
  beforeDocuments: number;
  expectedDocuments: number;
  expectedByKind: Record<string, number>;
  afterDocuments: number | null;
  orphanFactDocuments: number | null;
  missingFactDocuments: number | null;
  orphanEpisodeDocuments: number | null;
  missingEpisodeDocuments: number | null;
  duplicateDocumentKeys: number | null;
  vectorMode: "fts_only";
  clearedVectorRows: number;
};

export type MemoryIntegrityVerification = {
  ok: boolean;
  audit: MemoryIntegrityAudit;
  plannedFactRowsStillVisible: number;
  plannedSynthesisRowsStillActive: number;
  planQuarantineMetadataMismatch: string[];
  expectedFtsDocuments: number;
  prismaReadWriteSmoke: {
    ok: boolean;
    error: string | null;
  };
  failures: string[];
};

export type MemoryCutoverReceipt = {
  version: 1;
  /** Absent on legacy receipts, which are interpreted as repair-plan v1. */
  repairPlanVersion?: 1 | 2;
  cutoverId: string;
  completedAt: string;
  planSha256: string;
  stagingMigrationReceiptFileSha256: string;
  liveDbPath: string;
  stagingDbPath: string;
  retainedBackup: {
    path: string;
    databaseFileSha256: string;
    memoryStateSha256: string;
  };
  installed: {
    databaseFileSha256: string;
    memoryStateSha256: string;
  };
};

export type MemoryCutoverResult = {
  mode: "dry-run" | "apply";
  ready: boolean;
  planSha256: string;
  migrationReceiptFileSha256: string;
  liveDbPath: string;
  stagingDbPath: string;
  stagingDbSha256: string;
  retainedBackupPath: string;
  retainedBackupSha256: string | null;
  receiptPath: string;
  receiptFileSha256: string | null;
  installedDbSha256: string | null;
  rolledBackAfterFailure: boolean;
};

export type MemoryRollbackResult = {
  mode: "dry-run" | "apply";
  ready: boolean;
  cutoverId: string;
  liveDbPath: string;
  restoredDbSha256: string | null;
  safetyBackupPath: string;
  safetyBackupSha256: string | null;
  rolledBackAfterFailure: boolean;
};

export type StagingMigrationReceipt = {
  version: 1;
  migrationRunId: string;
  completedAt: string;
  sourceSnapshot: {
    path: string;
    databaseFileSha256: string;
    memoryStateSha256: string;
  };
  migratedStaging: {
    path: string;
    databaseFileSha256: string;
    memoryStateSha256: string;
  };
  migrationNames: string[];
};

export type StagingMigrationResult = {
  mode: "dry-run" | "apply";
  ready: boolean;
  sourceSnapshotPath: string;
  sourceSnapshotSha256: string;
  stagingDbPath: string;
  stagingDbSha256: string | null;
  receiptPath: string;
  receiptFileSha256: string | null;
  migrationNames: string[];
};

export async function createMemoryRepairBackup(args: {
  sourceDbPath: string;
  snapshotDbPath: string;
  stagingDbPath?: string;
}) {
  const sourceDbPath = resolve(args.sourceDbPath);
  const snapshotDbPath = resolve(args.snapshotDbPath);
  const stagingDbPath = args.stagingDbPath
    ? resolve(args.stagingDbPath)
    : undefined;

  assertDistinctPaths(sourceDbPath, snapshotDbPath, "source", "snapshot");
  if (stagingDbPath) {
    assertDistinctPaths(sourceDbPath, stagingDbPath, "source", "staging");
    assertDistinctPaths(snapshotDbPath, stagingDbPath, "snapshot", "staging");
  }
  if (!existsSync(sourceDbPath)) {
    throw new Error(`Source database does not exist: ${sourceDbPath}`);
  }
  for (const outputPath of [snapshotDbPath, stagingDbPath].filter(Boolean) as string[]) {
    if (existsSync(outputPath)) {
      throw new Error(`Refusing to overwrite existing repair artifact: ${outputPath}`);
    }
    mkdirSync(dirname(outputPath), { recursive: true });
  }

  const sourceBaseFileSha256 = await sha256File(sourceDbPath);
  const source = new Database(sourceDbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(snapshotDbPath);
  } finally {
    source.close();
  }

  normalizeOfflineSnapshot(snapshotDbPath);
  const snapshotAudit = await auditMemoryDatabase(snapshotDbPath);
  if (
    snapshotAudit.integrityCheck.length !== 1 ||
    snapshotAudit.integrityCheck[0] !== "ok" ||
    snapshotAudit.foreignKeyViolations.length > 0
  ) {
    throw new Error("SQLite backup failed integrity or foreign-key validation.");
  }

  chmodSync(snapshotDbPath, 0o444);
  let stagingFileSha256: string | undefined;
  if (stagingDbPath) {
    copyFileSync(snapshotDbPath, stagingDbPath);
    chmodSync(stagingDbPath, 0o600);
    stagingFileSha256 = await sha256File(stagingDbPath);
    if (stagingFileSha256 !== snapshotAudit.databaseFileSha256) {
      throw new Error("Staging copy checksum does not match the consistent snapshot.");
    }
  }

  return {
    sourceDbPath,
    snapshotDbPath,
    stagingDbPath: stagingDbPath ?? null,
    sourceBaseFileSha256,
    sourceChecksumScope:
      "base SQLite file only; WAL-aware consistency is represented by the online backup checksum",
    snapshotFileSha256: snapshotAudit.databaseFileSha256,
    stagingFileSha256: stagingFileSha256 ?? null,
    memoryStateSha256: snapshotAudit.memoryStateSha256,
    integrityCheck: snapshotAudit.integrityCheck,
    foreignKeyViolationCount: snapshotAudit.foreignKeyViolations.length,
  };
}

export async function auditMemoryDatabase(
  inputDbPath: string,
): Promise<MemoryIntegrityAudit> {
  const dbPath = requireExistingDatabase(inputDbPath);
  const databaseFileSha256 = await sha256File(dbPath);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.exec("PRAGMA query_only = ON;");
    const integrityCheck = rows<{ integrity_check: string }>(
      db,
      "PRAGMA integrity_check",
    ).map((row) => row.integrity_check);
    const foreignKeyViolations = rows<JsonRow>(db, "PRAGMA foreign_key_check");
    const factOriginProjection = columnExists(db, "L2MemoryFact", "memoryOrigin")
      ? "memoryOrigin"
      : "'legacy_unknown' AS memoryOrigin";
    const facts = rows<JsonRow>(
      db,
      `SELECT id, userId, factType, tag, status, evidenceTraceIds, validationJson,
              ${factOriginProjection}
       FROM L2MemoryFact ORDER BY id`,
    );
    const l1Evidence = loadFactEvidence(db, facts);
    const classifiedFacts = classifyFacts(db, facts, l1Evidence);
    const relationalExecutionEvidence = loadRelationalExecutionEvidenceState(
      db,
      l1Evidence,
    );
    const ftsExists = tableExists(db, "memory_fts");
    const vectorTablePresent = tableExists(db, "memory_vec");
    const vectorMapTablePresent = tableExists(db, "memory_vec_map");
    const eligibleFactDocuments = countEligibleFacts(db);
    const eligibleEpisodeDocuments = countEligibleEpisodes(db);
    const ftsByKind = ftsExists
      ? countByKey(rows<{ kind: string }>(db, "SELECT kind FROM memory_fts"), "kind")
      : {};
    const synthesisByStatus = countByKey(
      rows<{ status: string }>(db, "SELECT status FROM SynthesisSlot"),
      "status",
    );
    const projectionTablePresent = tableExists(db, "memory_vec_projection");
    const projectionRows = projectionTablePresent
      ? countTable(db, "memory_vec_projection")
      : 0;
    const episodeEmbedding = projectionTablePresent
      ? {
          embedded: one<{ n: number }>(
            db,
            "SELECT COUNT(*) n FROM memory_vec_projection WHERE kind = 'episode'",
          ).n,
          pendingEmbeddingCount: one<{ n: number }>(
            db,
            `SELECT COUNT(*) n
               FROM MemoryEpisode e
              WHERE e.memoryOrigin = 'learner'
                AND NOT EXISTS (
                  SELECT 1 FROM memory_vec_projection p
                   WHERE p.ref_id = e.id AND p.kind = 'episode'
                )`,
          ).n,
          vectorOrphanCount: one<{ n: number }>(
            db,
            `SELECT COUNT(*) n
               FROM memory_vec_projection p
              WHERE p.kind = 'episode'
                AND NOT EXISTS (
                  SELECT 1 FROM MemoryEpisode e WHERE e.id = p.ref_id
                )`,
          ).n,
          vectorMapDriftCount:
            (vectorMapTablePresent ? countTable(db, "memory_vec_map") : 0) -
            projectionRows,
        }
      : {
          embedded: 0,
          pendingEmbeddingCount: 0,
          vectorOrphanCount: 0,
          vectorMapDriftCount: 0,
        };
    const schema = inspectMemorySchemaParity(db);
    const memoryStateSha256 = hashStableValue({
      facts,
      factEvidence: [...l1Evidence.values()].sort(compareById),
      relationalExecutionEvidence,
      episodes: rows<JsonRow>(db, "SELECT * FROM MemoryEpisode ORDER BY id"),
      synthesis: rows<JsonRow>(db, "SELECT * FROM SynthesisSlot ORDER BY id"),
      knowledgeNotes: rows<JsonRow>(db, "SELECT * FROM KnowledgeNote ORDER BY id"),
      fts: ftsExists
        ? rows<JsonRow>(
            db,
            "SELECT rowid, content, kind, ref_id FROM memory_fts ORDER BY kind, ref_id, rowid",
          )
        : [],
    });

    return {
      version: 1,
      databaseFileSha256,
      memoryStateSha256,
      integrityCheck,
      foreignKeyViolations,
      counts: {
        users: countTable(db, "User"),
        l1Events: countTable(db, "L1MemoryEvent"),
        l2Facts: facts.length,
        episodes: countTable(db, "MemoryEpisode"),
        synthesisSlots: countTable(db, "SynthesisSlot"),
        knowledgeNotes: countTable(db, "KnowledgeNote"),
        ftsDocuments: ftsExists ? countTable(db, "memory_fts") : 0,
      },
      facts: classifiedFacts,
      synthesis: {
        active: synthesisByStatus.active ?? 0,
        byStatus: synthesisByStatus,
      },
      fts: {
        exists: ftsExists,
        byKind: ftsByKind,
        eligibleFactDocuments,
        orphanFactDocuments: ftsExists
          ? countOrphanFactDocuments(db)
          : 0,
        missingFactDocuments: ftsExists
          ? countMissingFactDocuments(db)
          : eligibleFactDocuments,
        eligibleEpisodeDocuments,
        orphanEpisodeDocuments: ftsExists
          ? countOrphanEpisodeDocuments(db)
          : 0,
        missingEpisodeDocuments: ftsExists
          ? countMissingEpisodeDocuments(db)
          : eligibleEpisodeDocuments,
        duplicateDocumentKeys: ftsExists
          ? scalarCount(
              db,
              `SELECT COUNT(*) count FROM (
                 SELECT kind, ref_id FROM memory_fts
                 GROUP BY kind, ref_id HAVING COUNT(*) > 1
               )`,
            )
          : 0,
      },
      vector: {
        mode: vectorTablePresent || vectorMapTablePresent ? "vector_present" : "fts_only",
        tablePresent: vectorTablePresent,
        mapTablePresent: vectorMapTablePresent,
        mapRows: vectorMapTablePresent ? countTable(db, "memory_vec_map") : 0,
        embeddedEpisodes: episodeEmbedding.embedded,
        pendingEmbeddingCount: episodeEmbedding.pendingEmbeddingCount,
        vectorOrphanCount: episodeEmbedding.vectorOrphanCount,
        vectorMapDriftCount: episodeEmbedding.vectorMapDriftCount,
      },
      schema,
    };
  } finally {
    db.close();
  }
}

export async function buildMemoryRepairPlan(
  dbPath: string,
): Promise<{ plan: MemoryRepairPlan; planSha256: string }> {
  const audit = await auditMemoryDatabase(dbPath);
  assertHealthyAudit(audit);
  const db = new Database(requireExistingDatabase(dbPath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.exec("PRAGMA query_only = ON;");
    const factById = new Map(
      rows<{
        id: string;
        userId: string;
        factType: string;
        tag: string;
        status: string;
        validationJson: string;
        memoryOrigin: string;
      }>(
        db,
        `SELECT id, userId, factType, tag, status, validationJson,
                ${columnExists(db, "L2MemoryFact", "memoryOrigin") ? "memoryOrigin" : "'legacy_unknown' AS memoryOrigin"}
         FROM L2MemoryFact ORDER BY id`,
      ).map((fact) => [fact.id, fact]),
    );
    const reasonByFactId = new Map<string, Set<string>>();
    for (const category of [
      audit.facts.blocked,
      audit.facts.invalidEvidence,
      audit.facts.assistantOnlyPreferences,
    ]) {
      for (const fact of category) {
        const reasons = reasonByFactId.get(fact.id) ?? new Set<string>();
        fact.reasons.forEach((reason) => reasons.add(reason));
        reasonByFactId.set(fact.id, reasons);
      }
    }
    const quarantineFacts = [...reasonByFactId.entries()]
      .map(([id, reasons]): FactQuarantineAction => {
        const fact = factById.get(id);
        if (!fact) throw new Error(`Fact disappeared while planning: ${id}`);
        return {
          id,
          userId: fact.userId,
          factType: fact.factType,
          tag: fact.tag,
          reasons: [...reasons].sort(),
          before: {
            status: fact.status,
            validationJson: fact.validationJson,
          },
        };
      })
      .sort(compareById);
    const synthesisHasOrigin = columnExists(
      db,
      "SynthesisSlot",
      "memoryOrigin",
    );
    const synthesisOriginProjection = synthesisHasOrigin
      ? "memoryOrigin"
      : "'legacy_unknown' AS memoryOrigin";
    const synthesisOriginExpression = synthesisHasOrigin
      ? "memoryOrigin"
      : "'legacy_unknown'";
    const invalidateSynthesis = rows<{
      id: string;
      userId: string;
      slot: string;
      synthesisKey: string;
      status: string;
      memoryOrigin: string;
    }>(
      db,
      `SELECT id, userId, slot, synthesisKey, status, ${synthesisOriginProjection}
       FROM SynthesisSlot
       WHERE status = 'active' AND ${synthesisOriginExpression} <> 'learner'
       ORDER BY id`,
    ).map((slot) => ({
      id: slot.id,
      userId: slot.userId,
      slot: slot.slot,
      synthesisKey: slot.synthesisKey,
      beforeStatus: slot.status,
      reason: "legacy_synthesis_requires_trusted_rebuild" as const,
    }));
    const activeKnowledgeNotes = scalarCount(
      db,
      "SELECT COUNT(*) count FROM KnowledgeNote WHERE status = 'active'",
    );
    const quarantinedFactIds = new Set(
      quarantineFacts.map((action) => action.id),
    );
    const factDocuments = buildFactFtsTruthDocuments(db).filter(
      (document) => !quarantinedFactIds.has(document.refId),
    ).length;
    const expectedIndexTruth = {
      factDocuments,
      episodeDocuments: audit.fts.eligibleEpisodeDocuments,
      knowledgeBaseDocuments: buildKbDocuments().length,
      activeKnowledgeNoteDocuments: activeKnowledgeNotes,
      totalDocuments:
        factDocuments +
        audit.fts.eligibleEpisodeDocuments +
        buildKbDocuments().length +
        activeKnowledgeNotes,
      factEligibilityMode:
        "trusted_learner_fact_with_human_teaching_text_fail_closed" as const,
      episodeEligibilityMode:
        "learner_origin_and_blocked_text_safe_fail_closed" as const,
      vectorMode: "fts_only" as const,
    };
    const seed = hashStableValue({
      source: audit.memoryStateSha256,
      quarantineFacts,
      invalidateSynthesis,
      expectedIndexTruth,
    });
    const plan: MemoryRepairPlan = {
      version: MEMORY_REPAIR_PLAN_VERSION,
      repairRunId: `memory-repair-${seed.slice(0, 16)}`,
      source: {
        databaseFileSha256: audit.databaseFileSha256,
        memoryStateSha256: audit.memoryStateSha256,
      },
      actions: { quarantineFacts, invalidateSynthesis },
      expectedIndexTruth,
      warnings: [
        "Repair plan v2 adds trusted learner fact documents to FTS relational truth. Version 1 plans must be regenerated; existing version 1 cutover receipts remain readable and rollback-compatible.",
        "MemoryEpisode indexing is fail-closed: only memoryOrigin=learner episodes without blocked development-noise text are eligible. If the origin column is absent, every episode is legacy_unknown and none is indexed.",
        "All non-learner L2 facts and active synthesis are quarantined/invalidated. Rebuild requires explicit learner origin; legacy_unknown is never promoted by inference.",
        "Vector rebuilding is intentionally disabled in Phase 4A. Episodes remain pending and retrieval is explicitly fts_only.",
      ],
    };
    return { plan, planSha256: hashRepairPlan(plan) };
  } finally {
    db.close();
  }
}

export async function applyMemoryRepairPlan(args: {
  dbPath: string;
  liveDbPath: string;
  plan: MemoryRepairPlan;
  expectedPlanSha256: string;
  expectedDbSha256: string;
  mode: "dry-run" | "apply";
}): Promise<RepairApplyResult> {
  assertValidPlan(args.plan, args.expectedPlanSha256);
  const dbPath = requireExistingDatabase(args.dbPath);
  if (args.mode === "apply") {
    assertNotLiveDatabase(dbPath, args.liveDbPath);
  }
  const beforeAudit = await auditMemoryDatabase(dbPath);
  const alreadyApplied = await isRepairPlanApplied(dbPath, args.plan, args.expectedPlanSha256);
  if (!alreadyApplied) {
    if (beforeAudit.databaseFileSha256 !== args.expectedDbSha256) {
      throw new Error(
        `Database checksum drift: expected ${args.expectedDbSha256}, got ${beforeAudit.databaseFileSha256}`,
      );
    }
    if (beforeAudit.memoryStateSha256 !== args.plan.source.memoryStateSha256) {
      throw new Error("Memory state drifted after the repair plan was generated.");
    }
  }

  if (args.mode === "dry-run" || alreadyApplied) {
    const visibility = await countPlanVisibility(dbPath, args.plan, args.expectedPlanSha256);
    return {
      mode: args.mode,
      repairRunId: args.plan.repairRunId,
      planSha256: args.expectedPlanSha256,
      alreadyApplied,
      factRowsChanged: 0,
      synthesisRowsChanged: 0,
      ...visibility,
    };
  }

  const db = new Database(dbPath, { fileMustExist: true });
  let factRowsChanged = 0;
  let synthesisRowsChanged = 0;
  try {
    const updateFact = db.prepare(
      `UPDATE L2MemoryFact
       SET status = 'stale', validationJson = ?, updatedAt = ?
       WHERE id = ?`,
    );
    const updateSynthesis = db.prepare(
      `UPDATE SynthesisSlot SET status = 'stale', updatedAt = ? WHERE id = ?`,
    );
    const apply = db.transaction(() => {
      const updatedAt = new Date().toISOString();
      for (const action of args.plan.actions.quarantineFacts) {
        const validation = withQuarantineMetadata(action.before.validationJson, {
          repairRunId: args.plan.repairRunId,
          planSha256: args.expectedPlanSha256,
          reasons: action.reasons,
          previousStatus: action.before.status,
        });
        factRowsChanged += Number(
          updateFact.run(validation, updatedAt, action.id).changes,
        );
      }
      for (const action of args.plan.actions.invalidateSynthesis) {
        synthesisRowsChanged += Number(
          updateSynthesis.run(updatedAt, action.id).changes,
        );
      }
    });
    apply();
  } finally {
    db.close();
  }

  if (factRowsChanged !== args.plan.actions.quarantineFacts.length) {
    throw new Error("Applied fact quarantine count does not match the dry-run plan.");
  }
  if (synthesisRowsChanged !== args.plan.actions.invalidateSynthesis.length) {
    throw new Error("Applied synthesis invalidation count does not match the dry-run plan.");
  }
  const visibility = await countPlanVisibility(dbPath, args.plan, args.expectedPlanSha256);
  return {
    mode: args.mode,
    repairRunId: args.plan.repairRunId,
    planSha256: args.expectedPlanSha256,
    alreadyApplied: false,
    factRowsChanged,
    synthesisRowsChanged,
    ...visibility,
  };
}

export async function rebuildMemoryFtsIndex(args: {
  dbPath: string;
  liveDbPath: string;
  plan: MemoryRepairPlan;
  expectedPlanSha256: string;
  mode: "dry-run" | "apply";
}): Promise<IndexRebuildResult> {
  assertValidPlan(args.plan, args.expectedPlanSha256);
  const dbPath = requireExistingDatabase(args.dbPath);
  if (args.mode === "apply") {
    assertNotLiveDatabase(dbPath, args.liveDbPath);
  }
  const planState = await countPlanVisibility(
    dbPath,
    args.plan,
    args.expectedPlanSha256,
  );
  if (
    planState.factsRemainingVisibleFromPlan > 0 ||
    planState.synthesisRemainingActiveFromPlan > 0
  ) {
    throw new Error("Apply the quarantine plan before rebuilding derived indexes.");
  }

  const db = new Database(dbPath, {
    readonly: args.mode === "dry-run",
    fileMustExist: true,
  });
  try {
    if (args.mode === "dry-run") db.exec("PRAGMA query_only = ON;");
    const beforeDocuments = tableExists(db, "memory_fts")
      ? countTable(db, "memory_fts")
      : 0;
    const documents = buildFtsTruthDocuments(db);
    const expectedByKind = countByKey(documents, "kind");
    const expectedDocuments = documents.length;
    const vectorMapRows = tableExists(db, "memory_vec_map")
      ? countTable(db, "memory_vec_map")
      : 0;

    if (args.mode === "dry-run") {
      return {
        mode: args.mode,
        planSha256: args.expectedPlanSha256,
        beforeDocuments,
        expectedDocuments,
        expectedByKind,
        afterDocuments: null,
        orphanFactDocuments: null,
        missingFactDocuments: null,
        orphanEpisodeDocuments: null,
        missingEpisodeDocuments: null,
        duplicateDocumentKeys: null,
        vectorMode: "fts_only",
        clearedVectorRows: vectorMapRows,
      };
    }

    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      content,
      kind UNINDEXED,
      ref_id UNINDEXED,
      tokenize = 'unicode61'
    );`);
    const insert = db.prepare(
      "INSERT INTO memory_fts (content, kind, ref_id) VALUES (?, ?, ?)",
    );
    const rebuild = db.transaction(() => {
      db.exec("DELETE FROM memory_fts;");
      for (const document of documents) {
        insert.run(document.content, document.kind, document.refId);
      }
      if (tableExists(db, "memory_vec_map")) {
        db.exec("DELETE FROM memory_vec_map;");
      }
      if (tableExists(db, "memory_vec_projection")) {
        db.exec("DELETE FROM memory_vec_projection;");
      }
      const after = countTable(db, "memory_fts");
      if (after !== expectedDocuments) {
        throw new Error(
          `FTS rebuild count mismatch: expected ${expectedDocuments}, got ${after}`,
        );
      }
      if (countDuplicateFtsKeys(db) !== 0) {
        throw new Error("FTS rebuild produced duplicate document keys.");
      }
      if (countOrphanFactDocuments(db) !== 0) {
        throw new Error("FTS rebuild produced orphan fact documents.");
      }
      if (countMissingFactDocuments(db) !== 0) {
        throw new Error("FTS rebuild omitted relational fact documents.");
      }
      if (countOrphanEpisodeDocuments(db) !== 0) {
        throw new Error("FTS rebuild produced orphan episode documents.");
      }
      if (countMissingEpisodeDocuments(db) !== 0) {
        throw new Error("FTS rebuild omitted relational episode documents.");
      }
    });
    rebuild();

    return {
      mode: args.mode,
      planSha256: args.expectedPlanSha256,
      beforeDocuments,
      expectedDocuments,
      expectedByKind,
      afterDocuments: countTable(db, "memory_fts"),
      orphanFactDocuments: countOrphanFactDocuments(db),
      missingFactDocuments: countMissingFactDocuments(db),
      orphanEpisodeDocuments: countOrphanEpisodeDocuments(db),
      missingEpisodeDocuments: countMissingEpisodeDocuments(db),
      duplicateDocumentKeys: countDuplicateFtsKeys(db),
      vectorMode: "fts_only",
      clearedVectorRows: vectorMapRows,
    };
  } finally {
    db.close();
  }
}

export async function verifyMemoryRepair(args: {
  dbPath: string;
  plan: MemoryRepairPlan;
  expectedPlanSha256: string;
}): Promise<MemoryIntegrityVerification> {
  assertValidPlan(args.plan, args.expectedPlanSha256);
  const audit = await auditMemoryDatabase(args.dbPath);
  const visibility = await countPlanVisibility(
    args.dbPath,
    args.plan,
    args.expectedPlanSha256,
  );
  const metadataMismatch = await findQuarantineMetadataMismatch(
    args.dbPath,
    args.plan,
    args.expectedPlanSha256,
  );
  const prismaReadWriteSmoke = await runCurrentPrismaMemorySchemaSmoke(
    args.dbPath,
  );
  const failures: string[] = [];
  if (audit.integrityCheck.length !== 1 || audit.integrityCheck[0] !== "ok") {
    failures.push("integrity_check_failed");
  }
  if (audit.foreignKeyViolations.length > 0) failures.push("foreign_key_violation");
  if (visibility.factsRemainingVisibleFromPlan > 0) {
    failures.push("planned_fact_still_visible");
  }
  if (visibility.synthesisRemainingActiveFromPlan > 0) {
    failures.push("planned_synthesis_still_active");
  }
  if (metadataMismatch.length > 0) failures.push("quarantine_metadata_mismatch");
  if (audit.facts.blocked.some((fact) => fact.status !== "stale")) {
    failures.push("blocked_fact_not_stale");
  }
  if (audit.fts.orphanFactDocuments !== 0) failures.push("fts_fact_orphan");
  if (audit.fts.missingFactDocuments !== 0) failures.push("fts_fact_missing");
  if (
    (audit.fts.byKind.fact ?? 0) !==
    args.plan.expectedIndexTruth.factDocuments
  ) {
    failures.push("fts_fact_count_mismatch");
  }
  if (audit.fts.orphanEpisodeDocuments !== 0) failures.push("fts_episode_orphan");
  if (audit.fts.missingEpisodeDocuments !== 0) failures.push("fts_episode_missing");
  if (audit.fts.duplicateDocumentKeys !== 0) failures.push("fts_duplicate_key");
  if (
    audit.counts.ftsDocuments !== args.plan.expectedIndexTruth.totalDocuments
  ) {
    failures.push("fts_total_mismatch");
  }
  if (audit.vector.embeddedEpisodes !== 0 || audit.vector.mapRows !== 0) {
    failures.push("vector_not_fts_only");
  }
  if (audit.schema.missingTables.length > 0) failures.push("schema_table_missing");
  if (audit.schema.missingColumns.length > 0) failures.push("schema_column_missing");
  if (audit.schema.missingIndexes.length > 0) failures.push("schema_index_missing");
  if (audit.schema.mismatchedIndexes.length > 0) {
    failures.push("schema_index_mismatch");
  }
  if (audit.schema.forbiddenLegacyIndexesPresent.length > 0) {
    failures.push("legacy_unique_index_present");
  }
  if (audit.schema.missingMigrationRecords.length > 0) {
    failures.push("prisma_migration_missing");
  }
  if (audit.schema.invalidMigrationRecords.length > 0) {
    failures.push("prisma_migration_invalid");
  }
  if (!prismaReadWriteSmoke.ok) failures.push("prisma_read_write_smoke_failed");

  return {
    ok: failures.length === 0,
    audit,
    plannedFactRowsStillVisible: visibility.factsRemainingVisibleFromPlan,
    plannedSynthesisRowsStillActive:
      visibility.synthesisRemainingActiveFromPlan,
    planQuarantineMetadataMismatch: metadataMismatch,
    expectedFtsDocuments: args.plan.expectedIndexTruth.totalDocuments,
    prismaReadWriteSmoke,
    failures,
  };
}

export async function migrateMemoryStagingFromSnapshot(args: {
  sourceSnapshotPath: string;
  stagingDbPath: string;
  receiptPath: string;
  expectedSourceSnapshotSha256: string;
  mode: "dry-run" | "apply";
}): Promise<StagingMigrationResult> {
  const sourceSnapshotPath = requireSafeDatabasePath(
    args.sourceSnapshotPath,
    "source SQLite snapshot",
  );
  assertImmutableSqliteSnapshot(sourceSnapshotPath);
  const stagingDbPath = requireSafeOutputPath(
    args.stagingDbPath,
    "migrated staging database",
  );
  const receiptPath = requireSafeOutputPath(
    args.receiptPath,
    "staging migration receipt",
  );
  assertDistinctArtifactPaths([
    ["source snapshot", sourceSnapshotPath],
    ["migrated staging database", stagingDbPath],
    ["staging migration receipt", receiptPath],
  ]);
  const sourceAudit = await auditMemoryDatabase(sourceSnapshotPath);
  assertHealthyAudit(sourceAudit);
  if (sourceAudit.databaseFileSha256 !== args.expectedSourceSnapshotSha256) {
    throw new Error("Source snapshot checksum does not match the expected SHA256.");
  }
  assertOriginMigrationCanStartFromSnapshot(sourceSnapshotPath);
  const repositoryMigrations = loadRepositoryMigrations();

  if (args.mode === "dry-run") {
    return {
      mode: "dry-run",
      ready: true,
      sourceSnapshotPath,
      sourceSnapshotSha256: sourceAudit.databaseFileSha256,
      stagingDbPath,
      stagingDbSha256: null,
      receiptPath,
      receiptFileSha256: null,
      migrationNames: repositoryMigrations.map((migration) => migration.name),
    };
  }

  const candidatePath = resolve(
    dirname(stagingDbPath),
    `.${basename(stagingDbPath)}.migrate-${randomUUID()}.tmp`,
  );
  let stagingInstalled = false;
  try {
    copyFileSync(
      sourceSnapshotPath,
      candidatePath,
      fsConstants.COPYFILE_EXCL,
    );
    chmodSync(candidatePath, 0o600);
    fsyncFile(candidatePath);
    if ((await sha256File(candidatePath)) !== args.expectedSourceSnapshotSha256) {
      throw new Error("Staging migration candidate copy checksum mismatch.");
    }
    applyOriginMigration(candidatePath, repositoryMigrations);
    const migratedAudit = await auditMemoryDatabase(candidatePath);
    assertHealthyAudit(migratedAudit);
    if (!migratedAudit.schema.ok) {
      throw new Error(
        `Migrated staging schema parity failed: ${formatSchemaParityFailures(migratedAudit.schema).join(", ")}`,
      );
    }
    const prismaSmoke = await runCurrentPrismaMemorySchemaSmoke(candidatePath);
    if (!prismaSmoke.ok) {
      throw new Error(`Current Prisma read/write smoke failed: ${prismaSmoke.error}`);
    }
    fsyncFile(candidatePath);
    renameSync(candidatePath, stagingDbPath);
    fsyncDirectory(dirname(stagingDbPath));
    stagingInstalled = true;

    const installedAudit = await auditMemoryDatabase(stagingDbPath);
    assertHealthyAudit(installedAudit);
    if (!installedAudit.schema.ok) {
      throw new Error("Installed staging database lost schema parity.");
    }
    const receipt: StagingMigrationReceipt = {
      version: MEMORY_STAGING_MIGRATION_RECEIPT_VERSION,
      migrationRunId: `memory-staging-migration-${randomUUID()}`,
      completedAt: new Date().toISOString(),
      sourceSnapshot: {
        path: sourceSnapshotPath,
        databaseFileSha256: sourceAudit.databaseFileSha256,
        memoryStateSha256: sourceAudit.memoryStateSha256,
      },
      migratedStaging: {
        path: stagingDbPath,
        databaseFileSha256: installedAudit.databaseFileSha256,
        memoryStateSha256: installedAudit.memoryStateSha256,
      },
      migrationNames: repositoryMigrations.map((migration) => migration.name),
    };
    writeJsonFileAtomically(receiptPath, receipt);
    return {
      mode: "apply",
      ready: true,
      sourceSnapshotPath,
      sourceSnapshotSha256: sourceAudit.databaseFileSha256,
      stagingDbPath,
      stagingDbSha256: installedAudit.databaseFileSha256,
      receiptPath,
      receiptFileSha256: await sha256File(receiptPath),
      migrationNames: receipt.migrationNames,
    };
  } catch (error) {
    if (stagingInstalled) removeFileAndSyncDirectory(stagingDbPath);
    removeFileAndSyncDirectory(receiptPath);
    throw error;
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath, { force: true });
  }
}

export function readStagingMigrationReceipt(
  path: string,
): StagingMigrationReceipt {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as StagingMigrationReceipt;
  if (parsed.version !== MEMORY_STAGING_MIGRATION_RECEIPT_VERSION) {
    throw new Error(
      `Unsupported staging migration receipt version: ${String(parsed.version)}`,
    );
  }
  if (
    !parsed.migrationRunId ||
    !parsed.sourceSnapshot?.path ||
    !parsed.sourceSnapshot.databaseFileSha256 ||
    !parsed.sourceSnapshot.memoryStateSha256 ||
    !parsed.migratedStaging?.path ||
    !parsed.migratedStaging.databaseFileSha256 ||
    !parsed.migratedStaging.memoryStateSha256 ||
    !Array.isArray(parsed.migrationNames) ||
    !parsed.migrationNames.includes(MEMORY_ORIGIN_MIGRATION_NAME)
  ) {
    throw new Error("Malformed staging migration receipt.");
  }
  return parsed;
}

export async function cutoverMemoryDatabase(args: {
  liveDbPath: string;
  stagingDbPath: string;
  retainedBackupPath: string;
  receiptPath: string;
  stagingMigrationReceiptPath: string;
  expectedStagingMigrationReceiptFileSha256: string;
  plan: MemoryRepairPlan;
  expectedPlanSha256: string;
  expectedStagingDbSha256: string;
  mode: "dry-run" | "apply";
  webUiPort?: number;
  /** @internal Tests only. The CLI never exposes fault injection. */
  __testFaultAfterReplace?: boolean;
}): Promise<MemoryCutoverResult> {
  assertValidPlan(args.plan, args.expectedPlanSha256);
  assertTestFaultIsTestOnly(args.__testFaultAfterReplace);
  const liveDbPath = requireSafeDatabasePath(args.liveDbPath, "live database");
  const stagingDbPath = requireSafeDatabasePath(
    args.stagingDbPath,
    "verified staging database",
  );
  const retainedBackupPath = requireSafeOutputPath(
    args.retainedBackupPath,
    "retained pre-cutover backup",
  );
  const receiptPath = requireSafeOutputPath(
    args.receiptPath,
    "cutover receipt",
  );
  const stagingMigrationReceiptPath = requireSafeExistingFilePath(
    args.stagingMigrationReceiptPath,
    "staging migration receipt",
  );
  const stagingMigrationReceiptFileSha256 = await sha256File(
    stagingMigrationReceiptPath,
  );
  if (
    stagingMigrationReceiptFileSha256 !==
    args.expectedStagingMigrationReceiptFileSha256
  ) {
    throw new Error("Staging migration receipt file checksum mismatch.");
  }
  const stagingMigrationReceipt = readStagingMigrationReceipt(
    stagingMigrationReceiptPath,
  );
  if (stagingMigrationReceipt.migratedStaging.path !== stagingDbPath) {
    throw new Error("Staging migration receipt is bound to a different staging path.");
  }
  if (
    stagingMigrationReceipt.migratedStaging.databaseFileSha256 !==
      args.plan.source.databaseFileSha256 ||
    stagingMigrationReceipt.migratedStaging.memoryStateSha256 !==
      args.plan.source.memoryStateSha256
  ) {
    throw new Error("Repair plan source is not bound to the migrated staging receipt.");
  }
  assertDistinctArtifactPaths([
    ["live database", liveDbPath],
    ["staging database", stagingDbPath],
    ["retained backup", retainedBackupPath],
    ["cutover receipt", receiptPath],
    ["staging migration receipt", stagingMigrationReceiptPath],
  ]);

  const port = args.webUiPort ?? MEMORY_CUTOVER_WEB_UI_PORT;
  await assertMemoryWritersStopped(liveDbPath, port);
  const stagingAudit = await assertVerifiedStaging({
    stagingDbPath,
    plan: args.plan,
    expectedPlanSha256: args.expectedPlanSha256,
    expectedStagingDbSha256: args.expectedStagingDbSha256,
  });
  await assertMemoryWritersStopped(liveDbPath, port);

  if (args.mode === "dry-run") {
    return {
      mode: "dry-run",
      ready: true,
      planSha256: args.expectedPlanSha256,
      migrationReceiptFileSha256: stagingMigrationReceiptFileSha256,
      liveDbPath,
      stagingDbPath,
      stagingDbSha256: stagingAudit.databaseFileSha256,
      retainedBackupPath,
      retainedBackupSha256: null,
      receiptPath,
      receiptFileSha256: null,
      installedDbSha256: null,
      rolledBackAfterFailure: false,
    };
  }

  const backup = await createMemoryRepairBackup({
    sourceDbPath: liveDbPath,
    snapshotDbPath: retainedBackupPath,
  });
  if (
    backup.snapshotFileSha256 !==
      stagingMigrationReceipt.sourceSnapshot.databaseFileSha256 ||
    backup.memoryStateSha256 !==
      stagingMigrationReceipt.sourceSnapshot.memoryStateSha256
  ) {
    throw new Error(
      "Fresh online backup does not match the source snapshot bound to the staging migration receipt.",
    );
  }

  await assertTcpPortHasNoListener(port);
  checkpointAndRemoveSqliteSidecars(liveDbPath);
  await assertMemoryWritersStopped(liveDbPath, port);
  const stagingShaImmediatelyBeforeReplace = await sha256File(stagingDbPath);
  if (stagingShaImmediatelyBeforeReplace !== args.expectedStagingDbSha256) {
    throw new Error("Staging database checksum drifted after verification.");
  }

  let liveWasReplaced = false;
  let rolledBackAfterFailure = false;
  try {
    await atomicInstallDatabase({
      sourceDbPath: stagingDbPath,
      liveDbPath,
      expectedSourceSha256: args.expectedStagingDbSha256,
    });
    liveWasReplaced = true;
    if (args.__testFaultAfterReplace) {
      throw new Error("Injected cutover failure after live replacement.");
    }

    const installedVerification = await verifyMemoryRepair({
      dbPath: liveDbPath,
      plan: args.plan,
      expectedPlanSha256: args.expectedPlanSha256,
    });
    if (!installedVerification.ok) {
      throw new Error(
        `Installed database failed memory verification: ${installedVerification.failures.join(", ")}`,
      );
    }
    if (
      installedVerification.audit.databaseFileSha256 !==
      args.expectedStagingDbSha256
    ) {
      throw new Error("Installed database checksum does not match verified staging.");
    }
    removeEmptyReadSidecars(liveDbPath);
    assertNoSqliteSidecars(liveDbPath);

    const receipt: MemoryCutoverReceipt = {
      version: MEMORY_CUTOVER_RECEIPT_VERSION,
      repairPlanVersion: args.plan.version,
      cutoverId: `memory-cutover-${randomUUID()}`,
      completedAt: new Date().toISOString(),
      planSha256: args.expectedPlanSha256,
      stagingMigrationReceiptFileSha256,
      liveDbPath,
      stagingDbPath,
      retainedBackup: {
        path: retainedBackupPath,
        databaseFileSha256: backup.snapshotFileSha256,
        memoryStateSha256: backup.memoryStateSha256,
      },
      installed: {
        databaseFileSha256: installedVerification.audit.databaseFileSha256,
        memoryStateSha256: installedVerification.audit.memoryStateSha256,
      },
    };
    writeJsonFileAtomically(receiptPath, receipt);
    const receiptFileSha256 = await sha256File(receiptPath);
    return {
      mode: "apply",
      ready: true,
      planSha256: args.expectedPlanSha256,
      migrationReceiptFileSha256: stagingMigrationReceiptFileSha256,
      liveDbPath,
      stagingDbPath,
      stagingDbSha256: stagingAudit.databaseFileSha256,
      retainedBackupPath,
      retainedBackupSha256: backup.snapshotFileSha256,
      receiptPath,
      receiptFileSha256,
      installedDbSha256: installedVerification.audit.databaseFileSha256,
      rolledBackAfterFailure,
    };
  } catch (error) {
    if (liveWasReplaced) {
      try {
        await atomicInstallDatabase({
          sourceDbPath: retainedBackupPath,
          liveDbPath,
          expectedSourceSha256: backup.snapshotFileSha256,
        });
        const restoredAudit = await auditMemoryDatabase(liveDbPath);
        assertHealthyAudit(restoredAudit);
        if (
          restoredAudit.databaseFileSha256 !== backup.snapshotFileSha256 ||
          restoredAudit.memoryStateSha256 !== backup.memoryStateSha256
        ) {
          throw new Error("Rollback checksum or logical memory state mismatch.");
        }
        removeFileAndSyncDirectory(receiptPath);
        rolledBackAfterFailure = true;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Memory cutover failed and automatic rollback also failed. Retained backup: ${retainedBackupPath}`,
        );
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Memory cutover failed${rolledBackAfterFailure ? "; live database was restored from the retained backup" : ""}: ${detail}`,
      { cause: error },
    );
  }
}

export async function rollbackMemoryCutover(args: {
  liveDbPath: string;
  receiptPath: string;
  expectedReceiptFileSha256: string;
  safetyBackupPath: string;
  mode: "dry-run" | "apply";
  webUiPort?: number;
  /** @internal Tests only. The CLI never exposes fault injection. */
  __testFaultAfterReplace?: boolean;
}): Promise<MemoryRollbackResult> {
  assertTestFaultIsTestOnly(args.__testFaultAfterReplace);
  const liveDbPath = requireSafeDatabasePath(args.liveDbPath, "live database");
  const receiptPath = requireSafeExistingFilePath(
    args.receiptPath,
    "cutover receipt",
  );
  const receiptFileSha256 = await sha256File(receiptPath);
  if (receiptFileSha256 !== args.expectedReceiptFileSha256) {
    throw new Error("Cutover receipt file checksum mismatch.");
  }
  const receipt = readMemoryCutoverReceipt(receiptPath);
  if (receipt.liveDbPath !== liveDbPath) {
    throw new Error("Cutover receipt is bound to a different live database path.");
  }
  const retainedBackupPath = requireSafeDatabasePath(
    receipt.retainedBackup.path,
    "retained pre-cutover backup",
  );
  const safetyBackupPath = requireSafeOutputPath(
    args.safetyBackupPath,
    "pre-rollback safety backup",
  );
  assertDistinctArtifactPaths([
    ["live database", liveDbPath],
    ["retained backup", retainedBackupPath],
    ["rollback safety backup", safetyBackupPath],
    ["cutover receipt", receiptPath],
  ]);

  const port = args.webUiPort ?? MEMORY_CUTOVER_WEB_UI_PORT;
  await assertMemoryWritersStopped(liveDbPath, port);
  if ((await sha256File(liveDbPath)) !== receipt.installed.databaseFileSha256) {
    throw new Error(
      "Live database changed after cutover; refusing to overwrite newer state during rollback.",
    );
  }
  const retainedBackupAudit = await auditMemoryDatabase(retainedBackupPath);
  assertHealthyAudit(retainedBackupAudit);
  if (
    retainedBackupAudit.databaseFileSha256 !==
      receipt.retainedBackup.databaseFileSha256 ||
    retainedBackupAudit.memoryStateSha256 !== receipt.retainedBackup.memoryStateSha256
  ) {
    throw new Error("Retained backup does not match the checksum-bound cutover receipt.");
  }

  if (args.mode === "dry-run") {
    return {
      mode: "dry-run",
      ready: true,
      cutoverId: receipt.cutoverId,
      liveDbPath,
      restoredDbSha256: null,
      safetyBackupPath,
      safetyBackupSha256: null,
      rolledBackAfterFailure: false,
    };
  }

  const safetyBackup = await createMemoryRepairBackup({
    sourceDbPath: liveDbPath,
    snapshotDbPath: safetyBackupPath,
  });
  if (
    safetyBackup.sourceBaseFileSha256 !== receipt.installed.databaseFileSha256 ||
    safetyBackup.memoryStateSha256 !== receipt.installed.memoryStateSha256
  ) {
    throw new Error("Fresh rollback safety backup does not match current live state.");
  }
  await assertTcpPortHasNoListener(port);
  checkpointAndRemoveSqliteSidecars(liveDbPath);
  await assertMemoryWritersStopped(liveDbPath, port);

  let liveWasReplaced = false;
  let rolledBackAfterFailure = false;
  try {
    await atomicInstallDatabase({
      sourceDbPath: retainedBackupPath,
      liveDbPath,
      expectedSourceSha256: receipt.retainedBackup.databaseFileSha256,
    });
    liveWasReplaced = true;
    if (args.__testFaultAfterReplace) {
      throw new Error("Injected rollback failure after live replacement.");
    }
    const restoredAudit = await auditMemoryDatabase(liveDbPath);
    assertHealthyAudit(restoredAudit);
    if (
      restoredAudit.databaseFileSha256 !==
        receipt.retainedBackup.databaseFileSha256 ||
      restoredAudit.memoryStateSha256 !== receipt.retainedBackup.memoryStateSha256
    ) {
      throw new Error("Restored database does not match retained backup.");
    }
    removeEmptyReadSidecars(liveDbPath);
    assertNoSqliteSidecars(liveDbPath);
    return {
      mode: "apply",
      ready: true,
      cutoverId: receipt.cutoverId,
      liveDbPath,
      restoredDbSha256: restoredAudit.databaseFileSha256,
      safetyBackupPath,
      safetyBackupSha256: safetyBackup.snapshotFileSha256,
      rolledBackAfterFailure,
    };
  } catch (error) {
    if (liveWasReplaced) {
      try {
        await atomicInstallDatabase({
          sourceDbPath: safetyBackupPath,
          liveDbPath,
          expectedSourceSha256: safetyBackup.snapshotFileSha256,
        });
        const recoveredAudit = await auditMemoryDatabase(liveDbPath);
        assertHealthyAudit(recoveredAudit);
        if (
          recoveredAudit.databaseFileSha256 !== safetyBackup.snapshotFileSha256 ||
          recoveredAudit.memoryStateSha256 !== safetyBackup.memoryStateSha256
        ) {
          throw new Error("Rollback failure recovery checksum mismatch.");
        }
        rolledBackAfterFailure = true;
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Memory rollback failed and recovery of the installed database also failed. Safety backup: ${safetyBackupPath}`,
        );
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Memory rollback failed${rolledBackAfterFailure ? "; installed database was recovered from the safety backup" : ""}: ${detail}`,
      { cause: error },
    );
  }
}

export function readMemoryCutoverReceipt(path: string): MemoryCutoverReceipt {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as MemoryCutoverReceipt;
  if (parsed.version !== MEMORY_CUTOVER_RECEIPT_VERSION) {
    throw new Error(`Unsupported memory cutover receipt version: ${String(parsed.version)}`);
  }
  if (
    (parsed.repairPlanVersion !== undefined &&
      parsed.repairPlanVersion !== LEGACY_MEMORY_REPAIR_PLAN_VERSION &&
      parsed.repairPlanVersion !== MEMORY_REPAIR_PLAN_VERSION) ||
    !parsed.cutoverId ||
    !parsed.planSha256 ||
    !parsed.stagingMigrationReceiptFileSha256 ||
    !parsed.liveDbPath ||
    !parsed.stagingDbPath ||
    !parsed.retainedBackup?.path ||
    !parsed.retainedBackup.databaseFileSha256 ||
    !parsed.retainedBackup.memoryStateSha256 ||
    !parsed.installed?.databaseFileSha256 ||
    !parsed.installed.memoryStateSha256
  ) {
    throw new Error("Malformed memory cutover receipt.");
  }
  return parsed;
}

export function hashRepairPlan(plan: MemoryRepairPlan) {
  return hashStableValue(plan);
}

export async function readRepairPlan(path: string): Promise<MemoryRepairPlan> {
  const { readFile } = await import("node:fs/promises");
  const root = asRecord(
    JSON.parse(await readFile(resolve(path), "utf8")) as unknown,
  );
  if (!root) throw new Error("Malformed memory repair plan.");
  assertSupportedRepairPlanVersion(root.version);
  const parsed = root as unknown as MemoryRepairPlan;
  assertRepairPlanV2Shape(parsed);
  return parsed;
}

async function assertVerifiedStaging(args: {
  stagingDbPath: string;
  plan: MemoryRepairPlan;
  expectedPlanSha256: string;
  expectedStagingDbSha256: string;
}) {
  const actualSha256 = await sha256File(args.stagingDbPath);
  if (actualSha256 !== args.expectedStagingDbSha256) {
    throw new Error(
      `Staging database checksum mismatch: expected ${args.expectedStagingDbSha256}, got ${actualSha256}`,
    );
  }
  const verification = await verifyMemoryRepair({
    dbPath: args.stagingDbPath,
    plan: args.plan,
    expectedPlanSha256: args.expectedPlanSha256,
  });
  if (!verification.ok) {
    throw new Error(
      `Staging database is not verified for cutover: ${verification.failures.join(", ")}`,
    );
  }
  if (verification.audit.databaseFileSha256 !== actualSha256) {
    throw new Error("Staging database changed while it was being verified.");
  }
  return verification.audit;
}

async function assertMemoryWritersStopped(dbPath: string, webUiPort: number) {
  if (
    !Number.isInteger(webUiPort) ||
    webUiPort < 1 ||
    webUiPort > 65_535
  ) {
    throw new Error(`Invalid WebUI port for cutover safety probe: ${webUiPort}`);
  }
  await assertTcpPortHasNoListener(webUiPort);
  assertNoSqliteSidecars(dbPath);
  assertNoWritableDatabaseHandles(dbPath);
}

function assertNoSqliteSidecars(dbPath: string) {
  const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`].filter(
    (path) => existsSync(path),
  );
  if (sidecars.length > 0) {
    throw new Error(
      `Refusing memory cutover while SQLite sidecar files exist: ${sidecars.join(", ")}. Perform a clean shutdown/checkpoint first.`,
    );
  }
}

function checkpointAndRemoveSqliteSidecars(dbPath: string) {
  assertNoWritableDatabaseHandles(dbPath);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    db.close();
  }
  assertNoWritableDatabaseHandles(dbPath);
  let removed = false;
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    if (!existsSync(sidecar)) continue;
    rmSync(sidecar, { force: true });
    removed = true;
  }
  if (removed) fsyncDirectory(dirname(dbPath));
}

function normalizeOfflineSnapshot(dbPath: string) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.prepare("PRAGMA journal_mode=DELETE").get();
  } finally {
    db.close();
  }
  for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    if (existsSync(sidecar)) rmSync(sidecar, { force: true });
  }
  fsyncFile(dbPath);
  fsyncDirectory(dirname(dbPath));
}

function removeEmptyReadSidecars(dbPath: string) {
  assertNoWritableDatabaseHandles(dbPath);
  const walPath = `${dbPath}-wal`;
  if (existsSync(walPath) && statSync(walPath).size !== 0) {
    throw new Error("Read-only verification unexpectedly produced a non-empty WAL file.");
  }
  let removed = false;
  for (const sidecar of [walPath, `${dbPath}-shm`]) {
    if (!existsSync(sidecar)) continue;
    rmSync(sidecar, { force: true });
    removed = true;
  }
  if (removed) fsyncDirectory(dirname(dbPath));
}

function assertImmutableSqliteSnapshot(dbPath: string) {
  if ((statSync(dbPath).mode & 0o222) !== 0) {
    throw new Error(
      "Source must be an immutable online-backup snapshot with no write permission bits.",
    );
  }
  const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`].filter(
    (path) => existsSync(path),
  );
  if (sidecars.length > 0) {
    throw new Error(
      `Immutable source snapshot must not have SQLite sidecars: ${sidecars.join(", ")}`,
    );
  }
  assertNoWritableDatabaseHandles(dbPath);
}

async function assertTcpPortHasNoListener(port: number) {
  for (const target of [
    { host: "0.0.0.0", ipv6Only: false },
    { host: "::", ipv6Only: true },
  ]) {
    await new Promise<void>((resolveProbe, rejectProbe) => {
      const server = createServer();
      server.unref();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (
          target.host === "::" &&
          ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code ?? "")
        ) {
          resolveProbe();
          return;
        }
        if (error.code === "EADDRINUSE") {
          rejectProbe(
            new Error(
              `Refusing memory cutover while WebUI port ${port} has a listener. Stop the WebUI and MemoryAgent writers first.`,
            ),
          );
          return;
        }
        rejectProbe(
          new Error(
            `Could not prove WebUI port ${port} is stopped: ${error.message}`,
          ),
        );
      });
      server.listen(
        {
          port,
          host: target.host,
          exclusive: true,
          ipv6Only: target.ipv6Only,
        },
        () => {
          server.close((error) => {
            if (error) rejectProbe(error);
            else resolveProbe();
          });
        },
      );
    });
  }
}

function assertNoWritableDatabaseHandles(dbPath: string) {
  if (process.platform !== "linux" || !existsSync("/proc")) {
    throw new Error(
      "Cannot prove SQLite writer handles are closed: Linux /proc inspection is unavailable.",
    );
  }
  const targetPaths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const normalizedTargets = new Set(targetPaths.map((path) => resolve(path)));
  const targetInodes = new Set(
    targetPaths
      .filter((path) => existsSync(path))
      .map((path) => {
        const stat = statSync(path);
        return `${stat.dev}:${stat.ino}`;
      }),
  );
  const writableHandles: string[] = [];
  for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    const fdDirectory = `/proc/${pid}/fd`;
    let descriptors: string[];
    try {
      descriptors = readdirSync(fdDirectory);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      const fdPath = `${fdDirectory}/${descriptor}`;
      let pointsAtDatabase = false;
      try {
        const target = readlinkSync(fdPath).replace(/ \(deleted\)$/, "");
        if (isAbsolute(target) && normalizedTargets.has(resolve(target))) {
          pointsAtDatabase = true;
        } else {
          const stat = statSync(fdPath);
          pointsAtDatabase = targetInodes.has(`${stat.dev}:${stat.ino}`);
        }
      } catch {
        continue;
      }
      if (!pointsAtDatabase) continue;
      try {
        const fdInfo = readFileSync(`/proc/${pid}/fdinfo/${descriptor}`, "utf8");
        const flags = /^flags:\s+([0-7]+)/m.exec(fdInfo)?.[1];
        if (!flags) {
          throw new Error("missing fd flags");
        }
        const accessMode = Number.parseInt(flags, 8) & 0b11;
        if (accessMode !== 0) writableHandles.push(`pid=${pid},fd=${descriptor}`);
      } catch {
        writableHandles.push(`pid=${pid},fd=${descriptor},mode=unknown`);
      }
    }
  }
  if (writableHandles.length > 0) {
    throw new Error(
      `Refusing memory cutover while writable SQLite handles remain open: ${writableHandles.join("; ")}`,
    );
  }
}

async function atomicInstallDatabase(args: {
  sourceDbPath: string;
  liveDbPath: string;
  expectedSourceSha256: string;
}) {
  const sourceDbPath = requireSafeDatabasePath(
    args.sourceDbPath,
    "atomic replacement source",
  );
  const liveDbPath = requireSafeDatabasePath(
    args.liveDbPath,
    "atomic replacement target",
  );
  if (sameExistingFile(sourceDbPath, liveDbPath)) {
    throw new Error("Atomic replacement source and target must be different files.");
  }
  const candidatePath = resolve(
    dirname(liveDbPath),
    `.${basename(liveDbPath)}.install-${randomUUID()}.tmp`,
  );
  try {
    copyFileSync(
      sourceDbPath,
      candidatePath,
      fsConstants.COPYFILE_EXCL,
    );
    chmodSync(candidatePath, 0o600);
    fsyncFile(candidatePath);
    const candidateSha256 = await sha256File(candidatePath);
    if (candidateSha256 !== args.expectedSourceSha256) {
      throw new Error("Atomic replacement candidate checksum mismatch.");
    }
    requireSafeDatabasePath(liveDbPath, "atomic replacement target");
    renameSync(candidatePath, liveDbPath);
    fsyncDirectory(dirname(liveDbPath));
  } finally {
    if (existsSync(candidatePath)) rmSync(candidatePath, { force: true });
  }
}

function writeJsonFileAtomically(path: string, value: unknown) {
  const safePath = requireSafeOutputPath(path, "cutover receipt");
  const file = openSync(safePath, "wx", 0o600);
  try {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  fsyncDirectory(dirname(safePath));
}

function fsyncFile(path: string) {
  const file = openSync(path, "r");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}

function fsyncDirectory(path: string) {
  const directory = openSync(path, "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function removeFileAndSyncDirectory(path: string) {
  if (!existsSync(path)) return;
  rmSync(path, { force: true });
  fsyncDirectory(dirname(path));
}

function requireSafeDatabasePath(inputPath: string, label: string) {
  const path = requireSafeExistingFilePath(inputPath, label);
  if (path.endsWith("-wal") || path.endsWith("-shm") || path.endsWith("-journal")) {
    throw new Error(`${label} must be a primary SQLite database, not a sidecar: ${path}`);
  }
  return path;
}

function requireSafeExistingFilePath(inputPath: string, label: string) {
  if (!isAbsolute(inputPath)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const path = resolve(inputPath);
  assertNoSymlinkComponents(path, false, label);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  if (realpathSync(path) !== path) {
    throw new Error(`${label} path is not canonical: ${path}`);
  }
  return path;
}

function requireSafeOutputPath(inputPath: string, label: string) {
  if (!isAbsolute(inputPath)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const path = resolve(inputPath);
  assertNoSymlinkComponents(path, true, label);
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite existing ${label}: ${path}`);
  }
  const parent = dirname(path);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
    throw new Error(`${label} parent directory must already exist: ${parent}`);
  }
  return path;
}

function assertNoSymlinkComponents(
  path: string,
  allowMissingLeaf: boolean,
  label: string,
) {
  const root = parse(path).root;
  const components = path.slice(root.length).split(sep).filter(Boolean);
  let cursor = root;
  for (let index = 0; index < components.length; index += 1) {
    cursor = resolve(cursor, components[index]);
    let stat: ReturnType<typeof lstatSync> | undefined;
    try {
      stat = lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!stat) {
      if (allowMissingLeaf && index === components.length - 1) return;
      throw new Error(`${label} path component does not exist: ${cursor}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link: ${cursor}`);
    }
  }
}

function assertDistinctArtifactPaths(entries: Array<[string, string]>) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const [leftLabel, leftPath] = entries[leftIndex];
      const [rightLabel, rightPath] = entries[rightIndex];
      if (
        resolve(leftPath) === resolve(rightPath) ||
        (existsSync(leftPath) &&
          existsSync(rightPath) &&
          sameExistingFile(leftPath, rightPath))
      ) {
        throw new Error(
          `${leftLabel} and ${rightLabel} must be distinct filesystem objects.`,
        );
      }
    }
  }
}

function assertTestFaultIsTestOnly(enabled: boolean | undefined) {
  if (enabled && process.env.NODE_ENV !== "test") {
    throw new Error("Cutover fault injection is available only under NODE_ENV=test.");
  }
}

const ORIGIN_MIGRATION_COLUMNS: Record<string, string[]> = {
  L1MemoryEvent: ["memoryOrigin", "traceRunId"],
  ProblemWorkspaceSession: ["memoryOrigin"],
  AgentTraceRun: ["memoryOrigin"],
  BackgroundJob: ["memoryOrigin"],
  L2MemoryFact: ["memoryOrigin"],
  MemoryEpisode: ["memoryOrigin"],
  SynthesisSlot: ["memoryOrigin"],
  ChatSession: ["memoryOrigin"],
  ChatMessage: ["memoryOrigin"],
  ReviewAttempt: ["memoryOrigin"],
  RunEvidence: ["memoryOrigin"],
  ProblemHistory: ["memoryOrigin"],
};

const REQUIRED_ORIGIN_INDEXES: Array<{
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}> = [
  { table: "L1MemoryEvent", name: "L1MemoryEvent_memoryOrigin_occurredAt_idx", columns: ["memoryOrigin", "occurredAt"], unique: false },
  { table: "L1MemoryEvent", name: "L1MemoryEvent_traceRunId_idx", columns: ["traceRunId"], unique: false },
  { table: "ProblemWorkspaceSession", name: "ProblemWorkspaceSession_memoryOrigin_startedAt_idx", columns: ["memoryOrigin", "startedAt"], unique: false },
  { table: "AgentTraceRun", name: "AgentTraceRun_memoryOrigin_startedAt_idx", columns: ["memoryOrigin", "startedAt"], unique: false },
  { table: "BackgroundJob", name: "BackgroundJob_memoryOrigin_status_idx", columns: ["memoryOrigin", "status"], unique: false },
  { table: "L2MemoryFact", name: "L2MemoryFact_memoryOrigin_status_lastSeenAt_idx", columns: ["memoryOrigin", "status", "lastSeenAt"], unique: false },
  { table: "L2MemoryFact", name: "L2MemoryFact_userId_factType_tag_memoryOrigin_key", columns: ["userId", "factType", "tag", "memoryOrigin"], unique: true },
  { table: "MemoryEpisode", name: "MemoryEpisode_memoryOrigin_createdAt_idx", columns: ["memoryOrigin", "createdAt"], unique: false },
  { table: "SynthesisSlot", name: "SynthesisSlot_memoryOrigin_status_updatedAt_idx", columns: ["memoryOrigin", "status", "updatedAt"], unique: false },
  { table: "SynthesisSlot", name: "SynthesisSlot_userId_slot_synthesisKey_memoryOrigin_key", columns: ["userId", "slot", "synthesisKey", "memoryOrigin"], unique: true },
  { table: "ChatSession", name: "ChatSession_userId_problemId_memoryOrigin_key", columns: ["userId", "problemId", "memoryOrigin"], unique: true },
  { table: "ChatSession", name: "ChatSession_memoryOrigin_updatedAt_idx", columns: ["memoryOrigin", "updatedAt"], unique: false },
  { table: "ChatMessage", name: "ChatMessage_memoryOrigin_createdAt_idx", columns: ["memoryOrigin", "createdAt"], unique: false },
  { table: "ReviewAttempt", name: "ReviewAttempt_memoryOrigin_createdAt_idx", columns: ["memoryOrigin", "createdAt"], unique: false },
  { table: "RunEvidence", name: "RunEvidence_memoryOrigin_createdAt_idx", columns: ["memoryOrigin", "createdAt"], unique: false },
  { table: "ProblemHistory", name: "ProblemHistory_memoryOrigin_createdAt_idx", columns: ["memoryOrigin", "createdAt"], unique: false },
];

const FORBIDDEN_LEGACY_UNIQUE_INDEXES = [
  "L2MemoryFact_userId_factType_tag_key",
  "SynthesisSlot_userId_slot_synthesisKey_key",
  "ChatSession_userId_problemId_key",
];

type RepositoryMigration = {
  name: string;
  sql: string;
  checksum: string;
};

function loadRepositoryMigrations(): RepositoryMigration[] {
  const migrationsDirectory = resolve(process.cwd(), "prisma/migrations");
  return readdirSync(migrationsDirectory)
    .sort()
    .map((name) => {
      const migrationPath = join(migrationsDirectory, name, "migration.sql");
      if (!existsSync(migrationPath)) return null;
      const sql = readFileSync(migrationPath, "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    })
    .filter((migration): migration is RepositoryMigration => Boolean(migration));
}

function inspectMemorySchemaParity(db: SqliteDatabase): MemorySchemaParity {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const table = model.dbName ?? model.name;
    if (!tableExists(db, table)) {
      missingTables.push(table);
      continue;
    }
    const actualColumns = new Set(
      rows<{ name: string }>(db, `PRAGMA table_info(${safeIdentifier(table)})`).map(
        (column) => column.name,
      ),
    );
    for (const field of model.fields.filter((field) => field.kind === "scalar")) {
      if (!actualColumns.has(field.name)) missingColumns.push(`${table}.${field.name}`);
    }
  }

  const missingIndexes: string[] = [];
  const mismatchedIndexes: string[] = [];
  for (const expected of REQUIRED_ORIGIN_INDEXES) {
    if (!tableExists(db, expected.table)) {
      missingIndexes.push(expected.name);
      continue;
    }
    const indexes = rows<{ name: string; unique: number | bigint }>(
      db,
      `PRAGMA index_list(${safeIdentifier(expected.table)})`,
    );
    const index = indexes.find((candidate) => candidate.name === expected.name);
    if (!index) {
      missingIndexes.push(expected.name);
      continue;
    }
    const columns = rows<{ name: string; seqno: number | bigint }>(
      db,
      `PRAGMA index_info(${safeIdentifier(expected.name)})`,
    )
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((column) => column.name);
    if (
      Boolean(Number(index.unique)) !== expected.unique ||
      columns.join("\u0000") !== expected.columns.join("\u0000")
    ) {
      mismatchedIndexes.push(expected.name);
    }
  }
  const forbiddenLegacyIndexesPresent = FORBIDDEN_LEGACY_UNIQUE_INDEXES.filter(
    (index) =>
      Boolean(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
          )
          .get(index),
      ),
  );

  const repositoryMigrations = loadRepositoryMigrations();
  const missingMigrationRecords: string[] = [];
  const invalidMigrationRecords: string[] = [];
  if (!tableExists(db, "_prisma_migrations")) {
    missingMigrationRecords.push(
      ...repositoryMigrations.map((migration) => migration.name),
    );
  } else {
    try {
      const records = rows<{
        migration_name: string;
        checksum: string;
        finished_at: string | null;
        rolled_back_at: string | null;
      }>(
        db,
        `SELECT migration_name, checksum, finished_at, rolled_back_at
         FROM "_prisma_migrations"`,
      );
      const recordByName = new Map(records.map((record) => [record.migration_name, record]));
      for (const migration of repositoryMigrations) {
        const record = recordByName.get(migration.name);
        if (!record) {
          missingMigrationRecords.push(migration.name);
        } else if (
          record.checksum !== migration.checksum ||
          !record.finished_at ||
          record.rolled_back_at
        ) {
          invalidMigrationRecords.push(migration.name);
        }
      }
    } catch {
      invalidMigrationRecords.push("_prisma_migrations_unreadable");
    }
  }

  const result = {
    missingTables: [...new Set(missingTables)].sort(),
    missingColumns: [...new Set(missingColumns)].sort(),
    missingIndexes: [...new Set(missingIndexes)].sort(),
    mismatchedIndexes: [...new Set(mismatchedIndexes)].sort(),
    forbiddenLegacyIndexesPresent: [...new Set(forbiddenLegacyIndexesPresent)].sort(),
    missingMigrationRecords: [...new Set(missingMigrationRecords)].sort(),
    invalidMigrationRecords: [...new Set(invalidMigrationRecords)].sort(),
  };
  return {
    ok: Object.values(result).every((values) => values.length === 0),
    ...result,
  };
}

function safeIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function assertOriginMigrationCanStartFromSnapshot(dbPath: string) {
  const db = new Database(requireExistingDatabase(dbPath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const present = Object.entries(ORIGIN_MIGRATION_COLUMNS).flatMap(
      ([table, columns]) =>
        columns
          .filter((column) => columnExists(db, table, column))
          .map((column) => `${table}.${column}`),
    );
    if (present.length > 0) {
      throw new Error(
        `Source must be a fresh pre-migration snapshot; origin migration columns already exist: ${present.join(", ")}`,
      );
    }
    for (const legacyIndex of FORBIDDEN_LEGACY_UNIQUE_INDEXES) {
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(legacyIndex)
      ) {
        throw new Error(
          `Fresh snapshot is missing expected pre-migration unique index: ${legacyIndex}`,
        );
      }
    }
    const migrations = loadRepositoryMigrations();
    const targetIndex = migrations.findIndex(
      (migration) => migration.name === MEMORY_ORIGIN_MIGRATION_NAME,
    );
    if (targetIndex < 0) {
      throw new Error(`Repository migration is missing: ${MEMORY_ORIGIN_MIGRATION_NAME}`);
    }
    if (!tableExists(db, "_prisma_migrations")) {
      throw new Error(
        "Fresh snapshot is missing Prisma migration history; refusing to fabricate predecessor migration records.",
      );
    }
    const records = rows<{
      migration_name: string;
      checksum: string;
      finished_at: string | null;
      rolled_back_at: string | null;
    }>(
      db,
      `SELECT migration_name, checksum, finished_at, rolled_back_at
       FROM "_prisma_migrations"`,
    );
    const byName = new Map(records.map((record) => [record.migration_name, record]));
    for (const predecessor of migrations.slice(0, targetIndex)) {
      const record = byName.get(predecessor.name);
      if (
        !record ||
        record.checksum !== predecessor.checksum ||
        !record.finished_at ||
        record.rolled_back_at
      ) {
        throw new Error(
          `Fresh snapshot lacks checksum-valid predecessor migration: ${predecessor.name}`,
        );
      }
    }
    if (byName.has(MEMORY_ORIGIN_MIGRATION_NAME)) {
      throw new Error("Fresh snapshot already records the origin migration as applied.");
    }
    const unexpectedlyAppliedLaterMigration = migrations
      .slice(targetIndex + 1)
      .find((migration) => byName.has(migration.name));
    if (unexpectedlyAppliedLaterMigration) {
      throw new Error(
        `Fresh snapshot records a later migration without the origin migration: ${unexpectedlyAppliedLaterMigration.name}`,
      );
    }
  } finally {
    db.close();
  }
}

function applyOriginMigration(
  dbPath: string,
  repositoryMigrations: RepositoryMigration[],
) {
  const originMigrationIndex = repositoryMigrations.findIndex(
    (migration) => migration.name === MEMORY_ORIGIN_MIGRATION_NAME,
  );
  if (originMigrationIndex < 0) {
    throw new Error(`Repository migration is missing: ${MEMORY_ORIGIN_MIGRATION_NAME}`);
  }
  const pendingMigrations = repositoryMigrations.slice(originMigrationIndex);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    const insert = db.prepare(
      `INSERT INTO "_prisma_migrations"
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
    );
    const apply = db.transaction(() => {
      const now = new Date().toISOString();
      for (const migration of pendingMigrations) {
        db.exec(migration.sql);
        insert.run(
          randomUUID(),
          migration.checksum,
          now,
          migration.name,
          now,
        );
      }
      const structural = inspectMemorySchemaParity(db);
      const structuralFailures = [
        ...structural.missingTables,
        ...structural.missingColumns,
        ...structural.missingIndexes,
        ...structural.mismatchedIndexes,
        ...structural.forbiddenLegacyIndexesPresent,
      ];
      if (structuralFailures.length > 0) {
        throw new Error(
          `Pending migrations did not reach current schema parity: ${structuralFailures.join(", ")}`,
        );
      }
    });
    apply();
  } finally {
    db.close();
  }
}

async function runCurrentPrismaMemorySchemaSmoke(dbPath: string) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${resolve(dbPath)}` });
  const client = new PrismaClient({ adapter, log: ["error"] });
  const sentinel = `__memory_schema_smoke__${randomUUID()}`;
  try {
    await client.$transaction([
      client.l1MemoryEvent.findFirst({ select: { id: true, memoryOrigin: true, traceRunId: true } }),
      client.problemWorkspaceSession.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.agentTraceRun.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.backgroundJob.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.l2MemoryFact.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.memoryEpisode.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.synthesisSlot.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.chatSession.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.chatMessage.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.reviewAttempt.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.runEvidence.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.problemHistory.findFirst({ select: { id: true, memoryOrigin: true } }),
      client.l1MemoryEvent.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown", traceRunId: null } }),
      client.problemWorkspaceSession.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.agentTraceRun.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.backgroundJob.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.l2MemoryFact.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.memoryEpisode.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.synthesisSlot.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.chatSession.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.chatMessage.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.reviewAttempt.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.runEvidence.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.problemHistory.updateMany({ where: { id: sentinel }, data: { memoryOrigin: "legacy_unknown" } }),
      client.l2MemoryFact.findUnique({
        where: {
          userId_factType_tag_memoryOrigin: {
            userId: sentinel,
            factType: sentinel,
            tag: sentinel,
            memoryOrigin: "legacy_unknown",
          },
        },
        select: { id: true },
      }),
      client.synthesisSlot.findUnique({
        where: {
          userId_slot_synthesisKey_memoryOrigin: {
            userId: sentinel,
            slot: sentinel,
            synthesisKey: sentinel,
            memoryOrigin: "legacy_unknown",
          },
        },
        select: { id: true },
      }),
      client.chatSession.findUnique({
        where: {
          userId_problemId_memoryOrigin: {
            userId: sentinel,
            problemId: sentinel,
            memoryOrigin: "legacy_unknown",
          },
        },
        select: { id: true },
      }),
    ]);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.$disconnect();
  }
}

function formatSchemaParityFailures(schema: MemorySchemaParity) {
  return [
    ...schema.missingTables.map((value) => `missing_table:${value}`),
    ...schema.missingColumns.map((value) => `missing_column:${value}`),
    ...schema.missingIndexes.map((value) => `missing_index:${value}`),
    ...schema.mismatchedIndexes.map((value) => `mismatched_index:${value}`),
    ...schema.forbiddenLegacyIndexesPresent.map((value) => `legacy_index:${value}`),
    ...schema.missingMigrationRecords.map((value) => `missing_migration:${value}`),
    ...schema.invalidMigrationRecords.map((value) => `invalid_migration:${value}`),
  ];
}

function classifyFacts(
  db: SqliteDatabase,
  facts: JsonRow[],
  evidenceById: Map<string, JsonRow>,
): MemoryIntegrityAudit["facts"] {
  const blocked: FactAuditRow[] = [];
  const invalidEvidence: FactAuditRow[] = [];
  const assistantOnlyPreferences: FactAuditRow[] = [];

  for (const fact of facts) {
    const reasons: string[] = [];
    const invalidReasons: string[] = [];
    const tag = stringField(fact, "tag");
    const memoryOrigin = stringField(fact, "memoryOrigin") || "legacy_unknown";
    if (memoryOrigin !== "learner") {
      invalidReasons.push(
        memoryOrigin === "legacy_unknown"
          ? "legacy_unknown_origin"
          : "ineligible_origin",
      );
    }
    const evidence = parseEvidenceIds(fact.evidenceTraceIds);
    if (BLOCKED_MEMORY_TAGS.has(normalizeMemoryTag(tag))) {
      reasons.push("blocked_development_noise_tag");
      blocked.push(toFactAuditRow(fact, reasons));
    }

    if (!evidence.validJson || !evidence.isArray) {
      invalidReasons.push("malformed_evidence_trace_ids");
    } else if (evidence.ids.length === 0) {
      invalidReasons.push("missing_evidence_trace_ids");
    } else {
      const evidenceRows = evidence.ids
        .map((id) => evidenceById.get(id))
        .filter((row): row is JsonRow => Boolean(row));
      if (evidenceRows.length !== evidence.ids.length) {
        invalidReasons.push("unknown_evidence_trace_id");
      }
      if (
        evidenceRows.some(
          (row) => stringField(row, "userId") !== stringField(fact, "userId"),
        )
      ) {
        invalidReasons.push("foreign_user_evidence");
      }
      invalidReasons.push(
        ...validateFactExecutionEvidence(db, fact, evidenceRows),
      );
    }
    if (invalidReasons.length > 0) {
      invalidEvidence.push(toFactAuditRow(fact, invalidReasons));
    }

    if (
      stringField(fact, "factType") === "preference" &&
      evidence.ids.length > 0
    ) {
      const evidenceRows = evidence.ids
        .map((id) => evidenceById.get(id))
        .filter((row): row is JsonRow => Boolean(row));
      if (
        evidenceRows.length === evidence.ids.length &&
        evidenceRows.every((row) => stringField(row, "eventType") === "chat_reply")
      ) {
        assistantOnlyPreferences.push(
          toFactAuditRow(fact, ["assistant_only_evidence"]),
        );
      }
    }
  }

  return {
    blocked: blocked.sort(compareById),
    invalidEvidence: invalidEvidence.sort(compareById),
    assistantOnlyPreferences: assistantOnlyPreferences.sort(compareById),
  };
}

function loadFactEvidence(db: SqliteDatabase, facts: JsonRow[]) {
  const ids = [
    ...new Set(
      facts.flatMap((fact) => parseEvidenceIds(fact.evidenceTraceIds).ids),
    ),
  ].sort();
  const result = new Map<string, JsonRow>();
  const originProjection = columnExists(db, "L1MemoryEvent", "memoryOrigin")
    ? "memoryOrigin"
    : "'legacy_unknown' AS memoryOrigin";
  const statement = db.prepare(
    `SELECT id, userId, problemId, chatSessionId, reviewAttemptId,
            eventType, source, eventJson, content, ${originProjection}
     FROM L1MemoryEvent WHERE id = ?`,
  );
  for (const id of ids) {
    const row = statement.get(id) as JsonRow | undefined;
    if (row) result.set(id, row);
  }
  return result;
}

type RequiredExecutionEvidence = {
  status: "failed" | "passed_visible_tests";
  capability: "canWriteMistakeMemory" | "canVerdict";
};

const EXECUTION_FACT_REQUIREMENTS: Record<string, RequiredExecutionEvidence> = {
  mistake: { status: "failed", capability: "canWriteMistakeMemory" },
  weakness: { status: "failed", capability: "canWriteMistakeMemory" },
  strength: { status: "passed_visible_tests", capability: "canVerdict" },
  skill: { status: "passed_visible_tests", capability: "canVerdict" },
};

function validateFactExecutionEvidence(
  db: SqliteDatabase,
  fact: JsonRow,
  evidenceRows: JsonRow[],
) {
  if ((stringField(fact, "memoryOrigin") || "legacy_unknown") !== "learner") {
    return [];
  }

  const requirement = EXECUTION_FACT_REQUIREMENTS[stringField(fact, "factType")];
  const executionEvents = evidenceRows.filter((row) =>
    ["run_evidence", "mock_interview_run_evidence"].includes(
      stringField(row, "eventType"),
    ),
  );
  const reasons = new Set<string>();
  let verifiedRequiredEvidence = 0;

  if (requirement && executionEvents.length === 0) {
    reasons.add("missing_relational_execution_evidence");
  }

  for (const event of executionEvents) {
    if (stringField(event, "memoryOrigin") !== "learner") {
      reasons.add("ineligible_execution_evidence_origin");
      continue;
    }

    const payload = parseJsonRecord(stringField(event, "eventJson"));
    const eventStatus = readString(payload.status);
    const eventRequirement: RequiredExecutionEvidence =
      requirement && eventStatus === requirement.status
        ? requirement
        : {
            status:
              eventStatus === "passed_visible_tests"
                ? "passed_visible_tests"
                : "failed",
            capability: "canVerdict",
          };
    const result =
      stringField(event, "eventType") === "run_evidence"
        ? validateReviewExecutionEvidence(db, event, payload, eventRequirement)
        : validateMockInterviewExecutionEvidence(
            db,
            event,
            payload,
            eventRequirement,
          );
    result.reasons.forEach((reason) => reasons.add(reason));
    if (result.verified && (!requirement || eventStatus === requirement.status)) {
      verifiedRequiredEvidence += 1;
    }
  }

  if (requirement && verifiedRequiredEvidence === 0) {
    reasons.add(
      requirement.status === "failed"
        ? "missing_verified_failed_review_evidence"
        : "missing_verified_passed_revision_evidence",
    );
  }

  return [...reasons].sort();
}

function validateReviewExecutionEvidence(
  db: SqliteDatabase,
  event: JsonRow,
  payload: Record<string, unknown>,
  requirement: RequiredExecutionEvidence,
) {
  const reasons = new Set<string>();
  if (
    stringField(event, "source") !== "review_pipeline" ||
    !stringField(event, "reviewAttemptId")
  ) {
    reasons.add("ineligible_review_execution_source");
    return { verified: false, reasons };
  }

  const runEvidenceId = readString(payload.runEvidenceId);
  const relation = runEvidenceId
    ? loadReviewExecutionRelation(db, runEvidenceId)
    : undefined;
  if (!runEvidenceId || !relation) {
    reasons.add("missing_review_execution_relation");
    return { verified: false, reasons };
  }

  const eventStatus = readString(payload.status);
  const executionFingerprint = readString(payload.executionFingerprint);
  const relationStatus = stringField(relation, "status");
  const reviewLanguage = stringField(relation, "reviewLanguage");
  const codeSnapshot = stringField(relation, "codeSnapshot");
  const computedFingerprint =
    reviewLanguage === "Python"
      ? fingerprintCodeForExecution({ language: "Python", code: codeSnapshot })
      : undefined;

  if (
    stringField(relation, "source") !== "review" ||
    stringField(relation, "runMemoryOrigin") !== "learner" ||
    stringField(relation, "reviewMemoryOrigin") !== "learner" ||
    stringField(relation, "reviewId") !==
      stringField(event, "reviewAttemptId") ||
    stringField(relation, "reviewUserId") !== stringField(event, "userId") ||
    stringField(relation, "reviewProblemId") !==
      stringField(event, "problemId") ||
    stringField(relation, "reviewChatSessionId") !==
      stringField(event, "chatSessionId") ||
    stringField(relation, "runChatSessionId") !==
      stringField(event, "chatSessionId")
  ) {
    reasons.add("review_execution_relation_mismatch");
  }
  if (
    reviewLanguage !== "Python" ||
    !executionFingerprint ||
    executionFingerprint !== stringField(relation, "executionFingerprint") ||
    executionFingerprint !== computedFingerprint ||
    (readString(payload.codeHash) !== undefined &&
      readString(payload.codeHash) !== stringField(relation, "codeHash"))
  ) {
    reasons.add("review_execution_revision_mismatch");
  }
  if (
    eventStatus !== requirement.status ||
    relationStatus !== requirement.status ||
    eventStatus !== relationStatus ||
    !countMatches(payload.passedCount, relation.passedCount) ||
    !countMatches(payload.failedCount, relation.failedCount)
  ) {
    reasons.add("review_execution_status_mismatch");
  }
  validateExecutionVerdicts({
    storedRawResultJson: stringField(relation, "rawResultJson"),
    eventPayload: payload,
    status: relationStatus,
    capability: requirement.capability,
    reasons,
  });

  return { verified: reasons.size === 0, reasons };
}

function validateMockInterviewExecutionEvidence(
  db: SqliteDatabase,
  event: JsonRow,
  payload: Record<string, unknown>,
  requirement: RequiredExecutionEvidence,
) {
  const reasons = new Set<string>();
  if (stringField(event, "source") !== "mock_interview:run_code") {
    reasons.add("ineligible_mock_interview_execution_source");
    return { verified: false, reasons };
  }

  const runEvidenceId = readString(payload.runEvidenceId);
  const relation = runEvidenceId
    ? loadMockExecutionRelation(db, runEvidenceId)
    : undefined;
  if (!runEvidenceId || !relation) {
    reasons.add("missing_mock_interview_execution_relation");
    return { verified: false, reasons };
  }

  const eventStatus = readString(payload.status);
  const executionFingerprint = readString(payload.executionFingerprint);
  const relationStatus = stringField(relation, "status");
  const snapshotLanguage = stringField(relation, "snapshotLanguage");
  const computedFingerprint =
    snapshotLanguage === "Python"
      ? fingerprintCodeForExecution({
          language: "Python",
          code: stringField(relation, "snapshotCode"),
        })
      : undefined;

  if (
    stringField(relation, "sessionId") !== readString(payload.sessionId) ||
    stringField(relation, "sessionUserId") !== stringField(event, "userId") ||
    stringField(relation, "sessionProblemId") !==
      stringField(event, "problemId") ||
    stringField(relation, "problemId") !== stringField(event, "problemId") ||
    stringField(relation, "codeSnapshotId") !==
      readString(payload.codeSnapshotId) ||
    stringField(relation, "snapshotId") !==
      readString(payload.codeSnapshotId) ||
    stringField(relation, "snapshotSessionId") !==
      stringField(relation, "sessionId") ||
    stringField(relation, "snapshotProblemId") !==
      stringField(event, "problemId")
  ) {
    reasons.add("mock_interview_execution_relation_mismatch");
  }
  if (
    stringField(relation, "sessionLanguage") !== "Python" ||
    snapshotLanguage !== "Python" ||
    !executionFingerprint ||
    executionFingerprint !== computedFingerprint
  ) {
    reasons.add("mock_interview_execution_revision_mismatch");
  }
  if (
    eventStatus !== requirement.status ||
    relationStatus !== requirement.status ||
    eventStatus !== relationStatus ||
    !countMatches(payload.passedCount, relation.passedCount) ||
    !countMatches(payload.failedCount, relation.failedCount)
  ) {
    reasons.add("mock_interview_execution_status_mismatch");
  }
  validateExecutionVerdicts({
    storedRawResultJson: stringField(relation, "rawResultJson"),
    eventPayload: payload,
    status: relationStatus,
    capability: requirement.capability,
    reasons,
  });

  return { verified: reasons.size === 0, reasons };
}

function validateExecutionVerdicts(args: {
  storedRawResultJson: string;
  eventPayload: Record<string, unknown>;
  status: string;
  capability: RequiredExecutionEvidence["capability"];
  reasons: Set<string>;
}) {
  const storedVerdict = readStoredEvidenceVerdict(args.storedRawResultJson);
  const eventVerdict = asRecord(args.eventPayload.evidenceVerdict);
  const storedCapabilities = asRecord(storedVerdict?.capabilities);
  const eventCapabilities = asRecord(eventVerdict?.capabilities);
  const providerUsed = readString(storedVerdict?.providerUsed);
  const evidenceClass = readString(storedVerdict?.evidenceClass);
  const capabilityKeys = [
    "canVerdict",
    "canWriteMistakeMemory",
    "canWriteEpisode",
    "canSignalPlanner",
    "canUseFailureSalience",
  ] as const;

  if (
    !storedVerdict ||
    !eventVerdict ||
    readString(storedVerdict.status) !== args.status ||
    readString(eventVerdict.status) !== args.status ||
    readString(eventVerdict.providerUsed) !== providerUsed ||
    readString(eventVerdict.evidenceClass) !== evidenceClass ||
    readString(eventVerdict.provenance) !==
      readString(storedVerdict.provenance) ||
    readString(eventVerdict.fallbackFromProvider) !==
      readString(storedVerdict.fallbackFromProvider) ||
    !providerUsed ||
    providerUsed === "mock" ||
    (evidenceClass !== "verdict_bearing" && evidenceClass !== "local_only")
  ) {
    args.reasons.add(
      providerUsed === "mock"
        ? "mock_runner_evidence_is_not_learner_evidence"
        : "execution_provenance_mismatch",
    );
  }
  if (
    capabilityKeys.some(
      (key) =>
        typeof storedCapabilities?.[key] !== "boolean" ||
        storedCapabilities[key] !== eventCapabilities?.[key],
    ) ||
    storedCapabilities?.[args.capability] !== true ||
    eventCapabilities?.[args.capability] !== true
  ) {
    args.reasons.add("execution_capability_mismatch");
  }
}

function loadReviewExecutionRelation(
  db: SqliteDatabase,
  runEvidenceId: string,
) {
  if (!tableExists(db, "RunEvidence") || !tableExists(db, "ReviewAttempt")) {
    return undefined;
  }
  const runOrigin = columnExists(db, "RunEvidence", "memoryOrigin")
    ? "run.memoryOrigin"
    : "'legacy_unknown'";
  const reviewOrigin = columnExists(db, "ReviewAttempt", "memoryOrigin")
    ? "review.memoryOrigin"
    : "'legacy_unknown'";
  return db
    .prepare(
      `SELECT run.id, run.reviewAttemptId, run.chatSessionId AS runChatSessionId,
              run.source, run.codeHash, run.executionFingerprint, run.status,
              run.passedCount, run.failedCount, run.rawResultJson,
              ${runOrigin} AS runMemoryOrigin,
              review.id AS reviewId, review.userId AS reviewUserId,
              review.problemId AS reviewProblemId,
              review.chatSessionId AS reviewChatSessionId,
              review.language AS reviewLanguage,
              review.codeSnapshot AS codeSnapshot,
              ${reviewOrigin} AS reviewMemoryOrigin
       FROM RunEvidence run
       LEFT JOIN ReviewAttempt review ON review.id = run.reviewAttemptId
       WHERE run.id = ?`,
    )
    .get(runEvidenceId) as JsonRow | undefined;
}

function loadMockExecutionRelation(
  db: SqliteDatabase,
  runEvidenceId: string,
) {
  if (
    !tableExists(db, "MockInterviewRunEvidence") ||
    !tableExists(db, "MockInterviewSession") ||
    !tableExists(db, "MockInterviewCodeSnapshot")
  ) {
    return undefined;
  }
  return db
    .prepare(
      `SELECT run.id, run.sessionId, run.codeSnapshotId, run.problemId,
              run.status, run.passedCount, run.failedCount, run.rawResultJson,
              session.userId AS sessionUserId,
              session.problemId AS sessionProblemId,
              session.language AS sessionLanguage,
              snapshot.id AS snapshotId,
              snapshot.sessionId AS snapshotSessionId,
              snapshot.problemId AS snapshotProblemId,
              snapshot.language AS snapshotLanguage,
              snapshot.code AS snapshotCode
       FROM MockInterviewRunEvidence run
       LEFT JOIN MockInterviewSession session ON session.id = run.sessionId
       LEFT JOIN MockInterviewCodeSnapshot snapshot ON snapshot.id = run.codeSnapshotId
       WHERE run.id = ?`,
    )
    .get(runEvidenceId) as JsonRow | undefined;
}

function loadRelationalExecutionEvidenceState(
  db: SqliteDatabase,
  evidenceById: Map<string, JsonRow>,
) {
  return [...evidenceById.values()]
    .flatMap((event) => {
      const payload = parseJsonRecord(stringField(event, "eventJson"));
      const id = readString(payload.runEvidenceId);
      if (!id) return [];
      if (stringField(event, "eventType") === "run_evidence") {
        const relation = loadReviewExecutionRelation(db, id);
        return relation ? [{ eventId: stringField(event, "id"), relation }] : [];
      }
      if (stringField(event, "eventType") === "mock_interview_run_evidence") {
        const relation = loadMockExecutionRelation(db, id);
        return relation ? [{ eventId: stringField(event, "id"), relation }] : [];
      }
      return [];
    })
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
}

function readStoredEvidenceVerdict(rawResultJson: string) {
  const root = parseJsonRecord(rawResultJson);
  const rawResult = asRecord(root.rawResult);
  return asRecord(rawResult?.evidenceVerdict) ?? asRecord(root.evidenceVerdict);
}

function parseJsonRecord(value: string) {
  try {
    return asRecord(JSON.parse(value) as unknown) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function countMatches(payloadValue: unknown, storedValue: unknown) {
  return (
    typeof payloadValue === "number" &&
    Number.isInteger(payloadValue) &&
    payloadValue === Number(storedValue)
  );
}

function parseEvidenceIds(value: unknown) {
  if (typeof value !== "string") {
    return { validJson: false, isArray: false, ids: [] as string[] };
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return { validJson: true, isArray: false, ids: [] as string[] };
    }
    return {
      validJson: true,
      isArray: true,
      ids: [
        ...new Set(
          parsed.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ),
        ),
      ].sort(),
    };
  } catch {
    return { validJson: false, isArray: false, ids: [] as string[] };
  }
}

function toFactAuditRow(fact: JsonRow, reasons: string[]): FactAuditRow {
  return {
    id: stringField(fact, "id"),
    userId: stringField(fact, "userId"),
    factType: stringField(fact, "factType"),
    tag: stringField(fact, "tag"),
    status: stringField(fact, "status"),
    memoryOrigin: stringField(fact, "memoryOrigin") || "legacy_unknown",
    reasons: [...new Set(reasons)].sort(),
  };
}

function buildFtsTruthDocuments(db: SqliteDatabase) {
  const facts = buildFactFtsTruthDocuments(db);
  const episodes = eligibleEpisodeRows(db).map(
    (episode) => ({
      kind: "episode",
      refId: episode.id,
      content: episodeFtsContent(
        episode,
        problemSearchMetadataFromJoinedRow(episode),
      ),
    }),
  );
  const kb = buildKbDocuments().map((document) => ({
    kind: "kb",
    refId: document.refId,
    content: document.content,
  }));
  const notes = rows<{
    id: string;
    conceptKey: string;
    title: string;
    snippet: string;
    whenToUse: string;
    category: string;
  }>(
    db,
    `SELECT id, conceptKey, title, snippet, whenToUse, category
     FROM KnowledgeNote WHERE status = 'active' ORDER BY id`,
  ).map((note) => ({
    kind: "knowledge_note",
    refId: knowledgeNoteFtsRefId(note.id),
    content: knowledgeNoteFtsContent(note),
  }));
  const documents = [...facts, ...episodes, ...kb, ...notes].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.refId.localeCompare(right.refId),
  );
  const keys = new Set<string>();
  for (const document of documents) {
    const key = `${document.kind}\u0000${document.refId}`;
    if (keys.has(key)) throw new Error(`Duplicate relational FTS truth key: ${key}`);
    keys.add(key);
  }
  return documents;
}

type JoinedProblemSearchRow = {
  problemTitle: string | null;
  problemSlug: string | null;
  problemLeetcodeNumber: number | null;
  problemTags: string | null;
  problemHot150Section: string | null;
};

function buildFactFtsTruthDocuments(db: SqliteDatabase) {
  if (!columnExists(db, "L2MemoryFact", "memoryOrigin")) return [];
  return rows<
    {
      id: string;
      factType: string;
      tag: string;
      label: string | null;
      value: string | null;
      lastEvidenceSummary: string | null;
      status: string;
      memoryOrigin: string;
      validationJson: string;
    } & JoinedProblemSearchRow
  >(
    db,
    `SELECT fact.id, fact.factType, fact.tag, fact.label, fact.value,
            fact.lastEvidenceSummary, fact.status, fact.memoryOrigin,
            fact.validationJson,
            problem.title AS problemTitle,
            problem.slug AS problemSlug,
            problem.leetcodeNumber AS problemLeetcodeNumber,
            problem.tags AS problemTags,
            problem.hot150Section AS problemHot150Section
     FROM L2MemoryFact fact
     LEFT JOIN Problem problem ON problem.id = fact.problemId
     ORDER BY fact.id`,
  ).flatMap((fact) => {
    const content = factFtsContent(
      fact,
      problemSearchMetadataFromJoinedRow(fact),
    );
    return content
      ? [{ kind: "fact", refId: fact.id, content }]
      : [];
  });
}

function problemSearchMetadataFromJoinedRow(
  row: JoinedProblemSearchRow,
): ProblemSearchMetadata | undefined {
  if (
    !row.problemTitle &&
    !row.problemSlug &&
    row.problemLeetcodeNumber === null &&
    !row.problemTags &&
    !row.problemHot150Section
  ) {
    return undefined;
  }
  return {
    title: row.problemTitle,
    slug: row.problemSlug,
    leetcodeNumber: row.problemLeetcodeNumber,
    tags: row.problemTags,
    hot150Section: row.problemHot150Section,
  };
}

async function countPlanVisibility(
  dbPath: string,
  plan: MemoryRepairPlan,
  planSha256: string,
) {
  const db = new Database(requireExistingDatabase(dbPath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.exec("PRAGMA query_only = ON;");
    const fact = db.prepare(
      "SELECT status, validationJson FROM L2MemoryFact WHERE id = ?",
    );
    const synthesis = db.prepare("SELECT status FROM SynthesisSlot WHERE id = ?");
    let factsRemainingVisibleFromPlan = 0;
    let synthesisRemainingActiveFromPlan = 0;
    for (const action of plan.actions.quarantineFacts) {
      const row = fact.get(action.id) as
        | { status: string; validationJson: string }
        | undefined;
      if (!row || !hasQuarantineMetadata(row.validationJson, planSha256)) {
        factsRemainingVisibleFromPlan += 1;
        continue;
      }
      if (row.status !== "stale") factsRemainingVisibleFromPlan += 1;
    }
    for (const action of plan.actions.invalidateSynthesis) {
      const row = synthesis.get(action.id) as { status: string } | undefined;
      if (!row || row.status === "active") synthesisRemainingActiveFromPlan += 1;
    }
    return { factsRemainingVisibleFromPlan, synthesisRemainingActiveFromPlan };
  } finally {
    db.close();
  }
}

async function isRepairPlanApplied(
  dbPath: string,
  plan: MemoryRepairPlan,
  planSha256: string,
) {
  const visibility = await countPlanVisibility(dbPath, plan, planSha256);
  return (
    visibility.factsRemainingVisibleFromPlan === 0 &&
    visibility.synthesisRemainingActiveFromPlan === 0
  );
}

async function findQuarantineMetadataMismatch(
  dbPath: string,
  plan: MemoryRepairPlan,
  planSha256: string,
) {
  const db = new Database(requireExistingDatabase(dbPath), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const get = db.prepare(
      "SELECT status, validationJson FROM L2MemoryFact WHERE id = ?",
    );
    const mismatches: string[] = [];
    for (const action of plan.actions.quarantineFacts) {
      const row = get.get(action.id) as
        | { status: string; validationJson: string }
        | undefined;
      if (
        !row ||
        row.status !== "stale" ||
        !hasQuarantineMetadata(row.validationJson, planSha256)
      ) {
        mismatches.push(action.id);
      }
    }
    return mismatches;
  } finally {
    db.close();
  }
}

function withQuarantineMetadata(
  validationJson: string,
  metadata: {
    repairRunId: string;
    planSha256: string;
    reasons: string[];
    previousStatus: string;
  },
) {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(validationJson) as unknown;
    parsed = value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { legacyValidationValue: value };
  } catch {
    parsed = { legacyValidationRaw: validationJson };
  }
  return stableStringify({ ...parsed, integrityQuarantine: metadata });
}

function hasQuarantineMetadata(validationJson: string, planSha256: string) {
  try {
    const parsed = JSON.parse(validationJson) as {
      integrityQuarantine?: { planSha256?: unknown };
    };
    return parsed.integrityQuarantine?.planSha256 === planSha256;
  } catch {
    return false;
  }
}

function assertValidPlan(plan: MemoryRepairPlan, expectedPlanSha256: string) {
  assertSupportedRepairPlanVersion(plan.version);
  assertRepairPlanV2Shape(plan);
  const actual = hashRepairPlan(plan);
  if (actual !== expectedPlanSha256) {
    throw new Error(`Repair plan checksum mismatch: expected ${expectedPlanSha256}, got ${actual}`);
  }
}

function assertRepairPlanV2Shape(plan: MemoryRepairPlan) {
  const truth = asRecord(plan.expectedIndexTruth);
  if (
    !truth ||
    !Number.isInteger(truth.factDocuments) ||
    !Number.isInteger(truth.episodeDocuments) ||
    !Number.isInteger(truth.totalDocuments) ||
    truth.factEligibilityMode !==
      "trusted_learner_fact_with_human_teaching_text_fail_closed" ||
    truth.episodeEligibilityMode !==
      "learner_origin_and_blocked_text_safe_fail_closed" ||
    !Array.isArray(plan.actions?.quarantineFacts) ||
    !Array.isArray(plan.actions?.invalidateSynthesis)
  ) {
    throw new Error("Malformed memory repair plan version 2.");
  }
}

function assertSupportedRepairPlanVersion(version: unknown): asserts version is 2 {
  if (version === LEGACY_MEMORY_REPAIR_PLAN_VERSION) {
    throw new Error(
      "Repair plan version 1 predates fact FTS relational truth. Regenerate the plan from the unchanged staging database before rebuild or cutover; existing version 1 cutover receipts remain readable and rollback-compatible.",
    );
  }
  if (version !== MEMORY_REPAIR_PLAN_VERSION) {
    throw new Error(`Unsupported memory repair plan version: ${String(version)}`);
  }
}

function assertHealthyAudit(audit: MemoryIntegrityAudit) {
  if (audit.integrityCheck.length !== 1 || audit.integrityCheck[0] !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${audit.integrityCheck.join(", ")}`);
  }
  if (audit.foreignKeyViolations.length > 0) {
    throw new Error("SQLite foreign_key_check reported violations.");
  }
}

function assertNotLiveDatabase(dbPath: string, liveDbPath: string) {
  if (sameExistingFile(dbPath, liveDbPath)) {
    throw new Error(`Refusing to mutate live/development database: ${resolve(dbPath)}`);
  }
}

function sameExistingFile(left: string, right: string) {
  const leftResolved = existsSync(left) ? realpathSync(left) : resolve(left);
  const rightResolved = existsSync(right) ? realpathSync(right) : resolve(right);
  if (leftResolved === rightResolved) return true;
  if (!existsSync(leftResolved) || !existsSync(rightResolved)) return false;
  const leftStat = statSync(leftResolved);
  const rightStat = statSync(rightResolved);
  return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
}

function assertDistinctPaths(
  left: string,
  right: string,
  leftLabel: string,
  rightLabel: string,
) {
  if (resolve(left) === resolve(right)) {
    throw new Error(`${leftLabel} and ${rightLabel} database paths must differ.`);
  }
}

function requireExistingDatabase(inputPath: string) {
  const path = resolve(inputPath);
  if (!existsSync(path)) throw new Error(`Database does not exist: ${path}`);
  return path;
}

function tableExists(db: SqliteDatabase, tableName: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function columnExists(db: SqliteDatabase, tableName: string, columnName: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Unsafe SQLite identifier: ${tableName}`);
  }
  return rows<{ name: string }>(db, `PRAGMA table_info(${tableName})`).some(
    (column) => column.name === columnName,
  );
}

function countTable(db: SqliteDatabase, tableName: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error(`Unsafe SQLite identifier: ${tableName}`);
  }
  return scalarCount(db, `SELECT COUNT(*) count FROM ${tableName}`);
}

function countOrphanFactDocuments(db: SqliteDatabase) {
  const eligibleIds = new Set(
    buildFactFtsTruthDocuments(db).map((document) => document.refId),
  );
  return rows<{ ref_id: string }>(
    db,
    "SELECT ref_id FROM memory_fts WHERE kind = 'fact'",
  ).filter((row) => !eligibleIds.has(row.ref_id)).length;
}

function countMissingFactDocuments(db: SqliteDatabase) {
  const indexedIds = new Set(
    rows<{ ref_id: string }>(
      db,
      "SELECT ref_id FROM memory_fts WHERE kind = 'fact'",
    ).map((row) => row.ref_id),
  );
  return buildFactFtsTruthDocuments(db).filter(
    (document) => !indexedIds.has(document.refId),
  ).length;
}

function countEligibleFacts(db: SqliteDatabase) {
  return buildFactFtsTruthDocuments(db).length;
}

function countOrphanEpisodeDocuments(db: SqliteDatabase) {
  const eligibleIds = new Set(eligibleEpisodeRows(db).map((row) => row.id));
  return rows<{ ref_id: string }>(
    db,
    "SELECT ref_id FROM memory_fts WHERE kind = 'episode'",
  ).filter((row) => !eligibleIds.has(row.ref_id)).length;
}

function countMissingEpisodeDocuments(db: SqliteDatabase) {
  const indexedIds = new Set(
    rows<{ ref_id: string }>(
      db,
      "SELECT ref_id FROM memory_fts WHERE kind = 'episode'",
    ).map((row) => row.ref_id),
  );
  return eligibleEpisodeRows(db).filter((row) => !indexedIds.has(row.id)).length;
}

function countEligibleEpisodes(db: SqliteDatabase) {
  return eligibleEpisodeRows(db).length;
}

function eligibleEpisodeRows(db: SqliteDatabase) {
  if (!columnExists(db, "MemoryEpisode", "memoryOrigin")) return [];
  return rows<{
    id: string;
    title: string;
    summary: string;
    tags: string;
    kind: string;
    sourceTraceIds: string;
    memoryOrigin: string;
    problemTitle: string | null;
    problemSlug: string | null;
    problemLeetcodeNumber: number | null;
    problemTags: string | null;
    problemHot150Section: string | null;
  }>(
    db,
    `SELECT episode.id, episode.title, episode.summary, episode.tags,
            episode.kind, episode.sourceTraceIds,
            episode.memoryOrigin,
            problem.title AS problemTitle,
            problem.slug AS problemSlug,
            problem.leetcodeNumber AS problemLeetcodeNumber,
            problem.tags AS problemTags,
            problem.hot150Section AS problemHot150Section
     FROM MemoryEpisode episode
     LEFT JOIN Problem problem ON problem.id = episode.problemId
     ORDER BY episode.id`,
  ).filter((episode) => isSafeEpisodeForIndexing(episode));
}

function countDuplicateFtsKeys(db: SqliteDatabase) {
  return scalarCount(
    db,
    `SELECT COUNT(*) count FROM (
       SELECT kind, ref_id FROM memory_fts
       GROUP BY kind, ref_id HAVING COUNT(*) > 1
     )`,
  );
}

function scalarCount(db: SqliteDatabase, sql: string) {
  return Number(one<{ count: number | bigint }>(db, sql).count);
}

function one<T>(db: SqliteDatabase, sql: string, ...args: unknown[]): T {
  const row = db.prepare(sql).get(...args) as T | undefined;
  if (!row) throw new Error(`SQLite query returned no row: ${sql}`);
  return row;
}

function rows<T>(db: SqliteDatabase, sql: string, ...args: unknown[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}

function countByKey<T extends Record<K, string>, K extends keyof T>(
  values: T[],
  key: K,
) {
  const result: Record<string, number> = {};
  for (const value of values) result[value[key]] = (result[value[key]] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function stringField(row: JsonRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function compareById(left: JsonRow, right: JsonRow) {
  return stringField(left, "id").localeCompare(stringField(right, "id"));
}

function hashStableValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

export function sha256File(path: string) {
  return new Promise<string>((resolveChecksum, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveChecksum(hash.digest("hex")));
  });
}

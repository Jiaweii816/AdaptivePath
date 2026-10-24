import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMemoryIntegrityArgs } from "../../scripts/memory-integrity";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import {
  applyMemoryRepairPlan,
  auditMemoryDatabase,
  buildMemoryRepairPlan,
  createMemoryRepairBackup,
  cutoverMemoryDatabase,
  migrateMemoryStagingFromSnapshot,
  readMemoryCutoverReceipt,
  readRepairPlan,
  readStagingMigrationReceipt,
  rebuildMemoryFtsIndex,
  rollbackMemoryCutover,
  sha256File,
  verifyMemoryRepair,
} from "@/server/memory/repair/memory-integrity-repair";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("memory integrity repair tooling", () => {
  it("requires an explicit database and defaults mutations to dry-run", () => {
    expect(() => parseMemoryIntegrityArgs(["audit"])).toThrow(/--db/);
    expect(() => parseMemoryIntegrityArgs(["unknown", "--db", "x.db"])).toThrow(
      /First argument/,
    );
    expect(() =>
      parseMemoryIntegrityArgs(["audit", "--db", "x.db", "--mystery"]),
    ).toThrow(/Unknown argument/);

    expect(
      parseMemoryIntegrityArgs([
        "apply",
        "--db",
        "staging.db",
        "--plan",
        "plan.json",
      ]),
    ).toMatchObject({ command: "apply", apply: false });
    expect(
      parseMemoryIntegrityArgs([
        "rebuild-index",
        "--db=staging.db",
        "--plan=plan.json",
        "--apply",
      ]),
    ).toMatchObject({ command: "rebuild-index", apply: true });
    expect(
      parseMemoryIntegrityArgs([
        "cutover",
        "--db=live.db",
        "--staging=staging.db",
        "--plan=plan.json",
        "--expected-plan-sha256=plan-sha",
        "--expected-staging-db-sha256=staging-sha",
        "--backup=before.db",
        "--receipt=cutover.json",
        "--migration-receipt=migration.json",
        "--expected-migration-receipt-file-sha256=migration-sha",
      ]),
    ).toMatchObject({ command: "cutover", apply: false });
    expect(() =>
      parseMemoryIntegrityArgs([
        "audit",
        "--db=x.db",
        "--plan=not-allowed.json",
      ]),
    ).toThrow(/audit does not accept --plan/);
    expect(() =>
      parseMemoryIntegrityArgs([
        "rollback",
        "--db=live.db",
        "--receipt=cutover.json",
        "--expected-receipt-file-sha256=sha",
        "--safety-backup=safety.db",
        "--expected-plan-sha256=not-allowed",
      ]),
    ).toThrow(/rollback does not accept --expected-plan-sha256/);
    expect(
      parseMemoryIntegrityArgs([
        "migrate-staging",
        "--db=snapshot.db",
        "--staging=staging.db",
        "--migration-receipt=migration.json",
        "--expected-db-sha256=snapshot-sha",
      ]),
    ).toMatchObject({ command: "migrate-staging", apply: false });
  });

  it("creates an immutable online backup and checksum-identical staging copy", async () => {
    const fixture = createFixture();
    const snapshot = join(fixture.dir, "snapshot.db");
    const staging = join(fixture.dir, "staging.db");

    const result = await createMemoryRepairBackup({
      sourceDbPath: fixture.dbPath,
      snapshotDbPath: snapshot,
      stagingDbPath: staging,
    });

    expect(result.integrityCheck).toEqual(["ok"]);
    expect(result.foreignKeyViolationCount).toBe(0);
    expect(result.snapshotFileSha256).toBe(result.stagingFileSha256);
    expect(statSync(snapshot).mode & 0o777).toBe(0o444);
    expect(statSync(staging).mode & 0o777).toBe(0o600);
    expect(readFileSync(snapshot)).toEqual(readFileSync(staging));
  });

  it("plans deterministic non-destructive quarantine and repairs FTS on staging", async () => {
    const fixture = createFixture();
    const firstAudit = await auditMemoryDatabase(fixture.dbPath);
    expect(firstAudit.facts.blocked.map((fact) => fact.tag)).toEqual([
      "hardcoded_return",
    ]);
    expect(firstAudit.facts.invalidEvidence).toHaveLength(4);
    expect(
      firstAudit.facts.invalidEvidence.find((fact) => fact.tag === "no_evidence")
        ?.reasons,
    ).toEqual(["legacy_unknown_origin", "missing_evidence_trace_ids"]);
    expect(
      firstAudit.facts.assistantOnlyPreferences.map((fact) => fact.tag),
    ).toEqual(["assistant_only"]);
    expect(firstAudit.fts.eligibleEpisodeDocuments).toBe(0);
    expect(firstAudit.fts.orphanEpisodeDocuments).toBe(2);
    expect(firstAudit.fts.missingEpisodeDocuments).toBe(0);
    expect(firstAudit.vector.mode).toBe("fts_only");

    const sourceSnapshotPath = join(fixture.dir, "source-snapshot.db");
    const sourceSnapshot = await createMemoryRepairBackup({
      sourceDbPath: fixture.dbPath,
      snapshotDbPath: sourceSnapshotPath,
    });
    const stagingPath = join(fixture.dir, "staging.db");
    const migrationReceiptPath = join(fixture.dir, "migration-receipt.json");
    const migrated = await migrateMemoryStagingFromSnapshot({
      sourceSnapshotPath,
      stagingDbPath: stagingPath,
      receiptPath: migrationReceiptPath,
      expectedSourceSnapshotSha256: sourceSnapshot.snapshotFileSha256,
      mode: "apply",
    });
    expect(migrated.ready).toBe(true);
    expect((await auditMemoryDatabase(stagingPath)).schema.ok).toBe(true);

    const firstPlan = await buildMemoryRepairPlan(stagingPath);
    const secondPlan = await buildMemoryRepairPlan(stagingPath);
    expect(secondPlan).toEqual(firstPlan);
    expect(firstPlan.plan.actions.quarantineFacts).toHaveLength(4);
    expect(firstPlan.plan.expectedIndexTruth.episodeDocuments).toBe(0);
    expect(firstPlan.plan.actions.invalidateSynthesis).toHaveLength(1);

    const stagingBefore = await auditMemoryDatabase(stagingPath);
    const dryRun = await applyMemoryRepairPlan({
      dbPath: stagingPath,
      liveDbPath: fixture.dbPath,
      plan: firstPlan.plan,
      expectedPlanSha256: firstPlan.planSha256,
      expectedDbSha256: stagingBefore.databaseFileSha256,
      mode: "dry-run",
    });
    expect(dryRun).toMatchObject({
      alreadyApplied: false,
      factRowsChanged: 0,
      synthesisRowsChanged: 0,
      factsRemainingVisibleFromPlan: 4,
      synthesisRemainingActiveFromPlan: 1,
    });

    await expect(
      applyMemoryRepairPlan({
        dbPath: fixture.dbPath,
        liveDbPath: fixture.dbPath,
        plan: firstPlan.plan,
        expectedPlanSha256: firstPlan.planSha256,
        expectedDbSha256: firstAudit.databaseFileSha256,
        mode: "apply",
      }),
    ).rejects.toThrow(/Refusing to mutate live/);

    const applied = await applyMemoryRepairPlan({
      dbPath: stagingPath,
      liveDbPath: fixture.dbPath,
      plan: firstPlan.plan,
      expectedPlanSha256: firstPlan.planSha256,
      expectedDbSha256: stagingBefore.databaseFileSha256,
      mode: "apply",
    });
    expect(applied).toMatchObject({
      alreadyApplied: false,
      factRowsChanged: 4,
      synthesisRowsChanged: 1,
      factsRemainingVisibleFromPlan: 0,
      synthesisRemainingActiveFromPlan: 0,
    });

    const reapplied = await applyMemoryRepairPlan({
      dbPath: stagingPath,
      liveDbPath: fixture.dbPath,
      plan: firstPlan.plan,
      expectedPlanSha256: firstPlan.planSha256,
      expectedDbSha256: stagingBefore.databaseFileSha256,
      mode: "apply",
    });
    expect(reapplied).toMatchObject({ alreadyApplied: true, factRowsChanged: 0 });

    const beforeRelationalCounts = relationalCounts(stagingPath);
    const indexResult = await rebuildMemoryFtsIndex({
      dbPath: stagingPath,
      liveDbPath: fixture.dbPath,
      plan: firstPlan.plan,
      expectedPlanSha256: firstPlan.planSha256,
      mode: "apply",
    });
    expect(indexResult).toMatchObject({
      orphanEpisodeDocuments: 0,
      missingEpisodeDocuments: 0,
      duplicateDocumentKeys: 0,
      vectorMode: "fts_only",
    });
    expect(indexResult.afterDocuments).toBe(indexResult.expectedDocuments);
    expect(relationalCounts(stagingPath)).toEqual(beforeRelationalCounts);

    const verification = await verifyMemoryRepair({
      dbPath: stagingPath,
      plan: firstPlan.plan,
      expectedPlanSha256: firstPlan.planSha256,
    });
    expect(verification.ok).toBe(true);
    expect(verification.failures).toEqual([]);
    expect(verification.audit.fts.orphanEpisodeDocuments).toBe(0);
    expect(verification.audit.fts.missingEpisodeDocuments).toBe(0);
    expect(verification.audit.schema.ok).toBe(true);
    expect(verification.prismaReadWriteSmoke).toEqual({ ok: true, error: null });
  });

  it("indexes only explicit learner-origin episodes and retains learner facts", async () => {
    const fixture = createFixture();
    const db = new Database(fixture.dbPath);
    db.exec(`
      ALTER TABLE L2MemoryFact
        ADD COLUMN memoryOrigin TEXT NOT NULL DEFAULT 'legacy_unknown';
      ALTER TABLE MemoryEpisode
        ADD COLUMN memoryOrigin TEXT NOT NULL DEFAULT 'legacy_unknown';
      ALTER TABLE SynthesisSlot
        ADD COLUMN memoryOrigin TEXT NOT NULL DEFAULT 'legacy_unknown';
      UPDATE L2MemoryFact SET memoryOrigin = 'learner' WHERE id = 'f-clean';
      UPDATE MemoryEpisode SET memoryOrigin = 'learner' WHERE id = 'ep-2';
      UPDATE MemoryEpisode
        SET memoryOrigin = 'learner', summary = 'Repeated hardcoded_return placeholder'
        WHERE id = 'ep-1';
      INSERT INTO MemoryEpisode
        (id,userId,kind,title,summary,outcome,tags,memoryOrigin)
      VALUES
        ('ep-3','u1','review','旧开发噪声','用户反复表现出未实现搜索逻辑，并使用硬编码返回。','unresolved','[]','learner');
      INSERT INTO MemoryEpisode
        (id,userId,kind,title,summary,outcome,tags,memoryOrigin)
      VALUES
        ('ep-4','u1','review','改写后的开发噪声','搜索逻辑尚未实现；搜尋邏輯尚未實現；把返回值写死了；把返回值寫死了。','unresolved','[]','learner');
    `);
    db.close();

    const { plan, planSha256 } = await buildMemoryRepairPlan(fixture.dbPath);
    expect(plan.actions.quarantineFacts.map((fact) => fact.id)).toEqual([
      "f-assistant",
      "f-blocked",
      "f-empty",
    ]);
    expect(plan.expectedIndexTruth).toMatchObject({
      episodeDocuments: 1,
      episodeEligibilityMode:
        "learner_origin_and_blocked_text_safe_fail_closed",
    });
    const beforeRepair = await auditMemoryDatabase(fixture.dbPath);
    await applyMemoryRepairPlan({
      dbPath: fixture.dbPath,
      liveDbPath: join(fixture.dir, "not-live.db"),
      plan,
      expectedPlanSha256: planSha256,
      expectedDbSha256: beforeRepair.databaseFileSha256,
      mode: "apply",
    });
    await rebuildMemoryFtsIndex({
      dbPath: fixture.dbPath,
      liveDbPath: join(fixture.dir, "not-live.db"),
      plan,
      expectedPlanSha256: planSha256,
      mode: "apply",
    });
    const indexed = new Database(fixture.dbPath, { readonly: true });
    expect(
      indexed
        .prepare("SELECT ref_id FROM memory_fts WHERE kind = 'episode' ORDER BY ref_id")
        .all(),
    ).toEqual([{ ref_id: "ep-2" }]);
    indexed.close();
  });

  it("clears the vector projection whenever it clears the vector map", async () => {
    const fixture = createFixture();
    const { plan, planSha256 } = await buildMemoryRepairPlan(fixture.dbPath);
    const before = await auditMemoryDatabase(fixture.dbPath);
    await applyMemoryRepairPlan({
      dbPath: fixture.dbPath,
      liveDbPath: join(fixture.dir, "not-live.db"),
      plan,
      expectedPlanSha256: planSha256,
      expectedDbSha256: before.databaseFileSha256,
      mode: "apply",
    });
    const db = new Database(fixture.dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_vec_map (
        ref_id TEXT PRIMARY KEY,
        vec_rowid INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_vec_projection (
        ref_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        learner_id TEXT,
        embedded_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO memory_vec_map (ref_id, vec_rowid) VALUES (?, ?)").run(
      "ep-1",
      1,
    );
    db.prepare(
      "INSERT INTO memory_vec_projection (ref_id, kind, content_hash, embedding_model, learner_id, embedded_at) VALUES (?,?,?,?,?,?)",
    ).run(
      "ep-1",
      "episode",
      "hash-1",
      "text-embedding-v4",
      "u1",
      "2026-07-20T00:00:00.000Z",
    );
    db.close();

    await rebuildMemoryFtsIndex({
      dbPath: fixture.dbPath,
      liveDbPath: join(fixture.dir, "not-live.db"),
      plan,
      expectedPlanSha256: planSha256,
      mode: "apply",
    });

    const checked = new Database(fixture.dbPath, { readonly: true });
    expect(
      checked.prepare("SELECT COUNT(*) AS n FROM memory_vec_projection").get(),
    ).toEqual({ n: 0 });
    checked.close();
  });

  it("rebuilds trusted fact and problem-enriched episode FTS from relational truth", async () => {
    const fixture = createFixture();
    const dbPath = await migrateFixtureToCurrentSchema(fixture);
    const db = new Database(dbPath);
    const now = "2026-07-16T00:00:00.000Z";
    db.prepare(
      `INSERT INTO Problem
         (id, leetcodeNumber, slug, title, hot150Section, methodName, tags, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "p97",
      97,
      "interleaving-string",
      "Interleaving String",
      "Multidimensional DP",
      "isInterleave",
      JSON.stringify(["String", "Multidimensional DP", "Hot-150"]),
      now,
    );
    db.prepare(
      `INSERT INTO L1MemoryEvent
         (id, userId, problemId, eventType, eventJson, content, source, memoryOrigin)
       VALUES (?, 'u1', 'p97', 'memory_note', '{}', ?, 'note_memory_tool', 'learner')`,
    ).run("fact-fts-evidence", "Learner asked to start explanations with a counterexample.");
    const trustedValidation = durableIntegrityValidation({
      promotionStatus: "trusted",
      evidenceTraceId: "fact-fts-evidence",
    });
    const pendingValidation = durableIntegrityValidation({
      promotionStatus: "pending",
      evidenceTraceId: "fact-fts-evidence",
    });
    const insertFact = db.prepare(
      `INSERT INTO L2MemoryFact
         (id, userId, problemId, factType, tag, label, value, status, source,
          memoryOrigin, evidenceTraceIds, validationJson, lastEvidenceSummary,
          updatedAt)
       VALUES (?, 'u1', 'p97', 'preference', ?, ?, ?, ?, 'user_explicit',
               'learner', ?, ?, ?, ?)`,
    );
    insertFact.run(
      "fact-trusted-fts",
      "counterexample_first_explanation",
      "The learner prefers seeing one counterexample before the abstraction.",
      "Start with a concrete counterexample.",
      "active",
      JSON.stringify(["fact-fts-evidence"]),
      trustedValidation,
      "The learner explicitly requested this explanation order.",
      now,
    );
    insertFact.run(
      "fact-blocked-fts",
      "hardcoded_return",
      "This blocked development-noise row must never be indexed.",
      "Blocked row.",
      "active",
      JSON.stringify(["fact-fts-evidence"]),
      trustedValidation,
      "Blocked development noise.",
      now,
    );
    insertFact.run(
      "fact-stale-fts",
      "state_transition_explanation",
      "This stale row must never be indexed.",
      "Stale row.",
      "stale",
      JSON.stringify(["fact-fts-evidence"]),
      trustedValidation,
      "Stale learner state.",
      now,
    );
    insertFact.run(
      "fact-pending-fts",
      "invariant_first_explanation",
      "This untrusted pending row must never be indexed.",
      "Pending row.",
      "active",
      JSON.stringify(["fact-fts-evidence"]),
      pendingValidation,
      "Pending learner state.",
      now,
    );
    db.prepare(
      `INSERT INTO MemoryEpisode
         (id, userId, problemId, kind, title, summary, outcome, tags,
          sourceTraceIds, memoryOrigin)
       VALUES (?, 'u1', 'p97', 'review', ?, ?, 'resolved', ?, ?, 'learner')`,
    ).run(
      "episode-problem-enriched",
      "State transition review",
      "The learner recovered by defining the state before writing transitions.",
      JSON.stringify(["state_transition_reasoning", "Hot-150"]),
      JSON.stringify(["fact-fts-evidence"]),
    );
    db.close();

    const before = await auditMemoryDatabase(dbPath);
    expect(before.fts).toMatchObject({
      eligibleFactDocuments: 1,
      missingFactDocuments: 1,
      eligibleEpisodeDocuments: 1,
    });
    const { plan, planSha256 } = await buildMemoryRepairPlan(dbPath);
    expect(plan.version).toBe(2);
    expect(plan.expectedIndexTruth).toMatchObject({
      factDocuments: 1,
      episodeDocuments: 1,
      factEligibilityMode:
        "trusted_learner_fact_with_human_teaching_text_fail_closed",
    });
    expect(plan.actions.quarantineFacts.map((fact) => fact.id)).toContain(
      "fact-blocked-fts",
    );
    await applyMemoryRepairPlan({
      dbPath,
      liveDbPath: fixture.dbPath,
      plan,
      expectedPlanSha256: planSha256,
      expectedDbSha256: before.databaseFileSha256,
      mode: "apply",
    });
    const rebuilt = await rebuildMemoryFtsIndex({
      dbPath,
      liveDbPath: fixture.dbPath,
      plan,
      expectedPlanSha256: planSha256,
      mode: "apply",
    });
    expect(rebuilt.expectedByKind.fact).toBe(1);
    expect(rebuilt).toMatchObject({
      orphanFactDocuments: 0,
      missingFactDocuments: 0,
    });

    const indexed = new Database(dbPath);
    const factRows = indexed
      .prepare("SELECT ref_id, content FROM memory_fts WHERE kind = 'fact'")
      .all() as Array<{ ref_id: string; content: string }>;
    expect(factRows.map((row) => row.ref_id)).toEqual(["fact-trusted-fts"]);
    expect(factRows[0]?.content).toContain("LeetCode 97 Interleaving String");
    expect(factRows[0]?.content).toContain("multidimensional dp");
    expect(factRows[0]?.content).not.toContain("Hot-150");
    expect(factRows[0]?.content).not.toContain("hot 150");
    const episodeContent = indexed
      .prepare(
        "SELECT content FROM memory_fts WHERE kind = 'episode' AND ref_id = ?",
      )
      .get("episode-problem-enriched") as { content: string };
    expect(episodeContent.content).toContain("LeetCode 97 Interleaving String");
    expect(episodeContent.content).toContain("interleaving string");
    expect(episodeContent.content).toContain("multidimensional dp");
    expect(episodeContent.content).toContain("state transition reasoning");
    expect(episodeContent.content).not.toContain("hot 150");

    indexed.prepare("DELETE FROM memory_fts WHERE ref_id = ?").run(
      "fact-trusted-fts",
    );
    indexed
      .prepare(
        "INSERT INTO memory_fts (content, kind, ref_id) VALUES (?, 'fact', ?)",
      )
      .run("stale fact artifact", "fact-stale-fts");
    indexed.close();

    const brokenAudit = await auditMemoryDatabase(dbPath);
    expect(brokenAudit.fts).toMatchObject({
      orphanFactDocuments: 1,
      missingFactDocuments: 1,
    });
    const brokenVerification = await verifyMemoryRepair({
      dbPath,
      plan,
      expectedPlanSha256: planSha256,
    });
    expect(brokenVerification.failures).toEqual(
      expect.arrayContaining(["fts_fact_orphan", "fts_fact_missing"]),
    );
  });

  it("rejects legacy repair plans while keeping legacy cutover receipts readable", async () => {
    const fixture = createFixture();
    const legacyPlanPath = join(fixture.dir, "repair-plan-v1.json");
    writeFileSync(legacyPlanPath, JSON.stringify({ version: 1 }));
    await expect(readRepairPlan(legacyPlanPath)).rejects.toThrow(
      /predates fact FTS relational truth.*cutover receipts remain readable/i,
    );

    const legacyReceiptPath = join(fixture.dir, "cutover-receipt-v1.json");
    writeFileSync(
      legacyReceiptPath,
      JSON.stringify({
        version: 1,
        cutoverId: "legacy-cutover",
        completedAt: "2026-07-16T00:00:00.000Z",
        planSha256: "a".repeat(64),
        stagingMigrationReceiptFileSha256: "b".repeat(64),
        liveDbPath: join(fixture.dir, "live.db"),
        stagingDbPath: join(fixture.dir, "staging.db"),
        retainedBackup: {
          path: join(fixture.dir, "backup.db"),
          databaseFileSha256: "c".repeat(64),
          memoryStateSha256: "d".repeat(64),
        },
        installed: {
          databaseFileSha256: "e".repeat(64),
          memoryStateSha256: "f".repeat(64),
        },
      }),
    );
    const legacyReceipt = readMemoryCutoverReceipt(legacyReceiptPath);
    expect(legacyReceipt).toMatchObject({
      version: 1,
      cutoverId: "legacy-cutover",
    });
    expect(legacyReceipt.repairPlanVersion).toBeUndefined();
  });

  it("keeps relational Official and Local Visible Review evidence while quarantining forged execution lineage", async () => {
    const fixture = createFixture();
    const dbPath = await migrateFixtureToCurrentSchema(fixture);
    const db = new Database(dbPath);
    insertProblem(db, "p-array", '["Array","Two Pointers"]');
    insertProblem(db, "p-dp", '["Dynamic Programming","String"]');
    db.prepare("INSERT INTO User (id, handle, updatedAt) VALUES (?, ?, ?)").run(
      "u2",
      "OtherLearner",
      "2026-07-16T00:00:00.000Z",
    );

    insertReviewExecutionFact(db, {
      suffix: "official",
      problemId: "p-array",
      factType: "mistake",
      tag: "two_pointer_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
    });
    insertReviewExecutionFact(db, {
      suffix: "official-resolution",
      problemId: "p-array",
      factType: "skill",
      tag: "temporary_resolution_fixture",
      status: "passed_visible_tests",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: false,
    });
    db.prepare("DELETE FROM L2MemoryFact WHERE id = ?").run(
      "fact-official-resolution",
    );
    db.prepare(
      "UPDATE L2MemoryFact SET evidenceTraceIds = ? WHERE id = 'fact-official'",
    ).run(JSON.stringify(["event-official", "event-official-resolution"]));
    insertReviewExecutionFact(db, {
      suffix: "local",
      problemId: "p-dp",
      factType: "weakness",
      tag: "state_transition_reasoning",
      status: "failed",
      evidenceClass: "local_only",
      providerUsed: "local_hot150",
      canVerdict: true,
      canWriteMistakeMemory: true,
    });
    insertReviewExecutionFact(db, {
      suffix: "missing-run",
      problemId: "p-array",
      factType: "skill",
      tag: "array_iteration",
      status: "passed_visible_tests",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: false,
      omitRun: true,
    });
    insertReviewExecutionFact(db, {
      suffix: "wrong-user",
      problemId: "p-array",
      factType: "mistake",
      tag: "array_index_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      reviewUserId: "u2",
    });
    insertReviewExecutionFact(db, {
      suffix: "wrong-problem",
      problemId: "p-array",
      factType: "mistake",
      tag: "array_condition_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventProblemId: "p-dp",
    });
    insertReviewExecutionFact(db, {
      suffix: "wrong-revision",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_revision_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventExecutionFingerprint: "execfp:v1:sha256:forged",
    });
    insertReviewExecutionFact(db, {
      suffix: "wrong-status",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_status_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventStatus: "passed_visible_tests",
    });
    insertReviewExecutionFact(db, {
      suffix: "mock-runner",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_mock_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "mock",
      canVerdict: true,
      canWriteMistakeMemory: true,
    });
    insertReviewExecutionFact(db, {
      suffix: "no-capability",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_capability_update",
      status: "failed",
      evidenceClass: "local_only",
      providerUsed: "local_hot150",
      canVerdict: true,
      canWriteMistakeMemory: false,
    });
    insertReviewExecutionFact(db, {
      suffix: "chat-run-code",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_chat_tool_update",
      status: "failed",
      evidenceClass: "local_only",
      providerUsed: "local_hot150",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventSource: "chat_run_code_tool",
      runSource: "chat_tool",
    });
    insertReviewExecutionFact(db, {
      suffix: "evaluation-origin",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_evaluation_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventMemoryOrigin: "evaluation",
    });
    insertReviewExecutionFact(db, {
      suffix: "test-origin",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_test_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventMemoryOrigin: "test",
    });
    insertReviewExecutionFact(db, {
      suffix: "seed-origin",
      problemId: "p-array",
      factType: "mistake",
      tag: "pointer_seed_update",
      status: "failed",
      evidenceClass: "verdict_bearing",
      providerUsed: "lc_submit",
      canVerdict: true,
      canWriteMistakeMemory: true,
      eventMemoryOrigin: "seed",
    });
    insertMockInterviewExecutionFact(db, {
      suffix: "real-mock-interview",
      problemId: "p-dp",
      providerUsed: "local_hot150",
      eventMemoryOrigin: "learner",
    });
    db.close();

    const audit = await auditMemoryDatabase(dbPath);
    const invalid = new Map(
      audit.facts.invalidEvidence.map((fact) => [fact.id, fact.reasons]),
    );
    expect(invalid.has("fact-official")).toBe(false);
    expect(invalid.has("fact-local")).toBe(false);
    expect(invalid.has("fact-real-mock-interview")).toBe(false);
    expect(invalid.get("fact-missing-run")).toEqual(
      expect.arrayContaining([
        "missing_review_execution_relation",
        "missing_verified_passed_revision_evidence",
      ]),
    );
    expect(invalid.get("fact-wrong-user")).toContain(
      "review_execution_relation_mismatch",
    );
    expect(invalid.get("fact-wrong-problem")).toContain(
      "review_execution_relation_mismatch",
    );
    expect(invalid.get("fact-wrong-revision")).toContain(
      "review_execution_revision_mismatch",
    );
    expect(invalid.get("fact-wrong-status")).toContain(
      "review_execution_status_mismatch",
    );
    expect(invalid.get("fact-mock-runner")).toContain(
      "mock_runner_evidence_is_not_learner_evidence",
    );
    expect(invalid.get("fact-no-capability")).toContain(
      "execution_capability_mismatch",
    );
    expect(invalid.get("fact-chat-run-code")).toContain(
      "ineligible_review_execution_source",
    );
    for (const suffix of ["evaluation-origin", "test-origin", "seed-origin"]) {
      expect(invalid.get(`fact-${suffix}`)).toContain(
        "ineligible_execution_evidence_origin",
      );
    }

    const { plan } = await buildMemoryRepairPlan(dbPath);
    const quarantinedIds = new Set(
      plan.actions.quarantineFacts.map((fact) => fact.id),
    );
    expect(quarantinedIds.has("fact-official")).toBe(false);
    expect(quarantinedIds.has("fact-local")).toBe(false);
    expect(quarantinedIds.has("fact-real-mock-interview")).toBe(false);
    expect(quarantinedIds.has("fact-chat-run-code")).toBe(true);
    expect(quarantinedIds.has("fact-mock-runner")).toBe(true);
  });

  it("atomically migrates only a fresh snapshot and records complete Prisma parity", async () => {
    const fixture = createFixture();
    const walSource = new Database(fixture.dbPath);
    walSource.prepare("PRAGMA journal_mode=WAL").get();
    walSource.close();
    const sourceSnapshotPath = join(fixture.dir, "immutable-source.db");
    const sourceSnapshot = await createMemoryRepairBackup({
      sourceDbPath: fixture.dbPath,
      snapshotDbPath: sourceSnapshotPath,
    });
    expect(existsSync(`${sourceSnapshotPath}-wal`)).toBe(false);
    expect(existsSync(`${sourceSnapshotPath}-shm`)).toBe(false);
    const offlineSnapshot = new Database(sourceSnapshotPath, { readonly: true });
    expect(offlineSnapshot.prepare("PRAGMA journal_mode").get()).toEqual({
      journal_mode: "delete",
    });
    offlineSnapshot.close();
    const repeatedSnapshotPath = join(fixture.dir, "immutable-source-repeat.db");
    const repeatedSnapshot = await createMemoryRepairBackup({
      sourceDbPath: fixture.dbPath,
      snapshotDbPath: repeatedSnapshotPath,
    });
    expect(repeatedSnapshot.snapshotFileSha256).toBe(
      sourceSnapshot.snapshotFileSha256,
    );
    expect(existsSync(`${repeatedSnapshotPath}-wal`)).toBe(false);
    expect(existsSync(`${repeatedSnapshotPath}-shm`)).toBe(false);
    const stagingPath = join(fixture.dir, "migrated-stage.db");
    const migrationReceiptPath = join(fixture.dir, "migrated-stage.json");

    const dryRun = await migrateMemoryStagingFromSnapshot({
      sourceSnapshotPath,
      stagingDbPath: stagingPath,
      receiptPath: migrationReceiptPath,
      expectedSourceSnapshotSha256: sourceSnapshot.snapshotFileSha256,
      mode: "dry-run",
    });
    expect(dryRun).toMatchObject({ mode: "dry-run", ready: true });
    expect(existsSync(stagingPath)).toBe(false);
    expect(existsSync(migrationReceiptPath)).toBe(false);

    const applied = await migrateMemoryStagingFromSnapshot({
      sourceSnapshotPath,
      stagingDbPath: stagingPath,
      receiptPath: migrationReceiptPath,
      expectedSourceSnapshotSha256: sourceSnapshot.snapshotFileSha256,
      mode: "apply",
    });
    expect(applied).toMatchObject({ mode: "apply", ready: true });
    expect(applied.receiptFileSha256).toMatch(/^[a-f0-9]{64}$/);
    const migratedAudit = await auditMemoryDatabase(stagingPath);
    expect(migratedAudit.schema).toMatchObject({ ok: true });
    expect(migratedAudit.schema.missingMigrationRecords).toEqual([]);
    expect(migratedAudit.schema.forbiddenLegacyIndexesPresent).toEqual([]);

    const partialWorking = join(fixture.dir, "partial-origin-working.db");
    copyFileSync(fixture.dbPath, partialWorking);
    const partial = new Database(partialWorking);
    partial.exec(
      "ALTER TABLE ChatSession ADD COLUMN memoryOrigin TEXT NOT NULL DEFAULT 'legacy_unknown'",
    );
    partial.close();
    const partialSnapshot = join(fixture.dir, "partial-origin-snapshot.db");
    const partialBackup = await createMemoryRepairBackup({
      sourceDbPath: partialWorking,
      snapshotDbPath: partialSnapshot,
    });
    const refusedStage = join(fixture.dir, "refused-stage.db");
    const refusedReceipt = join(fixture.dir, "refused-stage.json");
    await expect(
      migrateMemoryStagingFromSnapshot({
        sourceSnapshotPath: partialSnapshot,
        stagingDbPath: refusedStage,
        receiptPath: refusedReceipt,
        expectedSourceSnapshotSha256: partialBackup.snapshotFileSha256,
        mode: "apply",
      }),
    ).rejects.toThrow(/fresh pre-migration snapshot/);
    expect(existsSync(refusedStage)).toBe(false);
    expect(existsSync(refusedReceipt)).toBe(false);
  });

  it("fails verification on missing origin columns, compound indexes, or migration ledger rows", async () => {
    const fixture = createFixture();
    const prepared = await prepareVerifiedStaging(fixture);

    const missingColumnPath = join(fixture.dir, "missing-column.db");
    copyFileSync(prepared.stagingPath, missingColumnPath);
    const missingColumnDb = new Database(missingColumnPath);
    missingColumnDb.exec(`
      DROP INDEX ChatMessage_memoryOrigin_createdAt_idx;
      ALTER TABLE ChatMessage DROP COLUMN memoryOrigin;
    `);
    missingColumnDb.close();
    const missingColumn = await verifyMemoryRepair({
      dbPath: missingColumnPath,
      plan: prepared.plan,
      expectedPlanSha256: prepared.planSha256,
    });
    expect(missingColumn.ok).toBe(false);
    expect(missingColumn.failures).toEqual(
      expect.arrayContaining([
        "schema_column_missing",
        "schema_index_missing",
        "prisma_read_write_smoke_failed",
      ]),
    );

    const missingIndexPath = join(fixture.dir, "missing-index.db");
    copyFileSync(prepared.stagingPath, missingIndexPath);
    const missingIndexDb = new Database(missingIndexPath);
    missingIndexDb.exec(`
      DROP INDEX ChatSession_userId_problemId_memoryOrigin_key;
      CREATE UNIQUE INDEX ChatSession_userId_problemId_key
        ON ChatSession(userId, problemId);
    `);
    missingIndexDb.close();
    const missingIndex = await verifyMemoryRepair({
      dbPath: missingIndexPath,
      plan: prepared.plan,
      expectedPlanSha256: prepared.planSha256,
    });
    expect(missingIndex.ok).toBe(false);
    expect(missingIndex.failures).toEqual(
      expect.arrayContaining([
        "schema_index_missing",
        "legacy_unique_index_present",
      ]),
    );

    const missingMigrationPath = join(fixture.dir, "missing-migration.db");
    copyFileSync(prepared.stagingPath, missingMigrationPath);
    const missingMigrationDb = new Database(missingMigrationPath);
    missingMigrationDb
      .prepare("DELETE FROM _prisma_migrations WHERE migration_name = ?")
      .run("20260716150000_memory_origin_provenance");
    missingMigrationDb.close();
    const missingMigration = await verifyMemoryRepair({
      dbPath: missingMigrationPath,
      plan: prepared.plan,
      expectedPlanSha256: prepared.planSha256,
    });
    expect(missingMigration.ok).toBe(false);
    expect(missingMigration.failures).toContain("prisma_migration_missing");

    const cutoverCorruptDb = new Database(prepared.stagingPath);
    cutoverCorruptDb.exec(`
      DROP INDEX RunEvidence_memoryOrigin_createdAt_idx;
      ALTER TABLE RunEvidence DROP COLUMN memoryOrigin;
    `);
    cutoverCorruptDb.close();
    await expect(
      cutoverMemoryDatabase({
        liveDbPath: fixture.dbPath,
        stagingDbPath: prepared.stagingPath,
        retainedBackupPath: join(fixture.dir, "must-not-cutover-backup.db"),
        receiptPath: join(fixture.dir, "must-not-cutover.json"),
        stagingMigrationReceiptPath: prepared.migrationReceiptPath,
        expectedStagingMigrationReceiptFileSha256:
          prepared.migrationReceiptFileSha256,
        plan: prepared.plan,
        expectedPlanSha256: prepared.planSha256,
        expectedStagingDbSha256: await sha256File(prepared.stagingPath),
        mode: "dry-run",
        webUiPort: await unusedPort(),
      }),
    ).rejects.toThrow(/not verified for cutover/);
  });

  it("cutover is checksum-bound, atomic, receipt-backed, and explicitly reversible", async () => {
    const fixture = createFixture();
    const prepared = await prepareVerifiedStaging(fixture);
    const port = await unusedPort();
    const backupPath = join(fixture.dir, "retained-before-cutover.db");
    const receiptPath = join(fixture.dir, "cutover-receipt.json");

    await expect(
      cutoverMemoryDatabase({
        liveDbPath: fixture.dbPath,
        stagingDbPath: prepared.stagingPath,
        retainedBackupPath: backupPath,
        receiptPath,
        stagingMigrationReceiptPath: prepared.migrationReceiptPath,
        expectedStagingMigrationReceiptFileSha256:
          prepared.migrationReceiptFileSha256,
        plan: prepared.plan,
        expectedPlanSha256: prepared.planSha256,
        expectedStagingDbSha256: "0".repeat(64),
        mode: "dry-run",
        webUiPort: port,
      }),
    ).rejects.toThrow(/Staging database checksum mismatch/);

    const dryRun = await cutoverMemoryDatabase({
      liveDbPath: fixture.dbPath,
      stagingDbPath: prepared.stagingPath,
      retainedBackupPath: backupPath,
      receiptPath,
      stagingMigrationReceiptPath: prepared.migrationReceiptPath,
      expectedStagingMigrationReceiptFileSha256:
        prepared.migrationReceiptFileSha256,
      plan: prepared.plan,
      expectedPlanSha256: prepared.planSha256,
      expectedStagingDbSha256: prepared.stagingSha256,
      mode: "dry-run",
      webUiPort: port,
    });
    expect(dryRun).toMatchObject({ mode: "dry-run", ready: true });
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(receiptPath)).toBe(false);

    const applied = await cutoverMemoryDatabase({
      liveDbPath: fixture.dbPath,
      stagingDbPath: prepared.stagingPath,
      retainedBackupPath: backupPath,
      receiptPath,
      stagingMigrationReceiptPath: prepared.migrationReceiptPath,
      expectedStagingMigrationReceiptFileSha256:
        prepared.migrationReceiptFileSha256,
      plan: prepared.plan,
      expectedPlanSha256: prepared.planSha256,
      expectedStagingDbSha256: prepared.stagingSha256,
      mode: "apply",
      webUiPort: port,
    });
    expect(applied).toMatchObject({
      mode: "apply",
      ready: true,
      installedDbSha256: prepared.stagingSha256,
      rolledBackAfterFailure: false,
    });
    expect(applied.retainedBackupSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(statSync(backupPath).mode & 0o777).toBe(0o444);
    expect(await sha256File(fixture.dbPath)).toBe(prepared.stagingSha256);
    const receipt = readMemoryCutoverReceipt(receiptPath);
    expect(receipt).toMatchObject({
      repairPlanVersion: 2,
      planSha256: prepared.planSha256,
      liveDbPath: fixture.dbPath,
      retainedBackup: { path: backupPath },
      installed: { databaseFileSha256: prepared.stagingSha256 },
    });

    const receiptFileSha256 = await sha256File(receiptPath);
    const safetyBackupPath = join(fixture.dir, "pre-rollback-safety.db");
    await expect(
      rollbackMemoryCutover({
        liveDbPath: fixture.dbPath,
        receiptPath,
        expectedReceiptFileSha256: "f".repeat(64),
        safetyBackupPath,
        mode: "dry-run",
        webUiPort: port,
      }),
    ).rejects.toThrow(/receipt file checksum mismatch/);
    const rollbackDryRun = await rollbackMemoryCutover({
      liveDbPath: fixture.dbPath,
      receiptPath,
      expectedReceiptFileSha256: receiptFileSha256,
      safetyBackupPath,
      mode: "dry-run",
      webUiPort: port,
    });
    expect(rollbackDryRun).toMatchObject({ mode: "dry-run", ready: true });
    expect(existsSync(safetyBackupPath)).toBe(false);

    const rollback = await rollbackMemoryCutover({
      liveDbPath: fixture.dbPath,
      receiptPath,
      expectedReceiptFileSha256: receiptFileSha256,
      safetyBackupPath,
      mode: "apply",
      webUiPort: port,
    });
    expect(rollback).toMatchObject({
      mode: "apply",
      ready: true,
      restoredDbSha256: applied.retainedBackupSha256,
      rolledBackAfterFailure: false,
    });
    expect(rollback.safetyBackupSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256File(fixture.dbPath)).toBe(
      applied.retainedBackupSha256,
    );
    expect((await auditMemoryDatabase(fixture.dbPath)).memoryStateSha256).toBe(
      prepared.liveBefore.memoryStateSha256,
    );
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(safetyBackupPath)).toBe(true);
    expect(existsSync(receiptPath)).toBe(true);
  });

  it("refuses active listeners, writable SQLite handles, sidecars, and symlink aliases", async () => {
    const fixture = createFixture();
    const prepared = await prepareVerifiedStaging(fixture);
    const backupPath = join(fixture.dir, "blocked-backup.db");
    const receiptPath = join(fixture.dir, "blocked-receipt.json");
    const invoke = (port: number, stagingDbPath = prepared.stagingPath) =>
      cutoverMemoryDatabase({
        liveDbPath: fixture.dbPath,
        stagingDbPath,
        retainedBackupPath: backupPath,
        receiptPath,
        stagingMigrationReceiptPath: prepared.migrationReceiptPath,
        expectedStagingMigrationReceiptFileSha256:
          prepared.migrationReceiptFileSha256,
        plan: prepared.plan,
        expectedPlanSha256: prepared.planSha256,
        expectedStagingDbSha256: prepared.stagingSha256,
        mode: "dry-run",
        webUiPort: port,
      });

    const listener = createServer();
    await new Promise<void>((resolveListen) =>
      listener.listen(0, "0.0.0.0", resolveListen),
    );
    const address = listener.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    await expect(invoke(address.port)).rejects.toThrow(/has a listener/);
    await new Promise<void>((resolveClose, rejectClose) =>
      listener.close((error) => (error ? rejectClose(error) : resolveClose())),
    );

    const port = await unusedPort();
    const openWriter = new Database(fixture.dbPath);
    await expect(invoke(port)).rejects.toThrow(/writable SQLite handles/);
    openWriter.close();

    const stagingAlias = join(fixture.dir, "staging-link.db");
    symlinkSync(prepared.stagingPath, stagingAlias);
    await expect(invoke(port, stagingAlias)).rejects.toThrow(/symbolic link/);
  });

  it("automatically restores live state when cutover fails after replacement", async () => {
    const fixture = createFixture();
    const prepared = await prepareVerifiedStaging(fixture);
    const port = await unusedPort();
    const backupPath = join(fixture.dir, "failure-backup.db");
    const receiptPath = join(fixture.dir, "failure-receipt.json");

    await expect(
      cutoverMemoryDatabase({
        liveDbPath: fixture.dbPath,
        stagingDbPath: prepared.stagingPath,
        retainedBackupPath: backupPath,
        receiptPath,
        stagingMigrationReceiptPath: prepared.migrationReceiptPath,
        expectedStagingMigrationReceiptFileSha256:
          prepared.migrationReceiptFileSha256,
        plan: prepared.plan,
        expectedPlanSha256: prepared.planSha256,
        expectedStagingDbSha256: prepared.stagingSha256,
        mode: "apply",
        webUiPort: port,
        __testFaultAfterReplace: true,
      }),
    ).rejects.toThrow(/live database was restored/);

    const after = await auditMemoryDatabase(fixture.dbPath);
    expect(after.memoryStateSha256).toBe(prepared.liveBefore.memoryStateSha256);
    expect(after.databaseFileSha256).toBe(await sha256File(backupPath));
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(receiptPath)).toBe(false);
  });
});

async function prepareVerifiedStaging(fixture: ReturnType<typeof createFixture>) {
  const liveBefore = await auditMemoryDatabase(fixture.dbPath);
  const snapshotPath = join(fixture.dir, `snapshot-${Math.random()}.db`);
  const stagingPath = join(fixture.dir, `verified-${Math.random()}.db`);
  const snapshot = await createMemoryRepairBackup({
    sourceDbPath: fixture.dbPath,
    snapshotDbPath: snapshotPath,
  });
  const migrationReceiptPath = join(
    fixture.dir,
    `migration-${Math.random()}.json`,
  );
  const migrated = await migrateMemoryStagingFromSnapshot({
    sourceSnapshotPath: snapshotPath,
    stagingDbPath: stagingPath,
    receiptPath: migrationReceiptPath,
    expectedSourceSnapshotSha256: snapshot.snapshotFileSha256,
    mode: "apply",
  });
  if (!migrated.receiptFileSha256) {
    throw new Error("Test migration receipt checksum missing");
  }
  expect(readStagingMigrationReceipt(migrationReceiptPath)).toMatchObject({
    sourceSnapshot: { path: snapshotPath },
    migratedStaging: { path: stagingPath },
  });
  const { plan, planSha256 } = await buildMemoryRepairPlan(stagingPath);
  const stagingBefore = await auditMemoryDatabase(stagingPath);
  await applyMemoryRepairPlan({
    dbPath: stagingPath,
    liveDbPath: fixture.dbPath,
    plan,
    expectedPlanSha256: planSha256,
    expectedDbSha256: stagingBefore.databaseFileSha256,
    mode: "apply",
  });
  await rebuildMemoryFtsIndex({
    dbPath: stagingPath,
    liveDbPath: fixture.dbPath,
    plan,
    expectedPlanSha256: planSha256,
    mode: "apply",
  });
  const verification = await verifyMemoryRepair({
    dbPath: stagingPath,
    plan,
    expectedPlanSha256: planSha256,
  });
  if (!verification.ok) throw new Error("Test staging fixture did not verify");
  return {
    liveBefore,
    plan,
    planSha256,
    stagingPath,
    stagingSha256: verification.audit.databaseFileSha256,
    migrationReceiptPath,
    migrationReceiptFileSha256: migrated.receiptFileSha256,
  };
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

async function migrateFixtureToCurrentSchema(
  fixture: ReturnType<typeof createFixture>,
) {
  const snapshotPath = join(fixture.dir, `relational-snapshot-${randomUUID()}.db`);
  const stagingPath = join(fixture.dir, `relational-staging-${randomUUID()}.db`);
  const receiptPath = join(fixture.dir, `relational-migration-${randomUUID()}.json`);
  const snapshot = await createMemoryRepairBackup({
    sourceDbPath: fixture.dbPath,
    snapshotDbPath: snapshotPath,
  });
  await migrateMemoryStagingFromSnapshot({
    sourceSnapshotPath: snapshotPath,
    stagingDbPath: stagingPath,
    receiptPath,
    expectedSourceSnapshotSha256: snapshot.snapshotFileSha256,
    mode: "apply",
  });
  return stagingPath;
}

function insertProblem(db: InstanceType<typeof Database>, id: string, tags: string) {
  db.prepare(
    `INSERT INTO Problem (id, slug, title, methodName, tags, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    `Problem ${id}`,
    "solve",
    tags,
    "2026-07-16T00:00:00.000Z",
  );
}

type ReviewExecutionFactSpec = {
  suffix: string;
  problemId: string;
  factType: "mistake" | "weakness" | "strength" | "skill";
  tag: string;
  status: "failed" | "passed_visible_tests";
  eventStatus?: "failed" | "passed_visible_tests";
  evidenceClass: "verdict_bearing" | "local_only";
  providerUsed: string;
  canVerdict: boolean;
  canWriteMistakeMemory: boolean;
  reviewUserId?: string;
  eventProblemId?: string;
  eventExecutionFingerprint?: string;
  eventSource?: string;
  eventMemoryOrigin?: string;
  runSource?: string;
  omitRun?: boolean;
};

function insertReviewExecutionFact(
  db: InstanceType<typeof Database>,
  spec: ReviewExecutionFactSpec,
) {
  const now = "2026-07-16T00:00:00.000Z";
  const userId = spec.reviewUserId ?? "u1";
  const sessionId = `session-${userId}-${spec.problemId}`;
  const reviewId = `review-${spec.suffix}`;
  const runId = `run-${spec.suffix}`;
  const eventId = `event-${spec.suffix}`;
  const code = `class Solution:\n    def solve(self, nums):\n        return len(nums)\n# ${spec.suffix}`;
  const executionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code,
  });
  const codeHash = `sha256:${spec.suffix}`;
  const passedCount = spec.status === "passed_visible_tests" ? 2 : 1;
  const failedCount = spec.status === "failed" ? 1 : 0;
  const verdict = {
    evidenceClass: spec.evidenceClass,
    replyMode:
      spec.evidenceClass === "local_only"
        ? "local_fallback"
        : spec.status === "passed_visible_tests"
          ? "success"
          : "diagnostic",
    capabilities: {
      canVerdict: spec.canVerdict,
      canWriteMistakeMemory: spec.canWriteMistakeMemory,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: spec.canWriteMistakeMemory,
    },
    status: spec.status,
    providerUsed: spec.providerUsed,
    scopeLabel:
      spec.evidenceClass === "local_only"
        ? "local visible-test evidence"
        : "execution evidence",
    modelInstruction: "Use only the recorded evidence scope.",
  };
  db.prepare(
    `INSERT OR IGNORE INTO ChatSession
       (id, userId, problemId, title, memoryOrigin, updatedAt)
     VALUES (?, ?, ?, ?, 'learner', ?)`,
  ).run(sessionId, userId, spec.problemId, spec.suffix, now);
  db.prepare(
    `INSERT INTO ReviewAttempt
       (id, userId, problemId, chatSessionId, language, codeSnapshot, memoryOrigin)
     VALUES (?, ?, ?, ?, 'Python', ?, 'learner')`,
  ).run(reviewId, userId, spec.problemId, sessionId, code);
  if (!spec.omitRun) {
    db.prepare(
      `INSERT INTO RunEvidence
         (id, reviewAttemptId, chatSessionId, source, codeHash,
          executionFingerprint, status, passedCount, failedCount,
          rawResultJson, memoryOrigin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'learner')`,
    ).run(
      runId,
      reviewId,
      sessionId,
      spec.runSource ?? "review",
      codeHash,
      executionFingerprint,
      spec.status,
      passedCount,
      failedCount,
      JSON.stringify({
        status: spec.status,
        passedCount,
        failedCount,
        rawResult: { providerUsed: spec.providerUsed, evidenceVerdict: verdict },
      }),
    );
  }
  const eventStatus = spec.eventStatus ?? spec.status;
  db.prepare(
    `INSERT INTO L1MemoryEvent
       (id, userId, problemId, chatSessionId, reviewAttemptId, eventType,
        eventJson, content, source, memoryOrigin)
     VALUES (?, 'u1', ?, ?, ?, 'run_evidence', ?, ?, ?, ?)`,
  ).run(
    eventId,
    spec.eventProblemId ?? spec.problemId,
    sessionId,
    reviewId,
    JSON.stringify({
      runEvidenceId: runId,
      codeHash,
      executionFingerprint:
        spec.eventExecutionFingerprint ?? executionFingerprint,
      status: eventStatus,
      passedCount,
      failedCount,
      evidenceVerdict: { ...verdict, status: eventStatus },
    }),
    `${eventStatus}: ${passedCount} passed, ${failedCount} failed`,
    spec.eventSource ?? "review_pipeline",
    spec.eventMemoryOrigin ?? "learner",
  );
  db.prepare(
    `INSERT INTO L2MemoryFact
       (id, userId, problemId, sourceReviewAttemptId, factType, tag, status,
        evidenceTraceIds, validationJson, memoryOrigin, updatedAt)
     VALUES (?, 'u1', ?, ?, ?, ?, 'active', ?, '{}', 'learner', ?)`,
  ).run(
    `fact-${spec.suffix}`,
    spec.problemId,
    reviewId,
    spec.factType,
    spec.tag,
    JSON.stringify([eventId]),
    now,
  );
}

function insertMockInterviewExecutionFact(
  db: InstanceType<typeof Database>,
  spec: {
    suffix: string;
    problemId: string;
    providerUsed: string;
    eventMemoryOrigin: string;
  },
) {
  const now = "2026-07-16T00:00:00.000Z";
  const sessionId = `mock-session-${spec.suffix}`;
  const snapshotId = `mock-snapshot-${spec.suffix}`;
  const runId = `mock-run-${spec.suffix}`;
  const eventId = `mock-event-${spec.suffix}`;
  const code = "class Solution:\n    def solve(self, s):\n        return True";
  const executionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code,
  });
  const verdict = {
    evidenceClass: "local_only",
    replyMode: "local_fallback",
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: true,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: false,
    },
    status: "passed_visible_tests",
    providerUsed: spec.providerUsed,
    scopeLabel: "local visible-test evidence",
    modelInstruction: "Use only the recorded evidence scope.",
  };
  db.prepare(
    `INSERT INTO MockInterviewSession
       (id, userId, problemId, language, updatedAt)
     VALUES (?, 'u1', ?, 'Python', ?)`,
  ).run(sessionId, spec.problemId, now);
  db.prepare(
    `INSERT INTO MockInterviewCodeSnapshot
       (id, sessionId, problemId, language, code)
     VALUES (?, ?, ?, 'Python', ?)`,
  ).run(snapshotId, sessionId, spec.problemId, code);
  db.prepare(
    `INSERT INTO MockInterviewRunEvidence
       (id, sessionId, codeSnapshotId, problemId, status, passedCount,
        failedCount, rawResultJson)
     VALUES (?, ?, ?, ?, 'passed_visible_tests', 2, 0, ?)`,
  ).run(
    runId,
    sessionId,
    snapshotId,
    spec.problemId,
    JSON.stringify({
      status: "passed_visible_tests",
      passedCount: 2,
      failedCount: 0,
      rawResult: { providerUsed: spec.providerUsed, evidenceVerdict: verdict },
    }),
  );
  db.prepare(
    `INSERT INTO L1MemoryEvent
       (id, userId, problemId, eventType, eventJson, content, source, memoryOrigin)
     VALUES (?, 'u1', ?, 'mock_interview_run_evidence', ?, ?,
             'mock_interview:run_code', ?)`,
  ).run(
    eventId,
    spec.problemId,
    JSON.stringify({
      sessionId,
      codeSnapshotId: snapshotId,
      runEvidenceId: runId,
      executionFingerprint,
      status: "passed_visible_tests",
      passedCount: 2,
      failedCount: 0,
      evidenceVerdict: verdict,
    }),
    "passed_visible_tests: 2 passed, 0 failed",
    spec.eventMemoryOrigin,
  );
  db.prepare(
    `INSERT INTO L2MemoryFact
       (id, userId, problemId, factType, tag, status, evidenceTraceIds,
        validationJson, memoryOrigin, updatedAt)
     VALUES (?, 'u1', ?, 'strength', ?, 'active', ?, '{}', 'learner', ?)`,
  ).run(
    `fact-${spec.suffix}`,
    spec.problemId,
    `mock_interview_strength_${spec.suffix}`,
    JSON.stringify([eventId]),
    now,
  );
}

function durableIntegrityValidation(args: {
  promotionStatus: "pending" | "trusted";
  evidenceTraceId: string;
}) {
  return JSON.stringify({
    integrity: {
      version: 1,
      origin: "learner",
      subject: "user_explicit",
      mechanism: "counterexample_first_explanation",
      humanLabel:
        "The learner prefers seeing one counterexample before the abstraction.",
      portability: "portable",
      promotionStatus: args.promotionStatus,
      evidenceClusters: [
        {
          key: "explicit-preference-cluster",
          problemId: "p97",
          reviewAttemptId: null,
          revisionKey: "explicit-preference",
          transition: "preference_set",
          evidenceTraceIds: [args.evidenceTraceId],
        },
      ],
    },
  });
}

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), "pc-memory-repair-"));
  dirs.push(dir);
  const dbPath = join(dir, "source.db");
  const db = new Database(dbPath);
  applyRepositoryMigrationsBeforeOrigin(db);
  recordAppliedPreOriginMigrations(db);
  db.exec(`
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      content,
      kind UNINDEXED,
      ref_id UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
  const now = "2026-07-16T00:00:00.000Z";
  db.prepare("INSERT INTO User (id, handle, updatedAt) VALUES (?, ?, ?)").run(
    "u1",
    "try",
    now,
  );
  const insertEvent = db.prepare(
    "INSERT INTO L1MemoryEvent (id,userId,eventType,source,eventJson,content) VALUES (?,?,?,?,?,?)",
  );
  insertEvent.run("e-review", "u1", "diagnosis", "review", "{}", "diagnosis");
  insertEvent.run("e-assistant", "u1", "chat_reply", "chat_reply", "{}", "advice");
  insertEvent.run("e-user", "u1", "chat_user_message", "chat_reply", "{}", "remember this");
  const insertFact = db.prepare(
    `INSERT INTO L2MemoryFact
       (id,userId,factType,tag,status,evidenceTraceIds,validationJson,updatedAt)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  insertFact.run(
    "f-blocked",
    "u1",
    "mistake",
    "hardcoded_return",
    "active",
    '["e-review"]',
    "{}",
    now,
  );
  insertFact.run(
    "f-empty",
    "u1",
    "skill",
    "no_evidence",
    "active",
    "[]",
    "{}",
    now,
  );
  insertFact.run(
    "f-assistant",
    "u1",
    "preference",
    "assistant_only",
    "active",
    '["e-assistant"]',
    "{}",
    now,
  );
  insertFact.run(
    "f-clean",
    "u1",
    "preference",
    "language",
    "active",
    '["e-user"]',
    "{}",
    now,
  );
  const insertEpisode = db.prepare(
    `INSERT INTO MemoryEpisode
       (id,userId,kind,title,summary,outcome,tags)
     VALUES (?,?,?,?,?,?,?)`,
  );
  insertEpisode.run("ep-1", "u1", "review", "One", "First", "unresolved", "[]");
  insertEpisode.run("ep-2", "u1", "review", "Two", "Second", "resolved", "[]");
  db.prepare(
    `INSERT INTO SynthesisSlot
       (id,userId,slot,synthesisKey,text,status,updatedAt)
     VALUES (?,?,?,?,?,?,?)`,
  ).run("s1", "u1", "strengths", "legacy", "Legacy synthesis", "active", now);
  const insertNote = db.prepare(
    `INSERT INTO KnowledgeNote
       (id,userId,conceptKey,title,snippet,whenToUse,category,status,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  insertNote.run("n1", "u1", "dict", "Dict", "Use dict", "Lookup", "api", "active", now);
  insertNote.run(
    "n2",
    "u1",
    "heap",
    "Heap",
    "Use heap",
    "Priority",
    "api",
    "archived",
    now,
  );
  const insertFts = db.prepare(
    "INSERT INTO memory_fts (content,kind,ref_id) VALUES (?,?,?)",
  );
  insertFts.run("One First", "episode", "ep-1");
  insertFts.run("Old orphan", "episode", "deleted-episode");
  db.prepare("PRAGMA journal_mode=DELETE").get();
  db.close();
  return { dir, dbPath };
}

function relationalCounts(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      facts: db.prepare("SELECT COUNT(*) count FROM L2MemoryFact").get().count,
      episodes: db.prepare("SELECT COUNT(*) count FROM MemoryEpisode").get().count,
      synthesis: db.prepare("SELECT COUNT(*) count FROM SynthesisSlot").get().count,
      notes: db.prepare("SELECT COUNT(*) count FROM KnowledgeNote").get().count,
    };
  } finally {
    db.close();
  }
}

function applyRepositoryMigrationsBeforeOrigin(db: { exec: (sql: string) => unknown }) {
  const migrationsRoot = join(process.cwd(), "prisma", "migrations");
  for (const migrationName of readdirSync(migrationsRoot).sort()) {
    if (migrationName === "20260716150000_memory_origin_provenance") break;
    const migrationPath = join(migrationsRoot, migrationName, "migration.sql");
    if (!existsSync(migrationPath)) continue;
    db.exec(readFileSync(migrationPath, "utf8"));
  }
}

function recordAppliedPreOriginMigrations(db: {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
}) {
  db.exec(`CREATE TABLE "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );`);
  const insert = db.prepare(
    `INSERT INTO "_prisma_migrations"
     (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
  );
  const migrationsRoot = join(process.cwd(), "prisma", "migrations");
  const now = "2026-07-16T00:00:00.000Z";
  for (const migrationName of readdirSync(migrationsRoot).sort()) {
    if (migrationName === "20260716150000_memory_origin_provenance") break;
    const migrationPath = join(migrationsRoot, migrationName, "migration.sql");
    if (!existsSync(migrationPath)) continue;
    const sql = readFileSync(migrationPath, "utf8");
    insert.run(
      randomUUID(),
      createHash("sha256").update(sql).digest("hex"),
      now,
      migrationName,
      now,
    );
  }
}

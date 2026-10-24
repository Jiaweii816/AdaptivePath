import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEGACY_MIGRATION_PROCESS_INSTANCE_ID,
  migrateL1Telemetry,
} from "@/server/observability/migrate-l1-telemetry";
import {
  buildBackupRecommendation,
  parseRuntimeTraceMigrationArgs,
} from "../../scripts/migrate-runtime-trace";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("one-way L1 telemetry migration", () => {
  it("requires an explicit database, one mode, and explicit apply deletion", () => {
    expect(() => parseRuntimeTraceMigrationArgs(["--dry-run"])).toThrow(
      /--db/,
    );
    expect(() =>
      parseRuntimeTraceMigrationArgs(["--db", "fixture.db"]),
    ).toThrow(/exactly one/);
    expect(() =>
      parseRuntimeTraceMigrationArgs([
        "--db",
        "fixture.db",
        "--dry-run",
        "--delete-source",
      ]),
    ).toThrow(/requires --apply/);

    expect(
      parseRuntimeTraceMigrationArgs([
        "--db",
        "fixture.db",
        "--apply",
      ]),
    ).toMatchObject({ mode: "apply", deleteSource: false });
  });

  it("recommends a WAL-safe SQLite backup and restore rehearsal", async () => {
    const fixture = await createFixture();
    const recommendation = await buildBackupRecommendation(
      fixture.database.dbPath,
      new Date("2026-07-12T12:34:56.000Z"),
    );

    expect(recommendation).toMatchObject({
      databasePath: fixture.database.dbPath,
      sourceDatabaseBytes: expect.any(Number),
      sourceDatabaseFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      requiresStoppedWriters: true,
    });
    expect(recommendation.recommendedBackupPath).toContain(
      "pre-runtime-trace-20260712-",
    );
    expect(recommendation.backupCommand).toContain("sqlite3");
    expect(recommendation.backupCommand).toContain(".backup");
    expect(recommendation.backupCommand).not.toContain("cp --");
    expect(recommendation.backupChecksumCommand).toContain("sha256sum --");
    expect(recommendation.restoreCommands).toHaveLength(2);
    expect(recommendation.restoreCommands[0]).toContain("-wal");
    expect(recommendation.restoreCommands[0]).toContain("-shm");
    expect(recommendation.restoreCommands[1]).toContain("cp --");
  });

  it("shell-quotes apostrophes in SQLite backup paths", async () => {
    const fixture = await createFixture();
    const quoteDirectory = await mkdtemp(join(tmpdir(), "runtime-trace-'"));
    const quotedDatabasePath = join(quoteDirectory, "source's db.sqlite");
    await copyFile(fixture.database.dbPath, quotedDatabasePath);

    const recommendation = await buildBackupRecommendation(quotedDatabasePath);

    expect(recommendation.backupCommand).toContain(`'"'"'`);
    await rm(quoteDirectory, { recursive: true, force: true });
  });

  it("dry-runs deterministic mapping and reports malformed and per-family counts", async () => {
    const fixture = await createFixture();
    const summary = await migrateL1Telemetry(fixture.database.prisma, {
      mode: "dry-run",
    });

    expect(summary).toMatchObject({
      ok: true,
      mode: "dry-run",
      sourceTotal: 6,
      sourceMalformedEventJsonCount: 1,
      requiredRunCount: 5,
      syntheticRunCount: 2,
      existingRunCount: 0,
      existingMatchingEventCount: 0,
      pendingRunCount: 5,
      pendingEventCount: 6,
      insertedRunCount: 0,
      insertedEventCount: 0,
      deletedSourceCount: 0,
      sourceCounts: {
        llm_call: 2,
        tool_call: 1,
        tool_result: 1,
        retrieval_trace: 1,
        reply_safety_replaced: 1,
      },
    });
    expect(await fixture.database.prisma.agentTraceRun.count()).toBe(0);
    expect(await fixture.database.prisma.agentTraceEvent.count()).toBe(0);
  });

  it("applies unscoped Runs before Events and is idempotent on rerun", async () => {
    const fixture = await createFixture();
    const first = await migrateL1Telemetry(fixture.database.prisma, {
      mode: "apply",
    });

    expect(first).toMatchObject({
      ok: true,
      insertedRunCount: 5,
      insertedEventCount: 6,
      replayedEventCount: 0,
      deletedSourceCount: 0,
      remainingSourceTelemetryCount: 6,
      targetCounts: {
        llm_call: 2,
        tool_call: 1,
        tool_result: 1,
        retrieval_trace: 1,
        reply_safety_replaced: 1,
      },
      integrity: {
        expectedEventCount: 6,
        matchingEventCount: 6,
        digestMismatchCount: 0,
        missingRunCount: 0,
        eventWithoutRunCount: 0,
        payloadWithoutEventCount: 0,
      },
    });

    const events = await fixture.database.prisma.agentTraceEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events).toHaveLength(6);
    expect(events.every((event) => event.workspaceSessionId === null)).toBe(
      true,
    );
    expect(events.every((event) => event.seq === null)).toBe(true);
    expect(
      await fixture.database.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "legacy:run:legacy-tool-call" },
      }),
    ).toMatchObject({
      workspaceSessionId: null,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      processInstanceId: LEGACY_MIGRATION_PROCESS_INSTANCE_ID,
      traceCompleteness: "degraded",
    });
    expect(
      await fixture.database.prisma.agentTraceEvent.findUniqueOrThrow({
        where: { eventId: "legacy:l1:legacy-mock-llm" },
      }),
    ).toMatchObject({ path: "mock_interview", status: "failed" });
    expect(
      await fixture.database.prisma.agentTraceEvent.findUniqueOrThrow({
        where: { eventId: "legacy:l1:legacy-malformed-retrieval" },
      }),
    ).toMatchObject({
      path: "memory_background",
      status: "succeeded",
    });

    const replay = await migrateL1Telemetry(fixture.database.prisma, {
      mode: "apply",
    });
    expect(replay).toMatchObject({
      ok: true,
      existingRunCount: 5,
      existingMatchingEventCount: 6,
      pendingRunCount: 0,
      pendingEventCount: 0,
      insertedRunCount: 0,
      insertedEventCount: 0,
      replayedEventCount: 6,
    });
    expect(await fixture.database.prisma.agentTraceRun.count()).toBe(5);
    expect(await fixture.database.prisma.agentTraceEvent.count()).toBe(6);
  });

  it("reports a deterministic digest conflict and preserves every source row", async () => {
    const fixture = await createFixture();
    await migrateL1Telemetry(fixture.database.prisma, { mode: "apply" });
    await fixture.database.prisma.agentTraceEvent.update({
      where: { eventId: "legacy:l1:legacy-review-llm" },
      data: { eventDigest: "f".repeat(64) },
    });

    const conflicted = await migrateL1Telemetry(fixture.database.prisma, {
      mode: "apply",
      deleteSource: true,
    });

    expect(conflicted.ok).toBe(false);
    expect(conflicted.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "existing_event",
          id: "legacy:l1:legacy-review-llm",
        }),
      ]),
    );
    expect(conflicted.deletedSourceCount).toBe(0);
    expect(await fixture.database.prisma.l1MemoryEvent.count()).toBe(7);
  });

  it("deletes only verified telemetry when explicitly requested and keeps semantic L1", async () => {
    const fixture = await createFixture();
    const summary = await migrateL1Telemetry(fixture.database.prisma, {
      mode: "apply",
      deleteSource: true,
    });

    expect(summary).toMatchObject({
      ok: true,
      deletedSourceCount: 6,
      remainingSourceTelemetryCount: 0,
    });
    expect(
      await fixture.database.prisma.l1MemoryEvent.findMany({
        select: { id: true, eventType: true },
      }),
    ).toEqual([
      { id: "semantic-chat-reply", eventType: "chat_reply" },
    ]);
    expect(await fixture.database.prisma.agentTraceEvent.count()).toBe(6);
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(
    database.prisma,
  );
  const base = {
    userId: user.id,
    problemId: problem.id,
    occurredAt: new Date("2026-07-12T12:00:00.000Z"),
  };
  await database.prisma.l1MemoryEvent.createMany({
    data: [
      {
        ...base,
        id: "legacy-review-llm",
        eventType: "llm_call",
        source: "review:diagnose",
        eventJson: JSON.stringify({
          traceRunId: "legacy-shared-review-run",
          path: "review",
          status: "ok",
          model: "deepseek-chat",
          latencyMs: 100,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          usageSource: "provider",
        }),
      },
      {
        ...base,
        id: "legacy-tool-call",
        chatSessionId: chatSession.id,
        eventType: "tool_call",
        source: "chat_reply",
        occurredAt: new Date("2026-07-12T12:00:01.000Z"),
        eventJson: JSON.stringify({
          toolCallId: "tool-1",
          toolName: "run_current_code",
          arguments: { tests: ["visible-1"] },
        }),
      },
      {
        ...base,
        id: "legacy-tool-result",
        chatSessionId: chatSession.id,
        eventType: "tool_result",
        source: "chat_reply",
        occurredAt: new Date("2026-07-12T12:00:02.000Z"),
        eventJson: JSON.stringify({
          traceRunId: "legacy-shared-chat-run",
          toolCallId: "tool-2",
          toolName: "run_current_code",
          status: "error",
          errorKind: "tool_execution_error",
        }),
      },
      {
        ...base,
        id: "legacy-guard",
        chatSessionId: chatSession.id,
        eventType: "reply_safety_replaced",
        source: "chat_reply",
        occurredAt: new Date("2026-07-12T12:00:03.000Z"),
        eventJson: JSON.stringify({
          traceRunId: "legacy-shared-chat-run",
          reason: "product_invariant",
          originalReply: "unsafe",
          replacement: "safe",
        }),
      },
      {
        ...base,
        id: "legacy-malformed-retrieval",
        eventType: "retrieval_trace",
        source: "retrieve_memory",
        occurredAt: new Date("2026-07-12T12:00:04.000Z"),
        eventJson: "{malformed-json",
      },
      {
        ...base,
        id: "legacy-mock-llm",
        eventType: "llm_call",
        source: "mock_interview:respond",
        occurredAt: new Date("2026-07-12T12:00:05.000Z"),
        eventJson: JSON.stringify({
          traceRunId: "legacy-mock-run",
          path: "mock_interview",
          status: "error",
          model: "deepseek-chat",
          usageSource: "missing",
          usageMissingReason: "error_response",
        }),
      },
      {
        ...base,
        id: "semantic-chat-reply",
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        source: "chat_reply",
        occurredAt: new Date("2026-07-12T12:00:06.000Z"),
        eventJson: JSON.stringify({
          traceRunId: "legacy-shared-chat-run",
          sequence: 2,
        }),
      },
    ],
  });
  return { database, user, problem, chatSession };
}

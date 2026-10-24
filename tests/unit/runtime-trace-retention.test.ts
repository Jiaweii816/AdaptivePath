import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { runTracePayloadRetentionMaintenance } from "@/server/observability/runtime-trace-retention";
import { ensureWorkspaceTraceTurnBestEffort } from "@/server/observability/workspace-trace-finalize";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
const NOW = new Date("2026-07-12T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("Runtime Trace payload retention", () => {
  it("protects active, non-terminal background, open/unflushed, and recent terminal Sessions", async () => {
    const fixture = await createFixture();
    const eligible = await createScopedPayload(fixture, {
      label: "eligible-old",
      startedAt: hoursAgo(8),
    });
    const recent = await createScopedPayload(fixture, {
      label: "recent-terminal",
      startedAt: hoursAgo(1),
    });
    const active = await createScopedPayload(fixture, {
      label: "active",
      foregroundStatus: "active",
      backgroundStatus: "idle",
      startedAt: hoursAgo(10),
    });
    const sessionPending = await createScopedPayload(fixture, {
      label: "session-pending",
      backgroundStatus: "pending",
      startedAt: hoursAgo(9),
    });
    const jobPending = await createScopedPayload(fixture, {
      label: "job-pending",
      startedAt: hoursAgo(7),
    });
    await fixture.prisma.backgroundJob.create({
      data: {
        id: "job-pending",
        workspaceSessionId: jobPending.sessionId,
        originatingTraceRunId: jobPending.runId,
        processInstanceId: "boot-test",
        kind: "reflection",
        status: "pending",
        enqueuedAt: hoursAgo(6),
      },
    });
    const open = await createScopedPayload(fixture, {
      label: "open-run",
      startedAt: hoursAgo(6),
      traceCompleteness: "open",
      finalFlushAt: null,
    });
    const unflushed = await createScopedPayload(fixture, {
      label: "unflushed-run",
      startedAt: hoursAgo(5),
      traceCompleteness: "incomplete",
      finalFlushAt: null,
    });

    const result = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 1,
      retainUnscopedDays: 30,
      batchSize: 50,
      now: NOW,
    });

    expect(result).toMatchObject({ prunedCount: 1, scopedPrunedCount: 1 });
    expect(await payloadExists(fixture.prisma, eligible.eventRowId)).toBe(false);
    for (const protectedTrace of [
      recent,
      active,
      sessionPending,
      jobPending,
      open,
      unflushed,
    ]) {
      expect(await payloadExists(fixture.prisma, protectedTrace.eventRowId)).toBe(true);
    }
    expect(
      await fixture.prisma.agentTraceEvent.findUniqueOrThrow({
        where: { id: eligible.eventRowId },
        select: { payloadState: true },
      }),
    ).toEqual({ payloadState: "pruned" });
  });

  it("prunes only Payload rows while keeping Event/Run skeleton metrics", async () => {
    const fixture = await createFixture();
    const trace = await createScopedPayload(fixture, {
      label: "skeleton",
      startedAt: hoursAgo(4),
      providerTotalTokens: 321,
      estimatedCostUsd: 0.0012,
      llmCallCount: 1,
    });

    await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 0,
      batchSize: 10,
      now: NOW,
    });

    expect(await fixture.prisma.agentTracePayload.count()).toBe(0);
    expect(
      await fixture.prisma.agentTraceEvent.findUniqueOrThrow({
        where: { id: trace.eventRowId },
      }),
    ).toMatchObject({
      payloadState: "pruned",
      providerTotalTokens: 321,
      estimatedCostUsd: 0.0012,
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: trace.runId },
      }),
    ).toMatchObject({
      traceCompleteness: "complete",
      providerTotalTokens: 321,
      estimatedCostUsd: 0.0012,
      llmCallCount: 1,
    });
  });

  it("applies the recent terminal Session allowance independently per user", async () => {
    const fixture = await createFixture();
    const firstUserOld = await createScopedPayload(fixture, {
      label: "first-user-old",
      startedAt: hoursAgo(6),
    });
    const firstUserRecent = await createScopedPayload(fixture, {
      label: "first-user-recent",
      startedAt: hoursAgo(1),
    });
    const secondUser = await fixture.prisma.user.create({
      data: { handle: "second-retention-user" },
    });
    const secondUserFixture = { ...fixture, userId: secondUser.id };
    const secondUserOnly = await createScopedPayload(secondUserFixture, {
      label: "second-user-only",
      startedAt: hoursAgo(5),
    });

    await runTracePayloadRetentionMaintenance(fixture.prisma, {
      retainFullSessions: 1,
      batchSize: 10,
      now: NOW,
    });

    expect(await payloadExists(fixture.prisma, firstUserOld.eventRowId)).toBe(false);
    expect(await payloadExists(fixture.prisma, firstUserRecent.eventRowId)).toBe(true);
    expect(await payloadExists(fixture.prisma, secondUserOnly.eventRowId)).toBe(true);
  });

  it("expires only unscoped payloads older than TRACE_RETAIN_UNSCOPED_DAYS", async () => {
    const fixture = await createFixture();
    const old = await createUnscopedPayload(
      fixture,
      "legacy-old",
      daysAgo(31),
      // Phase 3 creates the Payload during migration, but retention must use
      // the historical Event clock instead of renewing it for 30 days.
      NOW,
    );
    const boundary = await createUnscopedPayload(fixture, "mock-boundary", daysAgo(30));
    const recent = await createUnscopedPayload(fixture, "mock-recent", daysAgo(2));

    const result = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 0,
      retainUnscopedDays: 30,
      batchSize: 10,
      now: NOW,
    });

    expect(result).toMatchObject({ prunedCount: 1, unscopedPrunedCount: 1 });
    expect(await payloadExists(fixture.prisma, old.eventRowId)).toBe(false);
    expect(await payloadExists(fixture.prisma, boundary.eventRowId)).toBe(true);
    expect(await payloadExists(fixture.prisma, recent.eventRowId)).toBe(true);
  });

  it("is bounded and idempotent across maintenance passes", async () => {
    const fixture = await createFixture();
    for (const [index, age] of [6, 5, 4].entries()) {
      await createScopedPayload(fixture, {
        label: `bounded-${index}`,
        startedAt: hoursAgo(age),
      });
    }

    const first = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 0,
      batchSize: 2,
      now: NOW,
    });
    expect(first).toMatchObject({ prunedCount: 2, hasMoreCandidates: true });
    expect(await fixture.prisma.agentTracePayload.count()).toBe(1);

    const second = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 0,
      batchSize: 2,
      now: NOW,
    });
    expect(second).toMatchObject({ prunedCount: 1, hasMoreCandidates: false });

    const third = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      userId: fixture.userId,
      retainFullSessions: 0,
      batchSize: 2,
      now: NOW,
    });
    expect(third).toMatchObject({ prunedCount: 0, selectedCount: 0 });
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(3);
    expect(await fixture.prisma.agentTraceRun.count()).toBe(3);
  });

  it("rolls back the Event state when Payload deletion fails", async () => {
    const fixture = await createFixture();
    const trace = await createScopedPayload(fixture, {
      label: "atomic-rollback",
      startedAt: hoursAgo(4),
    });
    await fixture.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_trace_payload_prune
      BEFORE DELETE ON AgentTracePayload
      BEGIN
        SELECT RAISE(ABORT, 'payload prune rejected');
      END;
    `);

    await expect(
      runTracePayloadRetentionMaintenance(fixture.prisma, {
        userId: fixture.userId,
        retainFullSessions: 0,
        batchSize: 1,
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(await payloadExists(fixture.prisma, trace.eventRowId)).toBe(true);
    expect(
      await fixture.prisma.agentTraceEvent.findUniqueOrThrow({
        where: { id: trace.eventRowId },
        select: { payloadState: true },
      }),
    ).toEqual({ payloadState: "captured" });
  });

  it("explicitly disables retention while eval artifacts await export", async () => {
    const fixture = await createFixture();
    const trace = await createScopedPayload(fixture, {
      label: "eval-artifact",
      startedAt: hoursAgo(24),
    });

    const result = await runTracePayloadRetentionMaintenance(fixture.prisma, {
      mode: "disabled_until_export",
      userId: fixture.userId,
      retainFullSessions: 0,
      batchSize: 1,
      now: NOW,
    });

    expect(result).toMatchObject({
      skipped: true,
      skipReason: "eval_artifacts_pending_export",
      prunedCount: 0,
    });
    expect(await payloadExists(fixture.prisma, trace.eventRowId)).toBe(true);
  });

  it("triggers bounded maintenance after allocation without pruning the active Turn", async () => {
    const fixture = await createFixture();
    const old = await createScopedPayload(fixture, {
      label: "maintenance-trigger",
      startedAt: hoursAgo(12),
    });

    const active = await ensureWorkspaceTraceTurnBestEffort(fixture.prisma, {
      userId: fixture.userId,
      problemId: fixture.problemId,
      browserInstanceId: "maintenance-browser",
      action: "practice_run",
      now: NOW,
      snapshot: { code: "print('active')" },
      env: {
        TRACE_RETAIN_FULL_SESSIONS: "0",
        TRACE_RETAIN_UNSCOPED_DAYS: "30",
        TRACE_PRUNE_BATCH_SIZE: "1",
      },
    });

    expect(active.enabled).toBe(true);
    if (!active.enabled) throw new Error("trace allocation was disabled");
    await expect
      .poll(() => payloadExists(fixture.prisma, old.eventRowId))
      .toBe(false);
    expect(
      await fixture.prisma.agentTracePayload.count({
        where: { workspaceSessionId: active.workspaceSessionId },
      }),
    ).toBe(1);
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const seeded = await seedMinimalUserAndProblem(database.prisma);
  return {
    prisma: database.prisma,
    userId: seeded.user.id,
    problemId: seeded.problem.id,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createScopedPayload(
  fixture: Fixture,
  args: {
    label: string;
    startedAt: Date;
    foregroundStatus?: "active" | "closed" | "abandoned";
    backgroundStatus?: "idle" | "pending" | "settled" | "failed";
    traceCompleteness?: "open" | "complete" | "degraded" | "incomplete";
    finalFlushAt?: Date | null;
    providerTotalTokens?: number;
    estimatedCostUsd?: number;
    llmCallCount?: number;
  },
) {
  const sessionId = `session-${args.label}`;
  const runId = `run-${args.label}`;
  const eventRowId = `event-row-${args.label}`;
  const foregroundStatus = args.foregroundStatus ?? "closed";
  const traceCompleteness = args.traceCompleteness ?? "complete";
  const finalFlushAt =
    args.finalFlushAt === undefined ? args.startedAt : args.finalFlushAt;
  await fixture.prisma.problemWorkspaceSession.create({
    data: {
      id: sessionId,
      userId: fixture.userId,
      problemId: fixture.problemId,
      browserInstanceId: `browser-${args.label}`,
      activeIdentityKey:
        foregroundStatus === "active" ? `active-${args.label}` : null,
      startTrigger: "review",
      captureLevel: "full",
      foregroundStatus,
      backgroundStatus:
        args.backgroundStatus ?? (foregroundStatus === "active" ? "idle" : "settled"),
      startedAt: args.startedAt,
      lastActivityAt: args.startedAt,
      foregroundEndedAt:
        foregroundStatus === "active" ? null : args.startedAt,
      endReason: foregroundStatus === "active" ? null : "explicit_exit",
      settledAt:
        args.backgroundStatus === "pending" || foregroundStatus === "active"
          ? null
          : args.startedAt,
    },
  });
  await fixture.prisma.agentTraceRun.create({
    data: {
      id: runId,
      userId: fixture.userId,
      problemId: fixture.problemId,
      workspaceSessionId: sessionId,
      turnOrdinal: 1,
      path: "review",
      actionKind: "review",
      status: traceCompleteness === "complete" ? "succeeded" : "degraded",
      processInstanceId: "boot-test",
      startedAt: args.startedAt,
      endedAt: traceCompleteness === "open" ? null : args.startedAt,
      traceCompleteness,
      finalFlushAt,
      providerTotalTokens: args.providerTotalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      llmCallCount: args.llmCallCount ?? 0,
    },
  });
  await createEventPayload(fixture.prisma, {
    eventRowId,
    eventId: `event-${args.label}`,
    runId,
    workspaceSessionId: sessionId,
    createdAt: args.startedAt,
    providerTotalTokens: args.providerTotalTokens,
    estimatedCostUsd: args.estimatedCostUsd,
  });
  return { sessionId, runId, eventRowId };
}

async function createUnscopedPayload(
  fixture: Fixture,
  label: string,
  createdAt: Date,
  payloadCreatedAt = createdAt,
) {
  const runId = `run-${label}`;
  const eventRowId = `event-row-${label}`;
  await fixture.prisma.agentTraceRun.create({
    data: {
      id: runId,
      userId: fixture.userId,
      problemId: fixture.problemId,
      path: label.startsWith("legacy") ? "memory_background" : "mock_interview",
      status: "succeeded",
      processInstanceId: "boot-test",
      startedAt: createdAt,
      endedAt: createdAt,
      traceCompleteness: "complete",
      finalFlushAt: createdAt,
    },
  });
  await createEventPayload(fixture.prisma, {
    eventRowId,
    eventId: `event-${label}`,
    runId,
    workspaceSessionId: null,
    createdAt,
    payloadCreatedAt,
  });
  return { runId, eventRowId };
}

async function createEventPayload(
  prisma: PrismaClient,
  args: {
    eventRowId: string;
    eventId: string;
    runId: string;
    workspaceSessionId: string | null;
    createdAt: Date;
    payloadCreatedAt?: Date;
    providerTotalTokens?: number;
    estimatedCostUsd?: number;
  },
) {
  await prisma.agentTraceEvent.create({
    data: {
      id: args.eventRowId,
      eventId: args.eventId,
      eventDigest: `digest-${args.eventId}`,
      workspaceSessionId: args.workspaceSessionId,
      traceRunId: args.runId,
      path: "review",
      stage: "test",
      kind: "llm",
      title: "Test payload",
      status: "succeeded",
      occurredAt: args.createdAt,
      providerTotalTokens: args.providerTotalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      detailLevel: "full",
      payloadState: "captured",
      createdAt: args.createdAt,
      payload: {
        create: {
          workspaceSessionId: args.workspaceSessionId,
          inputJson: JSON.stringify({ retained: true }),
          byteSize: 17,
          createdAt: args.payloadCreatedAt ?? args.createdAt,
        },
      },
    },
  });
}

async function payloadExists(prisma: PrismaClient, traceEventId: string) {
  return (
    (await prisma.agentTracePayload.count({ where: { traceEventId } })) === 1
  );
}

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

import { afterEach, describe, expect, it } from "vitest";
import {
  claimBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reconcileBackgroundJobs,
  recomputeWorkspaceSessionSettlement,
  recordBackgroundJobBeforeDispatch,
} from "@/server/observability/background-job-store";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import { finalizeTraceRun } from "@/server/observability/trace-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
const T0 = new Date("2026-07-12T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("durable Background Job settlement kernel", () => {
  it("records pending before dispatch, conditionally claims, and creates a linked child Run", async () => {
    const fixture = await createFixture();
    const job = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      jobId: "job-reflection",
      now: T0,
    });

    expect(job).toMatchObject({
      id: "job-reflection",
      memoryOrigin: "legacy_unknown",
      workspaceSessionId: fixture.root.workspaceSessionId,
      status: "pending",
      traceRunId: null,
    });
    expect(await session(fixture)).toMatchObject({
      backgroundStatus: "pending",
      settledAt: null,
    });

    const wrongOwner = await claimBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "boot-b",
      traceRunId: "must-not-exist",
      now: plus(1_000),
    });
    expect(wrongOwner.applied).toBe(false);
    expect(await fixture.prisma.agentTraceRun.count({ where: { id: "must-not-exist" } })).toBe(0);

    const claimed = await claimBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "boot-a",
      traceRunId: "run-reflection",
      now: plus(2_000),
    });
    expect(claimed).toMatchObject({ applied: true, job: { status: "running" } });
    if (!claimed.applied) throw new Error("job was not claimed");
    expect(claimed.childRun).toMatchObject({
      id: "run-reflection",
      memoryOrigin: "legacy_unknown",
      path: "memory_background",
      parentTraceRunId: fixture.root.traceRunId,
      originatingTraceRunId: fixture.root.traceRunId,
      originatingTurnOrdinal: fixture.root.turnOrdinal,
      workspaceSessionId: fixture.root.workspaceSessionId,
    });

    await finalizeTraceRun(fixture.prisma, {
      traceRunId: "run-reflection",
      status: "succeeded",
      traceCompleteness: "complete",
      endedAt: plus(3_000),
      traceOverheadMs: 0,
    });
    const completed = await completeBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "boot-a",
      now: plus(4_000),
    });
    expect(completed).toMatchObject({ applied: true, job: { status: "succeeded" } });
    expect(await session(fixture)).toMatchObject({
      foregroundStatus: "active",
      backgroundStatus: "settled",
      settledAt: null,
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "run-reflection" },
      }),
    ).toMatchObject({
      status: "succeeded",
      traceCompleteness: "complete",
      durationMs: 1_000,
      finalFlushAt: plus(3_000),
    });
  });

  it("never fabricates a complete final flush when a worker settles an open child Run", async () => {
    const fixture = await createFixture();
    const success = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      jobId: "unflushed-success",
      now: T0,
    });
    await claimBackgroundJob(fixture.prisma, {
      jobId: success.id,
      processInstanceId: "boot-a",
      traceRunId: "unflushed-success-run",
      now: plus(1_000),
    });
    await completeBackgroundJob(fixture.prisma, {
      jobId: success.id,
      processInstanceId: "boot-a",
      now: plus(2_000),
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "unflushed-success-run" },
      }),
    ).toMatchObject({
      status: "degraded",
      traceCompleteness: "incomplete",
      finalFlushAt: null,
    });

    const failure = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "embed_backfill",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      jobId: "unflushed-failure",
      now: plus(3_000),
    });
    await claimBackgroundJob(fixture.prisma, {
      jobId: failure.id,
      processInstanceId: "boot-a",
      traceRunId: "unflushed-failure-run",
      now: plus(4_000),
    });
    await failBackgroundJob(fixture.prisma, {
      jobId: failure.id,
      processInstanceId: "boot-a",
      now: plus(5_000),
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "unflushed-failure-run" },
      }),
    ).toMatchObject({
      status: "failed",
      traceCompleteness: "incomplete",
      finalFlushAt: null,
    });
  });

  it.each(["pending", "running"] as const)(
    "reconciles an old-process %s job as process_restart",
    async (initialStatus) => {
      const fixture = await createFixture();
      const job = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
        kind: "chat_consolidation",
        originatingTraceRunId: fixture.root.traceRunId,
        processInstanceId: "old-boot",
        jobId: `old-${initialStatus}`,
        now: T0,
      });
      if (initialStatus === "running") {
        const claimed = await claimBackgroundJob(fixture.prisma, {
          jobId: job.id,
          processInstanceId: "old-boot",
          traceRunId: "old-child-run",
          now: plus(1_000),
        });
        expect(claimed.applied).toBe(true);
      }

      const result = await reconcileBackgroundJobs(fixture.prisma, {
        processInstanceId: "new-boot",
        now: plus(2_000),
      });

      expect(result).toEqual({
        reconciledCount: 1,
        reconciled: [
          {
            jobId: job.id,
            priorStatus: initialStatus,
            failureReason: "process_restart",
          },
        ],
      });
      expect(
        await fixture.prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
      ).toMatchObject({ status: "failed", failureReason: "process_restart" });
      expect(await session(fixture)).toMatchObject({
        backgroundStatus: "failed",
        settledAt: null,
      });
      if (initialStatus === "running") {
        expect(
          await fixture.prisma.agentTraceRun.findUniqueOrThrow({
            where: { id: "old-child-run" },
          }),
        ).toMatchObject({
          status: "failed",
          traceCompleteness: "incomplete",
          finalFlushAt: null,
        });
      }
    },
  );

  it("uses timeout for stale current-process work and leaves live current work alone", async () => {
    const fixture = await createFixture();
    const pending = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "embed_backfill",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "current-boot",
      jobId: "current-pending",
      now: T0,
    });
    const running = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "current-boot",
      jobId: "current-running",
      now: T0,
    });
    await claimBackgroundJob(fixture.prisma, {
      jobId: running.id,
      processInstanceId: "current-boot",
      traceRunId: "current-running-child",
      now: plus(4_000),
    });

    const live = await reconcileBackgroundJobs(fixture.prisma, {
      processInstanceId: "current-boot",
      pendingTtlMs: 10_000,
      runningTtlMs: 10_000,
      now: plus(5_000),
    });
    expect(live.reconciledCount).toBe(0);

    const timedOut = await reconcileBackgroundJobs(fixture.prisma, {
      processInstanceId: "current-boot",
      pendingTtlMs: 6_000,
      runningTtlMs: 2_000,
      now: plus(7_000),
    });
    expect(timedOut.reconciled).toEqual(
      expect.arrayContaining([
        { jobId: pending.id, priorStatus: "pending", failureReason: "timeout" },
        { jobId: running.id, priorStatus: "running", failureReason: "timeout" },
      ]),
    );
    expect(timedOut.reconciled).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ failureReason: "process_restart" })]),
    );
  });

  it("prevents a late completion from overwriting a reconciled terminal result", async () => {
    const fixture = await createFixture();
    const job = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "old-boot",
      jobId: "late-job",
      now: T0,
    });
    await claimBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "old-boot",
      traceRunId: "late-child",
      now: plus(1_000),
    });
    await reconcileBackgroundJobs(fixture.prisma, {
      processInstanceId: "new-boot",
      now: plus(2_000),
    });

    const lateSuccess = await completeBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "old-boot",
      now: plus(3_000),
    });
    const lateError = await failBackgroundJob(fixture.prisma, {
      jobId: job.id,
      processInstanceId: "old-boot",
      now: plus(4_000),
    });

    expect(lateSuccess.applied).toBe(false);
    expect(lateError.applied).toBe(false);
    expect(
      await fixture.prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: "failed",
      failureReason: "process_restart",
      endedAt: plus(2_000),
    });
  });

  it("records a nested child before parent completion and prevents premature settlement", async () => {
    const fixture = await createFixture();
    const parentJob = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "chat_consolidation",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      jobId: "parent-job",
      now: T0,
    });
    const parentClaim = await claimBackgroundJob(fixture.prisma, {
      jobId: parentJob.id,
      processInstanceId: "boot-a",
      traceRunId: "parent-child-run",
      now: plus(1_000),
    });
    if (!parentClaim.applied) throw new Error("parent was not claimed");

    await fixture.prisma.problemWorkspaceSession.update({
      where: { id: fixture.root.workspaceSessionId },
      data: {
        foregroundStatus: "closed",
        activeIdentityKey: null,
        foregroundEndedAt: plus(2_000),
      },
    });
    const nestedJob = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "embed_backfill",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      jobId: "nested-job",
      now: plus(3_000),
    });

    await completeBackgroundJob(fixture.prisma, {
      jobId: parentJob.id,
      processInstanceId: "boot-a",
      now: plus(4_000),
    });
    expect(await session(fixture)).toMatchObject({
      foregroundStatus: "closed",
      backgroundStatus: "pending",
      settledAt: null,
    });

    const nestedClaim = await claimBackgroundJob(fixture.prisma, {
      jobId: nestedJob.id,
      parentTraceRunId: parentClaim.childRun.id,
      processInstanceId: "boot-a",
      traceRunId: "nested-child-run",
      now: plus(5_000),
    });
    expect(nestedClaim).toMatchObject({
      applied: true,
      childRun: {
        parentTraceRunId: parentClaim.childRun.id,
        originatingTraceRunId: fixture.root.traceRunId,
        originatingTurnOrdinal: fixture.root.turnOrdinal,
      },
    });
    await completeBackgroundJob(fixture.prisma, {
      jobId: nestedJob.id,
      processInstanceId: "boot-a",
      now: plus(6_000),
    });
    expect(await session(fixture)).toMatchObject({
      backgroundStatus: "settled",
      settledAt: plus(6_000),
    });
  });

  it("settles failed scoped work after navigation and supports unscoped interview work", async () => {
    const fixture = await createFixture();
    const scoped = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "boot-a",
      now: T0,
    });
    await claimBackgroundJob(fixture.prisma, {
      jobId: scoped.id,
      processInstanceId: "boot-a",
      now: plus(1_000),
    });
    await fixture.prisma.problemWorkspaceSession.update({
      where: { id: fixture.root.workspaceSessionId },
      data: {
        foregroundStatus: "closed",
        activeIdentityKey: null,
        foregroundEndedAt: plus(2_000),
      },
    });
    await failBackgroundJob(fixture.prisma, {
      jobId: scoped.id,
      processInstanceId: "boot-a",
      now: plus(3_000),
    });
    expect(await session(fixture)).toMatchObject({
      backgroundStatus: "failed",
      settledAt: plus(3_000),
    });

    const unscopedOrigin = await fixture.prisma.agentTraceRun.create({
      data: {
        id: "mock-origin",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        path: "mock_interview",
        processInstanceId: "boot-a",
      },
    });
    const unscoped = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "interview_feedback",
      originatingTraceRunId: unscopedOrigin.id,
      processInstanceId: "boot-a",
    });
    expect(unscoped.workspaceSessionId).toBeNull();
    const claimed = await claimBackgroundJob(fixture.prisma, {
      jobId: unscoped.id,
      processInstanceId: "boot-a",
      traceRunId: "mock-background-child",
    });
    expect(claimed).toMatchObject({
      applied: true,
      childRun: {
        workspaceSessionId: null,
        parentTraceRunId: "mock-origin",
        originatingTraceRunId: "mock-origin",
      },
    });
  });

  it("reconciles orphan Jobs during the next ensure-session transaction (restart rehearsal)", async () => {
    const fixture = await createFixture({ processInstanceId: "old-boot" });
    const job = await recordBackgroundJobBeforeDispatch(fixture.prisma, {
      kind: "reflection",
      originatingTraceRunId: fixture.root.traceRunId,
      processInstanceId: "old-boot",
      jobId: "restart-job",
      now: T0,
    });

    const next = await ensureWorkspaceTraceTurn(fixture.prisma, {
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      browserInstanceId: "same-tab",
      action: "chat",
      snapshot: {},
      cutoverEnabled: true,
      captureLevel: "full",
      processInstanceId: "new-boot",
      traceRunId: "post-restart-turn",
      now: plus(1_000),
      env: {},
    });
    expect(next.enabled).toBe(true);
    expect(
      await fixture.prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: "failed", failureReason: "process_restart" });
    expect(await session(fixture)).toMatchObject({ backgroundStatus: "failed" });
  });

  it("recomputes terminal settlement idempotently", async () => {
    const fixture = await createFixture();
    await fixture.prisma.problemWorkspaceSession.update({
      where: { id: fixture.root.workspaceSessionId },
      data: {
        foregroundStatus: "closed",
        activeIdentityKey: null,
        foregroundEndedAt: plus(1_000),
      },
    });
    await recomputeWorkspaceSessionSettlement(
      fixture.prisma,
      fixture.root.workspaceSessionId,
      plus(2_000),
    );
    await recomputeWorkspaceSessionSettlement(
      fixture.prisma,
      fixture.root.workspaceSessionId,
      plus(3_000),
    );
    expect(await session(fixture)).toMatchObject({
      backgroundStatus: "settled",
      settledAt: plus(3_000),
    });
  });
});

async function createFixture(options: { processInstanceId?: string } = {}) {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const root = await ensureWorkspaceTraceTurn(database.prisma, {
    userId: user.id,
    problemId: problem.id,
    browserInstanceId: "same-tab",
    action: "review",
    snapshot: {},
    cutoverEnabled: true,
    captureLevel: "full",
    processInstanceId: options.processInstanceId ?? "root-boot",
    traceRunId: "foreground-root",
    now: T0,
    env: {},
  });
  if (!root.enabled) throw new Error("trace unexpectedly disabled");
  return { prisma: database.prisma, user, problem, root };
}

function session(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
    where: { id: fixture.root.workspaceSessionId },
  });
}

function plus(milliseconds: number) {
  return new Date(T0.getTime() + milliseconds);
}

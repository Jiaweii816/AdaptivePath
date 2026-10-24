import { afterEach, describe, expect, it } from "vitest";
import {
  appendTraceEventBestEffort,
  attachTraceRunReferences,
  createTraceContext,
  startTraceStep,
} from "@/server/llm/trace-context";
import {
  finalizeForegroundWorkspaceTrace,
} from "@/server/observability/workspace-trace-finalize";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
afterEach(async () =>
  Promise.all(databases.splice(0).map((database) => database.cleanup())),
);

describe("foreground trace metrics kernel", () => {
  it("keeps trace overhead outside stage duration and inside Turn wall time", async () => {
    const fixture = await createFixture();
    const context = createTraceContext({
      prisma: fixture.prisma,
      userId: fixture.userId,
      problemId: fixture.problemId,
      path: "practice_run",
      task: "practice_run",
      traceRunId: fixture.runId,
      workspaceSessionId: fixture.sessionId,
      turnOrdinal: 1,
      captureLevel: "full",
      initialTraceOverheadMs: 25,
    });
    const step = startTraceStep(context, { spanKind: "runner" });
    await attachTraceRunReferences(context, {
      chatSessionId: fixture.chatSessionId,
    });
    expect(context.recorder!.traceOverheadMs).toBeGreaterThan(25);

    await appendTraceEventBestEffort(context, {
      step,
      stage: "execution_evidence",
      kind: "runner",
      title: "Visible test execution",
      status: "succeeded",
      durationMs: 600,
      details: { metadata: { provider: "fixture" } },
    });

    const result = await finalizeForegroundWorkspaceTrace(
      fixture.prisma,
      fixture.turn,
      context,
      { status: "succeeded" },
    );
    const run = await fixture.prisma.agentTraceRun.findUniqueOrThrow({
      where: { id: fixture.runId },
    });
    const runner = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: { traceRunId: fixture.runId, kind: "runner" },
    });

    expect(result).toMatchObject({ ok: true, degraded: false });
    expect(runner.durationMs).toBe(600);
    expect(run).toMatchObject({
      status: "succeeded",
      traceCompleteness: "complete",
      chatSessionId: fixture.chatSessionId,
    });
    expect(run.traceOverheadMs).toBeGreaterThanOrEqual(25);
    expect(run.durationMs).toBeGreaterThanOrEqual(900);
    expect(run.durationMs!).toBeGreaterThan(
      runner.durationMs! + run.traceOverheadMs!,
    );
  });

  it("clamps a backwards wall-clock duration without degrading the trace", async () => {
    const fixture = await createFixture();
    const context = createTraceContext({
      prisma: fixture.prisma,
      userId: fixture.userId,
      problemId: fixture.problemId,
      path: "review",
      task: "review",
      traceRunId: fixture.runId,
      workspaceSessionId: fixture.sessionId,
      turnOrdinal: 1,
      captureLevel: "full",
    });

    await appendTraceEventBestEffort(context, {
      stage: "review_persistence",
      kind: "persistence",
      title: "Persist Review outcome",
      status: "succeeded",
      durationMs: -1,
    });

    const result = await finalizeForegroundWorkspaceTrace(
      fixture.prisma,
      fixture.turn,
      context,
      { status: "succeeded" },
    );
    const event = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: { traceRunId: fixture.runId, stage: "review_persistence" },
    });

    expect(event.durationMs).toBe(0);
    expect(result).toMatchObject({ ok: true, degraded: false });
    await expect(
      fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: fixture.runId },
      }),
    ).resolves.toMatchObject({ traceCompleteness: "complete" });
  });

  it("labels start/end RSS and heap values as process-wide samples without consuming step indexes", async () => {
    const fixture = await createFixture();
    const context = createTraceContext({
      prisma: fixture.prisma,
      userId: fixture.userId,
      problemId: fixture.problemId,
      path: "review",
      task: "review",
      traceRunId: fixture.runId,
      workspaceSessionId: fixture.sessionId,
      turnOrdinal: 1,
      captureLevel: "full",
    });
    expect(startTraceStep(context, { spanKind: "llm" })?.stepIndex).toBe(1);

    await finalizeForegroundWorkspaceTrace(
      fixture.prisma,
      fixture.turn,
      context,
      { status: "failed" },
    );

    const samples = await fixture.prisma.agentTraceEvent.findMany({
      where: { traceRunId: fixture.runId, stage: "resource_sample" },
      orderBy: { occurredAt: "asc" },
      include: { payload: true },
    });
    expect(samples).toHaveLength(2);
    expect(samples.map((sample) => sample.resourceScope)).toEqual([
      "process_sample",
      "process_sample",
    ]);
    for (const sample of samples) {
      expect(sample.stepIndex).toBeNull();
      expect(sample.memoryRssBytes).toBeGreaterThan(0);
      expect(sample.memoryHeapUsedBytes).toBeGreaterThan(0);
      expect(sample.payload?.detailMetadataJson).toContain("process-wide");
      expect(sample.payload?.detailMetadataJson).toContain(
        "not_per_turn_allocation",
      );
    }
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: fixture.runId },
      }),
    ).toMatchObject({ status: "failed", traceCompleteness: "complete" });
  });

  it("degrades an allocated Run when its foreground recorder is unavailable", async () => {
    const fixture = await createFixture();

    const result = await finalizeForegroundWorkspaceTrace(
      fixture.prisma,
      fixture.turn,
      undefined,
      { status: "succeeded" },
    );

    expect(result).toMatchObject({ ok: false, degraded: true });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: fixture.runId },
      }),
    ).toMatchObject({ status: "degraded", traceCompleteness: "degraded" });
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(
    database.prisma,
  );
  const session = await database.prisma.problemWorkspaceSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      browserInstanceId: `metrics-tab-${Math.random()}`,
      activeIdentityKey: `metrics:${Math.random()}`,
      startTrigger: "review",
      captureLevel: "full",
    },
  });
  const runId = `metrics-run-${Math.random()}`;
  await database.prisma.agentTraceRun.create({
    data: {
      id: runId,
      userId: user.id,
      problemId: problem.id,
      workspaceSessionId: session.id,
      turnOrdinal: 1,
      path: "review",
      processInstanceId: "metrics-test-process",
      startedAt: new Date(Date.now() - 1_000),
    },
  });
  return {
    prisma: database.prisma,
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    sessionId: session.id,
    runId,
    turn: {
      enabled: true as const,
      workspaceSessionId: session.id,
      traceRunId: runId,
      turnOrdinal: 1,
      snapshotEventId: `${runId}:snapshot`,
      snapshotSeq: 1,
      captureLevel: "full" as const,
    },
  };
}

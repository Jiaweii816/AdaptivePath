import { afterEach, describe, expect, it } from "vitest";
import type { PreCaptureTraceEvent } from "@/server/observability/runtime-trace-capture";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import { TraceRecorder } from "@/server/observability/trace-recorder";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.cleanup())));

describe("TraceRecorder", () => {
  it("buffers, final-flushes, and completes a run with overhead", async () => {
    const fixture = await createFixture();
    let clock = 0;
    const recorder = new TraceRecorder({
      prisma: fixture.prisma,
      traceRunId: fixture.runId,
      workspaceSessionId: fixture.sessionId,
      capture: { detailLevel: "full", env: {} },
      now: () => new Date("2026-07-12T12:00:01.000Z"),
      clockMs: () => ++clock,
    });
    recorder.record(buildEvent(fixture.runId, fixture.sessionId));

    const result = await recorder.finalize({ status: "succeeded" });

    expect(result).toMatchObject({ ok: true, degraded: false });
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.runId } })).toMatchObject({
      status: "succeeded",
      traceCompleteness: "complete",
      finalFlushAt: new Date("2026-07-12T12:00:01.000Z"),
      llmCallCount: 1,
      traceOverheadMs: 3,
    });
  });

  it("serializes finalization behind an already in-flight manual flush", async () => {
    const fixture = await createFixture();
    const recorder = createRecorder(fixture);
    recorder.record(buildEvent(fixture.runId, fixture.sessionId));

    const inFlightFlush = recorder.flush();
    await Promise.resolve();
    const finalResult = await recorder.finalize({ status: "succeeded" });
    await inFlightFlush;

    expect(finalResult).toMatchObject({ ok: true, degraded: false });
    const run = await fixture.prisma.agentTraceRun.findUniqueOrThrow({
      where: { id: fixture.runId },
      include: { traceEvents: true },
    });
    expect(run.traceEvents).toHaveLength(1);
    expect(run.finalFlushAt).not.toBeNull();
    expect(run.traceCompleteness).toBe("complete");
  });

  it("never throws into coaching and degrades the run when persistence fails", async () => {
    const fixture = await createFixture();
    await fixture.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_recorder_event
      BEFORE INSERT ON AgentTraceEvent
      BEGIN
        SELECT RAISE(ABORT, 'recorder fixture failure');
      END;
    `);
    const recorder = createRecorder(fixture);
    recorder.record(buildEvent(fixture.runId, fixture.sessionId));

    const result = await recorder.finalize({ status: "succeeded" });

    expect(result).toMatchObject({ ok: false, degraded: true });
    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.runId } })).toMatchObject({
      status: "degraded",
      traceCompleteness: "degraded",
    });
  });

  it("rejects mismatched Runs and all record attempts once finalization begins", async () => {
    const fixture = await createFixture();
    const recorder = createRecorder(fixture);

    expect(() =>
      recorder.record(buildEvent("another-run", fixture.sessionId)),
    ).toThrow(/cannot record event for/i);

    recorder.record(buildEvent(fixture.runId, fixture.sessionId));
    const finalization = recorder.finalize({ status: "succeeded" });
    expect(() =>
      recorder.record(buildEvent(fixture.runId, fixture.sessionId)),
    ).toThrow(/while finalizing/i);
    await finalization;
    expect(() =>
      recorder.record(buildEvent(fixture.runId, fixture.sessionId)),
    ).toThrow(/while finalized/i);

    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
  });

  it("captures and redacts payloads inside the Recorder boundary", async () => {
    const fixture = await createFixture();
    const recorder = createRecorder(fixture);
    recorder.record(
      buildEvent(fixture.runId, fixture.sessionId, {
        apiKey: "must-not-persist",
        reasoning_content: "private reasoning",
      }),
    );

    await recorder.finalize({ status: "succeeded" });

    const payload = await fixture.prisma.agentTracePayload.findFirstOrThrow();
    expect(payload.detailMetadataJson).not.toContain("must-not-persist");
    expect(payload.detailMetadataJson).not.toContain("private reasoning");
    expect(payload.detailMetadataJson).toContain("REDACTED");
  });
});

function createRecorder(fixture: {
  prisma: MemoryTestDb["prisma"];
  runId: string;
  sessionId: string;
}) {
  return new TraceRecorder({
    prisma: fixture.prisma,
    traceRunId: fixture.runId,
    workspaceSessionId: fixture.sessionId,
    capture: { detailLevel: "full", env: {} },
  });
}

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const session = await database.prisma.problemWorkspaceSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      browserInstanceId: "recorder-tab",
      activeIdentityKey: `${user.id}:${problem.id}:recorder-tab`,
      startTrigger: "review",
      captureLevel: "full",
    },
  });
  const runId = `recorder-run-${Math.random()}`;
  await database.prisma.agentTraceRun.create({
    data: {
      id: runId,
      userId: user.id,
      problemId: problem.id,
      workspaceSessionId: session.id,
      turnOrdinal: 1,
      path: "review",
      processInstanceId: getProcessInstanceId(),
      startedAt: new Date("2026-07-12T12:00:00.000Z"),
    },
  });
  return { prisma: database.prisma, runId, sessionId: session.id };
}

function buildEvent(
  runId: string,
  sessionId: string,
  metadata: Record<string, unknown> = {},
): PreCaptureTraceEvent {
  return {
    identity: {
      eventId: `recorder-event-${runId}`,
      traceRunId: runId,
      workspaceSessionId: sessionId,
    },
    scope: { path: "review", stage: "diagnose_coach", kind: "llm", title: "Coach LLM" },
    lifecycle: { status: "succeeded", occurredAt: "2026-07-12T12:00:00.500Z" },
    details: { metadata },
    metrics: {
      providerInputTokens: 10,
      providerOutputTokens: 5,
      providerTotalTokens: 15,
      usageSource: "provider",
      pricingStatus: "unpriced",
    },
  };
}

import { afterEach, describe, expect, it } from "vitest";
import {
  captureNormalizedTraceEvent,
  type CapturedTraceEvent,
  type PreCaptureTraceEvent,
} from "@/server/observability/runtime-trace-capture";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import {
  flushTraceEvents,
  recomputeTraceRunRollups,
} from "@/server/observability/trace-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("trace store Phase 1 kernel", () => {
  it("replays one event idempotently without consuming seq or rollups", async () => {
    const fixture = await createFixture();
    const event = buildEvent({ id: "event-1", runId: fixture.run.id, sessionId: fixture.session.id });

    const first = await flushTraceEvents(fixture.prisma, [event]);
    const replay = await flushTraceEvents(fixture.prisma, [event]);

    expect(first).toMatchObject({ insertedCount: 1, duplicateCount: 0, conflicts: [] });
    expect(replay).toMatchObject({ insertedCount: 0, duplicateCount: 1, conflicts: [] });
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
    expect(await fixture.prisma.agentTracePayload.count()).toBe(1);
    expect(await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).toMatchObject({ nextSeq: 2 });
    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({
      llmCallCount: 1,
      providerInputTokens: 100,
      providerOutputTokens: 20,
      providerTotalTokens: 120,
      estimatedCostUsd: 0.0001,
    });
  });

  it("rejects a normalized-looking event that bypassed capture policy", async () => {
    const fixture = await createFixture();
    const captured = buildEvent({
      id: "uncaptured-event",
      runId: fixture.run.id,
      sessionId: fixture.session.id,
    });
    const unbranded = JSON.parse(JSON.stringify(captured)) as CapturedTraceEvent;

    await expect(
      flushTraceEvents(fixture.prisma, [unbranded]),
    ).rejects.toThrow(/bypassed capture policy/i);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(0);
  });

  it("rejects a conflicting digest and degrades the run without consuming seq", async () => {
    const fixture = await createFixture();
    const first = buildEvent({ id: "event-conflict", runId: fixture.run.id, sessionId: fixture.session.id });
    const conflict = buildEvent({ id: "event-conflict", runId: fixture.run.id, sessionId: fixture.session.id, variant: "changed" });
    await flushTraceEvents(fixture.prisma, [first]);

    const result = await flushTraceEvents(fixture.prisma, [conflict]);

    expect(result).toMatchObject({ insertedCount: 0, duplicateCount: 0 });
    expect(result.conflicts).toHaveLength(1);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
    expect(await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).toMatchObject({ nextSeq: 2 });
    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({
      status: "degraded",
      traceCompleteness: "degraded",
      llmCallCount: 1,
    });
  });

  it("keeps unscoped Mock Interview events at seq null", async () => {
    const fixture = await createFixture({ unscoped: true });
    const event = buildEvent({ id: "mock-event", runId: fixture.run.id, path: "mock_interview" });

    await flushTraceEvents(fixture.prisma, [event]);

    expect(await fixture.prisma.agentTraceEvent.findUniqueOrThrow({ where: { eventId: event.identity.eventId } })).toMatchObject({
      workspaceSessionId: null,
      seq: null,
    });
  });

  it("rejects an Event whose workspace Session differs from its Run", async () => {
    const fixture = await createFixture();
    const otherSession = await fixture.prisma.problemWorkspaceSession.create({
      data: {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        browserInstanceId: "other-tab",
        activeIdentityKey: `${fixture.user.id}:${fixture.problem.id}:other-tab`,
        startTrigger: "chat",
        captureLevel: "full",
      },
    });
    const mismatched = buildEvent({
      id: "mismatched-session",
      runId: fixture.run.id,
      sessionId: otherSession.id,
    });

    await expect(
      flushTraceEvents(fixture.prisma, [mismatched]),
    ).rejects.toThrow(/does not match its Run/i);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(0);
    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: otherSession.id },
      }),
    ).toMatchObject({ nextSeq: 1 });
  });

  it("commits Event and Payload atomically and rolls the seq cursor back on failure", async () => {
    const fixture = await createFixture();
    await fixture.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_trace_payload
      BEFORE INSERT ON AgentTracePayload
      BEGIN
        SELECT RAISE(ABORT, 'payload rejected by fixture');
      END;
    `);
    const event = buildEvent({ id: "atomic-event", runId: fixture.run.id, sessionId: fixture.session.id });

    await expect(flushTraceEvents(fixture.prisma, [event])).rejects.toThrow();

    expect(await fixture.prisma.agentTraceEvent.count()).toBe(0);
    expect(await fixture.prisma.agentTracePayload.count()).toBe(0);
    expect(await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).toMatchObject({ nextSeq: 1 });
  });

  it("retains Event and Run skeletons when Payload is deleted", async () => {
    const fixture = await createFixture();
    const event = buildEvent({ id: "prune-event", runId: fixture.run.id, sessionId: fixture.session.id });
    await flushTraceEvents(fixture.prisma, [event]);

    await fixture.prisma.agentTracePayload.deleteMany({ where: { workspaceSessionId: fixture.session.id } });

    expect(await fixture.prisma.agentTracePayload.count()).toBe(0);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
    expect(await fixture.prisma.agentTraceRun.count()).toBe(1);
  });

  it("keeps query scalars on Event and captured streams in Payload", async () => {
    const fixture = await createFixture();
    const event = buildEvent({
      id: "metadata-event",
      runId: fixture.run.id,
      sessionId: fixture.session.id,
      eventRole: "call",
      streams: { stdout: "visible output", stderr: "visible warning" },
      extraMetadata: {
        sequence: 7,
        runtimeDisposition: "executed",
        reason: "product_invariant",
        profileId: "review",
        thinking: true,
      },
    });

    await flushTraceEvents(fixture.prisma, [event]);

    const row = await fixture.prisma.agentTraceEvent.findUniqueOrThrow({
      where: { eventId: event.identity.eventId },
      include: { payload: true },
    });
    expect(JSON.parse(row.metadataJson ?? "{}")).toMatchObject({
      toolName: "run_current_code",
      toolCallId: "call-metadata-event",
      eventRole: "call",
      sequence: 7,
      runtimeDisposition: "executed",
      reason: "product_invariant",
      profileId: "review",
      thinking: true,
    });
    expect(row.payload).toMatchObject({ stdout: "visible output", stderr: "visible warning" });
    expect(JSON.parse(row.payload?.detailMetadataJson ?? "{}")).toMatchObject({
      nested: { staysInPayload: true },
    });
  });

  it("keeps provider token rollups null when any LLM usage is missing", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      buildEvent({
        id: "usage-known",
        runId: fixture.run.id,
        sessionId: fixture.session.id,
      }),
      buildEvent({
        id: "usage-missing",
        runId: fixture.run.id,
        sessionId: fixture.session.id,
        missingUsage: true,
      }),
    ]);

    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: fixture.run.id },
      }),
    ).toMatchObject({
      providerInputTokens: null,
      providerOutputTokens: null,
      providerTotalTokens: null,
      providerCachedTokens: null,
      providerReasoningTokens: null,
      estimatedCostUsd: 0.0001,
      pricingStatus: "partial",
      unpricedLlmCallCount: 1,
    });
  });

  it("marks an oversized toolCalls metadata field unavailable instead of vanishing silently", async () => {
    const fixture = await createFixture();
    const event = buildEvent({
      id: "oversized-tool-call",
      runId: fixture.run.id,
      sessionId: fixture.session.id,
      extraMetadata: {
        toolCalls: [
          {
            id: "call-oversized",
            name: "verify_proposed_repair",
            arguments: { code: "x".repeat(20_000), tests: ["case-a", "case-b"] },
          },
        ],
      },
    });

    await flushTraceEvents(fixture.prisma, [event]);

    const row = await fixture.prisma.agentTraceEvent.findUniqueOrThrow({
      where: { eventId: event.identity.eventId },
    });
    const metadata = JSON.parse(row.metadataJson ?? "{}");
    const unavailableFields = JSON.parse(row.unavailableFieldsJson ?? "[]");
    expect(metadata.toolCalls).toBeUndefined();
    expect(unavailableFields).toContain("$.details.metadata.toolCalls");
  });

  it("counts one Tool Call without double-counting its result event", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      buildEvent({ id: "tool-call", runId: fixture.run.id, sessionId: fixture.session.id, kind: "tool", status: "started", eventRole: "call" }),
      buildEvent({ id: "tool-result", runId: fixture.run.id, sessionId: fixture.session.id, kind: "tool", status: "succeeded", eventRole: "result" }),
    ]);

    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({
      llmCallCount: 0,
      toolCallCount: 1,
    });
  });

  it("allocates one committed contiguous range across concurrent flushes", async () => {
    const fixture = await createFixture();
    const first = buildEvent({ id: "concurrent-a", runId: fixture.run.id, sessionId: fixture.session.id });
    const second = buildEvent({ id: "concurrent-b", runId: fixture.run.id, sessionId: fixture.session.id, variant: "b" });

    await Promise.all([
      flushTraceEvents(fixture.prisma, [first]),
      flushTraceEvents(fixture.prisma, [second]),
    ]);

    const rows = await fixture.prisma.agentTraceEvent.findMany({ orderBy: { seq: "asc" }, select: { eventId: true, seq: true } });
    expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    expect(new Set(rows.map((row) => row.eventId))).toEqual(new Set(["concurrent-a", "concurrent-b"]));
    expect(await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).toMatchObject({ nextSeq: 3 });
  });

  it("handles concurrent replay without a duplicate or cursor gap", async () => {
    const fixture = await createFixture();
    const event = buildEvent({ id: "concurrent-replay", runId: fixture.run.id, sessionId: fixture.session.id });

    await Promise.all([
      flushTraceEvents(fixture.prisma, [event]),
      flushTraceEvents(fixture.prisma, [event]),
    ]);

    expect(await fixture.prisma.agentTraceEvent.count()).toBe(1);
    expect(await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).toMatchObject({ nextSeq: 2 });
    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({ llmCallCount: 1 });
  });

  it("recomputes derived rollups idempotently from Event truth", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      buildEvent({ id: "rollup-a", runId: fixture.run.id, sessionId: fixture.session.id }),
      buildEvent({ id: "rollup-b", runId: fixture.run.id, sessionId: fixture.session.id, variant: "b" }),
    ]);

    await recomputeTraceRunRollups(fixture.prisma, fixture.run.id);
    await recomputeTraceRunRollups(fixture.prisma, fixture.run.id);

    expect(await fixture.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: fixture.run.id } })).toMatchObject({
      llmCallCount: 2,
      providerInputTokens: 200,
      providerOutputTokens: 40,
      providerTotalTokens: 240,
      estimatedCostUsd: 0.0002,
    });
  });

  it("enforces one active identity at the database boundary", async () => {
    const fixture = await createFixture();
    await expect(fixture.prisma.problemWorkspaceSession.create({
      data: {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        browserInstanceId: "same-tab",
        activeIdentityKey: fixture.session.activeIdentityKey,
        startTrigger: "chat",
        captureLevel: "full",
      },
    })).rejects.toThrow();
  });
});

async function createFixture(options: { unscoped?: boolean } = {}) {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const session = options.unscoped
    ? null
    : await database.prisma.problemWorkspaceSession.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          browserInstanceId: "same-tab",
          activeIdentityKey: `${user.id}:${problem.id}:same-tab`,
          startTrigger: "review",
          captureLevel: "full",
        },
      });
  const run = await database.prisma.agentTraceRun.create({
    data: {
      id: `trace-run-${Math.random()}`,
      userId: user.id,
      problemId: problem.id,
      workspaceSessionId: session?.id,
      turnOrdinal: session ? 1 : null,
      path: options.unscoped ? "mock_interview" : "review",
      processInstanceId: getProcessInstanceId(),
    },
  });
  return { prisma: database.prisma, user, problem, session: session!, run };
}

function buildEvent(args: {
  id: string;
  runId: string;
  sessionId?: string;
  variant?: string;
  path?: "review" | "mock_interview";
  kind?: "llm" | "tool";
  status?: "started" | "succeeded";
  eventRole?: "call" | "result";
  streams?: { stdout: string; stderr: string };
  extraMetadata?: Record<string, unknown>;
  missingUsage?: boolean;
}): CapturedTraceEvent {
  const event: PreCaptureTraceEvent = {
    identity: {
      eventId: args.id,
      traceRunId: args.runId,
      workspaceSessionId: args.sessionId,
      stepIndex: 1,
      stepId: `${args.runId}:${args.id}`,
    },
    scope: {
      path: args.path ?? "review",
      stage: "diagnose_coach",
      kind: args.kind ?? "llm",
      title: args.kind === "tool" ? (args.eventRole === "result" ? "Tool result" : "Tool call") : `LLM ${args.variant ?? "base"}`,
    },
    lifecycle: {
      status: args.status ?? "succeeded",
      occurredAt: "2026-07-12T12:00:00.000Z",
      durationMs: 10,
    },
    details: {
      input: { variant: args.variant ?? "base" },
      output: { reply: "ok", ...args.streams },
      metadata: {
        model: "fixture-model",
        ...(args.eventRole
          ? {
              eventRole: args.eventRole,
              toolName: "run_current_code",
              toolCallId: `call-${args.id}`,
              nested: { staysInPayload: true },
            }
          : {}),
        ...args.extraMetadata,
      },
    },
    metrics: args.missingUsage
      ? {
          usageSource: "missing",
          usageMissingReason: "provider_omitted",
          pricingStatus: "unpriced",
        }
      : {
          providerInputTokens: 100,
          providerOutputTokens: 20,
          providerTotalTokens: 120,
          providerCachedTokens: 10,
          providerReasoningTokens: 5,
          usageSource: "provider",
          estimatedCostUsd: 0.0001,
          pricingVersion: "fixture-v1",
          pricingStatus: "priced",
        },
  };
  return captureNormalizedTraceEvent(event, {
    detailLevel: "full",
    env: {},
  });
}

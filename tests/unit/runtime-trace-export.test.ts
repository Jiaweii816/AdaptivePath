import { afterEach, describe, expect, it } from "vitest";
import {
  exportRuntimeTraceSession,
  runtimeTraceExportSchema,
} from "@/server/observability/runtime-trace-export";
import {
  loadReplayRunEvidenceFromTraceExport,
  TraceReplayRefusalError,
} from "../../evals/runner/replay-run-evidence";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("normalized runtime trace export", () => {
  it("exports an owned complete session and exposes eligible run evidence", async () => {
    const fixture = await createFixture("complete");
    await createCapturedEvent(fixture, {
      id: "snapshot",
      kind: "workspace_snapshot",
      input: { code: "[REDACTED]", codeHash: "hash" },
      redactedFields: ["$.details.input.authorization"],
    });
    await createCapturedEvent(fixture, {
      id: "runner",
      kind: "runner",
      input: { provider: "piston", codeHash: "hash" },
      output: {
        normalizedEvidence: runResult(),
        evidenceVerdict: evidenceVerdict(),
      },
    });

    const traceExport = await exportRuntimeTraceSession(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: fixture.session.id,
    });

    expect(traceExport).not.toBeNull();
    expect(runtimeTraceExportSchema.safeParse(traceExport).success).toBe(true);
    expect(traceExport).toMatchObject({
      exportVersion: "runtime-trace-v3",
      session: {
        id: fixture.session.id,
        user: { id: fixture.user.id, handle: "test-user" },
        problem: { id: fixture.problem.id, slug: "binary-search" },
      },
      payloadState: "full",
      traceCompleteness: "complete",
      replayEligible: true,
      replayIneligibleReasons: [],
    });
    expect(JSON.stringify(traceExport)).not.toContain("Bearer secret");
    expect(traceExport?.events[0]?.capture.redactedFields).toEqual([
      "$.details.input.authorization",
    ]);

    expect(loadReplayRunEvidenceFromTraceExport(traceExport)).toMatchObject({
      traceRunId: fixture.run.id,
      eventId: "runner",
      runResult: { status: "failed", failedCount: 1 },
      evidenceVerdict: { evidenceClass: "verdict_bearing" },
    });
  });

  it("keeps a fully pruned export analyzable but refuses replay", async () => {
    const fixture = await createFixture("pruned");
    await createSkeletonEvent(fixture, "snapshot-pruned", "workspace_snapshot", "pruned");
    await createSkeletonEvent(fixture, "runner-pruned", "runner", "pruned");

    const traceExport = (await exportRuntimeTraceSession(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: fixture.session.id,
    }))!;

    expect(traceExport.payloadState).toBe("pruned");
    expect(traceExport.replayEligible).toBe(false);
    expect(traceExport.events.map((event) => event.scope.title)).toEqual([
      "workspace_snapshot snapshot-pruned",
      "runner runner-pruned",
    ]);
    expect(traceExport.replayIneligibleReasons.map((reason) => reason.code)).toContain(
      "payload_pruned",
    );
    expectReplayRefusal(traceExport, "payload_pruned");
  });

  it("reports partially pruned payloads without erasing retained details", async () => {
    const fixture = await createFixture("partial");
    await createCapturedEvent(fixture, {
      id: "snapshot-retained",
      kind: "workspace_snapshot",
      input: { codeHash: "still-analyzable" },
    });
    await createSkeletonEvent(fixture, "runner-pruned", "runner", "pruned");

    const traceExport = (await exportRuntimeTraceSession(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: fixture.session.id,
    }))!;

    expect(traceExport.payloadState).toBe("partially_pruned");
    expect(traceExport.events[0]?.details?.input).toEqual({
      codeHash: "still-analyzable",
    });
    expectReplayRefusal(traceExport, "payload_partially_pruned");
  });

  it("refuses summary-only payloads with their explicit capture state", async () => {
    const fixture = await createFixture("summary");
    await createSkeletonEvent(fixture, "snapshot-summary", "workspace_snapshot", "summary_only");
    await createSkeletonEvent(fixture, "runner-summary", "runner", "summary_only");

    const traceExport = (await exportRuntimeTraceSession(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: fixture.session.id,
    }))!;
    expect(traceExport.payloadState).toBe("summary_only");
    expectReplayRefusal(traceExport, "payload_summary_only");
  });

  it("preserves truncated and unavailable distinctions and refuses both", async () => {
    const fixture = await createFixture("capture-distinction");
    await createCapturedEvent(fixture, {
      id: "snapshot-truncated",
      kind: "workspace_snapshot",
      input: { code: "head…[TRUNCATED]…tail", codeHash: "hash" },
      truncatedFields: ["$.details.input.code"],
    });
    await createSkeletonEvent(
      fixture,
      "runner-unavailable",
      "runner",
      "unavailable",
      ["$.details.output"],
    );

    const traceExport = (await exportRuntimeTraceSession(fixture.prisma, {
      userId: fixture.user.id,
      sessionId: fixture.session.id,
    }))!;

    expect(traceExport.events[0]?.capture.truncatedFields).toEqual([
      "$.details.input.code",
    ]);
    expect(traceExport.events[1]?.capture).toMatchObject({
      payloadState: "unavailable",
      unavailableFields: ["$.details.output"],
    });
    expect(traceExport.replayIneligibleReasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "payload_unavailable",
        "required_payload_truncated",
      ]),
    );
  });

  it.each(["degraded", "incomplete", "open"] as const)(
    "refuses %s Trace Runs with a specific completeness reason",
    async (traceCompleteness) => {
      const fixture = await createFixture(`completeness-${traceCompleteness}`, {
        traceCompleteness,
      });
      await createCapturedEvent(fixture, {
        id: `snapshot-${traceCompleteness}`,
        kind: "workspace_snapshot",
        input: { codeHash: "hash" },
      });

      const traceExport = (await exportRuntimeTraceSession(fixture.prisma, {
        userId: fixture.user.id,
        sessionId: fixture.session.id,
      }))!;
      const expectedCode =
        traceCompleteness === "degraded"
          ? "trace_degraded"
          : traceCompleteness === "open"
            ? "trace_open"
            : "trace_incomplete";

      expect(traceExport.traceCompleteness).toBe(
        traceCompleteness === "degraded" ? "degraded" : "incomplete",
      );
      expectReplayRefusal(traceExport, expectedCode);
    },
  );

  it("returns the same null result for another learner and an unknown Session", async () => {
    const fixture = await createFixture("authorization");
    const otherUser = await fixture.prisma.user.create({
      data: { handle: "other-user" },
    });

    await expect(
      exportRuntimeTraceSession(fixture.prisma, {
        userId: otherUser.id,
        sessionId: fixture.session.id,
      }),
    ).resolves.toBeNull();
    await expect(
      exportRuntimeTraceSession(fixture.prisma, {
        userId: fixture.user.id,
        sessionId: "missing-session",
      }),
    ).resolves.toBeNull();
  });
});

async function createFixture(
  suffix: string,
  options: { traceCompleteness?: "complete" | "degraded" | "incomplete" | "open" } = {},
) {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const session = await database.prisma.problemWorkspaceSession.create({
    data: {
      id: `session-${suffix}`,
      userId: user.id,
      problemId: problem.id,
      browserInstanceId: `tab-${suffix}`,
      activeIdentityKey: null,
      startTrigger: "review",
      captureLevel: "full",
      foregroundStatus: "closed",
      backgroundStatus: "settled",
      foregroundEndedAt: new Date("2026-07-12T12:00:05.000Z"),
      settledAt: new Date("2026-07-12T12:00:05.000Z"),
    },
  });
  const traceCompleteness = options.traceCompleteness ?? "complete";
  const run = await database.prisma.agentTraceRun.create({
    data: {
      id: `run-${suffix}`,
      userId: user.id,
      problemId: problem.id,
      workspaceSessionId: session.id,
      turnOrdinal: 1,
      path: "review",
      actionKind: "review",
      status: traceCompleteness === "degraded" ? "degraded" : "succeeded",
      processInstanceId: "test-process",
      startedAt: new Date("2026-07-12T12:00:00.000Z"),
      endedAt: new Date("2026-07-12T12:00:04.000Z"),
      durationMs: 4_000,
      traceCompleteness,
      finalFlushAt:
        traceCompleteness === "open"
          ? null
          : new Date("2026-07-12T12:00:04.000Z"),
    },
  });
  return { prisma: database.prisma, user, problem, session, run };
}

async function createCapturedEvent(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    id: string;
    kind: "workspace_snapshot" | "runner";
    input?: unknown;
    output?: unknown;
    redactedFields?: string[];
    truncatedFields?: string[];
  },
) {
  return fixture.prisma.agentTraceEvent.create({
    data: {
      eventId: input.id,
      eventDigest: "a".repeat(64),
      seq: await nextSeq(fixture),
      workspaceSessionId: fixture.session.id,
      traceRunId: fixture.run.id,
      turnOrdinal: 1,
      path: "review",
      stage: "fixture",
      kind: input.kind,
      title: `${input.kind} ${input.id}`,
      status: "succeeded",
      occurredAt: new Date("2026-07-12T12:00:01.000Z"),
      detailLevel: "full",
      payloadState: "captured",
      redactedFieldsJson: input.redactedFields
        ? JSON.stringify(input.redactedFields)
        : null,
      truncatedFieldsJson: input.truncatedFields
        ? JSON.stringify(input.truncatedFields)
        : null,
      payload: {
        create: {
          workspaceSessionId: fixture.session.id,
          inputJson:
            input.input === undefined ? null : JSON.stringify(input.input),
          outputJson:
            input.output === undefined ? null : JSON.stringify(input.output),
          byteSize: Buffer.byteLength(
            JSON.stringify({ input: input.input, output: input.output }),
            "utf8",
          ),
        },
      },
    },
  });
}

async function createSkeletonEvent(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  id: string,
  kind: "workspace_snapshot" | "runner",
  payloadState: "pruned" | "summary_only" | "unavailable",
  unavailableFields?: string[],
) {
  return fixture.prisma.agentTraceEvent.create({
    data: {
      eventId: id,
      eventDigest: "b".repeat(64),
      seq: await nextSeq(fixture),
      workspaceSessionId: fixture.session.id,
      traceRunId: fixture.run.id,
      turnOrdinal: 1,
      path: "review",
      stage: "fixture",
      kind,
      title: `${kind} ${id}`,
      status: "succeeded",
      occurredAt: new Date("2026-07-12T12:00:02.000Z"),
      detailLevel: payloadState === "summary_only" ? "summary" : "full",
      payloadState,
      unavailableFieldsJson: unavailableFields
        ? JSON.stringify(unavailableFields)
        : null,
    },
  });
}

async function nextSeq(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return (await fixture.prisma.agentTraceEvent.count({
    where: { workspaceSessionId: fixture.session.id },
  })) + 1;
}

function runResult() {
  return {
    status: "failed",
    failureProvenance: "user_code",
    passedCount: 1,
    failedCount: 1,
    stdout: "",
    stderr: "",
    firstFailedCase: {
      id: "case-2",
      label: "case 2",
      input: { nums: [1, 3], target: 2 },
      expected: 1,
      actual: 2,
    },
    testResults: [],
  };
}

function evidenceVerdict() {
  return {
    evidenceClass: "verdict_bearing",
    replyMode: "diagnostic",
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: true,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: true,
    },
    status: "failed",
    provenance: "user_code",
    providerUsed: "piston",
    scopeLabel: "selected visible tests",
    modelInstruction: "Use only captured evidence.",
  };
}

function expectReplayRefusal(
  artifact: unknown,
  expectedCode: string,
) {
  try {
    loadReplayRunEvidenceFromTraceExport(artifact);
    throw new Error("Expected replay refusal.");
  } catch (error) {
    expect(error).toBeInstanceOf(TraceReplayRefusalError);
    expect(
      (error as TraceReplayRefusalError).reasons.map((reason) => reason.code),
    ).toContain(expectedCode);
  }
}

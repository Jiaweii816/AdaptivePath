import { afterEach, describe, expect, it } from "vitest";
import {
  buildActiveIdentityKey,
  ensureWorkspaceTraceTurn,
  isTraceStoreCutoverEnabled,
  type EnsureWorkspaceTraceTurnInput,
} from "@/server/observability/workspace-session";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("Workspace Session lifecycle and allocator", () => {
  it("keeps an explicit isolated-test override without an environment kill switch", async () => {
    const fixture = await createFixture();

    expect(isTraceStoreCutoverEnabled({})).toBe(true);
    expect(
      await ensureWorkspaceTraceTurn(
        fixture.prisma,
        input(fixture, { env: {}, cutoverEnabled: false }),
      ),
    ).toEqual({ enabled: false });
    expect(await fixture.prisma.problemWorkspaceSession.count()).toBe(0);
    expect(await fixture.prisma.agentTraceRun.count()).toBe(0);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(0);
  });

  it.each(["review", "chat", "practice_run"] as const)(
    "starts on the first %s action with one root Turn and Snapshot",
    async (action) => {
      const fixture = await createFixture();
      const result = await ensureWorkspaceTraceTurn(
        fixture.prisma,
        input(fixture, { action }),
      );

      expect(result).toMatchObject({
        enabled: true,
        turnOrdinal: 1,
        snapshotSeq: 1,
        captureLevel: "full",
      });
      if (!result.enabled) throw new Error("trace unexpectedly disabled");
      expect(
        await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
          where: { id: result.workspaceSessionId },
        }),
      ).toMatchObject({
        startTrigger: action,
        memoryOrigin: "legacy_unknown",
        foregroundStatus: "active",
        backgroundStatus: "idle",
        nextTurnOrdinal: 2,
        nextSeq: 2,
      });
      expect(
        await fixture.prisma.agentTraceRun.findUniqueOrThrow({
          where: { id: result.traceRunId },
        }),
      ).toMatchObject({
        workspaceSessionId: result.workspaceSessionId,
        memoryOrigin: "legacy_unknown",
        turnOrdinal: 1,
        path: action,
        status: "running",
      });
    },
  );

  it("carries an explicit learner origin into the workspace and root Run", async () => {
    const fixture = await createFixture();
    const result = await enabledTurn(
      fixture,
      input(fixture, {
        env: { PATTERNCOACH_MEMORY_ORIGIN: "learner" },
      }),
    );

    expect(result.memoryOrigin).toBe("learner");
    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: result.workspaceSessionId },
        select: { memoryOrigin: true },
      }),
    ).toEqual({ memoryOrigin: "learner" });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: result.traceRunId },
        select: { memoryOrigin: true },
      }),
    ).toEqual({ memoryOrigin: "learner" });
  });

  it("resumes the same tab/problem, appends Turns, and preserves the Session capture level", async () => {
    const fixture = await createFixture();
    const first = await enabledTurn(
      fixture,
      input(fixture, {
        captureLevel: "full",
        snapshot: { language: "python", code: "first code" },
      }),
    );
    const second = await enabledTurn(
      fixture,
      input(fixture, {
        action: "chat",
        captureLevel: "summary",
        snapshot: { language: "cpp", code: "second code" },
      }),
    );

    expect(second.workspaceSessionId).toBe(first.workspaceSessionId);
    expect(second.turnOrdinal).toBe(2);
    expect(second.snapshotSeq).toBe(2);
    expect(second.captureLevel).toBe("full");
    expect(await fixture.prisma.problemWorkspaceSession.count()).toBe(1);
    expect(
      await fixture.prisma.agentTraceRun.findMany({
        orderBy: { turnOrdinal: "asc" },
        select: { turnOrdinal: true, status: true },
      }),
    ).toEqual([
      { turnOrdinal: 1, status: "running" },
      { turnOrdinal: 2, status: "running" },
    ]);
    expect(
      await fixture.prisma.agentTraceEvent.findMany({
        orderBy: { seq: "asc" },
        select: { seq: true },
      }),
    ).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it("closes only the same tab's old problem and settles an idle background", async () => {
    const fixture = await createFixture({ secondProblem: true });
    const first = await enabledTurn(fixture, input(fixture));
    const next = await enabledTurn(
      fixture,
      input(fixture, { problemId: fixture.secondProblem!.id }),
    );

    expect(next.workspaceSessionId).not.toBe(first.workspaceSessionId);
    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: first.workspaceSessionId },
      }),
    ).toMatchObject({
      foregroundStatus: "closed",
      backgroundStatus: "settled",
      endReason: "problem_changed",
      activeIdentityKey: null,
      foregroundEndedAt: expect.any(Date),
      settledAt: expect.any(Date),
    });
  });

  it("does not close another tab and keeps fresh same-problem tabs isolated", async () => {
    const fixture = await createFixture({ secondProblem: true });
    const tabA = await enabledTurn(
      fixture,
      input(fixture, { browserInstanceId: "browser-tab-a" }),
    );
    const tabB = await enabledTurn(
      fixture,
      input(fixture, {
        browserInstanceId: "browser-tab-b",
        problemId: fixture.secondProblem!.id,
      }),
    );
    const tabBSameProblem = await enabledTurn(
      fixture,
      input(fixture, {
        browserInstanceId: "browser-tab-b",
        problemId: fixture.problem.id,
        now: new Date("2026-07-12T12:00:01.000Z"),
      }),
    );

    expect(tabB.workspaceSessionId).not.toBe(tabA.workspaceSessionId);
    expect(tabBSameProblem.workspaceSessionId).not.toBe(tabA.workspaceSessionId);
    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: tabA.workspaceSessionId },
      }),
    ).toMatchObject({ foregroundStatus: "active" });
  });

  it("abandons only stale other-tab Sessions for the same problem", async () => {
    const fixture = await createFixture();
    const first = await enabledTurn(
      fixture,
      input(fixture, {
        browserInstanceId: "stale-tab-a",
        now: new Date("2026-07-12T10:00:00.000Z"),
      }),
    );
    await enabledTurn(
      fixture,
      input(fixture, {
        browserInstanceId: "fresh-tab-b",
        now: new Date("2026-07-12T12:00:00.000Z"),
        staleMs: 60 * 60 * 1000,
      }),
    );

    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: first.workspaceSessionId },
      }),
    ).toMatchObject({
      foregroundStatus: "abandoned",
      backgroundStatus: "settled",
      endReason: "abandoned",
      activeIdentityKey: null,
      settledAt: expect.any(Date),
    });
  });

  it("preserves pending background state when foreground reconciliation ends", async () => {
    const fixture = await createFixture({ secondProblem: true });
    const first = await enabledTurn(fixture, input(fixture));
    await fixture.prisma.problemWorkspaceSession.update({
      where: { id: first.workspaceSessionId },
      data: { backgroundStatus: "pending" },
    });

    await enabledTurn(
      fixture,
      input(fixture, { problemId: fixture.secondProblem!.id }),
    );

    expect(
      await fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: first.workspaceSessionId },
      }),
    ).toMatchObject({
      foregroundStatus: "closed",
      backgroundStatus: "pending",
      settledAt: null,
    });
  });

  it("uses the database active identity invariant for simultaneous first actions", async () => {
    const fixture = await createFixture();

    const [first, second] = await Promise.all([
      enabledTurn(
        fixture,
        input(fixture, { traceRunId: "concurrent-root-a" }),
      ),
      enabledTurn(
        fixture,
        input(fixture, { traceRunId: "concurrent-root-b" }),
      ),
    ]);

    expect(first.workspaceSessionId).toBe(second.workspaceSessionId);
    expect(new Set([first.turnOrdinal, second.turnOrdinal])).toEqual(
      new Set([1, 2]),
    );
    expect(await fixture.prisma.problemWorkspaceSession.count()).toBe(1);
    expect(await fixture.prisma.agentTraceRun.count()).toBe(2);
    expect(
      await fixture.prisma.agentTraceEvent.findMany({
        orderBy: { seq: "asc" },
        select: { seq: true },
      }),
    ).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it("rolls back Session, Run, Snapshot, and seq together on Snapshot failure", async () => {
    const fixture = await createFixture();
    await fixture.prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_workspace_snapshot_payload
      BEFORE INSERT ON AgentTracePayload
      BEGIN
        SELECT RAISE(ABORT, 'workspace snapshot payload rejected');
      END;
    `);

    await expect(
      ensureWorkspaceTraceTurn(fixture.prisma, input(fixture)),
    ).rejects.toThrow();

    expect(await fixture.prisma.problemWorkspaceSession.count()).toBe(0);
    expect(await fixture.prisma.agentTraceRun.count()).toBe(0);
    expect(await fixture.prisma.agentTraceEvent.count()).toBe(0);
    expect(await fixture.prisma.agentTracePayload.count()).toBe(0);
  });

  it("marks old-process open Runs incomplete on the next action", async () => {
    const fixture = await createFixture();
    const current = "current-process";
    const first = await enabledTurn(
      fixture,
      input(fixture, { processInstanceId: current }),
    );
    await fixture.prisma.agentTraceRun.create({
      data: {
        id: "orphaned-open-run",
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        path: "mock_interview",
        processInstanceId: "old-process",
        startedAt: new Date("2026-07-12T11:00:00.000Z"),
      },
    });

    await enabledTurn(
      fixture,
      input(fixture, {
        action: "chat",
        processInstanceId: current,
        now: new Date("2026-07-12T12:00:00.000Z"),
      }),
    );

    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "orphaned-open-run" },
      }),
    ).toMatchObject({
      status: "degraded",
      traceCompleteness: "incomplete",
      durationMs: 60 * 60 * 1000,
      finalFlushAt: null,
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: first.traceRunId },
      }),
    ).toMatchObject({ traceCompleteness: "open" });
  });

  it("builds an unambiguous deterministic active identity", () => {
    const first = buildActiveIdentityKey({
      userId: "a:b",
      problemId: "c",
      browserInstanceId: "d",
    });
    const second = buildActiveIdentityKey({
      userId: "a",
      problemId: "b:c",
      browserInstanceId: "d",
    });

    expect(first).toBe(
      buildActiveIdentityKey({
        userId: "a:b",
        problemId: "c",
        browserInstanceId: "d",
      }),
    );
    expect(first).not.toBe(second);
  });
});

async function createFixture(options: { secondProblem?: boolean } = {}) {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const secondProblem = options.secondProblem
    ? await database.prisma.problem.create({
        data: {
          slug: `second-${Math.random()}`,
          title: "Second Problem",
          methodName: "solve",
        },
      })
    : null;
  return { prisma: database.prisma, user, problem, secondProblem };
}

function input(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<EnsureWorkspaceTraceTurnInput> = {},
): EnsureWorkspaceTraceTurnInput {
  return {
    userId: fixture.user.id,
    problemId: fixture.problem.id,
    browserInstanceId: "browser-tab-primary",
    action: "review",
    cutoverEnabled: true,
    captureLevel: "full",
    env: {},
    staleMs: 60 * 60 * 1000,
    processInstanceId: "current-process",
    traceRunId: `root-${Math.random()}`,
    now: new Date("2026-07-12T12:00:00.000Z"),
    ...overrides,
    snapshot: overrides.snapshot ?? {
      language: "python",
      code: "class Solution: pass",
      codeHash: "code-hash",
      selectedTestCaseIds: ["visible-1"],
      clientOccurredAt: "2026-07-12T12:00:00.000Z",
    },
  };
}

async function enabledTurn(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  request: EnsureWorkspaceTraceTurnInput,
) {
  const result = await ensureWorkspaceTraceTurn(fixture.prisma, request);
  if (!result.enabled) throw new Error("trace unexpectedly disabled");
  return result;
}

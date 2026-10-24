import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueReflection } from "@/server/jobs/enqueue-reflection";
import { enqueueInterviewFeedback } from "@/server/jobs/enqueue-interview-feedback";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import type { FtsStore } from "@/server/memory/store/fts-store";
import { createDeterministicRetrievalTextRefreshProvider } from "@/server/memory/retrieval-text/refresh-retrieval-text";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
const ORIGINAL_MEMORY_ORIGIN = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
  if (ORIGINAL_MEMORY_ORIGIN === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = ORIGINAL_MEMORY_ORIGIN;
  }
});

describe("durable background dispatch adapter", () => {
  it("records pending before scheduling and flushes a scoped child with null turnOrdinal", async () => {
    const fixture = await createScopedFixture();
    let scheduled: (() => void) | undefined;
    const run = vi.fn().mockResolvedValue({ skipped: false });

    const job = await enqueueReflection(
      fixture.prisma,
      {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        originatingTraceRunId: fixture.root.traceRunId,
      },
      {
        processInstanceId: "dispatch-boot",
        traceRunId: "reflection-child",
        schedule: (task) => {
          scheduled = task;
        },
        run,
      },
    );

    expect(job).toMatchObject({ status: "pending", traceRunId: null });
    expect(run).not.toHaveBeenCalled();
    expect(
      await fixture.prisma.backgroundJob.findUniqueOrThrow({
        where: { id: "id" in job ? job.id : "missing" },
      }),
    ).toMatchObject({ status: "pending" });

    scheduled?.();
    await vi.waitFor(async () => {
      expect(
        await fixture.prisma.backgroundJob.findUniqueOrThrow({
          where: { id: "id" in job ? job.id : "missing" },
        }),
      ).toMatchObject({ status: "succeeded" });
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      originatingTraceRunId: fixture.root.traceRunId,
      parentTraceRunId: "reflection-child",
      traceContext: {
        traceRunId: "reflection-child",
        workspaceSessionId: fixture.root.workspaceSessionId,
        path: "memory_background",
      },
    });
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "reflection-child" },
      }),
    ).toMatchObject({
      turnOrdinal: null,
      originatingTurnOrdinal: fixture.root.turnOrdinal,
      status: "succeeded",
      traceCompleteness: "complete",
    });
    const events = await fixture.prisma.agentTraceEvent.findMany({
      where: { traceRunId: "reflection-child" },
      orderBy: { seq: "asc" },
    });
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.every((event) => event.turnOrdinal === null)).toBe(true);
    expect(events.some((event) => event.status === "succeeded")).toBe(true);
  });

  it("does not reopen a settled workspace when a terminal nested intent is deduplicated", async () => {
    const fixture = await createScopedFixture();
    const firstTasks: Array<() => void> = [];
    const run = vi.fn().mockResolvedValue({ skipped: false });
    const dedupeKey = "activity-extraction:receipt-1:reflection:v1";

    const first = await enqueueReflection(
      fixture.prisma,
      {
        userId: fixture.user.id,
        originatingTraceRunId: fixture.root.traceRunId,
      },
      {
        processInstanceId: "dispatch-boot",
        traceRunId: "deduped-reflection-child",
        dedupeKey,
        schedule: (task) => firstTasks.push(task),
        run,
      },
    );
    firstTasks.forEach((task) => task());
    await vi.waitFor(async () => {
      expect(
        await fixture.prisma.backgroundJob.findUniqueOrThrow({
          where: { id: "id" in first ? first.id : "missing" },
        }),
      ).toMatchObject({ status: "succeeded" });
    });
    await expect(
      fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: fixture.root.workspaceSessionId! },
      }),
    ).resolves.toMatchObject({ backgroundStatus: "settled" });

    const replayTasks: Array<() => void> = [];
    const replay = await enqueueReflection(
      fixture.prisma,
      {
        userId: fixture.user.id,
        originatingTraceRunId: fixture.root.traceRunId,
      },
      {
        processInstanceId: "dispatch-boot",
        dedupeKey,
        schedule: (task) => replayTasks.push(task),
        run,
      },
    );
    if (!("id" in replay) || !("id" in first)) {
      throw new Error("expected durable deduplicated Jobs");
    }
    expect(replay.id).toBe(first.id);
    expect(replayTasks).toHaveLength(1);
    replayTasks.forEach((task) => task());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(run).toHaveBeenCalledTimes(1);
    await expect(
      fixture.prisma.problemWorkspaceSession.findUniqueOrThrow({
        where: { id: fixture.root.workspaceSessionId! },
      }),
    ).resolves.toMatchObject({ backgroundStatus: "settled" });
  });

  it("does no work after a conditional claim loses ownership", async () => {
    const fixture = await createScopedFixture();
    let scheduled: (() => void) | undefined;
    const run = vi.fn();
    const job = await enqueueReflection(
      fixture.prisma,
      {
        userId: fixture.user.id,
        originatingTraceRunId: fixture.root.traceRunId,
      },
      {
        processInstanceId: "dispatch-boot",
        schedule: (task) => {
          scheduled = task;
        },
        run,
      },
    );
    if (!("id" in job)) throw new Error("expected durable Job");
    await fixture.prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "failed", failureReason: "process_restart" },
    });

    scheduled?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).not.toHaveBeenCalled();
    expect(
      await fixture.prisma.agentTraceRun.count({
        where: { originatingTraceRunId: fixture.root.traceRunId },
      }),
    ).toBe(0);
  });

  it("finalizes an unscoped child before terminal Job completion", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
    await database.prisma.agentTraceRun.create({
      data: {
        id: "mock-origin",
        userId: user.id,
        problemId: problem.id,
        path: "mock_interview",
        processInstanceId: "mock-boot",
      },
    });
    let scheduled: (() => void) | undefined;
    const job = await enqueueReflection(
      database.prisma,
      { userId: user.id, originatingTraceRunId: "mock-origin" },
      {
        processInstanceId: "mock-boot",
        traceRunId: "unscoped-child",
        schedule: (task) => {
          scheduled = task;
        },
        run: vi.fn().mockResolvedValue({ skipped: true }),
      },
    );
    if (!("id" in job)) throw new Error("expected durable Job");
    scheduled?.();

    await vi.waitFor(async () => {
      expect(
        await database.prisma.backgroundJob.findUniqueOrThrow({
          where: { id: job.id },
        }),
      ).toMatchObject({ status: "succeeded" });
    });
    expect(
      await database.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "unscoped-child" },
      }),
    ).toMatchObject({
      workspaceSessionId: null,
      status: "succeeded",
      traceCompleteness: "complete",
    });
  });

  it("does not append or finalize twice when terminal Job persistence fails", async () => {
    const fixture = await createScopedFixture();
    let scheduled: (() => void) | undefined;
    let jobId = "";
    let terminalError: unknown;
    const job = await enqueueReflection(
      fixture.prisma,
      {
        userId: fixture.user.id,
        originatingTraceRunId: fixture.root.traceRunId,
      },
      {
        processInstanceId: "dispatch-boot",
        traceRunId: "terminal-error-child",
        schedule: (task) => {
          scheduled = task;
        },
        onError: (error) => {
          terminalError = error;
        },
        run: async () => {
          await fixture.prisma.backgroundJob.delete({ where: { id: jobId } });
          return { skipped: false };
        },
      },
    );
    if (!("id" in job)) throw new Error("expected durable Job");
    jobId = job.id;
    scheduled?.();

    await vi.waitFor(() => expect(terminalError).toBeDefined());
    expect(
      await fixture.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: "terminal-error-child" },
      }),
    ).toMatchObject({ status: "succeeded", traceCompleteness: "complete" });
    const terminalEvents = await fixture.prisma.agentTraceEvent.findMany({
      where: {
        traceRunId: "terminal-error-child",
        stage: "background_job",
      },
    });
    expect(
      terminalEvents.filter((event) => event.status === "succeeded"),
    ).toHaveLength(1);
    expect(
      terminalEvents.filter((event) => event.status === "failed"),
    ).toHaveLength(0);
  });

  it("indexes interview feedback and records both nested children before parent completion", async () => {
    const fixture = await createScopedFixture();
    const episode = await fixture.prisma.memoryEpisode.create({
      data: {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        kind: "mock_interview",
        title: "Mock interview: Two Sum",
        summary: "Good evidence, one follow-up remains.",
        outcome: "resolved",
        memoryOrigin: "learner",
      },
    });
    const reconciled: Array<{
      kind: string;
      documents: Array<{ refId: string; content: string }>;
    }> = [];
    const ftsStore: FtsStore = {
      indexMemoryDocument: vi.fn(),
      removeMemoryDocument: vi.fn(),
      reconcileMemoryDocuments: (args) => {
        reconciled.push(args);
        return { indexed: args.documents.length, removed: 0 };
      },
      searchMemoryFts: vi.fn().mockReturnValue([]),
      close: vi.fn(),
    };
    let parentTask: (() => void) | undefined;
    const childTasks: Array<() => void> = [];

    const parent = await enqueueInterviewFeedback(
      fixture.prisma,
      {
        userId: fixture.user.id,
        problemId: fixture.problem.id,
        mockInterviewSessionId: "mock-session-1",
        feedbackId: "feedback-1",
        fallbackReport: false,
        episodeId: episode.id,
        changedFactIds: ["fact-1"],
        originatingTraceRunId: fixture.root.traceRunId,
        ftsStore,
        retrievalTextProvider:
          createDeterministicRetrievalTextRefreshProvider(),
        childDispatchOptions: {
          processInstanceId: "dispatch-boot",
          schedule: (task) => childTasks.push(task),
        },
      },
      {
        processInstanceId: "dispatch-boot",
        traceRunId: "interview-feedback-child",
        schedule: (task) => {
          parentTask = task;
        },
      },
    );
    parentTask?.();

    await vi.waitFor(async () => {
      expect(
        await fixture.prisma.backgroundJob.findUniqueOrThrow({
          where: { id: parent.id },
        }),
      ).toMatchObject({ status: "succeeded" });
    });
    expect(reconciled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "episode",
          documents: [expect.objectContaining({ refId: episode.id })],
        }),
      ]),
    );
    expect(childTasks).toHaveLength(2);
    expect(
      await fixture.prisma.backgroundJob.findMany({
        where: { originatingTraceRunId: fixture.root.traceRunId },
        orderBy: { enqueuedAt: "asc" },
        select: { kind: true, status: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { kind: "interview_feedback", status: "succeeded" },
        { kind: "embed_backfill", status: "pending" },
        { kind: "reflection", status: "pending" },
      ]),
    );
    const children = await fixture.prisma.backgroundJob.findMany({
      where: { kind: { in: ["embed_backfill", "reflection"] } },
    });
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.traceRunId).toBeNull();
    }
    const startEvent = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: {
        traceRunId: "interview-feedback-child",
        status: "started",
      },
      include: { payload: true },
    });
    expect(startEvent.payload?.detailMetadataJson).toContain("mock-session-1");
    expect(startEvent.payload?.detailMetadataJson).toContain("feedback-1");
  });
});

async function createScopedFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const root = await ensureWorkspaceTraceTurn(database.prisma, {
    userId: user.id,
    problemId: problem.id,
    browserInstanceId: "dispatch-tab",
    action: "review",
    snapshot: {},
    cutoverEnabled: true,
    captureLevel: "full",
    processInstanceId: "foreground-boot",
    traceRunId: "dispatch-root",
    memoryOrigin: "learner",
    env: { PATTERNCOACH_MEMORY_ORIGIN: "learner" },
  });
  if (!root.enabled) throw new Error("trace unexpectedly disabled");
  return { prisma: database.prisma, user, problem, root };
}

import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  captureNormalizedTraceEvent,
  type TraceCaptureLevel,
  type TraceSecretEnvironment,
} from "@/server/observability/runtime-trace-capture";
import { traceDetailLevelSchema } from "@/server/observability/runtime-trace-contract";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import { reconcileBackgroundJobsInTransaction } from "@/server/observability/background-job-store";
import { isTraceStoreCutoverEnabled } from "@/server/observability/runtime-trace-request";
import { flushCapturedTraceEventsInTransaction } from "@/server/observability/trace-store";
import {
  resolveMemoryOrigin,
  type MemoryOrigin,
} from "@/server/memory/memory-origin";

export { isTraceStoreCutoverEnabled } from "@/server/observability/runtime-trace-request";

const DEFAULT_TRACE_SESSION_STALE_MS = 60 * 60 * 1000;
const TRACE_TRANSACTION_RETRIES = 4;

export type WorkspaceTraceAction = "review" | "chat" | "practice_run";

export type WorkspaceSnapshotInput = {
  language?: string | null;
  code?: string;
  codeHash?: string | null;
  executionFingerprint?: string | null;
  selectedTestCaseIds?: string[];
  testContext?: unknown;
  clientOccurredAt?: string | Date;
  metadata?: Record<string, unknown>;
};

export type EnsureWorkspaceTraceTurnInput = {
  userId: string;
  problemId: string;
  browserInstanceId: string;
  action: WorkspaceTraceAction;
  snapshot: WorkspaceSnapshotInput;
  cutoverEnabled?: boolean;
  captureLevel?: TraceCaptureLevel;
  env?: TraceSecretEnvironment;
  staleMs?: number;
  processInstanceId?: string;
  traceRunId?: string;
  now?: Date;
  memoryOrigin?: MemoryOrigin;
};

export type WorkspaceTraceTurn = {
  enabled: true;
  workspaceSessionId: string;
  traceRunId: string;
  turnOrdinal: number;
  snapshotEventId: string;
  snapshotSeq: number;
  captureLevel: TraceCaptureLevel;
  memoryOrigin?: MemoryOrigin;
};

export type WorkspaceTraceDisabled = { enabled: false };

export function buildActiveIdentityKey(args: {
  userId: string;
  problemId: string;
  browserInstanceId: string;
  memoryOrigin?: MemoryOrigin;
}) {
  const memoryOrigin = args.memoryOrigin ?? resolveMemoryOrigin();
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        args.userId,
        args.problemId,
        args.browserInstanceId,
        memoryOrigin,
      ]),
    )
    .digest("hex");
  return `workspace:${digest}`;
}

export async function ensureWorkspaceTraceTurn(
  prisma: PrismaClient,
  input: EnsureWorkspaceTraceTurnInput,
): Promise<WorkspaceTraceTurn | WorkspaceTraceDisabled> {
  const env = input.env ?? process.env;
  const memoryOrigin = input.memoryOrigin ?? resolveMemoryOrigin(env);
  const cutoverEnabled =
    input.cutoverEnabled ?? isTraceStoreCutoverEnabled(env);
  if (!cutoverEnabled) return { enabled: false };

  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? resolveTraceSessionStaleMs(env);
  if (!Number.isFinite(staleMs) || staleMs <= 0) {
    throw new Error("TRACE_SESSION_STALE_MS must be a positive number.");
  }
  const requestedCaptureLevel = traceDetailLevelSchema.parse(
    input.captureLevel ?? resolveTraceCaptureLevel(env),
  );
  const processInstanceId =
    input.processInstanceId ?? getProcessInstanceId();
  const traceRunId = input.traceRunId ?? randomUUID();
  const activeIdentityKey = buildActiveIdentityKey({ ...input, memoryOrigin });

  return retryWorkspaceTransaction(() =>
    prisma.$transaction(async (tx) => {
      await reconcileWorkspaceTraceState(tx, {
        userId: input.userId,
        problemId: input.problemId,
        browserInstanceId: input.browserInstanceId,
        processInstanceId,
        now,
        staleMs,
        env,
        memoryOrigin,
      });

      const session = await claimActiveWorkspaceSession(tx, {
        userId: input.userId,
        problemId: input.problemId,
        browserInstanceId: input.browserInstanceId,
        activeIdentityKey,
        action: input.action,
        captureLevel: requestedCaptureLevel,
        now,
        memoryOrigin,
      });
      const turnOrdinal = session.nextTurnOrdinal;
      const claimedTurn = await tx.problemWorkspaceSession.updateMany({
        where: {
          id: session.id,
          activeIdentityKey,
          foregroundStatus: "active",
          nextTurnOrdinal: turnOrdinal,
        },
        data: {
          nextTurnOrdinal: { increment: 1 },
          lastActivityAt: now,
        },
      });
      if (claimedTurn.count !== 1) {
        throw new RetryableWorkspaceTransactionError(
          `Turn allocator changed for Session ${session.id}.`,
        );
      }

      await tx.agentTraceRun.create({
        data: {
          id: traceRunId,
          userId: input.userId,
          problemId: input.problemId,
          workspaceSessionId: session.id,
          turnOrdinal,
          path: input.action,
          actionKind: input.action,
          memoryOrigin,
          processInstanceId,
          startedAt: now,
        },
      });

      const snapshotEventId = `${traceRunId}:workspace_snapshot`;
      const snapshotEvent = captureNormalizedTraceEvent(
        {
          identity: {
            eventId: snapshotEventId,
            traceRunId,
            workspaceSessionId: session.id,
            turnOrdinal,
          },
          scope: {
            path: input.action,
            stage: snapshotStage(input.action),
            kind: "workspace_snapshot",
            title: "Workspace Snapshot",
          },
          lifecycle: {
            status: "succeeded",
            occurredAt: now.toISOString(),
            clientOccurredAt: normalizeClientTimestamp(
              input.snapshot.clientOccurredAt,
            ),
          },
          details: {
            input: {
              userId: input.userId,
              problemId: input.problemId,
              browserInstanceId: input.browserInstanceId,
              memoryOrigin,
              action: input.action,
              language: input.snapshot.language,
              code: input.snapshot.code,
              codeHash: input.snapshot.codeHash,
              executionFingerprint: input.snapshot.executionFingerprint,
              selectedTestCaseIds: input.snapshot.selectedTestCaseIds,
              testContext: input.snapshot.testContext,
            },
            metadata: {
              ...input.snapshot.metadata,
              action: input.action,
              startTrigger: session.startTrigger,
              browserInstanceId: input.browserInstanceId,
            },
          },
        },
        {
          detailLevel: traceDetailLevelSchema.parse(session.captureLevel),
          env,
        },
      );
      const flushed = await flushCapturedTraceEventsInTransaction(tx, [
        snapshotEvent,
      ]);
      const snapshotSeq = flushed.events[0]?.seq;
      if (
        flushed.insertedCount !== 1 ||
        snapshotSeq === null ||
        snapshotSeq === undefined
      ) {
        throw new Error(
          `Workspace Snapshot was not durably sequenced for Turn ${turnOrdinal}.`,
        );
      }

      return {
        enabled: true as const,
        workspaceSessionId: session.id,
        traceRunId,
        turnOrdinal,
        snapshotEventId,
        snapshotSeq,
        captureLevel: traceDetailLevelSchema.parse(session.captureLevel),
        memoryOrigin,
      };
    }),
  );
}

async function reconcileWorkspaceTraceState(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    problemId: string;
    browserInstanceId: string;
    processInstanceId: string;
    now: Date;
    staleMs: number;
    env: TraceSecretEnvironment;
    memoryOrigin: MemoryOrigin;
  },
) {
  const staleBefore = new Date(args.now.getTime() - args.staleMs);

  const staleSessions = await tx.problemWorkspaceSession.findMany({
    where: {
      userId: args.userId,
      problemId: args.problemId,
      browserInstanceId: { not: args.browserInstanceId },
      memoryOrigin: args.memoryOrigin,
      foregroundStatus: "active",
      lastActivityAt: { lt: staleBefore },
    },
    select: { id: true, backgroundStatus: true },
  });
  await terminalizeWorkspaceSessions(tx, staleSessions, {
    now: args.now,
    data: {
      foregroundStatus: "abandoned",
      endReason: "abandoned",
    },
  });

  const changedProblemSessions = await tx.problemWorkspaceSession.findMany({
    where: {
      userId: args.userId,
      problemId: { not: args.problemId },
      browserInstanceId: args.browserInstanceId,
      memoryOrigin: args.memoryOrigin,
      foregroundStatus: "active",
    },
    select: { id: true, backgroundStatus: true },
  });
  await terminalizeWorkspaceSessions(tx, changedProblemSessions, {
    now: args.now,
    data: {
      foregroundStatus: "closed",
      endReason: "problem_changed",
    },
  });

  await reconcileBackgroundJobsInTransaction(tx, {
    userId: args.userId,
    processInstanceId: args.processInstanceId,
    now: args.now,
    env: args.env,
    memoryOrigin: args.memoryOrigin,
  });

  const orphanedRuns = await tx.agentTraceRun.findMany({
    where: {
      userId: args.userId,
      processInstanceId: { not: args.processInstanceId },
      memoryOrigin: args.memoryOrigin,
      traceCompleteness: "open",
    },
    select: { id: true, startedAt: true },
  });
  for (const run of orphanedRuns) {
    await tx.agentTraceRun.update({
      where: { id: run.id },
      data: {
        status: "degraded",
        traceCompleteness: "incomplete",
        endedAt: args.now,
        durationMs: Math.max(
          0,
          args.now.getTime() - run.startedAt.getTime(),
        ),
      },
    });
  }
}

async function terminalizeWorkspaceSessions(
  tx: Prisma.TransactionClient,
  sessions: Array<{ id: string; backgroundStatus: string }>,
  args: {
    now: Date;
    data: {
      foregroundStatus: "closed" | "abandoned";
      endReason: "problem_changed" | "abandoned";
    };
  },
) {
  for (const session of sessions) {
    const hasNonTerminalBackground = session.backgroundStatus === "pending";
    await tx.problemWorkspaceSession.updateMany({
      where: { id: session.id, foregroundStatus: "active" },
      data: {
        ...args.data,
        activeIdentityKey: null,
        foregroundEndedAt: args.now,
        backgroundStatus:
          session.backgroundStatus === "idle"
            ? "settled"
            : session.backgroundStatus,
        settledAt: hasNonTerminalBackground ? null : args.now,
      },
    });
  }
}

async function claimActiveWorkspaceSession(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    problemId: string;
    browserInstanceId: string;
    activeIdentityKey: string;
    action: WorkspaceTraceAction;
    captureLevel: TraceCaptureLevel;
    now: Date;
    memoryOrigin: MemoryOrigin;
  },
) {
  const existing = await tx.problemWorkspaceSession.findUnique({
    where: { activeIdentityKey: args.activeIdentityKey },
  });
  if (existing) return existing;

  return tx.problemWorkspaceSession.create({
    data: {
      userId: args.userId,
      problemId: args.problemId,
      browserInstanceId: args.browserInstanceId,
      activeIdentityKey: args.activeIdentityKey,
      startTrigger: args.action,
      captureLevel: args.captureLevel,
      memoryOrigin: args.memoryOrigin,
      startedAt: args.now,
      lastActivityAt: args.now,
    },
  });
}

function snapshotStage(action: WorkspaceTraceAction) {
  if (action === "review") return "input_resolve";
  if (action === "chat") return "input_workspace_context";
  return "input_workspace_snapshot";
}

function normalizeClientTimestamp(value: string | Date | undefined) {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid clientOccurredAt: ${String(value)}`);
  }
  return date.toISOString();
}

function resolveTraceCaptureLevel(env: TraceSecretEnvironment) {
  if (env.TRACE_CAPTURE_LEVEL) {
    return traceDetailLevelSchema.parse(env.TRACE_CAPTURE_LEVEL);
  }
  return env.NODE_ENV === "development" ? "full" : "summary";
}

function resolveTraceSessionStaleMs(env: TraceSecretEnvironment) {
  if (!env.TRACE_SESSION_STALE_MS) return DEFAULT_TRACE_SESSION_STALE_MS;
  return Number(env.TRACE_SESSION_STALE_MS);
}

class RetryableWorkspaceTransactionError extends Error {}

async function retryWorkspaceTransaction<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < TRACE_TRANSACTION_RETRIES; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableWorkspaceError(error) || attempt === TRACE_TRANSACTION_RETRIES - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isRetryableWorkspaceError(error: unknown) {
  if (error instanceof RetryableWorkspaceTransactionError) return true;
  const record =
    error && typeof error === "object"
      ? (error as { code?: string; message?: string })
      : {};
  return (
    record.code === "P2002" ||
    record.code === "P1008" ||
    /busy|locked|unique constraint/i.test(record.message ?? "")
  );
}

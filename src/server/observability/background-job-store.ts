import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import {
  backgroundJobKindSchema,
  type BackgroundJobKind,
} from "@/server/observability/runtime-trace-contract";
import type { MemoryOrigin } from "@/server/memory/memory-origin";

export {
  BACKGROUND_JOB_KINDS,
  type BackgroundJobFailureReason,
  type BackgroundJobKind,
} from "@/server/observability/runtime-trace-contract";
const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RUNNING_TTL_MS = 10 * 60 * 1000;

type BackgroundJobTransaction = Prisma.TransactionClient;

export type RecordBackgroundJobInput = {
  kind: BackgroundJobKind;
  originatingTraceRunId: string;
  parentTraceRunId?: string;
  processInstanceId?: string;
  jobId?: string;
  dedupeKey?: string;
  now?: Date;
};

export type ClaimBackgroundJobInput = {
  jobId: string;
  /** Direct parent Run; the durable Job retains the foreground root separately. */
  parentTraceRunId?: string;
  processInstanceId?: string;
  traceRunId?: string;
  now?: Date;
};

export type FinishBackgroundJobInput = {
  jobId: string;
  processInstanceId?: string;
  now?: Date;
};

export type ReconcileBackgroundJobsInput = {
  processInstanceId?: string;
  userId?: string;
  pendingTtlMs?: number;
  runningTtlMs?: number;
  env?: Readonly<Record<string, string | undefined>>;
  memoryOrigin?: MemoryOrigin;
  now?: Date;
};

/**
 * Durably records intent before an in-process callback is scheduled. This API
 * does not dispatch, poll, or retry work; callers remain responsible for the
 * fire-and-forget closure.
 */
export async function recordBackgroundJobBeforeDispatch(
  prisma: PrismaClient,
  input: RecordBackgroundJobInput,
) {
  const kind = backgroundJobKindSchema.parse(input.kind);
  const processInstanceId = input.processInstanceId ?? getProcessInstanceId();
  const now = input.now ?? new Date();
  const jobId = input.jobId ?? randomUUID();

  return prisma.$transaction(async (tx) => {
    const origin = await tx.agentTraceRun.findUniqueOrThrow({
      where: { id: input.originatingTraceRunId },
      select: {
        id: true,
        workspaceSessionId: true,
        originatingTraceRunId: true,
        memoryOrigin: true,
      },
    });
    if (origin.originatingTraceRunId) {
      throw new Error(
        `Background Job origin ${origin.id} is not a root Trace Run.`,
      );
    }

    const data = {
        id: jobId,
        dedupeKey: input.dedupeKey,
        workspaceSessionId: origin.workspaceSessionId,
        originatingTraceRunId: origin.id,
        parentTraceRunId: input.parentTraceRunId,
        processInstanceId,
        kind,
        memoryOrigin: origin.memoryOrigin,
        status: "pending",
        enqueuedAt: now,
      };
    const job = input.dedupeKey
      ? await tx.backgroundJob.upsert({
          where: { dedupeKey: input.dedupeKey },
          create: data,
          update: {},
        })
      : await tx.backgroundJob.create({ data });

    // A deduplicated enqueue can return an already-terminal logical intent.
    // Do not move its workspace back to `pending`: no worker can claim that
    // terminal Job, so nothing would subsequently settle the workspace again.
    if (origin.workspaceSessionId && job.status === "pending") {
      await tx.problemWorkspaceSession.update({
        where: { id: origin.workspaceSessionId },
        data: { backgroundStatus: "pending", settledAt: null },
      });
    }
    return job;
  });
}

/** Conditionally claims work owned by this boot process and creates its child Run. */
export async function claimBackgroundJob(
  prisma: PrismaClient,
  input: ClaimBackgroundJobInput,
) {
  const processInstanceId = input.processInstanceId ?? getProcessInstanceId();
  const now = input.now ?? new Date();
  const traceRunId = input.traceRunId ?? randomUUID();

  return prisma.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUniqueOrThrow({
      where: { id: input.jobId },
      include: { originatingTraceRun: true },
    });
    const parentTraceRunId = input.parentTraceRunId ?? job.originatingTraceRunId;
    const parent = await tx.agentTraceRun.findUniqueOrThrow({
      where: { id: parentTraceRunId },
      select: {
        id: true,
        userId: true,
        workspaceSessionId: true,
        originatingTraceRunId: true,
        memoryOrigin: true,
      },
    });
    assertValidBackgroundParent(job, parent);

    const claimed = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: "pending",
        processInstanceId,
        traceRunId: null,
      },
      data: {
        status: "running",
        startedAt: now,
      },
    });
    if (claimed.count !== 1) {
      return {
        applied: false as const,
        job: await tx.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
      };
    }

    const childRun = await tx.agentTraceRun.create({
      data: {
        id: traceRunId,
        userId: job.originatingTraceRun.userId,
        problemId: job.originatingTraceRun.problemId,
        workspaceSessionId: job.workspaceSessionId,
        parentTraceRunId: parent.id,
        originatingTraceRunId: job.originatingTraceRunId,
        originatingTurnOrdinal: job.originatingTraceRun.turnOrdinal,
        path: job.kind === "campaign_strategist" ? "campaign_strategist" : "memory_background",
        actionKind: job.kind,
        memoryOrigin: job.memoryOrigin,
        processInstanceId,
        startedAt: now,
      },
    });
    await tx.backgroundJob.update({
      where: { id: job.id },
      data: { traceRunId },
    });

    return {
      applied: true as const,
      job: await tx.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
      childRun,
    };
  });
}

export async function completeBackgroundJob(
  prisma: PrismaClient,
  input: FinishBackgroundJobInput,
) {
  return finishBackgroundJob(prisma, input, {
    status: "succeeded",
    failureReason: null,
  });
}

export async function failBackgroundJob(
  prisma: PrismaClient,
  input: FinishBackgroundJobInput,
) {
  return finishBackgroundJob(prisma, input, {
    status: "failed",
    failureReason: "error",
  });
}

async function finishBackgroundJob(
  prisma: PrismaClient,
  input: FinishBackgroundJobInput,
  terminal: { status: "succeeded" | "failed"; failureReason: "error" | null },
) {
  const processInstanceId = input.processInstanceId ?? getProcessInstanceId();
  const now = input.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const current = await tx.backgroundJob.findUniqueOrThrow({
      where: { id: input.jobId },
    });
    const updated = await tx.backgroundJob.updateMany({
      where: {
        id: current.id,
        status: "running",
        processInstanceId,
        traceRunId: current.traceRunId,
      },
      data: {
        status: terminal.status,
        failureReason: terminal.failureReason,
        endedAt: now,
      },
    });
    if (updated.count !== 1) {
      return {
        applied: false as const,
        job: await tx.backgroundJob.findUniqueOrThrow({ where: { id: current.id } }),
      };
    }

    if (current.traceRunId) {
      const child = await tx.agentTraceRun.findUniqueOrThrow({
        where: { id: current.traceRunId },
        select: {
          startedAt: true,
          traceCompleteness: true,
          finalFlushAt: true,
        },
      });
      if (child.traceCompleteness === "open" || !child.finalFlushAt) {
        await tx.agentTraceRun.updateMany({
          where: {
            id: current.traceRunId,
            traceCompleteness: "open",
            finalFlushAt: null,
          },
          data: {
            status: terminal.status === "failed" ? "failed" : "degraded",
            traceCompleteness: "incomplete",
            endedAt: now,
            durationMs: Math.max(0, now.getTime() - child.startedAt.getTime()),
          },
        });
      }
    }
    if (current.workspaceSessionId) {
      await recomputeWorkspaceSessionSettlementInTransaction(
        tx,
        current.workspaceSessionId,
        now,
      );
    }

    return {
      applied: true as const,
      job: await tx.backgroundJob.findUniqueOrThrow({ where: { id: current.id } }),
    };
  });
}

/**
 * Reconciles durable records only. It never executes or retries the work they
 * describe. Older boot owners fail immediately; the current owner is governed
 * by status-specific TTLs.
 */
export async function reconcileBackgroundJobs(
  prisma: PrismaClient,
  input: ReconcileBackgroundJobsInput = {},
) {
  return prisma.$transaction((tx) =>
    reconcileBackgroundJobsInTransaction(tx, input),
  );
}

export async function reconcileBackgroundJobsInTransaction(
  tx: BackgroundJobTransaction,
  input: ReconcileBackgroundJobsInput = {},
) {
  const processInstanceId = input.processInstanceId ?? getProcessInstanceId();
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const pendingTtlMs = resolvePositiveTtl(
    input.pendingTtlMs,
    env.TRACE_BACKGROUND_JOB_PENDING_TTL_MS,
    DEFAULT_PENDING_TTL_MS,
    "TRACE_BACKGROUND_JOB_PENDING_TTL_MS",
  );
  const runningTtlMs = resolvePositiveTtl(
    input.runningTtlMs,
    env.TRACE_BACKGROUND_JOB_RUNNING_TTL_MS,
    DEFAULT_RUNNING_TTL_MS,
    "TRACE_BACKGROUND_JOB_RUNNING_TTL_MS",
  );
  const jobs = await tx.backgroundJob.findMany({
    where: {
      status: { in: ["pending", "running"] },
      ...(input.userId
        ? { originatingTraceRun: { is: { userId: input.userId } } }
        : {}),
      ...(input.memoryOrigin ? { memoryOrigin: input.memoryOrigin } : {}),
    },
  });
  const affectedSessionIds = new Set<string>();
  const reconciled: Array<{
    jobId: string;
    priorStatus: string;
    failureReason: "process_restart" | "timeout";
  }> = [];

  for (const job of jobs) {
    let failureReason: "process_restart" | "timeout" | null = null;
    if (job.processInstanceId !== processInstanceId) {
      failureReason = "process_restart";
    } else {
      const statusStartedAt =
        job.status === "running" ? (job.startedAt ?? job.enqueuedAt) : job.enqueuedAt;
      const ttlMs = job.status === "running" ? runningTtlMs : pendingTtlMs;
      if (now.getTime() - statusStartedAt.getTime() >= ttlMs) {
        failureReason = "timeout";
      }
    }
    if (!failureReason) continue;

    const failed = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        processInstanceId: job.processInstanceId,
      },
      data: { status: "failed", failureReason, endedAt: now },
    });
    if (failed.count !== 1) continue;

    if (job.traceRunId) {
      const child = await tx.agentTraceRun.findUnique({
        where: { id: job.traceRunId },
        select: { startedAt: true },
      });
      if (child) {
        await tx.agentTraceRun.updateMany({
          where: { id: job.traceRunId, traceCompleteness: "open" },
          data: {
            status: "failed",
            traceCompleteness: "incomplete",
            endedAt: now,
            durationMs: Math.max(0, now.getTime() - child.startedAt.getTime()),
          },
        });
      }
    }
    if (job.workspaceSessionId) affectedSessionIds.add(job.workspaceSessionId);
    reconciled.push({ jobId: job.id, priorStatus: job.status, failureReason });
  }

  for (const workspaceSessionId of affectedSessionIds) {
    await recomputeWorkspaceSessionSettlementInTransaction(
      tx,
      workspaceSessionId,
      now,
    );
  }
  return { reconciled, reconciledCount: reconciled.length };
}

export async function recomputeWorkspaceSessionSettlement(
  prisma: PrismaClient,
  workspaceSessionId: string,
  now = new Date(),
) {
  return prisma.$transaction((tx) =>
    recomputeWorkspaceSessionSettlementInTransaction(
      tx,
      workspaceSessionId,
      now,
    ),
  );
}

export async function recomputeWorkspaceSessionSettlementInTransaction(
  tx: BackgroundJobTransaction,
  workspaceSessionId: string,
  now: Date,
) {
  const session = await tx.problemWorkspaceSession.findUniqueOrThrow({
    where: { id: workspaceSessionId },
    select: { foregroundStatus: true },
  });
  const jobs = await tx.backgroundJob.findMany({
    where: { workspaceSessionId },
    select: { status: true },
  });
  const hasNonTerminal = jobs.some(
    (job) => job.status === "pending" || job.status === "running",
  );
  const hasFailed = jobs.some((job) => job.status === "failed");
  const backgroundStatus = hasNonTerminal
    ? "pending"
    : hasFailed
      ? "failed"
      : jobs.length > 0 || session.foregroundStatus !== "active"
        ? "settled"
        : "idle";
  const settledAt =
    !hasNonTerminal && session.foregroundStatus !== "active" ? now : null;

  return tx.problemWorkspaceSession.update({
    where: { id: workspaceSessionId },
    data: { backgroundStatus, settledAt },
  });
}

function assertValidBackgroundParent(
  job: {
    originatingTraceRunId: string;
    workspaceSessionId: string | null;
    memoryOrigin: string;
    originatingTraceRun: { userId: string; memoryOrigin: string };
  },
  parent: {
    id: string;
    userId: string;
    workspaceSessionId: string | null;
    originatingTraceRunId: string | null;
    memoryOrigin: string;
  },
) {
  if (
    parent.userId !== job.originatingTraceRun.userId ||
    parent.memoryOrigin !== job.memoryOrigin ||
    job.originatingTraceRun.memoryOrigin !== job.memoryOrigin ||
    parent.workspaceSessionId !== job.workspaceSessionId ||
    (parent.id !== job.originatingTraceRunId &&
      parent.originatingTraceRunId !== job.originatingTraceRunId)
  ) {
    throw new Error(
      `Trace Run ${parent.id} is not in Background Job ${job.originatingTraceRunId}'s origin chain.`,
    );
  }
}

function resolvePositiveTtl(
  explicit: number | undefined,
  environment: string | undefined,
  fallback: number,
  name: string,
) {
  const value = explicit ?? (environment === undefined ? fallback : Number(environment));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

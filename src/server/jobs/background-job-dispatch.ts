import type { PrismaClient } from "@prisma/client";
import {
  appendTraceEventBestEffort,
  createTraceContext,
  recordProcessMemorySample,
  type TraceContext,
} from "@/server/llm/trace-context";
import {
  claimBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  recordBackgroundJobBeforeDispatch,
  type BackgroundJobKind,
} from "@/server/observability/background-job-store";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import { parseMemoryOrigin } from "@/server/memory/memory-origin";

export type BackgroundJobOrigin = {
  /** Foreground root Run that caused this work. */
  originatingTraceRunId: string;
  /** Direct parent Run. Top-level jobs omit this and parent to the root. */
  parentTraceRunId?: string;
};

export type ClaimedBackgroundWorkContext = BackgroundJobOrigin & {
  traceContext: TraceContext;
};

export type BackgroundJobDispatchOptions = {
  schedule?: (task: () => void) => void;
  processInstanceId?: string;
  traceRunId?: string;
  onError?: (error: unknown) => void;
  dedupeKey?: string;
};

/**
 * Persists the work intent before scheduling an in-process callback. The
 * returned promise settles after durable record + scheduling, never after the
 * worker itself. This module is deliberately not a queue and has no polling or
 * retry behavior.
 */
export async function dispatchRecordedBackgroundJob(args: {
  prisma: PrismaClient;
  kind: BackgroundJobKind;
  task: string;
  origin: BackgroundJobOrigin;
  metadata?: Record<string, unknown>;
  run: (context: ClaimedBackgroundWorkContext) => Promise<unknown>;
  options?: BackgroundJobDispatchOptions;
}) {
  const processInstanceId =
    args.options?.processInstanceId ?? getProcessInstanceId();
  const job = await recordBackgroundJobBeforeDispatch(args.prisma, {
    kind: args.kind,
    originatingTraceRunId: args.origin.originatingTraceRunId,
    parentTraceRunId: args.origin.parentTraceRunId,
    processInstanceId,
    dedupeKey: args.options?.dedupeKey,
  });
  const schedule = args.options?.schedule ?? scheduleSoon;

  schedule(() => {
    void executeClaimedBackgroundJob({
      ...args,
      origin: {
        originatingTraceRunId: job.originatingTraceRunId,
        parentTraceRunId:
          job.parentTraceRunId ?? job.originatingTraceRunId,
      },
      processInstanceId,
      jobId: job.id,
      traceRunId: args.options?.traceRunId,
    }).catch((error) => {
      args.options?.onError?.(error);
      if (!args.options?.onError) {
        console.error(`${args.task} background dispatch failed.`, {
          error,
          jobId: job.id,
          originatingTraceRunId: args.origin.originatingTraceRunId,
        });
      }
    });
  });

  return job;
}

async function executeClaimedBackgroundJob(args: {
  prisma: PrismaClient;
  kind: BackgroundJobKind;
  task: string;
  origin: BackgroundJobOrigin;
  metadata?: Record<string, unknown>;
  run: (context: ClaimedBackgroundWorkContext) => Promise<unknown>;
  processInstanceId: string;
  jobId: string;
  traceRunId?: string;
}) {
  const claimed = await claimBackgroundJob(args.prisma, {
    jobId: args.jobId,
    parentTraceRunId: args.origin.parentTraceRunId,
    processInstanceId: args.processInstanceId,
    traceRunId: args.traceRunId,
  });
  if (!claimed.applied) {
    return { claimed: false as const };
  }

  const traceContext = createTraceContext({
    prisma: args.prisma,
    userId: claimed.childRun.userId,
    problemId: claimed.childRun.problemId ?? undefined,
    path: args.kind === "campaign_strategist" ? "campaign_strategist" : "memory_background",
    task: args.task,
    traceRunId: claimed.childRun.id,
    workspaceSessionId: claimed.childRun.workspaceSessionId ?? undefined,
    memoryOrigin: parseMemoryOrigin(claimed.childRun.memoryOrigin),
    bufferedRecorder: true,
  });
  await appendTraceEventBestEffort(traceContext, {
    stage: "background_job",
    kind: "background_job",
    title: `Background Job · ${args.kind}`,
    status: "started",
    details: {
      metadata: {
        jobId: args.jobId,
        kind: args.kind,
        originatingTraceRunId: args.origin.originatingTraceRunId,
        parentTraceRunId:
          args.origin.parentTraceRunId ?? args.origin.originatingTraceRunId,
        ...args.metadata,
      },
    },
  });

  let result: unknown;
  let workerError: unknown;
  try {
    result = await args.run({
      ...args.origin,
      parentTraceRunId: claimed.childRun.id,
      traceContext,
    });
  } catch (error) {
    workerError = error;
  }

  if (workerError === undefined) {
    await appendTraceEventBestEffort(traceContext, {
      stage: "background_job",
      kind: "background_job",
      title: `Background Job completed · ${args.kind}`,
      status: "succeeded",
      details: {
        metadata: { jobId: args.jobId, kind: args.kind, ...args.metadata },
      },
    });
    recordProcessMemorySample(traceContext, "end");
    await traceContext.recorder?.finalize({ status: "succeeded" });
    await completeBackgroundJob(args.prisma, {
      jobId: args.jobId,
      processInstanceId: args.processInstanceId,
    });
    return { claimed: true as const, result };
  }

  await appendTraceEventBestEffort(traceContext, {
    stage: "background_job",
    kind: "error",
    title: `Background Job failed · ${args.kind}`,
    status: "failed",
    details: {
      output: {
        error:
          workerError instanceof Error
            ? workerError.message
            : String(workerError),
      },
      metadata: { jobId: args.jobId, kind: args.kind, ...args.metadata },
    },
  });
  recordProcessMemorySample(traceContext, "end");
  await traceContext.recorder?.finalize({ status: "failed" });
  await failBackgroundJob(args.prisma, {
    jobId: args.jobId,
    processInstanceId: args.processInstanceId,
  });
  throw workerError;
}

function scheduleSoon(task: () => void) {
  if (typeof setImmediate === "function") {
    setImmediate(task);
    return;
  }
  void Promise.resolve().then(task);
}

/** Direct-call test/script compatibility when no originating Run exists. */
export function scheduleLegacyBackgroundWork(args: {
  schedule?: (task: () => void) => void;
  run: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const schedule = args.schedule ?? scheduleSoon;
  schedule(() => {
    void args.run().catch(args.onError);
  });
  return { recorded: false as const };
}

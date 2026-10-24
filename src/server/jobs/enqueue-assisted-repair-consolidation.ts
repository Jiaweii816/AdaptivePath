import type { PrismaClient } from "@prisma/client";
import {
  runAssistedRepairConsolidation,
  type RunAssistedRepairConsolidationArgs,
} from "@/server/memory/consolidation/consolidate-assisted-repair";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  dispatchRecordedBackgroundJob,
  scheduleLegacyBackgroundWork,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";

export type EnqueueAssistedRepairConsolidationArgs =
  RunAssistedRepairConsolidationArgs & Partial<BackgroundJobOrigin>;

type ClaimedArgs = EnqueueAssistedRepairConsolidationArgs & {
  traceContext: TraceContext;
  originatingTraceRunId: string;
};

export type EnqueueAssistedRepairConsolidationOptions =
  BackgroundJobDispatchOptions & {
    run?: (prisma: PrismaClient, args: ClaimedArgs) => Promise<unknown>;
  };

export async function enqueueAssistedRepairConsolidation(
  prisma: PrismaClient,
  args: EnqueueAssistedRepairConsolidationArgs,
  options: EnqueueAssistedRepairConsolidationOptions = {},
) {
  const run = options.run ?? runAssistedRepairConsolidation;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("Assisted repair consolidation failed.", {
        error,
        chainEventId: args.chainEventId,
      });
    });
  if (!args.originatingTraceRunId) {
    return scheduleLegacyBackgroundWork({
      schedule: options.schedule,
      run: () => run(prisma, args as ClaimedArgs),
      onError,
    });
  }
  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "assisted_repair_consolidation",
    task: "memory.consolidate_assisted_repair",
    origin: {
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.parentTraceRunId,
    },
    metadata: { chainEventId: args.chainEventId },
    options: {
      schedule: options.schedule,
      processInstanceId: options.processInstanceId,
      traceRunId: options.traceRunId,
      onError,
    },
    run: ({ traceContext, originatingTraceRunId, parentTraceRunId }) =>
      run(prisma, {
        ...args,
        traceContext,
        originatingTraceRunId,
        parentTraceRunId,
      } as ClaimedArgs),
  });
}

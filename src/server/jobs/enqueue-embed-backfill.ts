import type { PrismaClient } from "@prisma/client";
import {
  runEmbedBackfill,
  type RunEmbedBackfillArgs,
} from "@/server/memory/consolidation/embed-backfill";
import type { TraceContext } from "@/server/llm/trace-context";
import {
  dispatchRecordedBackgroundJob,
  scheduleLegacyBackgroundWork,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";

export type EnqueueEmbedBackfillArgs = RunEmbedBackfillArgs &
  Partial<BackgroundJobOrigin>;

type ClaimedEmbedBackfillArgs = EnqueueEmbedBackfillArgs & {
  traceContext: TraceContext;
  originatingTraceRunId: string;
};

export type EnqueueEmbedBackfillOptions = BackgroundJobDispatchOptions & {
  run?: (
    prisma: PrismaClient,
    args: ClaimedEmbedBackfillArgs,
  ) => Promise<unknown>;
};

export async function enqueueEmbedBackfill(
  prisma: PrismaClient,
  args: EnqueueEmbedBackfillArgs,
  options: EnqueueEmbedBackfillOptions = {},
) {
  const run = options.run ?? runEmbedBackfill;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("Embed backfill failed.", { error });
    });
  if (!args.originatingTraceRunId) {
    return scheduleLegacyBackgroundWork({
      schedule: options.schedule,
      run: () => run(prisma, args as ClaimedEmbedBackfillArgs),
      onError,
    });
  }
  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "embed_backfill",
    task: "memory.embed_backfill",
    origin: {
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.parentTraceRunId,
    },
    options: {
      schedule: options.schedule,
      processInstanceId: options.processInstanceId,
      traceRunId: options.traceRunId,
      dedupeKey: options.dedupeKey,
      onError,
    },
    run: ({ traceContext, originatingTraceRunId, parentTraceRunId }) =>
      run(prisma, {
        ...args,
        traceContext,
        originatingTraceRunId,
        parentTraceRunId,
      }),
  });
}

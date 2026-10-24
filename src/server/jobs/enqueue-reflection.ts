import type { PrismaClient } from "@prisma/client";
import {
  hasMemorySynthesisFailureTraceWritten,
  runReflection,
  type RunReflectionArgs,
} from "@/server/agents/memory-agent/tasks/reflect";
import type { TraceContext } from "@/server/llm/trace-context";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";
import { enqueueEmbedBackfill } from "./enqueue-embed-backfill";
import {
  dispatchRecordedBackgroundJob,
  scheduleLegacyBackgroundWork,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";

export type EnqueueReflectionArgs = RunReflectionArgs &
  Partial<BackgroundJobOrigin>;

type ClaimedReflectionArgs = EnqueueReflectionArgs & {
  traceContext: TraceContext;
  originatingTraceRunId: string;
};

export type EnqueueReflectionOptions = BackgroundJobDispatchOptions & {
  run?: (prisma: PrismaClient, args: ClaimedReflectionArgs) => Promise<unknown>;
};

export async function enqueueReflection(
  prisma: PrismaClient,
  args: EnqueueReflectionArgs,
  options: EnqueueReflectionOptions = {},
) {
  const run =
    options.run ??
    (async (client: PrismaClient, input: ClaimedReflectionArgs) => {
      const result = await runReflection(client, {
        ...input,
        ftsStore: input.ftsStore ?? getDefaultFtsStore(),
      });
      await enqueueEmbedBackfill(client, {
        originatingTraceRunId: input.originatingTraceRunId,
        parentTraceRunId: input.traceContext.traceRunId,
      });
      return result;
    });
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("Reflection failed.", {
        error,
        userId: args.userId,
        problemId: args.problemId,
        failureTraceAlreadyWritten:
          hasMemorySynthesisFailureTraceWritten(error),
      });
      if (hasMemorySynthesisFailureTraceWritten(error)) return;
      void appendL1TraceEvent(prisma, {
        userId: args.userId,
        problemId: args.problemId,
        reviewAttemptId: args.reviewAttemptId,
        eventType: "memory_synthesis_failed",
        source: "memory_agent:reflect",
        content: error instanceof Error ? error.message : String(error),
        eventJson: { changedFactIds: args.changedFactIds ?? [] },
      }).catch((traceError) => {
        console.error("Failed to append reflection failure trace.", {
          error: traceError,
          userId: args.userId,
        });
      });
    });
  if (!args.originatingTraceRunId) {
    return scheduleLegacyBackgroundWork({
      schedule: options.schedule,
      run: () => run(prisma, args as ClaimedReflectionArgs),
      onError,
    });
  }
  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "reflection",
    task: "memory.reflect",
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

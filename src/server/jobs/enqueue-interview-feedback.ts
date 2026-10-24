import type { PrismaClient } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import { isSafeEpisodeForIndexing } from "@/server/memory/store/episode-store";
import {
  getDefaultFtsStore,
  type FtsStore,
} from "@/server/memory/store/fts-store";
import {
  dispatchRecordedBackgroundJob,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";
import { enqueueEmbedBackfill } from "./enqueue-embed-backfill";
import { enqueueReflection } from "./enqueue-reflection";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  refreshLearnerRetrievalText,
  type RetrievalTextRefreshProvider,
} from "@/server/memory/retrieval-text/refresh-retrieval-text";

export type EnqueueInterviewFeedbackArgs = BackgroundJobOrigin & {
  userId: string;
  problemId: string;
  mockInterviewSessionId: string;
  feedbackId: string;
  fallbackReport: boolean;
  episodeId: string;
  changedFactIds: string[];
  ftsStore?: FtsStore;
  /** Test/script seam; production keeps default in-process scheduling. */
  childDispatchOptions?: BackgroundJobDispatchOptions;
  retrievalTextProvider?: RetrievalTextRefreshProvider;
};

type ClaimedInterviewFeedbackArgs = EnqueueInterviewFeedbackArgs & {
  traceContext: TraceContext;
};

export type EnqueueInterviewFeedbackOptions = BackgroundJobDispatchOptions & {
  run?: (
    prisma: PrismaClient,
    args: ClaimedInterviewFeedbackArgs,
  ) => Promise<unknown>;
};

/**
 * Coordinates post-report Mock Interview memory work. The learner-visible
 * report, feedback, L2 writes and episode are already durable before this is
 * called. The coordinator records its reflection/embed children before its own
 * Job can become terminal.
 */
export async function enqueueInterviewFeedback(
  prisma: PrismaClient,
  args: EnqueueInterviewFeedbackArgs,
  options: EnqueueInterviewFeedbackOptions = {},
) {
  const run = options.run ?? runInterviewFeedbackCoordination;
  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "interview_feedback",
    task: "memory.interview_feedback",
    origin: args,
    metadata: {
      mockInterviewSessionId: args.mockInterviewSessionId,
      feedbackId: args.feedbackId,
      fallbackReport: args.fallbackReport,
      episodeId: args.episodeId,
      changedFactIds: args.changedFactIds,
    },
    options: {
      schedule: options.schedule,
      processInstanceId: options.processInstanceId,
      traceRunId: options.traceRunId,
      onError:
        options.onError ??
        ((error) => {
          console.error("Mock Interview feedback background work failed.", {
            error,
            episodeId: args.episodeId,
          });
        }),
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

export async function runInterviewFeedbackCoordination(
  prisma: PrismaClient,
  args: ClaimedInterviewFeedbackArgs,
) {
  const episode = await prisma.memoryEpisode.findUniqueOrThrow({
    where: { id: args.episodeId },
  });
  if (
    args.traceContext.memoryOrigin !== "learner" ||
    !resolveMemoryWritePolicy().durableWrites ||
    !isSafeEpisodeForIndexing(episode)
  ) {
    return { episodeId: episode.id, skipped: "ineligible_memory_origin" };
  }
  const retrievalRefresh = await refreshLearnerRetrievalText(prisma, {
    userId: args.userId,
    episodeIds: [args.episodeId],
    factIds: args.changedFactIds,
    provider: args.retrievalTextProvider,
  });
  if (retrievalRefresh.failed.length > 0) {
    throw new Error("retrieval_text_refresh_failed:interview_feedback");
  }
  await reconcileLearnerMemoryRetrievalDocuments(prisma, {
    userId: args.userId,
    ftsStore: args.ftsStore ?? getDefaultFtsStore(),
  });

  // Await durable record + scheduling only. Neither promise waits for worker
  // completion, but both child Job rows exist before this coordinator returns.
  await enqueueEmbedBackfill(
    prisma,
    {
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.traceContext.traceRunId,
    },
    args.childDispatchOptions,
  );
  await enqueueReflection(
    prisma,
    {
      userId: args.userId,
      problemId: args.problemId,
      changedFactIds: args.changedFactIds,
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.traceContext.traceRunId,
    },
    args.childDispatchOptions,
  );

  return { episodeId: episode.id };
}

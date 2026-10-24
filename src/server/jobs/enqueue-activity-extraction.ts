import type { PrismaClient } from "@prisma/client";
import {
  ACTIVITY_EXTRACTION_VERSION,
  ensureExtractionReceipt,
} from "@/server/memory/activity-clusters";
import { appendTraceEventBestEffort } from "@/server/llm/trace-context";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import {
  runActivityExtraction,
  type RunActivityExtractionArgs,
  type RunActivityExtractionResult,
} from "@/server/memory/extraction";
import {
  enqueueEmbedBackfill,
  type EnqueueEmbedBackfillOptions,
} from "./enqueue-embed-backfill";
import {
  enqueueReflection,
  type EnqueueReflectionOptions,
} from "./enqueue-reflection";
import {
  dispatchRecordedBackgroundJob,
  type BackgroundJobDispatchOptions,
  type BackgroundJobOrigin,
} from "./background-job-dispatch";

export type EnqueueActivityExtractionArgs = Omit<
  RunActivityExtractionArgs,
  "traceContext"
> &
  BackgroundJobOrigin;

export type EnqueueActivityExtractionOptions = BackgroundJobDispatchOptions & {
  run?: (
    prisma: PrismaClient,
    args: RunActivityExtractionArgs & BackgroundJobOrigin,
  ) => Promise<RunActivityExtractionResult>;
  nestedJobs?: {
    reflection?: EnqueueReflectionOptions;
    embedBackfill?: EnqueueEmbedBackfillOptions;
  };
};

export async function enqueueActivityExtraction(
  prisma: PrismaClient,
  args: EnqueueActivityExtractionArgs,
  options: EnqueueActivityExtractionOptions = {},
) {
  const extractorVersion = args.extractorVersion ?? ACTIVITY_EXTRACTION_VERSION;
  const receipt = await ensureExtractionReceipt(prisma, {
    activityClusterId: args.activityClusterId,
    extractorVersion,
  });
  if (receipt.status === "policy_rejected") {
    return { recorded: false as const, receipt };
  }
  const run = options.run ?? runActivityExtraction;

  return dispatchRecordedBackgroundJob({
    prisma,
    kind: "activity_extraction",
    task: "memory.extract_activity",
    origin: {
      originatingTraceRunId: args.originatingTraceRunId,
      parentTraceRunId: args.parentTraceRunId,
    },
    metadata: {
      activityClusterId: args.activityClusterId,
      extractionReceiptId: receipt.id,
      extractorVersion,
    },
    options: {
      schedule: options.schedule,
      processInstanceId: options.processInstanceId,
      traceRunId: options.traceRunId,
      onError:
        options.onError ??
        ((error) => {
          console.error("Activity extraction failed.", {
            error,
            activityClusterId: args.activityClusterId,
            extractionReceiptId: receipt.id,
          });
        }),
    },
    run: async ({ traceContext, originatingTraceRunId, parentTraceRunId }) => {
      const result = await run(prisma, {
        ...args,
        extractorVersion,
        traceContext,
        originatingTraceRunId,
        parentTraceRunId,
      });
      const materialized =
        result.receiptStatus === "succeeded" ||
        result.receiptStatus === "partial";
      if (!result.claimed && !materialized) return result;

      const cluster = await prisma.memoryActivityCluster.findUniqueOrThrow({
        where: { id: args.activityClusterId },
        select: {
          userId: true,
          problemId: true,
          rootReviewAttemptId: true,
        },
      });
      const nestedOrigin = {
        originatingTraceRunId,
        // dispatchRecordedBackgroundJob replaces this with the claimed
        // activity-extraction child Run, so nested work is a true child of
        // extraction while retaining the foreground root.
        parentTraceRunId,
      };
      const processDefaults = { processInstanceId: options.processInstanceId };
      const recovered = !result.claimed
        ? await loadCompletedExtractionOutcome(prisma, args.activityClusterId)
        : undefined;
      const episodeId = result.episodeId ?? recovered?.episodeId;
      const candidateFactIds = [
        ...new Set([
          ...result.changedFactIds,
          ...(recovered?.changedFactIds ?? []),
        ]),
      ];
      const trustedFactIds = await loadTrustedFactIds(prisma, candidateFactIds);
      const nestedWrites: Array<Promise<void>> = [];

      if (trustedFactIds.length > 0) {
        nestedWrites.push(
          recordNestedIntentSafely({
            traceContext,
            kind: "reflection",
            activityClusterId: args.activityClusterId,
            run: () =>
              enqueueReflection(
                prisma,
                {
                  userId: cluster.userId,
                  problemId: cluster.problemId ?? undefined,
                  reviewAttemptId: cluster.rootReviewAttemptId ?? undefined,
                  changedFactIds: trustedFactIds,
                  ftsStore: args.ftsStore,
                  ...nestedOrigin,
                },
                {
                  ...processDefaults,
                  ...options.nestedJobs?.reflection,
                  dedupeKey: `activity-extraction:${result.receiptId}:reflection:v1`,
                },
              ),
          }),
        );
      }
      // Episode/L2 can embed now. If Reflection changes L3, its worker queues a
      // second content-hash-aware pass after L3 retrieval text is refreshed.
      if (episodeId || candidateFactIds.length > 0) {
        nestedWrites.push(
          recordNestedIntentSafely({
            traceContext,
            kind: "embed_backfill",
            activityClusterId: args.activityClusterId,
            run: () =>
              enqueueEmbedBackfill(
                prisma,
                {
                  ...nestedOrigin,
                  vectorStore: args.vectorStore,
                  embedClient: args.embedClient,
                },
                {
                  ...processDefaults,
                  ...options.nestedJobs?.embedBackfill,
                  dedupeKey: `activity-extraction:${result.receiptId}:embed:v1`,
                },
              ),
          }),
        );
      }

      // Each enqueue persists BackgroundJob before returning. Await all intent
      // writes before marking activity_extraction complete.
      await Promise.all(nestedWrites);
      return result;
    },
  });
}

async function loadCompletedExtractionOutcome(
  prisma: PrismaClient,
  activityClusterId: string,
) {
  const [episode, contributions] = await Promise.all([
    prisma.memoryEpisode.findFirst({
      where: { activityClusterId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    prisma.memoryEvidenceContribution.findMany({
      where: { activityClusterId },
      select: { targetClusterFactId: true },
    }),
  ]);
  return {
    episodeId: episode?.id,
    changedFactIds: [
      ...new Set(contributions.map((item) => item.targetClusterFactId)),
    ],
  };
}

async function loadTrustedFactIds(prisma: PrismaClient, factIds: string[]) {
  if (factIds.length === 0) return [];
  const facts = await prisma.l2MemoryFact.findMany({
    where: { id: { in: factIds } },
    select: {
      id: true,
      tag: true,
      status: true,
      memoryOrigin: true,
      validationJson: true,
    },
  });
  return facts.filter(isTrustedL2FactForConsumption).map((fact) => fact.id);
}

async function recordNestedIntentSafely(args: {
  traceContext: Parameters<typeof appendTraceEventBestEffort>[0];
  kind: "reflection" | "embed_backfill";
  activityClusterId: string;
  run: () => Promise<unknown>;
}) {
  try {
    await args.run();
  } catch (error) {
    console.error("Unable to record extraction downstream intent.", {
      error,
      kind: args.kind,
      activityClusterId: args.activityClusterId,
    });
    await appendTraceEventBestEffort(args.traceContext, {
      stage: "background_job",
      kind: "error",
      title: `Downstream intent failed · ${args.kind}`,
      status: "failed",
      details: {
        output: {
          error: error instanceof Error ? error.message : String(error),
        },
        metadata: {
          operation: "record_extraction_downstream_intent",
          kind: args.kind,
          activityClusterId: args.activityClusterId,
          extractionSucceeded: true,
          compensatable: true,
        },
      },
    });
  }
}

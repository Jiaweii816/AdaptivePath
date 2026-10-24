import type { MemoryEpisode, PrismaClient } from "@prisma/client";
import {
  enqueueActivityExtraction,
  type EnqueueActivityExtractionOptions,
} from "@/server/jobs/enqueue-activity-extraction";
import {
  appendTraceEventBestEffort,
  type TraceContext,
} from "@/server/llm/trace-context";
import { resolveMemoryWritePolicy } from "@/server/memory/memory-origin";
import type { ActivityExtractionProvider } from "@/server/memory/extraction";
import type { EmbedClient } from "@/server/memory/retrieval/embed-client";
import type { FtsStore } from "@/server/memory/store/fts-store";
import { getDefaultFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import type { VectorStore } from "@/server/memory/store/vector-store";

type ExtractionDispatchStatus =
  | "disabled"
  | "not_eligible"
  | "dispatched"
  | "missing_origin"
  | "dispatch_failed";

export async function completeReviewBackground(args: {
  db: PrismaClient;
  outcome: {
    reviewAttempt: { id: string };
    memoryEpisode: MemoryEpisode | null;
    activityCluster: { id: string; memoryOrigin: string };
    extractionReceipt: { id: string; status: string; extractorVersion: string };
  };
  userId: string;
  problemId: string;
  backgroundJobsDisabled: boolean;
  traceContext?: TraceContext;
  ftsStore?: FtsStore;
  activityExtraction?: {
    provider?: ActivityExtractionProvider;
    vectorStore?: VectorStore;
    embedClient?: EmbedClient;
    options?: EnqueueActivityExtractionOptions;
  };
}) {
  const receiptCanRun = ["queued", "failed"].includes(
    args.outcome.extractionReceipt.status,
  );
  let dispatchStatus: ExtractionDispatchStatus =
    !receiptCanRun
      ? "not_eligible"
      : args.backgroundJobsDisabled || !resolveMemoryWritePolicy().durableWrites
        ? "disabled"
        : args.traceContext
          ? "dispatched"
          : "missing_origin";
  let durableJobRecord = false;
  let recoveredFailedReceiptCount = 0;

  // The primary Review Episode is synchronously committed foreground truth. It
  // must remain lexically retrievable even if the async extractor/provider
  // later fails. Vector embedding still belongs to background work.
  if (resolveMemoryWritePolicy().durableWrites) {
    await reconcileLearnerMemoryRetrievalDocuments(args.db, {
      userId: args.userId,
      ftsStore: args.ftsStore ?? getDefaultFtsStore(),
    });
  }

  if (dispatchStatus === "dispatched" && args.traceContext) {
    try {
      const job = await enqueueActivityExtraction(
        args.db,
        {
          activityClusterId: args.outcome.activityCluster.id,
          extractorVersion: args.outcome.extractionReceipt.extractorVersion,
          originatingTraceRunId: args.traceContext.traceRunId,
          provider: args.activityExtraction?.provider,
          ftsStore: args.ftsStore,
          vectorStore: args.activityExtraction?.vectorStore,
          embedClient: args.activityExtraction?.embedClient,
        },
        args.activityExtraction?.options,
      );
      durableJobRecord = "id" in job;
      if (!durableJobRecord) dispatchStatus = "not_eligible";
    } catch (error) {
      dispatchStatus = "dispatch_failed";
      console.error("Unable to durably enqueue Review activity extraction.", {
        error,
        traceRunId: args.traceContext.traceRunId,
        reviewAttemptId: args.outcome.reviewAttempt.id,
        activityClusterId: args.outcome.activityCluster.id,
      });
    }
  }

  if (
    !args.backgroundJobsDisabled &&
    resolveMemoryWritePolicy().durableWrites &&
    args.traceContext
  ) {
    recoveredFailedReceiptCount = await enqueueRelatedFailedReceipts(args);
  }

  const extractionIntent = {
    activityClusterId: args.outcome.activityCluster.id,
    extractionReceiptId: args.outcome.extractionReceipt.id,
    extractorVersion: args.outcome.extractionReceipt.extractorVersion,
    receiptStatus: args.outcome.extractionReceipt.status,
    dispatchStatus,
    recoveredFailedReceiptCount,
  };
  await traceExtractionIntent(args, extractionIntent, durableJobRecord);
  return extractionIntent;
}

async function traceExtractionIntent(
  args: {
    outcome: { reviewAttempt: { id: string } };
    traceContext?: TraceContext;
  },
  intent: {
    activityClusterId: string;
    extractionReceiptId: string;
    extractorVersion: string;
    receiptStatus: string;
    dispatchStatus: ExtractionDispatchStatus;
    recoveredFailedReceiptCount: number;
  },
  durableJobRecord: boolean,
) {
  if (!args.traceContext) return;
  await appendTraceEventBestEffort(args.traceContext, {
    stage: "after_reply_memory",
    kind: "background_job",
    title: "Background intent · activity_extraction",
    status:
      intent.dispatchStatus === "dispatch_failed"
        ? "failed"
        : intent.receiptStatus === "queued"
          ? "succeeded"
          : "skipped",
    details: {
      input: {
        kind: "activity_extraction",
        triggerReason: "review_activity_cluster_sealed",
        originatingReviewAttemptId: args.outcome.reviewAttempt.id,
      },
      output: {
        ...intent,
        intentRecorded: true,
        durableJobRecord,
      },
      metadata: {
        operation: "enqueue_activity_extraction",
        workerImplemented: true,
      },
    },
  });
}

async function enqueueRelatedFailedReceipts(args: {
  db: PrismaClient;
  outcome: {
    activityCluster: { id: string };
    extractionReceipt: { extractorVersion: string };
  };
  traceContext?: TraceContext;
  ftsStore?: FtsStore;
  activityExtraction?: {
    provider?: ActivityExtractionProvider;
    vectorStore?: VectorStore;
    embedClient?: EmbedClient;
    options?: EnqueueActivityExtractionOptions;
  };
}) {
  if (!args.traceContext) return 0;
  const current = await args.db.memoryActivityCluster.findUniqueOrThrow({
    where: { id: args.outcome.activityCluster.id },
    select: { userId: true, chatSessionId: true, problemId: true },
  });
  const failed = await args.db.memoryExtractionReceipt.findMany({
    where: {
      status: "failed",
      extractorVersion: args.outcome.extractionReceipt.extractorVersion,
      activityClusterId: { not: args.outcome.activityCluster.id },
      activityCluster: {
        userId: current.userId,
        memoryOrigin: "learner",
        ...(current.chatSessionId
          ? { chatSessionId: current.chatSessionId }
          : { problemId: current.problemId }),
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 3,
    select: { activityClusterId: true },
  });
  let recorded = 0;
  for (const receipt of failed) {
    try {
      const job = await enqueueActivityExtraction(
        args.db,
        {
          activityClusterId: receipt.activityClusterId,
          extractorVersion: args.outcome.extractionReceipt.extractorVersion,
          originatingTraceRunId: args.traceContext.traceRunId,
          provider: args.activityExtraction?.provider,
          ftsStore: args.ftsStore,
          vectorStore: args.activityExtraction?.vectorStore,
          embedClient: args.activityExtraction?.embedClient,
        },
        args.activityExtraction?.options,
      );
      if ("id" in job) recorded += 1;
    } catch (error) {
      console.error("Unable to re-enqueue related failed extraction.", {
        error,
        activityClusterId: receipt.activityClusterId,
        originatingTraceRunId: args.traceContext.traceRunId,
      });
    }
  }
  return recorded;
}

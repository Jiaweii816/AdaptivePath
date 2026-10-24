import type { Prisma, PrismaClient } from "@prisma/client";
import type { TraceContext } from "@/server/llm/trace-context";
import { hashSelectedTestSuite } from "@/server/code/code-hash";
import {
  bindCampaignAttemptToPersistedReview,
  type CampaignWorkspaceAttemptContext,
} from "@/server/campaign/services";
import {
  ACTIVITY_EXTRACTION_VERSION,
  ensureExtractionReceiptTx,
  sealReviewActivityClusterTx,
  type ActivitySourceRef,
} from "@/server/memory/activity-clusters";
import {
  ASSISTED_REPAIR_CHAIN_SOURCE,
  type AssistedRepairChain,
} from "@/server/memory/assisted-repair-chain";
import { buildReviewEpisode } from "@/server/memory/consolidation/write-review-episode";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import { appendReviewL1Events } from "./review-l1-events";
import {
  createReviewRecords,
  type ReviewRecordArgs,
} from "./review-persistence-records";
import {
  appendReviewArbitrationResultTrace,
  appendReviewPersistenceTrace,
} from "./review-trace";

type PersistReviewArgs = ReviewRecordArgs & {
  db: PrismaClient;
  assistedRepairChain?: AssistedRepairChain;
  activitySourceItems: ActivitySourceRef[];
  arbitrationSkipReason?: "memory_skipped" | "not_eligible" | "no_candidate";
  pathStartedAt: number;
  l1OccurredAt: {
    reviewAttempt: Date;
    runEvidence: Date;
    diagnosis: Date;
    coachReply: Date;
  };
  traceContext?: TraceContext;
  campaignContext?: CampaignWorkspaceAttemptContext | null;
};

export async function persistReview(args: PersistReviewArgs) {
  const startedAt = Date.now();
  let outcome: Awaited<ReturnType<typeof runPersistenceTransaction>>;
  try {
    outcome = await args.db.$transaction((tx) =>
      runPersistenceTransaction(tx, args),
    );
  } catch (error) {
    await tracePersistenceFailure(args.traceContext, startedAt, error);
    throw error;
  }
  if (args.traceContext) {
    await appendReviewPersistenceTrace({
      traceContext: args.traceContext,
      durationMs: Date.now() - startedAt,
      status: "succeeded",
      ids: {
        reviewAttemptId: outcome.reviewAttempt.id,
        runEvidenceId: outcome.runEvidence.id,
        problemHistoryId: outcome.problemHistory.id,
        memoryEpisodeId: outcome.memoryEpisode?.id,
        activityClusterId: outcome.activityCluster.id,
        extractionReceiptId: outcome.extractionReceipt.id,
      },
    });
    await appendReviewArbitrationResultTrace({
      traceContext: args.traceContext,
      ...outcome.arbitrationTrace,
    });
  }
  return outcome;
}

async function runPersistenceTransaction(
  tx: Prisma.TransactionClient,
  args: PersistReviewArgs,
) {
  const records = await createReviewRecords(tx, args, (reviewAttemptId) => {
    if (args.traceContext) args.traceContext.reviewAttemptId = reviewAttemptId;
  });
  if (args.campaignContext) {
    await bindCampaignAttemptToPersistedReview(tx, args.campaignContext, {
      reviewAttemptId: records.reviewAttempt.id,
      codeRevision: args.executionFingerprint,
      executionFingerprint: args.executionFingerprint,
      selectedSuiteFingerprint: hashSelectedTestSuite(args.selectedTestCaseIds),
      evidenceProblemSlug: args.problem.slug,
      evidenceSubject: "current_user_code",
      evidenceScope: "selected_suite",
      evidenceClass: args.evidenceVerdict.evidenceClass,
      evidenceAuthority: "authoritative",
      evidenceCanVerdict: args.evidenceVerdict.capabilities.canVerdict,
      verdict: args.runResult.status,
    });
  }
  const reviewTraceEvents = await appendReviewL1Events(
    tx,
    buildL1Args(args, records),
  );
  const assistedRepairChainEvent = await appendAssistedRepairChainEvent(
    tx,
    args,
    records,
  );
  const arbitration = delegatedReviewArbitration(args);
  const activity = await sealReviewActivityClusterTx(tx, {
    reviewAttemptId: records.reviewAttempt.id,
    additionalSourceItems: args.activitySourceItems,
  });
  const memoryEpisode = await createReviewMemoryEpisode(
    tx,
    args,
    reviewTraceEvents,
    activity.cluster.id,
  );
  const extractionReceipt = await ensureExtractionReceiptTx(tx, {
    activityClusterId: activity.cluster.id,
    extractorVersion: ACTIVITY_EXTRACTION_VERSION,
  });
  return {
    ...records,
    reviewTraceEvents,
    updatedL2Facts: [],
    arbitrationTrace: arbitration.trace,
    memoryEpisode,
    assistedRepairChainEvent,
    activityCluster: activity.cluster,
    extractionReceipt,
  };
}

async function appendAssistedRepairChainEvent(
  tx: Prisma.TransactionClient,
  args: PersistReviewArgs,
  records: Awaited<ReturnType<typeof createReviewRecords>>,
) {
  if (!args.assistedRepairChain) return null;
  const chain = args.assistedRepairChain;
  return appendL1TraceEvent(tx, {
    userId: args.userId,
    problemId: args.problem.id,
    chatSessionId: args.chatSessionId,
    reviewAttemptId: records.reviewAttempt.id,
    eventType: "assisted_repair_chain_closed",
    source: ASSISTED_REPAIR_CHAIN_SOURCE,
    occurredAt: new Date(),
    content: `A failed learner revision received aligned Coach guidance before a changed revision passed Review evidence.`,
    eventJson: {
      version: chain.version,
      repairKey: chain.repairKey,
      failedPracticeRunLogId: chain.failedPracticeRunLogId,
      userChatMessageId: chain.userChatMessageId,
      userChatTraceId: chain.userChatTraceId,
      assistantChatMessageId: chain.assistantChatMessageId,
      assistantChatTraceId: chain.assistantChatTraceId,
      failedExecutionFingerprint: chain.failedExecutionFingerprint,
      passedExecutionFingerprint: chain.passedExecutionFingerprint,
      failedCodeHash: chain.failedCodeHash,
      passedCodeHash: chain.passedCodeHash,
      selectedTestCaseIds: chain.selectedTestCaseIds,
      evidenceScope: chain.evidenceScope,
      passedRunEvidenceId: records.runEvidence.id,
    },
    memoryOrigin: args.memoryOrigin,
    traceRunId: args.traceContext?.traceRunId,
  });
}

function buildL1Args(
  args: PersistReviewArgs,
  records: Awaited<ReturnType<typeof createReviewRecords>>,
) {
  return {
    userId: args.userId,
    problem: args.problem,
    chatSessionId: args.chatSessionId,
    reviewAttemptId: records.reviewAttempt.id,
    runEvidenceId: records.runEvidence.id,
    diagnosisResultId: records.diagnosisResult.id,
    assistantMessageId: records.assistantReviewMessage.id,
    problemHistoryId: records.problemHistory.id,
    language: args.language,
    userState: args.userState,
    userQuestion: args.userQuestion,
    codeLength: args.code.length,
    codeHash: args.codeHash,
    executionFingerprint: args.executionFingerprint,
    selectedTestCaseIds: args.selectedTestCaseIds,
    selectedTestsJson: args.selectedTestsJson,
    runResult: args.runResult,
    evidenceVerdict: args.evidenceVerdict,
    coachResult: args.coachResult,
    pathStartedAt: args.pathStartedAt,
    occurredAt: args.l1OccurredAt,
    traceContext: args.traceContext,
  };
}

function delegatedReviewArbitration(
  args: PersistReviewArgs,
) {
  const candidates = args.coachResult.diagnosis.memoryUpdateCandidate.facts;
  return {
    trace: {
      eligible: false,
      candidates,
      before: [],
      updated: [],
      rejected: [],
      reason:
        args.arbitrationSkipReason ?? "delegated_to_activity_extraction",
    },
  };
}

async function createReviewMemoryEpisode(
  tx: Prisma.TransactionClient,
  args: PersistReviewArgs,
  events: Awaited<ReturnType<typeof appendReviewL1Events>>,
  activityClusterId: string,
) {
  if (!args.evidenceVerdict.capabilities.canWriteEpisode) return null;
  const attemptOrdinal = await tx.reviewAttempt.count({
    where: {
      userId: args.userId,
      problemId: args.problem.id,
      memoryOrigin: args.memoryOrigin,
    },
  });
  const episode = await createMemoryEpisode(tx, {
    userId: args.userId,
    problemId: args.problem.id,
    chatSessionId: args.chatSessionId,
    memoryOrigin: args.memoryOrigin,
    ...buildReviewEpisode({
      problemTitle: args.problem.title,
      problemTags: args.tags,
      attemptOrdinal,
      runResult: args.runResult,
      evidenceScope:
        args.evidenceVerdict.evidenceClass === "local_only"
          ? "local_visible"
          : "official_judge",
      diagnosis: {
        userIssueSummary: args.coachResult.diagnosis.userIssueSummary,
        coachSummary: args.coachResult.diagnosis.coachSummary,
        mistakeTags: args.coachResult.diagnosis.mistakeTags,
      },
      sourceTraceIds: events.map((event) => event.id),
    }),
  });
  return tx.memoryEpisode.update({
    where: { id: episode.id },
    data: { activityClusterId },
  });
}

async function tracePersistenceFailure(
  traceContext: TraceContext | undefined,
  startedAt: number,
  error: unknown,
) {
  if (!traceContext) return;
  await appendReviewPersistenceTrace({
    traceContext,
    durationMs: Date.now() - startedAt,
    status: "failed",
    error,
  });
}

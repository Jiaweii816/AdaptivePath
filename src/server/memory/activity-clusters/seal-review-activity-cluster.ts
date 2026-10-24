import { parseMemoryOrigin } from "@/server/memory/memory-origin";
import type { ActivitySourceRef } from "./activity-cluster.types";
import type { ActivityClusterDb, ActivityClusterTx } from "./activity-source";
import { loadSealedActivityClusterInputTx } from "./load-sealed-activity-cluster";
import { sealActivityClusterTx } from "./seal-activity-cluster";

export type SealReviewActivityClusterArgs = {
  reviewAttemptId: string;
  /** First ChatMessage owned by this activity. Defaults to the Review reply. */
  startMessageSequence?: number;
  /** Last ChatMessage owned by this activity. Defaults to the Review reply. */
  endMessageSequence?: number;
  /** Practice runs and other immutable sources selected by foreground lineage. */
  additionalSourceItems?: ActivitySourceRef[];
};

export async function sealReviewActivityCluster(
  prisma: ActivityClusterDb,
  args: SealReviewActivityClusterArgs,
) {
  return prisma.$transaction((tx) => sealReviewActivityClusterTx(tx, args));
}

export async function sealReviewActivityClusterTx(
  tx: ActivityClusterTx,
  args: SealReviewActivityClusterArgs,
) {
  const existing = await tx.memoryActivityCluster.findUnique({
    where: { rootReviewAttemptId: args.reviewAttemptId },
    select: { id: true },
  });
  if (existing) {
    return loadSealedActivityClusterInputTx(tx, existing.id);
  }
  const review = await tx.reviewAttempt.findUnique({
    where: { id: args.reviewAttemptId },
    include: {
      runEvidences: true,
      diagnosisResult: true,
      chatMessages: true,
      l1MemoryEvents: true,
    },
  });
  if (!review) {
    throw new Error(`review_attempt_not_found:${args.reviewAttemptId}`);
  }
  const reviewMessages = review.chatMessages.filter(
    (message) => message.memoryOrigin === review.memoryOrigin,
  );
  const reviewSequences = reviewMessages.map((message) => message.sequence);
  const defaultSequence =
    reviewSequences.length > 0 ? Math.max(...reviewSequences) : null;
  const previousOwnedMessage = await tx.memoryActivityItem.findFirst({
    where: {
      sourceType: "chat_message",
      activityCluster: { chatSessionId: review.chatSessionId },
      messageSequence: { not: null },
    },
    orderBy: { messageSequence: "desc" },
    select: { messageSequence: true },
  });
  const session = await tx.chatSession.findUniqueOrThrow({
    where: { id: review.chatSessionId },
    select: { clearedBeforeSequence: true },
  });
  const unclaimedStart =
    Math.max(
      previousOwnedMessage?.messageSequence ?? 0,
      session.clearedBeforeSequence,
    ) + 1;
  const startSequence = args.startMessageSequence ?? unclaimedStart;
  const endSequence = args.endMessageSequence ?? defaultSequence;
  if (
    startSequence !== null &&
    endSequence !== null &&
    startSequence > endSequence
  ) {
    throw new Error("activity_message_range_invalid");
  }
  if (
    defaultSequence !== null &&
    (startSequence === null ||
      endSequence === null ||
      defaultSequence < startSequence ||
      defaultSequence > endSequence)
  ) {
    throw new Error("review_reply_outside_activity_message_range");
  }

  const messages =
    startSequence === null || endSequence === null
      ? reviewMessages
      : await tx.chatMessage.findMany({
          where: {
            sessionId: review.chatSessionId,
            memoryOrigin: review.memoryOrigin,
            sequence: { gte: startSequence, lte: endSequence },
          },
          orderBy: { sequence: "asc" },
        });
  const sourceItems: ActivitySourceRef[] = [
    {
      sourceType: "review_attempt",
      sourceId: review.id,
      evidenceRole: "learner_action",
    },
    ...review.runEvidences.map((run) => ({
      sourceType: "run_evidence" as const,
      sourceId: run.id,
      evidenceRole: "execution_evidence" as const,
    })),
    ...(review.diagnosisResult
      ? [
          {
            sourceType: "diagnosis_result" as const,
            sourceId: review.diagnosisResult.id,
            evidenceRole: "diagnosis" as const,
          },
        ]
      : []),
    ...messages.map(messageRef),
    ...review.l1MemoryEvents.map((event) => ({
      sourceType: "l1_event" as const,
      sourceId: event.id,
      evidenceRole: "trace" as const,
    })),
    ...(args.additionalSourceItems ?? []),
  ];

  return sealActivityClusterTx(tx, {
    userId: review.userId,
    problemId: review.problemId,
    chatSessionId: review.chatSessionId,
    rootReviewAttemptId: review.id,
    kind: "review_rooted",
    sourceKey: `review:${review.id}`,
    memoryOrigin: parseMemoryOrigin(review.memoryOrigin),
    sourceItems,
    boundaryReason: "review_persisted",
  });
}

function messageRef(message: { id: string; role: string }): ActivitySourceRef {
  return {
    sourceType: "chat_message",
    sourceId: message.id,
    evidenceRole:
      message.role === "user" ? "learner_action" : "coach_response",
  };
}

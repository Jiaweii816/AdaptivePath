import type { ActivitySourceRef } from "./activity-cluster.types";
import type { ActivityClusterDb, ActivityClusterTx } from "./activity-source";
import { loadSealedActivityClusterInputTx } from "./load-sealed-activity-cluster";
import { sealActivityClusterTx } from "./seal-activity-cluster";

export type SealHistoricalReplayClusterArgs = {
  reviewAttemptId: string;
  /** Only attestations from this replay run may anchor the cluster. */
  replayRunId: string;
};

/**
 * Replayed Reviews stay `legacy_unknown` for auditability, while their approved
 * learner-origin attestation authorizes durable memory over the same activity.
 */
export async function sealHistoricalReplayActivityCluster(
  prisma: ActivityClusterDb,
  args: SealHistoricalReplayClusterArgs,
) {
  return prisma.$transaction((tx) =>
    sealHistoricalReplayActivityClusterTx(tx, args),
  );
}

export async function sealHistoricalReplayActivityClusterTx(
  tx: ActivityClusterTx,
  args: SealHistoricalReplayClusterArgs,
) {
  const existing = await tx.memoryActivityCluster.findUnique({
    where: { rootReviewAttemptId: args.reviewAttemptId },
    select: { id: true },
  });
  if (existing) return loadSealedActivityClusterInputTx(tx, existing.id);

  const review = await loadReviewForHistoricalSealing(tx, args.reviewAttemptId);
  const attestation = findReplayAttestation(review, args.replayRunId);
  const originAttestation = {
    memoryOrigin: "learner" as const,
    eventId: attestation.id,
    reason: "historical_replay_attestation" as const,
  };
  const sourceItems = buildHistoricalSourceItems(review, originAttestation);

  return sealActivityClusterTx(tx, {
    userId: review.userId,
    problemId: review.problemId,
    chatSessionId: review.chatSessionId,
    rootReviewAttemptId: review.id,
    kind: "review_rooted",
    sourceKey: `historical-replay:${args.replayRunId}:${review.id}`,
    memoryOrigin: "learner",
    sourceItems,
    boundaryReason: "historical_replay_backfill",
  });
}

async function loadReviewForHistoricalSealing(
  tx: ActivityClusterTx,
  reviewAttemptId: string,
) {
  const review = await tx.reviewAttempt.findUnique({
    where: { id: reviewAttemptId },
    include: {
      runEvidences: true,
      diagnosisResult: true,
      chatMessages: true,
      l1MemoryEvents: true,
    },
  });
  if (!review) throw new Error(`review_attempt_not_found:${reviewAttemptId}`);
  return review;
}

type HistoricalReview = Awaited<
  ReturnType<typeof loadReviewForHistoricalSealing>
>;

function findReplayAttestation(review: HistoricalReview, replayRunId: string) {
  const attestation = review.l1MemoryEvents.find(
    (event) =>
      event.eventType === "historical_replay_attestation" &&
      event.memoryOrigin === "learner" &&
      readReplayRunId(event.eventJson) === replayRunId,
  );
  if (!attestation) {
    throw new Error(
      `historical_replay_attestation_not_found:${review.id}:${replayRunId}`,
    );
  }
  return attestation;
}

function buildHistoricalSourceItems(
  review: HistoricalReview,
  originAttestation: NonNullable<ActivitySourceRef["originAttestation"]>,
): ActivitySourceRef[] {
  return [
    attestedRef("review_attempt", review.id, "learner_action", originAttestation),
    ...review.runEvidences.map((run) =>
      attestedRef("run_evidence", run.id, "execution_evidence", originAttestation),
    ),
    ...diagnosisRef(review, originAttestation),
    ...review.chatMessages.map((message) =>
      attestedRef(
        "chat_message",
        message.id,
        message.role === "user" ? "learner_action" : "coach_response",
        originAttestation,
      ),
    ),
    { sourceType: "l1_event", sourceId: originAttestation.eventId },
  ];
}

function diagnosisRef(
  review: HistoricalReview,
  originAttestation: NonNullable<ActivitySourceRef["originAttestation"]>,
) {
  return review.diagnosisResult
    ? [
        attestedRef(
          "diagnosis_result",
          review.diagnosisResult.id,
          "diagnosis",
          originAttestation,
        ),
      ]
    : [];
}

function attestedRef(
  sourceType: ActivitySourceRef["sourceType"],
  sourceId: string,
  evidenceRole: NonNullable<ActivitySourceRef["evidenceRole"]>,
  originAttestation: NonNullable<ActivitySourceRef["originAttestation"]>,
): ActivitySourceRef {
  return { sourceType, sourceId, evidenceRole, originAttestation };
}

function readReplayRunId(eventJson: string) {
  try {
    const parsed = JSON.parse(eventJson) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>).replayRunId;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

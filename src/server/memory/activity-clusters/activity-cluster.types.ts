import { z } from "zod";
import type { MemoryOrigin } from "@/server/memory/memory-origin";

export const ACTIVITY_EXTRACTION_VERSION = "activity-memory-v1" as const;

export const activityClusterKindSchema = z.enum([
  "review_rooted",
  "chat_only",
]);
export type ActivityClusterKind = z.infer<typeof activityClusterKindSchema>;

export const activityClusterStatusSchema = z.enum(["sealed"]);
export type ActivityClusterStatus = z.infer<
  typeof activityClusterStatusSchema
>;

/**
 * An activity item names an immutable source record. The vocabulary describes
 * storage lineage, not algorithm knowledge, so it is deliberately independent
 * of problem tags and canonical mechanisms.
 */
export const activitySourceTypeSchema = z.enum([
  "practice_run",
  "chat_message",
  "review_attempt",
  "run_evidence",
  "diagnosis_result",
  "l1_event",
  "code_revision",
]);
export type ActivitySourceType = z.infer<typeof activitySourceTypeSchema>;

export const activityEvidenceRoleSchema = z.enum([
  "learner_action",
  "coach_response",
  "execution_evidence",
  "diagnosis",
  "revision",
  "trace",
]);
export type ActivityEvidenceRole = z.infer<
  typeof activityEvidenceRoleSchema
>;

export const extractionReceiptStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partial",
  "no_semantic_signal",
  "failed",
  "policy_rejected",
]);
export type ExtractionReceiptStatus = z.infer<
  typeof extractionReceiptStatusSchema
>;

export type ActivitySourceRef = {
  sourceType: ActivitySourceType;
  sourceId: string;
  evidenceRole?: ActivityEvidenceRole;
  originAttestation?: {
    memoryOrigin: MemoryOrigin;
    eventId: string;
    reason: "historical_replay_attestation";
  };
};

export type FrozenActivityItem = ActivitySourceRef & {
  id: string;
  ordinal: number;
  role: string | null;
  occurredAt: Date;
  messageSequence: number | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  /**
   * Source payload captured from the immutable historical row. `undefined`
   * means the source kind is intentionally unsupported; callers must never
   * replace it with the current mutable CodeDraft.
   */
  payload?: Record<string, unknown>;
};

export type SealedActivityClusterInput = {
  cluster: {
    id: string;
    userId: string;
    problemId: string | null;
    chatSessionId: string | null;
    rootReviewAttemptId: string | null;
    kind: ActivityClusterKind;
    status: ActivityClusterStatus;
    sourceKey: string;
    memoryOrigin: MemoryOrigin;
    startedAt: Date;
    endedAt: Date | null;
  };
  messageRange: {
    startSequence: number | null;
    endSequence: number | null;
  };
  items: FrozenActivityItem[];
  /** Stable digest of the frozen cluster manifest and immutable source rows. */
  inputHash: string;
  /** Every run remains visible, but the whole cluster is one evidence unit. */
  independentEvidenceKey: string;
  independentEvidenceUnitCount: 1;
};

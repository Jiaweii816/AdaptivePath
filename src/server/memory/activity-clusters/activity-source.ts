import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  activitySourceTypeSchema,
  type ActivityEvidenceRole,
  type ActivitySourceRef,
  type ActivitySourceType,
} from "./activity-cluster.types";

export type ActivityClusterDb = Pick<
  PrismaClient,
  | "practiceRunLog"
  | "chatMessage"
  | "reviewAttempt"
  | "runEvidence"
  | "diagnosisResult"
  | "l1MemoryEvent"
  | "chatSession"
  | "memoryActivityCluster"
  | "memoryActivityItem"
  | "memoryExtractionReceipt"
  | "$transaction"
>;

export type ActivityClusterTx = Prisma.TransactionClient;

export type ResolvedActivitySource = ActivitySourceRef & {
  userId: string;
  problemId: string | null;
  chatSessionId: string | null;
  memoryOrigin: string | null;
  role: string | null;
  occurredAt: Date;
  messageSequence: number | null;
  contentHash: string;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
};

export async function resolveActivitySource(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
): Promise<ResolvedActivitySource> {
  const sourceType = activitySourceTypeSchema.parse(ref.sourceType);
  switch (sourceType) {
    case "practice_run":
      return resolvePracticeRun(db, ref);
    case "chat_message":
      return resolveChatMessage(db, ref);
    case "review_attempt":
      return resolveReviewAttempt(db, ref);
    case "run_evidence":
      return resolveRunEvidence(db, ref);
    case "diagnosis_result":
      return resolveDiagnosis(db, ref);
    case "l1_event":
      return resolveL1Event(db, ref);
    case "code_revision":
      throw new ActivityClusterSourceError(
        ref,
        "code_revision_source_not_available",
      );
  }
}

async function resolvePracticeRun(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
) {
  const row = await db.practiceRunLog.findUnique({ where: { id: ref.sourceId } });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const payload = {
    language: row.language,
    codeSnapshot: row.codeSnapshot,
    codeHash: row.codeHash,
    executionFingerprint: row.executionFingerprint,
    runOrdinal: row.runOrdinal,
    selectedTestCaseIds: parseJson(row.selectedTestCaseIds),
    status: row.status,
    passedCount: row.passedCount,
    totalCount: row.totalCount,
    summary: row.summary,
    provider: row.provider,
    rawResult: parseJson(row.rawResultJson),
    durationMs: row.durationMs,
  };
  return resolved(ref, {
    userId: row.userId,
    problemId: row.problemId,
    chatSessionId: null,
    // PracticeRunLog predates row-level memory origin. Cluster wiring must
    // supply the origin; this limitation stays explicit in the receipt input.
    memoryOrigin: null,
    role: "learner",
    occurredAt: row.createdAt,
    messageSequence: null,
    metadata: { originVerification: "unavailable_on_source" },
    payload,
  });
}

async function resolveChatMessage(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
) {
  const row = await db.chatMessage.findUnique({
    where: { id: ref.sourceId },
    include: { session: true },
  });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const payload = {
    role: row.role,
    contentMarkdown: row.contentMarkdown,
    sequence: row.sequence,
    metadata: parseJson(row.metadataJson),
    reviewAttemptId: row.reviewAttemptId,
  };
  return resolved(ref, {
    userId: row.session.userId,
    problemId: row.session.problemId,
    chatSessionId: row.sessionId,
    memoryOrigin: row.memoryOrigin,
    role: row.role,
    occurredAt: row.createdAt,
    messageSequence: row.sequence,
    metadata: {},
    payload,
  });
}

async function resolveReviewAttempt(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
) {
  const row = await db.reviewAttempt.findUnique({ where: { id: ref.sourceId } });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const payload = {
    language: row.language,
    userState: row.userState,
    userQuestion: row.userQuestion,
    codeSnapshot: row.codeSnapshot,
    selectedTestCaseIds: parseJson(row.selectedTestCaseIds),
    selectedTests: parseJson(row.selectedTestsJson),
    coachReplyMarkdown: row.coachReplyMarkdown,
  };
  return resolved(ref, {
    userId: row.userId,
    problemId: row.problemId,
    chatSessionId: row.chatSessionId,
    memoryOrigin: row.memoryOrigin,
    role: "learner",
    occurredAt: row.createdAt,
    messageSequence: null,
    metadata: {},
    payload,
  });
}

async function resolveRunEvidence(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
) {
  const row = await db.runEvidence.findUnique({
    where: { id: ref.sourceId },
    include: { reviewAttempt: true, chatSession: true },
  });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const owner = row.reviewAttempt ?? row.chatSession;
  if (!owner) throw new ActivityClusterSourceError(ref, "source_has_no_owner");
  const payload = {
    source: row.source,
    toolCallId: row.toolCallId,
    codeHash: row.codeHash,
    executionFingerprint: row.executionFingerprint,
    status: row.status,
    passedCount: row.passedCount,
    failedCount: row.failedCount,
    durationMs: row.durationMs,
    stdout: row.stdout,
    stderr: row.stderr,
    actualOutput: row.actualOutput,
    expectedOutput: row.expectedOutput,
    firstFailedCase: parseJson(row.firstFailedCaseJson),
    rawResult: parseJson(row.rawResultJson),
  };
  return resolved(ref, {
    userId: owner.userId,
    problemId: owner.problemId,
    chatSessionId: row.chatSessionId,
    memoryOrigin: row.memoryOrigin,
    role: row.source === "review" ? "learner" : null,
    occurredAt: row.createdAt,
    messageSequence: null,
    metadata: {},
    payload,
  });
}

async function resolveDiagnosis(
  db: ActivityClusterTx,
  ref: ActivitySourceRef,
) {
  const row = await db.diagnosisResult.findUnique({
    where: { id: ref.sourceId },
    include: { reviewAttempt: true },
  });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const payload = {
    diagnosis: parseJson(row.diagnosisJson),
    memoryUpdateCandidate: parseJson(row.memoryUpdateCandidateJson),
    mistakeTags: parseJson(row.mistakeTags),
    skillTags: parseJson(row.skillTags),
    userIssueSummary: row.userIssueSummary,
    coachSummary: row.coachSummary,
    selfCheckQuestion: row.selfCheckQuestion,
    selfCheckAnswer: row.selfCheckAnswer,
  };
  return resolved(ref, {
    userId: row.reviewAttempt.userId,
    problemId: row.reviewAttempt.problemId,
    chatSessionId: row.reviewAttempt.chatSessionId,
    memoryOrigin: row.reviewAttempt.memoryOrigin,
    role: "assistant",
    occurredAt: row.createdAt,
    messageSequence: null,
    metadata: {},
    payload,
  });
}

async function resolveL1Event(db: ActivityClusterTx, ref: ActivitySourceRef) {
  const row = await db.l1MemoryEvent.findUnique({ where: { id: ref.sourceId } });
  if (!row) throw new ActivityClusterSourceError(ref, "source_not_found");
  const payload = {
    eventType: row.eventType,
    event: parseJson(row.eventJson),
    content: row.content,
    source: row.source,
    traceRunId: row.traceRunId,
    reviewAttemptId: row.reviewAttemptId,
  };
  return resolved(ref, {
    userId: row.userId,
    problemId: row.problemId,
    chatSessionId: row.chatSessionId,
    memoryOrigin: row.memoryOrigin,
    role: eventRole(row.eventType),
    occurredAt: row.occurredAt,
    messageSequence: readMessageSequence(row.eventJson),
    metadata: {},
    payload,
  });
}

function resolved(
  ref: ActivitySourceRef,
  value: Omit<
    ResolvedActivitySource,
    "sourceType" | "sourceId" | "evidenceRole" | "contentHash"
  > & { payload: Record<string, unknown> },
): ResolvedActivitySource {
  return {
    ...ref,
    ...value,
    evidenceRole: ref.evidenceRole ?? defaultEvidenceRole(ref.sourceType),
    contentHash: sha256(stableStringify(value.payload)),
  };
}

function defaultEvidenceRole(
  sourceType: ActivitySourceType,
): ActivityEvidenceRole {
  switch (sourceType) {
    case "practice_run":
    case "review_attempt":
      return "learner_action";
    case "chat_message":
      return "learner_action";
    case "run_evidence":
      return "execution_evidence";
    case "diagnosis_result":
      return "diagnosis";
    case "l1_event":
      return "trace";
    case "code_revision":
      return "revision";
  }
}

function eventRole(eventType: string) {
  if (eventType === "chat_user_message") return "user";
  if (eventType === "chat_reply" || eventType === "coach_reply") {
    return "assistant";
  }
  return null;
}

function readMessageSequence(value: string) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const sequence = (parsed as Record<string, unknown>).sequence;
  return typeof sequence === "number" && Number.isInteger(sequence)
    ? sequence
    : null;
}

export function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { unavailable: "invalid_json", rawHash: sha256(value) };
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class ActivityClusterSourceError extends Error {
  constructor(
    readonly source: Pick<ActivitySourceRef, "sourceType" | "sourceId">,
    readonly reason: string,
  ) {
    super(`${reason}:${source.sourceType}:${source.sourceId}`);
    this.name = "ActivityClusterSourceError";
  }
}

import type { L1MemoryEvent, PrismaClient } from "@prisma/client";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import {
  ASSISTED_REPAIR_CHAIN_EVENT_SOURCE,
  ASSISTED_REPAIR_CHAIN_EVENT_TYPE,
  assistedRepairChainClosedPayloadSchema,
  type AssistedRepairChainClosedPayload,
} from "./assisted-repair-contract";

type RepairVerificationPrisma = Pick<
  PrismaClient,
  | "l1MemoryEvent"
  | "practiceRunLog"
  | "chatMessage"
  | "runEvidence"
>;

export type VerifiedAssistedRepairChain = {
  chainEvent: L1MemoryEvent;
  payload: AssistedRepairChainClosedPayload;
  userId: string;
  problemId: string;
  chatSessionId: string;
  reviewAttemptId: string;
  problemTitle: string;
  problemTags: string[];
  failed: {
    code: string;
    status: string;
    resultSummary: string;
  };
  userQuestion: string;
  coachReply: string;
  passed: {
    code: string;
    status: "passed_visible_tests";
    resultSummary: string;
  };
  sourceTraceIds: string[];
};

export async function verifyAssistedRepairChainClosedEvent(
  prisma: RepairVerificationPrisma,
  chainEventId: string,
): Promise<VerifiedAssistedRepairChain> {
  const chainEvent = await prisma.l1MemoryEvent.findUnique({
    where: { id: chainEventId },
  });
  if (!chainEvent) throw invalid("missing_chain_event");
  if (
    chainEvent.eventType !== ASSISTED_REPAIR_CHAIN_EVENT_TYPE ||
    chainEvent.source !== ASSISTED_REPAIR_CHAIN_EVENT_SOURCE
  ) {
    throw invalid("invalid_chain_event_identity");
  }
  if (
    chainEvent.memoryOrigin !== "learner" ||
    !chainEvent.problemId ||
    !chainEvent.chatSessionId ||
    !chainEvent.reviewAttemptId
  ) {
    throw invalid("invalid_chain_event_scope");
  }
  const parsed = assistedRepairChainClosedPayloadSchema.safeParse(
    parseJson(chainEvent.eventJson),
  );
  if (!parsed.success) throw invalid("invalid_chain_payload");
  const payload = parsed.data;

  const [failure, userMessage, assistantMessage, passedRun, userTrace, assistantTrace] =
    await Promise.all([
      prisma.practiceRunLog.findUnique({
        where: { id: payload.failedPracticeRunLogId },
      }),
      prisma.chatMessage.findUnique({
        where: { id: payload.userChatMessageId },
        include: { session: { include: { problem: true } } },
      }),
      prisma.chatMessage.findUnique({
        where: { id: payload.assistantChatMessageId },
      }),
      prisma.runEvidence.findUnique({
        where: { id: payload.passedRunEvidenceId },
        include: { reviewAttempt: true },
      }),
      prisma.l1MemoryEvent.findUnique({ where: { id: payload.userChatTraceId } }),
      prisma.l1MemoryEvent.findUnique({
        where: { id: payload.assistantChatTraceId },
      }),
    ]);

  if (!failure?.codeSnapshot?.trim()) throw invalid("missing_failed_code_snapshot");
  if (!userMessage || !assistantMessage || !passedRun?.reviewAttempt) {
    throw invalid("missing_chain_relation");
  }
  if (!userTrace || !assistantTrace) throw invalid("missing_chat_trace_lineage");

  const identity = {
    userId: chainEvent.userId,
    problemId: chainEvent.problemId,
    chatSessionId: chainEvent.chatSessionId,
    memoryOrigin: chainEvent.memoryOrigin,
  };
  if (
    failure.userId !== identity.userId ||
    failure.problemId !== identity.problemId ||
    failure.language !== "Python" ||
    userMessage.sessionId !== identity.chatSessionId ||
    assistantMessage.sessionId !== identity.chatSessionId ||
    userMessage.memoryOrigin !== identity.memoryOrigin ||
    assistantMessage.memoryOrigin !== identity.memoryOrigin ||
    userMessage.role !== "user" ||
    assistantMessage.role !== "assistant" ||
    userMessage.sequence >= assistantMessage.sequence ||
    userMessage.session.userId !== identity.userId ||
    userMessage.session.problemId !== identity.problemId ||
    userMessage.session.memoryOrigin !== identity.memoryOrigin ||
    passedRun.reviewAttempt.id !== chainEvent.reviewAttemptId ||
    passedRun.reviewAttempt.userId !== identity.userId ||
    passedRun.reviewAttempt.problemId !== identity.problemId ||
    passedRun.reviewAttempt.chatSessionId !== identity.chatSessionId ||
    passedRun.reviewAttempt.memoryOrigin !== identity.memoryOrigin ||
    passedRun.memoryOrigin !== identity.memoryOrigin ||
    passedRun.source !== "review" ||
    passedRun.reviewAttempt.language !== "Python"
  ) {
    throw invalid("chain_relation_scope_mismatch");
  }

  assertChatTrace(userTrace, {
    ...identity,
    eventType: "chat_user_message",
    messageId: userMessage.id,
  });
  assertChatTrace(assistantTrace, {
    ...identity,
    eventType: "chat_reply",
    messageId: assistantMessage.id,
  });

  const failedCodeHash = hashCodeForRun({
    language: "Python",
    code: failure.codeSnapshot,
  });
  const failedFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: failure.codeSnapshot,
  });
  const passedCodeHash = hashCodeForRun({
    language: "Python",
    code: passedRun.reviewAttempt.codeSnapshot,
  });
  const passedFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: passedRun.reviewAttempt.codeSnapshot,
  });
  if (
    failure.codeHash !== failedCodeHash ||
    failure.executionFingerprint !== failedFingerprint ||
    payload.failedCodeHash !== failedCodeHash ||
    payload.failedExecutionFingerprint !== failedFingerprint ||
    passedRun.codeHash !== passedCodeHash ||
    passedRun.executionFingerprint !== passedFingerprint ||
    payload.passedCodeHash !== passedCodeHash ||
    payload.passedExecutionFingerprint !== passedFingerprint ||
    failedFingerprint === passedFingerprint
  ) {
    throw invalid("chain_revision_mismatch");
  }

  const failureVerdict = readStoredVerdict(failure.rawResultJson);
  const passedVerdict = readStoredVerdict(passedRun.rawResultJson);
  if (
    !FAILURE_STATUSES.has(failure.status) ||
    failure.provider.trim().toLowerCase() === "mock" ||
    !failureVerdict ||
    failureVerdict.status !== failure.status ||
    failureVerdict.providerUsed !== failure.provider ||
    failureVerdict.canVerdict !== true ||
    passedRun.status !== "passed_visible_tests" ||
    !passedVerdict ||
    passedVerdict.status !== "passed_visible_tests" ||
    passedVerdict.canVerdict !== true ||
    passedVerdict.providerUsed?.toLowerCase() === "mock" ||
    passedVerdict.evidenceClass !== payload.evidenceScope.evidenceClass ||
    passedVerdict.providerUsed !== payload.evidenceScope.providerUsed
  ) {
    throw invalid("chain_execution_evidence_mismatch");
  }

  assertWorkspaceAlignment(userMessage.metadataJson, failure, payload);
  assertWorkspaceAlignment(assistantMessage.metadataJson, failure, payload);
  assertWorkspaceAlignment(userTrace.eventJson, failure, payload);
  assertWorkspaceAlignment(assistantTrace.eventJson, failure, payload);

  const failedScope = normalizedIds(parseStringArray(failure.selectedTestCaseIds));
  const payloadScope = normalizedIds(payload.selectedTestCaseIds);
  const passedScope = new Set(
    normalizedIds(parseStringArray(passedRun.reviewAttempt.selectedTestCaseIds)),
  );
  if (
    failedScope.length === 0 ||
    JSON.stringify(failedScope) !== JSON.stringify(payloadScope) ||
    (passedVerdict.evidenceClass === "local_only" &&
      failedScope.some((id) => !passedScope.has(id)))
  ) {
    throw invalid("chain_test_scope_mismatch");
  }

  if (
    failure.createdAt >= userMessage.createdAt ||
    userMessage.createdAt > assistantMessage.createdAt ||
    assistantMessage.createdAt >= passedRun.reviewAttempt.createdAt ||
    passedRun.createdAt > chainEvent.occurredAt
  ) {
    throw invalid("chain_temporal_order_mismatch");
  }

  const passedRunTrace = await prisma.l1MemoryEvent.findFirst({
    where: {
      userId: identity.userId,
      problemId: identity.problemId,
      chatSessionId: identity.chatSessionId,
      reviewAttemptId: chainEvent.reviewAttemptId,
      eventType: "run_evidence",
      source: "review_pipeline",
      memoryOrigin: "learner",
    },
  });
  if (
    !passedRunTrace ||
    readString(parseRecord(passedRunTrace.eventJson).runEvidenceId) !== passedRun.id
  ) {
    throw invalid("missing_passed_review_trace");
  }

  return {
    chainEvent,
    payload,
    ...identity,
    reviewAttemptId: chainEvent.reviewAttemptId,
    problemTitle: userMessage.session.problem.title,
    problemTags: parseStringArray(userMessage.session.problem.tags),
    failed: {
      code: failure.codeSnapshot,
      status: failure.status,
      resultSummary: summarizeRun(failure),
    },
    userQuestion: userMessage.contentMarkdown,
    coachReply: assistantMessage.contentMarkdown,
    passed: {
      code: passedRun.reviewAttempt.codeSnapshot,
      status: "passed_visible_tests",
      resultSummary: summarizeRun(passedRun),
    },
    sourceTraceIds: [
      chainEvent.id,
      userTrace.id,
      assistantTrace.id,
      passedRunTrace.id,
    ],
  };
}

const FAILURE_STATUSES = new Set([
  "failed",
  "compile_error",
  "syntax_error",
  "runtime_error",
  "timeout",
]);

function assertChatTrace(
  event: L1MemoryEvent,
  expected: {
    userId: string;
    problemId: string;
    chatSessionId: string;
    memoryOrigin: string;
    eventType: string;
    messageId: string;
  },
) {
  if (
    event.userId !== expected.userId ||
    event.problemId !== expected.problemId ||
    event.chatSessionId !== expected.chatSessionId ||
    event.memoryOrigin !== expected.memoryOrigin ||
    event.eventType !== expected.eventType ||
    readString(parseRecord(event.eventJson).chatMessageId) !== expected.messageId
  ) {
    throw invalid("chat_trace_lineage_mismatch");
  }
}

function assertWorkspaceAlignment(
  json: string,
  failure: { id: string; status: string; codeHash: string | null; executionFingerprint: string | null },
  payload: AssistedRepairChainClosedPayload,
) {
  const root = parseRecord(json);
  const workspace = asRecord(root.workspace);
  if (
    readString(workspace?.currentCodeHash) !== payload.failedCodeHash ||
    readString(workspace?.currentExecutionFingerprint) !==
      payload.failedExecutionFingerprint ||
    readString(workspace?.latestAuthoritativeRunEvidenceId) !== failure.id ||
    readString(workspace?.latestAuthoritativeRunSource) !== "practice_run" ||
    readString(workspace?.latestAuthoritativeRunStatus) !== failure.status
  ) {
    throw invalid("chat_workspace_revision_mismatch");
  }
}

function readStoredVerdict(value: string) {
  const root = parseRecord(value);
  const rawResult = asRecord(root.rawResult);
  const verdict = asRecord(rawResult?.evidenceVerdict) ?? asRecord(root.evidenceVerdict);
  const capabilities = asRecord(verdict?.capabilities);
  const status = readString(verdict?.status);
  const evidenceClass = readString(verdict?.evidenceClass);
  const providerUsed = readString(verdict?.providerUsed);
  if (!status || !evidenceClass || !providerUsed) return undefined;
  return {
    status,
    evidenceClass,
    providerUsed,
    canVerdict: capabilities?.canVerdict,
  };
}

function summarizeRun(run: {
  status: string;
  passedCount: number;
  rawResultJson: string;
}) {
  const root = parseRecord(run.rawResultJson);
  const failedCount =
    typeof root.failedCount === "number" ? root.failedCount : undefined;
  const firstFailed = asRecord(root.firstFailedCase);
  return [
    `status=${run.status}`,
    `passed=${run.passedCount}`,
    failedCount === undefined ? undefined : `failed=${failedCount}`,
    firstFailed ? `firstFailedCase=${JSON.stringify(firstFailed).slice(0, 600)}` : undefined,
  ]
    .filter(Boolean)
    .join("; ");
}

function normalizedIds(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
}

function parseStringArray(value: string) {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseRecord(value: string) {
  return asRecord(parseJson(value)) ?? {};
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function invalid(reason: string) {
  return new Error(`invalid_assisted_repair_chain:${reason}`);
}

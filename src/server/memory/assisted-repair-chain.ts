import { createHash } from "node:crypto";

export const ASSISTED_REPAIR_CHAIN_SOURCE =
  "review_pipeline:assisted_repair_matcher" as const;

type ChainIdentity = {
  userId: string;
  problemId: string;
  language: string;
  memoryOrigin: string;
};

export type FailedPracticeRunCandidate = ChainIdentity & {
  id: string;
  createdAt: Date | string;
  source: string;
  userTriggered: boolean;
  providerUsed: string | null;
  status: string;
  codeHash: string | null;
  executionFingerprint: string | null;
  selectedTestCaseIds: readonly string[];
  firstFailedCaseId?: string | null;
};

export type RepairChatMessage = ChainIdentity & {
  id: string;
  traceId: string;
  chatSessionId: string;
  createdAt: Date | string;
  currentCodeHash: string | null;
  currentExecutionFingerprint: string | null;
  latestAuthoritativeRunEvidenceId: string | null;
  latestAuthoritativeRunSource: string | null;
  latestAuthoritativeRunStatus: string | null;
};

export type RepairChatPair = {
  user: RepairChatMessage & { role: "user" };
  assistant: RepairChatMessage & { role: "assistant" };
};

export type PassingRunCandidate = ChainIdentity & {
  endpoint: "review" | "practice_run";
  userTriggered: boolean;
  createdAt: Date | string;
  status: string;
  codeHash: string | null;
  executionFingerprint: string | null;
  selectedTestCaseIds: readonly string[];
  evidenceScope: {
    evidenceClass: string;
    providerUsed: string | null;
  };
};

export type AssistedRepairChain = {
  version: 1;
  source: typeof ASSISTED_REPAIR_CHAIN_SOURCE;
  passedEndpoint: "review" | "practice_run";
  repairKey: string;
  failedPracticeRunLogId: string;
  userChatMessageId: string;
  userChatTraceId: string;
  assistantChatMessageId: string;
  assistantChatTraceId: string;
  failedExecutionFingerprint: string;
  passedExecutionFingerprint: string;
  failedCodeHash: string;
  passedCodeHash: string;
  selectedTestCaseIds: string[];
  evidenceScope: {
    evidenceClass: string;
    providerUsed: string;
  };
};

export function matchAssistedRepairChain(input: {
  failedPracticeRuns: readonly FailedPracticeRunCandidate[];
  chatPairs: readonly RepairChatPair[];
  passingRun: PassingRunCandidate;
}): AssistedRepairChain | undefined {
  if (!isValidPassingRun(input.passingRun)) return undefined;

  const failures = [...input.failedPracticeRuns]
    .filter((run) => isValidFailure(run, input.passingRun))
    .sort(compareNewestFirst);

  for (const failure of failures) {
    const pair = [...input.chatPairs]
      .filter((candidate) => isAlignedPair(failure, candidate, input.passingRun))
      .sort((left, right) => compareNewestFirst(left.assistant, right.assistant))[0];
    if (!pair) continue;

    const failedExecutionFingerprint = failure.executionFingerprint!;
    const passedExecutionFingerprint = input.passingRun.executionFingerprint!;
    const failedCodeHash = failure.codeHash!;
    const passedCodeHash = input.passingRun.codeHash!;
    const evidenceScope = {
      evidenceClass: input.passingRun.evidenceScope.evidenceClass,
      providerUsed: input.passingRun.evidenceScope.providerUsed!,
    };
    const keyMaterial = [
      1,
      failure.id,
      pair.user.id,
      pair.user.traceId,
      pair.assistant.id,
      pair.assistant.traceId,
      failedExecutionFingerprint,
      passedExecutionFingerprint,
      ...normalizedIds(failure.selectedTestCaseIds),
      evidenceScope.evidenceClass,
      evidenceScope.providerUsed,
    ];

    return {
      version: 1,
      source: ASSISTED_REPAIR_CHAIN_SOURCE,
      passedEndpoint: input.passingRun.endpoint,
      repairKey: `repair:v1:${createHash("sha256")
        .update(JSON.stringify(keyMaterial))
        .digest("hex")}`,
      failedPracticeRunLogId: failure.id,
      userChatMessageId: pair.user.id,
      userChatTraceId: pair.user.traceId,
      assistantChatMessageId: pair.assistant.id,
      assistantChatTraceId: pair.assistant.traceId,
      failedExecutionFingerprint,
      passedExecutionFingerprint,
      failedCodeHash,
      passedCodeHash,
      selectedTestCaseIds: normalizedIds(failure.selectedTestCaseIds),
      evidenceScope,
    };
  }

  return undefined;
}

const VALID_FAILURE_STATUSES = new Set([
  "failed",
  "compile_error",
  "syntax_error",
  "runtime_error",
  "timeout",
]);
const EXCLUDED_STATUSES = new Set([
  "runner_error",
  "no_tests",
  "unsupported_language",
  "empty_code",
]);

function isValidFailure(
  run: FailedPracticeRunCandidate,
  pass: PassingRunCandidate,
) {
  return (
    sameIdentity(run, pass) &&
    run.source === "practice_run" &&
    run.userTriggered === true &&
    Boolean(run.id && run.codeHash && run.executionFingerprint) &&
    VALID_FAILURE_STATUSES.has(run.status) &&
    !EXCLUDED_STATUSES.has(run.status) &&
    !isMockProvider(run.providerUsed) &&
    toMillis(run.createdAt) < toMillis(pass.createdAt) &&
    run.executionFingerprint !== pass.executionFingerprint &&
    finalScopeCoversFailure(run, pass)
  );
}

function isValidPassingRun(pass: PassingRunCandidate) {
  return (
    (pass.endpoint === "review" || pass.endpoint === "practice_run") &&
    pass.userTriggered === true &&
    pass.status === "passed_visible_tests" &&
    Boolean(
      pass.userId &&
        pass.problemId &&
        pass.language &&
        pass.memoryOrigin &&
        pass.codeHash &&
        pass.executionFingerprint &&
        pass.evidenceScope.evidenceClass &&
        pass.evidenceScope.providerUsed,
    ) &&
    !isMockProvider(pass.evidenceScope.providerUsed) &&
    (pass.evidenceScope.evidenceClass === "verdict_bearing" ||
      pass.evidenceScope.evidenceClass === "local_only") &&
    Number.isFinite(toMillis(pass.createdAt))
  );
}

function isAlignedPair(
  failure: FailedPracticeRunCandidate,
  pair: RepairChatPair,
  pass: PassingRunCandidate,
) {
  const { user, assistant } = pair;
  const failAt = toMillis(failure.createdAt);
  const userAt = toMillis(user.createdAt);
  const assistantAt = toMillis(assistant.createdAt);
  const passAt = toMillis(pass.createdAt);
  return (
    sameIdentity(failure, user) &&
    sameIdentity(failure, assistant) &&
    user.chatSessionId === assistant.chatSessionId &&
    Boolean(user.traceId && assistant.traceId) &&
    user.currentCodeHash === failure.codeHash &&
    assistant.currentCodeHash === failure.codeHash &&
    user.currentExecutionFingerprint === failure.executionFingerprint &&
    assistant.currentExecutionFingerprint === failure.executionFingerprint &&
    user.latestAuthoritativeRunEvidenceId === failure.id &&
    assistant.latestAuthoritativeRunEvidenceId === failure.id &&
    user.latestAuthoritativeRunSource === "practice_run" &&
    assistant.latestAuthoritativeRunSource === "practice_run" &&
    user.latestAuthoritativeRunStatus === failure.status &&
    assistant.latestAuthoritativeRunStatus === failure.status &&
    failAt < userAt &&
    userAt < assistantAt &&
    assistantAt < passAt
  );
}

function finalScopeCoversFailure(
  failure: FailedPracticeRunCandidate,
  pass: PassingRunCandidate,
) {
  if (pass.evidenceScope.evidenceClass === "verdict_bearing") return true;
  if (pass.evidenceScope.evidenceClass !== "local_only") return false;

  const failureIds = normalizedIds(failure.selectedTestCaseIds);
  if (failure.firstFailedCaseId) failureIds.push(failure.firstFailedCaseId);
  const requiredIds = [...new Set(failureIds)];
  if (requiredIds.length === 0) return false;
  const passedIds = new Set(normalizedIds(pass.selectedTestCaseIds));
  return requiredIds.every((id) => passedIds.has(id));
}

function sameIdentity(left: ChainIdentity, right: ChainIdentity) {
  return (
    Boolean(left.userId && left.problemId && left.language && left.memoryOrigin) &&
    left.userId === right.userId &&
    left.problemId === right.problemId &&
    left.language === right.language &&
    left.memoryOrigin === right.memoryOrigin
  );
}

function isMockProvider(provider: string | null) {
  return provider?.trim().toLowerCase() === "mock";
}

function normalizedIds(ids: readonly string[]) {
  return [...new Set(ids.filter((id) => id.trim()).map((id) => id.trim()))].sort();
}

function compareNewestFirst(
  left: { id: string; createdAt: Date | string },
  right: { id: string; createdAt: Date | string },
) {
  return toMillis(right.createdAt) - toMillis(left.createdAt) ||
    right.id.localeCompare(left.id);
}

function toMillis(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

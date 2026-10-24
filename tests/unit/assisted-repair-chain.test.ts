import { describe, expect, it } from "vitest";
import {
  ASSISTED_REPAIR_CHAIN_SOURCE,
  matchAssistedRepairChain,
  type FailedPracticeRunCandidate,
  type PassingRunCandidate,
  type RepairChatPair,
} from "@/server/memory/assisted-repair-chain";

const identity = {
  userId: "user-1",
  problemId: "problem-35",
  language: "Python",
  memoryOrigin: "learner",
};

function failure(
  overrides: Partial<FailedPracticeRunCandidate> = {},
): FailedPracticeRunCandidate {
  return {
    ...identity,
    id: "practice-fail-1",
    createdAt: "2026-07-20T10:00:00.000Z",
    source: "practice_run",
    userTriggered: true,
    providerUsed: "local_hot150",
    status: "failed",
    codeHash: "sha256:failed-code",
    executionFingerprint: "execfp:v1:failed-code",
    selectedTestCaseIds: ["case-1", "case-2"],
    firstFailedCaseId: "case-2",
    ...overrides,
  };
}

function chatPair(
  failed = failure(),
  overrides: {
    user?: Partial<RepairChatPair["user"]>;
    assistant?: Partial<RepairChatPair["assistant"]>;
  } = {},
): RepairChatPair {
  const workspace = {
    ...identity,
    chatSessionId: "chat-1",
    currentCodeHash: failed.codeHash,
    currentExecutionFingerprint: failed.executionFingerprint,
    latestAuthoritativeRunEvidenceId: failed.id,
    latestAuthoritativeRunSource: "practice_run",
    latestAuthoritativeRunStatus: failed.status,
  };
  return {
    user: {
      ...workspace,
      id: `user-message-${failed.id}`,
      traceId: `user-trace-${failed.id}`,
      role: "user",
      createdAt: new Date(new Date(failed.createdAt).getTime() + 1_000),
      ...overrides.user,
    },
    assistant: {
      ...workspace,
      id: `assistant-message-${failed.id}`,
      traceId: `assistant-trace-${failed.id}`,
      role: "assistant",
      createdAt: new Date(new Date(failed.createdAt).getTime() + 2_000),
      ...overrides.assistant,
    },
  };
}

function passingRun(
  overrides: Partial<PassingRunCandidate> = {},
): PassingRunCandidate {
  return {
    ...identity,
    endpoint: "review",
    userTriggered: true,
    createdAt: "2026-07-20T10:05:00.000Z",
    status: "passed_visible_tests",
    codeHash: "sha256:passed-code",
    executionFingerprint: "execfp:v1:passed-code",
    selectedTestCaseIds: ["case-1", "case-2", "case-3"],
    evidenceScope: {
      evidenceClass: "local_only",
      providerUsed: "local_hot150",
    },
    ...overrides,
  };
}

describe("matchAssistedRepairChain", () => {
  it("closes an exactly aligned fail -> chat pair -> changed passing Review chain", () => {
    const failed = failure();
    const chain = matchAssistedRepairChain({
      failedPracticeRuns: [failed],
      chatPairs: [chatPair(failed)],
      passingRun: passingRun(),
    });

    expect(chain).toMatchObject({
      version: 1,
      source: ASSISTED_REPAIR_CHAIN_SOURCE,
      failedPracticeRunLogId: failed.id,
      userChatMessageId: `user-message-${failed.id}`,
      userChatTraceId: `user-trace-${failed.id}`,
      assistantChatMessageId: `assistant-message-${failed.id}`,
      assistantChatTraceId: `assistant-trace-${failed.id}`,
      failedExecutionFingerprint: failed.executionFingerprint,
      passedExecutionFingerprint: "execfp:v1:passed-code",
      selectedTestCaseIds: ["case-1", "case-2"],
      evidenceScope: {
        evidenceClass: "local_only",
        providerUsed: "local_hot150",
      },
    });
    expect(chain?.repairKey).toMatch(/^repair:v1:[a-f0-9]{64}$/);
  });

  it("also closes on a user-triggered changed Practice pass without making an L2 claim", () => {
    const failed = failure();
    const chain = matchAssistedRepairChain({
      failedPracticeRuns: [failed],
      chatPairs: [chatPair(failed)],
      passingRun: passingRun({ endpoint: "practice_run" }),
    });

    expect(chain).toMatchObject({
      version: 1,
      passedEndpoint: "practice_run",
      failedPracticeRunLogId: failed.id,
    });
    expect(chain).not.toHaveProperty("eligibleForL2");
  });

  it("chooses the newest failure that has an exact aligned pair", () => {
    const oldFailure = failure({ id: "practice-old" });
    const newestFailure = failure({
      id: "practice-newest",
      createdAt: "2026-07-20T10:02:00.000Z",
      codeHash: "sha256:newest-fail",
      executionFingerprint: "execfp:v1:newest-fail",
      selectedTestCaseIds: ["case-2"],
    });

    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [oldFailure, newestFailure],
        chatPairs: [chatPair(oldFailure), chatPair(newestFailure)],
        passingRun: passingRun(),
      })?.failedPracticeRunLogId,
    ).toBe("practice-newest");
  });

  it("skips a newer unaligned failure and selects the newest exactly aligned one", () => {
    const aligned = failure({ id: "practice-aligned" });
    const unaligned = failure({
      id: "practice-unaligned",
      createdAt: "2026-07-20T10:02:00.000Z",
      codeHash: "sha256:unaligned",
      executionFingerprint: "execfp:v1:unaligned",
    });

    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [aligned, unaligned],
        chatPairs: [chatPair(aligned)],
        passingRun: passingRun(),
      })?.failedPracticeRunLogId,
    ).toBe("practice-aligned");
  });

  it("rejects a chat revision mismatch", () => {
    const failed = failure();
    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [failed],
        chatPairs: [
          chatPair(failed, {
            assistant: {
              currentExecutionFingerprint: "execfp:v1:different",
            },
          }),
        ],
        passingRun: passingRun(),
      }),
    ).toBeUndefined();
  });

  it("rejects a latest evidence id mismatch", () => {
    const failed = failure();
    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [failed],
        chatPairs: [
          chatPair(failed, {
            user: { latestAuthoritativeRunEvidenceId: "other-run" },
          }),
        ],
        passingRun: passingRun(),
      }),
    ).toBeUndefined();
  });

  it("rejects a passing Review of the same revision", () => {
    const failed = failure();
    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [failed],
        chatPairs: [chatPair(failed)],
        passingRun: passingRun({
          codeHash: failed.codeHash,
          executionFingerprint: failed.executionFingerprint,
        }),
      }),
    ).toBeUndefined();
  });

  it("rejects local passing evidence that does not cover the failed suite", () => {
    const failed = failure();
    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [failed],
        chatPairs: [chatPair(failed)],
        passingRun: passingRun({ selectedTestCaseIds: ["case-1"] }),
      }),
    ).toBeUndefined();
  });

  it.each([
    { status: "runner_error" },
    { status: "no_tests" },
    { status: "unsupported_language" },
    { status: "empty_code" },
    { providerUsed: "mock" },
    { userTriggered: false },
  ])("rejects non-learner or engineering failure evidence: %o", (override) => {
    const failed = failure(override);
    expect(
      matchAssistedRepairChain({
        failedPracticeRuns: [failed],
        chatPairs: [chatPair(failed)],
        passingRun: passingRun(),
      }),
    ).toBeUndefined();
  });

  it("produces a stable repairKey independent of input and suite ordering", () => {
    const failed = failure({ selectedTestCaseIds: ["case-2", "case-1"] });
    const pair = chatPair(failed);
    const first = matchAssistedRepairChain({
      failedPracticeRuns: [failure({ id: "older" }), failed],
      chatPairs: [chatPair(failure({ id: "older" })), pair],
      passingRun: passingRun(),
    });
    const second = matchAssistedRepairChain({
      failedPracticeRuns: [failed, failure({ id: "older" })],
      chatPairs: [pair, chatPair(failure({ id: "older" }))],
      passingRun: passingRun(),
    });

    expect(first?.repairKey).toBe(second?.repairKey);
  });
});

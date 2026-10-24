import { describe, expect, it, vi } from "vitest";
import { loadReviewAssistedRepairChain } from "@/server/agents/coach-agent/review-assisted-repair";

describe("loadReviewAssistedRepairChain", () => {
  it("projects persisted Practice and Chat lineage into a closed Review chain", async () => {
    const failedAt = new Date("2026-07-20T10:00:00.000Z");
    const userAt = new Date("2026-07-20T10:01:00.000Z");
    const assistantAt = new Date("2026-07-20T10:02:00.000Z");
    const passedAt = new Date("2026-07-20T10:03:00.000Z");
    const workspace = {
      currentCodeHash: "sha256:failed",
      currentExecutionFingerprint: "execfp:v1:failed",
      latestAuthoritativeRunEvidenceId: "practice-1",
      latestAuthoritativeRunSource: "practice_run",
      latestAuthoritativeRunStatus: "failed",
    };
    const prisma = {
      practiceRunLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "practice-1",
            language: "Python",
            createdAt: failedAt,
            provider: "local_hot150",
            status: "failed",
            codeHash: "sha256:failed",
            executionFingerprint: "execfp:v1:failed",
            selectedTestCaseIds: JSON.stringify(["case-1"]),
            rawResultJson: JSON.stringify({
              firstFailedCase: { id: "case-1" },
            }),
          },
        ]),
      },
      chatMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "message-user",
            role: "user",
            sequence: 1,
            createdAt: userAt,
            metadataJson: JSON.stringify({
              type: "chat_user_message",
              workspace,
            }),
          },
          {
            id: "message-assistant",
            role: "assistant",
            sequence: 2,
            createdAt: assistantAt,
            metadataJson: JSON.stringify({ type: "chat_reply", workspace }),
          },
        ]),
      },
      l1MemoryEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "trace-user",
            eventJson: JSON.stringify({ chatMessageId: "message-user" }),
          },
          {
            id: "trace-assistant",
            eventJson: JSON.stringify({ chatMessageId: "message-assistant" }),
          },
        ]),
      },
    };

    const chain = await loadReviewAssistedRepairChain(prisma as never, {
      userId: "user-1",
      problemId: "problem-1",
      chatSessionId: "session-1",
      language: "Python",
      memoryOrigin: "learner",
      passedAt,
      passedStatus: "passed_visible_tests",
      passedCodeHash: "sha256:passed",
      passedExecutionFingerprint: "execfp:v1:passed",
      passedSelectedTestCaseIds: ["case-1"],
      evidenceVerdict: {
        evidenceClass: "local_only",
        replyMode: "local_fallback",
        capabilities: {
          canVerdict: true,
          canWriteMistakeMemory: true,
          canWriteEpisode: true,
          canSignalPlanner: true,
          canUseFailureSalience: true,
        },
        status: "passed_visible_tests",
        providerUsed: "local_hot150",
        scopeLabel: "selected local visible tests",
        modelInstruction: "Scope claims to selected visible tests.",
      },
    });

    expect(chain).toMatchObject({
      failedPracticeRunLogId: "practice-1",
      userChatMessageId: "message-user",
      userChatTraceId: "trace-user",
      assistantChatMessageId: "message-assistant",
      assistantChatTraceId: "trace-assistant",
      passedEndpoint: "review",
      selectedTestCaseIds: ["case-1"],
    });
  });
});

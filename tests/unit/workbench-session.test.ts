import { describe, expect, it } from "vitest";
import { buildWorkbenchSession } from "@/features/workbench/workbench-session";

const problem = { id: "p1", slug: "two-sum", title: "Two Sum" };
const runResult = {
  status: "failed",
  passedCount: 1,
  failedCount: 1,
  stdout: "",
  stderr: "",
  testResults: [],
};

describe("buildWorkbenchSession", () => {
  it("reconstructs review turns interleaved with chat turns", () => {
    const session = buildWorkbenchSession({
      chatSessionId: "cs1",
      problem,
      reviewAttempts: [
        {
          id: "ra1",
          coachReplyMarkdown: "## Diagnosis\nfix the loop",
          diagnosisJson: JSON.stringify({ summary: "loop bug" }),
          language: "Python",
          selectedTestCaseIds: JSON.stringify(["case-1", "case-2"]),
          rawResultJson: JSON.stringify(runResult),
          problemHistoryId: "ph1",
        },
      ],
      messages: [
        {
          id: "m1",
          role: "assistant",
          contentMarkdown: "## Diagnosis\nfix the loop",
          reviewAttemptId: "ra1",
          sequence: 1,
        },
        {
          id: "m2",
          role: "user",
          contentMarkdown: "why?",
          reviewAttemptId: null,
          sequence: 2,
        },
        {
          id: "m3",
          role: "assistant",
          contentMarkdown: "because...",
          reviewAttemptId: null,
          sequence: 3,
        },
      ],
    });

    expect(session.chatSessionId).toBe("cs1");
    expect(session.latestReview?.coachReply).toContain("fix the loop");
    expect(session.latestReview?.runResult.passedCount).toBe(1);
    expect(session.latestReview?.evidence).toMatchObject({
      source: "review",
      language: "Python",
      selectedTestCaseIds: ["case-1", "case-2"],
      runnerProvider: "Unknown",
    });
    expect(session.chatTurns).toHaveLength(3);
    expect(session.chatTurns[0]).toMatchObject({
      role: "review",
      content: "## Diagnosis\nfix the loop",
      evidence: {
        source: "review",
        language: "Python",
      },
    });
    expect(session.chatTurns[1]).toEqual({
      id: "m2",
      role: "user",
      content: "why?",
    });
    expect(session.chatTurns[2]).toEqual({
      id: "m3",
      role: "assistant",
      content: "because...",
    });
  });

  it("returns null latestReview when there are no review attempts", () => {
    const session = buildWorkbenchSession({
      chatSessionId: "cs1",
      problem,
      reviewAttempts: [],
      messages: [
        {
          id: "m1",
          role: "user",
          contentMarkdown: "hi",
          reviewAttemptId: null,
          sequence: 1,
        },
      ],
    });

    expect(session.latestReview).toBeNull();
    expect(session.chatTurns).toEqual([
      { id: "m1", role: "user", content: "hi" },
    ]);
  });

  it("restores backend action outcomes for authoritative save status UI", () => {
    const actionOutcomes = [
      {
        toolName: "save_knowledge_note",
        displayName: "知识手册",
        status: "completed",
        message: "知识手册：已保存「deque」",
        recordId: "note-1",
      },
    ];
    const session = buildWorkbenchSession({
      chatSessionId: "cs1",
      problem,
      reviewAttempts: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          contentMarkdown: "这段正文不负责证明保存成功。",
          reviewAttemptId: null,
          sequence: 1,
          metadataJson: JSON.stringify({ actionOutcomes }),
        },
      ],
    });

    expect(session.chatTurns[0]).toMatchObject({
      role: "assistant",
      actionOutcomes,
    });
  });
});

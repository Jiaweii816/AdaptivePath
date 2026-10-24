import { describe, expect, it, vi } from "vitest";
import { readReviewStream } from "@/features/workbench/review-stream";
import type {
  WorkbenchReviewResult,
  WorkbenchRunEvidence,
} from "@/features/workbench/types";

const evidence = {
  source: "review",
  language: "Python",
  selectedTestCaseIds: ["case-1"],
  runnerProvider: "LeetCode",
  evidenceSource: "Official Judge Evidence",
  runResult: {
    status: "passed_visible_tests",
    passedCount: 96,
    failedCount: 0,
    stdout: "",
    stderr: "Accepted",
    testResults: [],
  },
} satisfies WorkbenchRunEvidence;

const result = {
  ok: true,
  problem: { id: "problem-1", slug: "two-sum", title: "Two Sum" },
  chatSessionId: "chat-1",
  reviewAttemptId: "review-1",
  problemHistoryId: "history-1",
  runResult: evidence.runResult,
  evidence,
  diagnosis: {
    problemSlug: "two-sum",
    runStatus: "passed_visible_tests",
    userIssueSummary: "Passed.",
    coachSummary: "Passed.",
    mistakeTags: [],
    skillTags: ["hash-table"],
    memoryUpdateCandidate: { facts: [] },
  },
  coachReply: "Official result preserved.",
} satisfies WorkbenchReviewResult;

describe("readReviewStream", () => {
  it("delivers evidence before the completed Review result", async () => {
    const onEvidence = vi.fn();
    const response = new Response(
      [
        JSON.stringify({ type: "evidence", evidence }),
        JSON.stringify({ type: "complete", result }),
        "",
      ].join("\n"),
    );

    await expect(readReviewStream(response, onEvidence)).resolves.toEqual(result);
    expect(onEvidence).toHaveBeenCalledWith(evidence);
  });

  it("surfaces a streamed Review error", async () => {
    const response = new Response(
      `${JSON.stringify({ type: "error", error: "Review failed." })}\n`,
    );

    await expect(readReviewStream(response, vi.fn())).rejects.toThrow(
      "Review failed.",
    );
  });
});

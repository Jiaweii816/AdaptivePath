import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadLatestReviewProjection } from "@/server/agents/coach-agent/chat-context-loader";
import { buildWorkspaceCodeRevision } from "@/server/agents/coach-agent/workspace-revision";
import { hashCodeForRun } from "@/server/code/code-hash";

const PROBLEM_ID = "group-anagrams";
const CURRENT_CODE = "class Solution:\n    def groupAnagrams(self, strs):\n        return []";
const CURRENT_REVISION = buildWorkspaceCodeRevision({
  problemId: PROBLEM_ID,
  language: "Python",
  code: CURRENT_CODE,
})!;

describe("loadLatestReviewProjection", () => {
  it("uses the ReviewAttempt snapshot when legacy Review run evidence has no hash", async () => {
    const projection = await loadLatestReviewProjection(
      requestArgs(),
      reviewDb(reviewRow({ codeSnapshot: CURRENT_CODE, runCodeHash: null })),
    );

    expect(projection.alignment).toBe("matches_current_revision");
    expect(projection.context).toMatchObject({
      reviewAttemptId: "review-1",
      problemSlug: "group-anagrams",
      runStatus: "runtime_error",
    });
  });

  it("uses the Review RunEvidence hash first and excludes a mismatched latest Review", async () => {
    const staleHash = hashCodeForRun({
      language: "Python",
      code: `${CURRENT_CODE}\n# stale`,
    });
    const projection = await loadLatestReviewProjection(
      requestArgs(),
      reviewDb(
        reviewRow({ codeSnapshot: CURRENT_CODE, runCodeHash: staleHash }),
      ),
    );

    expect(projection).toEqual({ alignment: "different_revision" });
  });
});

function requestArgs() {
  return {
    userId: "user-1",
    problemId: PROBLEM_ID,
    chatSessionId: "chat-1",
    currentRevision: CURRENT_REVISION,
  };
}

function reviewDb(review: ReturnType<typeof reviewRow>) {
  return {
    reviewAttempt: { findFirst: vi.fn().mockResolvedValue(review) },
  } as unknown as Pick<PrismaClient, "reviewAttempt">;
}

function reviewRow(args: { codeSnapshot: string; runCodeHash: string | null }) {
  return {
    id: "review-1",
    language: "Python",
    codeSnapshot: args.codeSnapshot,
    diagnosisResult: null,
    problem: { slug: "group-anagrams" },
    problemHistories: [],
    runEvidences: [
      {
        codeHash: args.runCodeHash,
        status: "runtime_error",
        passedCount: 0,
        failedCount: 1,
        actualOutput: null,
        expectedOutput: null,
        firstFailedCaseJson: null,
      },
    ],
  };
}

import { describe, expect, it } from "vitest";
import { createMockCoachProvider } from "@/server/agents/coach-agent/mock-coach-provider";
import {
  findForbiddenCopy,
  validateCoachReplyContract,
} from "@/server/agents/coach-agent/coach-reply-contract";
import type { CoachReviewInput } from "@/server/agents/coach-agent/coach-agent.types";
import type { EvidenceVerdict } from "@/types/evidence";
import {
  coachMemoryBrief,
  teachableMemory,
} from "./coach-memory-brief-test-helpers";

const reviewInput: CoachReviewInput = {
  problem: {
    slug: "search-insert-position",
    title: "Search Insert Position",
    leetcodeNumber: 35,
    tags: ["array", "binary-search"],
    methodName: "searchInsert",
  },
  user: {
    displayName: "try",
    strongPatterns: ["HashMap", "Array traversal"],
    weakPatterns: ["Binary Search boundaries"],
    outputPreferences: ["Short, step-by-step answer"],
  },
  memory: coachMemoryBrief({
    teachableMemories: [
      teachableMemory({
        kind: "recurring_mistake",
        cue: "Binary search boundary updates have discarded a possible answer before.",
        sourceLabel: "Prior Search Insert reviews",
      }),
    ],
    outputPreferences: ["Concrete example first"],
  }),
  language: "Python",
  code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 2",
  runResult: {
    status: "failed",
    passedCount: 0,
    failedCount: 1,
    stdout: "",
    stderr: "",
    actualOutput: "2",
    expectedOutput: "1",
    firstFailedCase: {
      id: "case-1",
      label: "insert in middle",
      input: { nums: [1, 3, 5, 6], target: 2 },
      expected: 1,
      actual: 2,
    },
    testResults: [],
  },
  responseLanguage: "zh",
};

const localOnlyPassedVerdict: EvidenceVerdict = {
  evidenceClass: "local_only",
  replyMode: "local_fallback",
  capabilities: {
    canVerdict: true,
    canWriteMistakeMemory: false,
    canWriteEpisode: true,
    canSignalPlanner: true,
    canUseFailureSalience: false,
  },
  status: "passed_visible_tests",
  scopeLabel: "local visible-test fallback",
  modelInstruction:
    "Stay scoped to local visible fallback tests; do not claim official success.",
};

describe("createMockCoachProvider", () => {
  it("personalizes Search Insert feedback around binary-search boundary weakness", async () => {
    const provider = createMockCoachProvider();
    const result = await provider.review(reviewInput);

    expect(validateCoachReplyContract(result.coachReply)).toEqual({
      valid: true,
    });
    expect(result.coachReply).toContain("二分边界");
    expect(result.coachReply).toContain("insert in middle");
    expect(result.coachReply).toContain("return left");
    expect(result.coachReply).not.toContain("### 你现在卡在哪里");
    expect(result.diagnosis.mistakeTags).toContain(
      "binary_search_boundary_mistake",
    );
    expect(result.diagnosis.memoryUpdateCandidate.facts[0]?.tag).toBe(
      "binary_search_boundary_mistake",
    );
    expect(result.diagnosis.selfCheck?.question).toContain("插入位置");
  });

  it("returns a visible-test-scoped reply for local-only passed evidence", async () => {
    const provider = createMockCoachProvider();
    const result = await provider.review({
      ...reviewInput,
      evidenceVerdict: localOnlyPassedVerdict,
      runResult: {
        status: "passed_visible_tests",
        passedCount: 3,
        failedCount: 0,
        stdout: "",
        stderr: "",
        durationMs: 12,
        testResults: [],
      },
    });

    expect(result.coachReply).toContain("所选本地可见测试");
    expect(result.coachReply).toContain("不是 LeetCode 官方判定");
    expect(result.coachReply).not.toContain("###");
    expect(findForbiddenCopy(result.coachReply)).toEqual([]);
    expect(result.diagnosis.runStatus).toBe("passed_visible_tests");
    expect(result.diagnosis.coachSummary).toContain("official result remains unverified");
    expect(result.diagnosis.mistakeTags).toEqual([]);
    expect(result.diagnosis.selfCheck).toBeNull();
    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([]);
  });

  it("keeps a local failed diagnosis and candidate scoped to visible tests", async () => {
    const provider = createMockCoachProvider();
    const result = await provider.review({
      ...reviewInput,
      evidenceVerdict: {
        ...localOnlyPassedVerdict,
        status: "failed",
        capabilities: {
          ...localOnlyPassedVerdict.capabilities,
          canWriteMistakeMemory: true,
          canSignalPlanner: false,
          canUseFailureSalience: true,
        },
      },
    });

    expect(result.coachReply).toContain("只针对所选本地可见测试");
    expect(result.coachReply).toContain("不是 LeetCode 官方判定");
    expect(result.diagnosis.memoryUpdateCandidate.facts[0]?.tag).toBe(
      "binary_search_boundary_mistake",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  alignReviewResultWithRunEvidence,
  buildLlmUnavailableResult,
  buildNonVerdictReviewResult,
} from "@/server/agents/coach-agent/review-pipeline";
import type { CodeRunResult } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import type { EvidenceVerdict } from "@/types/evidence";

const runResult: CodeRunResult = {
  status: "failed",
  passedCount: 1,
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
};

const localOnlyPassedRun: CodeRunResult = {
  status: "passed_visible_tests",
  passedCount: 3,
  failedCount: 0,
  stdout: "",
  stderr: "",
  durationMs: 10,
  testResults: [],
};

function evidenceVerdict(overrides: Partial<EvidenceVerdict>): EvidenceVerdict {
  return {
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
    modelInstruction: "Stay scoped to local visible fallback tests.",
    ...overrides,
  };
}

describe("buildLlmUnavailableResult", () => {
  it("returns a tier-3 result that preserves run evidence and skips memory", () => {
    const result = buildLlmUnavailableResult({
      problemSlug: "search-insert-position",
      problemTags: ["binary-search"],
      runResult,
      responseLanguage: "zh",
      error: new Error("ECONNRESET"),
    });

    expect(result.degraded?.tier).toBe(3);
    expect(result.degraded?.memorySkipped).toBe(true);
    expect(result.degraded?.reason).toContain("ECONNRESET");
    expect(result.diagnosis.runStatus).toBe("failed");
    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([]);
    expect(result.coachReply).not.toContain("### 你现在卡在哪里");
    expect(result.coachReply).not.toContain("###");
    expect(result.coachReply.length).toBeGreaterThan(20);
  });

  it("keeps an official Accepted result visible when Coach reaches its timeout", () => {
    const result = buildLlmUnavailableResult({
      problemSlug: "two-sum",
      problemTags: ["hash-table"],
      runResult: {
        ...localOnlyPassedRun,
        rawResult: { providerUsed: "lc_submit" },
      },
      responseLanguage: "zh",
      error: new Error("Request timed out"),
    });

    expect(result.coachReply).toContain("LeetCode 官方判题已返回 Accepted");
    expect(result.coachReply).toContain("25 秒上限");
    expect(result.degraded?.memorySkipped).toBe(true);
  });
});

describe("buildNonVerdictReviewResult", () => {
  it("returns undefined for local_only passed runs so the Local-Evidence Examiner LLM call runs", () => {
    const result = buildNonVerdictReviewResult({
      evidenceVerdict: evidenceVerdict({}),
      problemSlug: "maximum-sum-circular-subarray",
      problemTags: ["array"],
      runResult: localOnlyPassedRun,
      responseLanguage: "zh",
    });

    expect(result).toBeUndefined();
  });

  it("still returns a degraded result when execution evidence is unavailable", () => {
    const unavailable = buildNonVerdictReviewResult({
      evidenceVerdict: evidenceVerdict({
        evidenceClass: "evidence_unavailable",
        replyMode: "unavailable",
        status: "runner_error",
        capabilities: {
          canVerdict: false,
          canWriteMistakeMemory: false,
          canWriteEpisode: false,
          canSignalPlanner: false,
          canUseFailureSalience: false,
        },
      }),
      problemSlug: "two-sum",
      problemTags: ["hash-table"],
      runResult: {
        ...localOnlyPassedRun,
        status: "runner_error",
        passedCount: 0,
      },
      responseLanguage: "zh",
    });

    expect(unavailable?.degraded?.memorySkipped).toBe(true);
    expect(unavailable?.coachReply.length).toBeGreaterThan(10);
  });

  it("lets remote LeetCode unavailability fall through to static Review LLM", () => {
    const result = buildNonVerdictReviewResult({
      evidenceVerdict: evidenceVerdict({
        evidenceClass: "evidence_unavailable",
        replyMode: "unavailable",
        status: "runner_error",
        providerUsed: "lc_submit",
        capabilities: {
          canVerdict: false,
          canWriteMistakeMemory: false,
          canWriteEpisode: false,
          canSignalPlanner: false,
          canUseFailureSalience: false,
        },
      }),
      problemSlug: "two-sum",
      problemTags: ["hash-table"],
      runResult: {
        ...localOnlyPassedRun,
        status: "runner_error",
        passedCount: 0,
        rawResult: { providerUsed: "lc_submit" },
      },
      responseLanguage: "zh",
    });

    expect(result).toBeUndefined();
  });
});

describe("alignReviewResultWithRunEvidence", () => {
  it("derives an evidence-scoped mistake when failed code proves a canonical mechanism but the provider is unavailable", () => {
    const providerResult = buildLlmUnavailableResult({
      problemSlug: "search-insert-position",
      problemTags: ["binary-search", "array"],
      runResult,
      responseLanguage: "en",
      error: new Error("Review LLM returned an empty response."),
    });

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "search-insert-position",
      problemTitle: "Search Insert Position",
      problemTags: ["binary-search", "array"],
      code: [
        "class Solution:",
        "    def searchInsert(self, nums, target):",
        "        left, right = 0, len(nums) - 1",
        "        while left <= right:",
        "            mid = (left + right) // 2",
        "            if nums[mid] < target:",
        "                left = mid + 1",
        "            else:",
        "                right = mid - 2",
        "        return left",
      ].join("\n"),
      runResult,
      evidenceVerdict: evidenceVerdict({
        status: "failed",
        capabilities: {
          canVerdict: true,
          canWriteMistakeMemory: true,
          canWriteEpisode: true,
          canSignalPlanner: false,
          canUseFailureSalience: true,
        },
      }),
      responseLanguage: "en",
    });

    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([
      expect.objectContaining({
        factType: "mistake",
        tag: "binary_search_invariant",
        label: expect.stringContaining("binary-search interval invariant"),
      }),
    ]);
    expect(
      result.diagnosis.memoryUpdateCandidate.facts[0]?.evidenceSummary,
    ).toContain("selected local visible test");
    expect(result.degraded).toMatchObject({
      tier: 3,
      memorySkipped: false,
    });
  });

  it("derives an evidence-scoped strength when passed code proves a canonical mechanism but the provider emits no fact", () => {
    const passedRun: CodeRunResult = {
      status: "passed_visible_tests",
      passedCount: 66,
      failedCount: 0,
      stdout: "",
      stderr: "Accepted",
      testResults: [],
      rawResult: { providerUsed: "lc_submit" },
    };
    const providerResult: CoachReviewResult = {
      diagnosis: {
        problemSlug: "search-insert-position",
        runStatus: "passed_visible_tests",
        userIssueSummary: "The current revision passed.",
        coachSummary: "Move on after self-rating.",
        mistakeTags: [],
        skillTags: ["binary-search", "array"],
        memoryUpdateCandidate: { facts: [], summary: "No facts." },
      },
      coachReply: "The current revision passed.",
    };

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "search-insert-position",
      problemTitle: "Search Insert Position",
      problemTags: ["binary-search", "array"],
      code: [
        "class Solution:",
        "    def searchInsert(self, nums, target):",
        "        left, right = 0, len(nums) - 1",
        "        while left <= right:",
        "            mid = (left + right) // 2",
        "            if nums[mid] < target:",
        "                left = mid + 1",
        "            else:",
        "                right = mid - 1",
        "        return left",
      ].join("\n"),
      runResult: passedRun,
      responseLanguage: "en",
    });

    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([
      expect.objectContaining({
        factType: "strength",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
      }),
    ]);
    expect(
      result.diagnosis.memoryUpdateCandidate.facts[0]?.evidenceSummary,
    ).toContain("passed Review execution evidence");
  });

  it("replaces an unmapped passed-provider fact with a code-proven canonical strength", () => {
    const result = alignReviewResultWithRunEvidence({
      coachResult: {
        diagnosis: {
          problemSlug: "climbing-stairs",
          runStatus: "passed_visible_tests",
          userIssueSummary: "The visible cases passed.",
          coachSummary: "The recurrence is consistent.",
          mistakeTags: [],
          skillTags: ["dynamic-programming", "1d-dp"],
          memoryUpdateCandidate: {
            facts: [
              {
                factType: "strength",
                tag: "dp_recurrence_implementation",
                label: "Correct recurrence",
                confidence: 0.9,
                evidenceSummary: "The visible cases passed with the recurrence.",
              },
            ],
            summary: "Provider proposed an unmapped label.",
          },
        },
        coachReply: "The visible cases passed.",
        degraded: {
          tier: 3,
          reason: "Review LLM returned an empty response.",
          memorySkipped: true,
        },
      },
      problemSlug: "climbing-stairs",
      problemTitle: "Climbing Stairs",
      problemTags: ["dynamic-programming", "1d-dp"],
      code: [
        "class Solution:",
        "    def climbStairs(self, n):",
        "        dp = [0] * (n + 1)",
        "        dp[1], dp[2] = 1, 2",
        "        for step in range(3, n + 1):",
        "            dp[step] = dp[step - 1] + dp[step - 2]",
        "        return dp[n]",
      ].join("\n"),
      runResult: {
        status: "passed_visible_tests",
        passedCount: 2,
        failedCount: 0,
        stdout: "",
        stderr: "Accepted",
        testResults: [],
        rawResult: { providerUsed: "lc_submit" },
      },
      responseLanguage: "en",
    });

    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([
      expect.objectContaining({
        factType: "strength",
        tag: "dynamic_programming_state_transition",
      }),
    ]);
    expect(JSON.stringify(result.diagnosis.memoryUpdateCandidate)).not.toContain(
      "dp_recurrence_implementation",
    );
    expect(result.degraded).toMatchObject({
      tier: 3,
      memorySkipped: false,
    });
  });

  it("replaces contradictory passed-run coaching with a next-problem reply", () => {
    const passedRun: CodeRunResult = {
      status: "passed_visible_tests",
      passedCount: 130,
      failedCount: 0,
      stdout: "",
      stderr: "",
      durationMs: 25,
      testResults: [],
    };
    const providerResult: CoachReviewResult = {
      diagnosis: {
        problemSlug: "ransom-note",
        runStatus: "failed",
        userIssueSummary: "The first visible case failed.",
        coachSummary: "Fix the mismatch.",
        mistakeTags: ["hash_map_mistake"],
        skillTags: ["hash-table"],
        memoryUpdateCandidate: {
          facts: [
            {
              factType: "mistake",
              tag: "hash_map_mistake",
              confidence: 0.7,
            },
          ],
          summary: "Mistake surfaced.",
        },
      },
      coachReply: [
        "根因:第一个可见用例没过。",
        "走一遍失败用例,定位第一个 mismatch。",
        "最小改法:只修产生 mismatch 的那一处。",
      ].join("\n"),
    };

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "ransom-note",
      problemTitle: "Ransom Note",
      problemTags: ["hash-table"],
      runResult: passedRun,
      responseLanguage: "zh",
      planner: {
        currentPlanItemId: "plan-383",
        nextTodayItem: {
          planItemId: "plan-228",
          slug: "summary-ranges",
          title: "Summary Ranges",
          leetcodeNumber: 228,
          source: "plan",
        },
      },
    });

    expect(result.diagnosis.runStatus).toBe("passed_visible_tests");
    expect(result.diagnosis.mistakeTags).toEqual([]);
    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([]);
    expect(result.coachReply).toContain("你当前的算法已经接近最优解");
    expect(result.coachReply).toContain("LC 228 Summary Ranges");
    expect(result.coachReply).not.toContain("###");
    expect(result.coachReply).not.toContain("没过");
    expect(result.degraded?.memorySkipped).not.toBe(true);
  });

  it("uses the passed-run optimization signal for a concise opt-in reply", () => {
    const passedRun: CodeRunResult = {
      status: "passed_visible_tests",
      passedCount: 31,
      failedCount: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
      testResults: [],
    };
    const providerResult: CoachReviewResult = {
      diagnosis: {
        problemSlug: "convert-sorted-array-to-binary-search-tree",
        runStatus: "passed_visible_tests",
        userIssueSummary: "Current run passed.",
        coachSummary:
          "can_optimize: 中点递归构造 BST - 每次取中点，左右递归生成平衡子树",
        mistakeTags: [],
        skillTags: ["binary-search-tree"],
        memoryUpdateCandidate: {
          facts: [],
          summary: "No mistake fact.",
        },
      },
      coachReply: "这次运行已经通过。",
    };

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "convert-sorted-array-to-binary-search-tree",
      problemTitle: "Convert Sorted Array to Binary Search Tree",
      problemTags: ["binary-search-tree"],
      runResult: passedRun,
      responseLanguage: "zh",
      planner: {
        currentPlanItemId: "plan-108",
        nextTodayItem: {
          planItemId: "plan-53",
          slug: "maximum-subarray",
          title: "Maximum Subarray",
          leetcodeNumber: 53,
          source: "plan",
        },
      },
    });

    expect(result.coachReply).toContain(
      "你当前的算法还可以再优化，采用中点递归构造 BST（每次取中点，左右递归生成平衡子树），你想要我给你讲解吗？",
    );
    expect(result.coachReply).toContain(
      "Today 自评里记录 Convert Sorted Array to Binary Search Tree 的体感",
    );
    expect(result.coachReply).toContain("LC 53 Maximum Subarray");
    expect(result.coachReply).not.toContain("###");
    expect(result.diagnosis.coachSummary).toContain("can_optimize:");
  });

  it("preserves scoped local evidence copy while stripping mistake facts for local-only passed runs", () => {
    const providerResult: CoachReviewResult = {
      diagnosis: {
        problemSlug: "maximum-sum-circular-subarray",
        runStatus: "passed_visible_tests",
        userIssueSummary: "Selected local visible tests passed.",
        coachSummary: "Check an all-negative boundary case next.",
        mistakeTags: ["kadane_edge_case"],
        skillTags: ["array"],
        selfCheck: null,
        memoryUpdateCandidate: {
          facts: [
            {
              factType: "mistake",
              tag: "kadane_edge_case",
              confidence: 0.8,
            },
          ],
          summary: "No mistake fact from a locally passing Review.",
        },
      },
      coachReply:
        "所选本地可见测试通过，但这不是 LeetCode 官方判定，也不覆盖隐藏测试。下一步手动 trace 一个全负数边界用例。",
    };

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "maximum-sum-circular-subarray",
      problemTitle: "Maximum Sum Circular Subarray",
      problemTags: ["array"],
      runResult: localOnlyPassedRun,
      evidenceVerdict: evidenceVerdict({}),
      responseLanguage: "zh",
    });

    expect(result.coachReply).toContain("所选本地可见测试");
    expect(result.coachReply).toContain("不是 LeetCode 官方判定");
    expect(result.coachReply).not.toContain("###");
    expect(result.coachReply).not.toContain("你当前的算法已经接近最优解");
    expect(result.diagnosis.mistakeTags).toEqual([]);
    expect(result.diagnosis.memoryUpdateCandidate.facts).toEqual([]);
    expect(result.degraded?.memorySkipped).not.toBe(true);
  });

  it("preserves a local failed candidate and aligns its run status", () => {
    const providerResult: CoachReviewResult = {
      diagnosis: {
        problemSlug: "search-insert-position",
        runStatus: "runtime_error",
        userIssueSummary: "Selected visible case returned the wrong index.",
        coachSummary: "The insertion boundary moved too far right.",
        mistakeTags: ["binary_search_boundary"],
        skillTags: ["binary-search"],
        memoryUpdateCandidate: {
          facts: [
            {
              factType: "mistake",
              tag: "binary_search_boundary",
              confidence: 0.7,
              evidenceSummary:
                "The selected local visible case returned index 2 instead of 1.",
            },
          ],
          summary: "Local failed-case candidate.",
        },
      },
      coachReply:
        "所选本地可见用例显示返回边界偏右。这不是 LeetCode 官方判定。",
    };

    const result = alignReviewResultWithRunEvidence({
      coachResult: providerResult,
      problemSlug: "search-insert-position",
      problemTitle: "Search Insert Position",
      problemTags: ["binary-search"],
      runResult,
      evidenceVerdict: evidenceVerdict({
        status: "failed",
        capabilities: {
          canVerdict: true,
          canWriteMistakeMemory: true,
          canWriteEpisode: true,
          canSignalPlanner: false,
          canUseFailureSalience: true,
        },
      }),
      responseLanguage: "zh",
    });

    expect(result.diagnosis.runStatus).toBe("failed");
    expect(result.diagnosis.mistakeTags).toEqual([
      "binary_search_boundary",
    ]);
    expect(result.diagnosis.memoryUpdateCandidate.facts).toHaveLength(1);
    expect(result.degraded).toBeUndefined();
  });
});

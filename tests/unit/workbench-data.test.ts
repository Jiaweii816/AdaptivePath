import { describe, expect, it, vi } from "vitest";
import { getWorkbenchData } from "@/features/workbench/workbench-data";
import { seedDatabase } from "../../prisma/seed";
import { createMemoryTestDb } from "./memory-test-helpers";

describe("workbench data", () => {
  it("loads generated local Hot-150 problem data without a LeetCode session", async () => {
    const db = await createMemoryTestDb();
    const originalSession = process.env.LEETCODE_SESSION;

    delete process.env.LEETCODE_SESSION;

    try {
      await seedDatabase(db.prisma);
      const data = await getWorkbenchData({
        db: db.prisma,
        requestedSlug: "minimum-size-subarray-sum",
      });
      const problem = data.problems.find(
        (item) => item.slug === "minimum-size-subarray-sum",
      );

      expect(data.hasLeetCodeSession).toBe(false);
      expect(problem?.statementMarkdown).toContain(
        "minimal length of a subarray",
      );
      expect(problem?.localRunStatus).toBe("runnable");
      expect(problem?.testCases).toHaveLength(3);
      expect(problem?.testCases[0]?.gtProvenance).toBe("ac_solution");
    } finally {
      if (originalSession === undefined) {
        delete process.env.LEETCODE_SESSION;
      } else {
        process.env.LEETCODE_SESSION = originalSession;
      }

      await db.cleanup();
    }
  });

  it("hydrates a requested Hot-150 problem before the initial Workbench render", async () => {
    const db = await createMemoryTestDb();
    const getProblem = vi.fn().mockResolvedValue({
      questionId: "209",
      questionFrontendId: "209",
      title: "Minimum Size Subarray Sum",
      titleSlug: "minimum-size-subarray-sum",
      content: "<p>Given an array of positive integers nums and a positive integer target.</p>",
      difficulty: "Medium",
      topicTags: [{ name: "Sliding Window", slug: "sliding-window" }],
      codeSnippets: [
        {
          lang: "Python3",
          langSlug: "python3",
          code: "class Solution:\n    def minSubArrayLen(self, target: int, nums: list[int]) -> int:\n        pass",
        },
        {
          lang: "C++",
          langSlug: "cpp",
          code: "class Solution {\npublic:\n    int minSubArrayLen(int target, vector<int>& nums) {}\n};",
        },
      ],
      exampleTestcases: "7\n[2,3,1,2,4,3]\n4\n[1,4,4]",
      metaData: JSON.stringify({
        name: "minSubArrayLen",
        params: [
          { name: "target", type: "integer" },
          { name: "nums", type: "integer[]" },
        ],
      }),
    });

    try {
      const data = await getWorkbenchData({
        db: db.prisma,
        problemClient: { getProblem },
        requestedSlug: "minimum-size-subarray-sum",
      });
      const problem = data.problems.find(
        (item) => item.slug === "minimum-size-subarray-sum",
      );

      expect(getProblem).toHaveBeenCalledTimes(1);
      expect(problem?.statementMarkdown).toContain(
        "Given an array of positive integers",
      );
      expect(problem?.starterCode.Python).toContain("minSubArrayLen");
      expect(problem?.testCases).toHaveLength(2);
    } finally {
      await db.cleanup();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { createLcRunnerProvider } from "@/server/tools/code-runner/lc-runner";

describe("LeetCode runner provider", () => {
  it("uses interpret_solution for visible_run execution", async () => {
    const runCode = vi.fn().mockResolvedValue({
      check: {
        run_success: true,
        compare_result: "1",
        code_answer: ["2"],
        expected_code_answer: ["2"],
        std_output_list: ["case stdout"],
      },
    });
    const submitSolution = vi.fn();
    const runner = createLcRunnerProvider({
      client: { runCode, submitSolution },
    });

    const result = await runner.run({
      problem: {
        slug: "two-sum",
        title: "Two Sum",
        leetcodeNumber: 1,
        methodName: "twoSum",
        tags: ["array", "hashmap"],
      },
      language: "Python",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",
      testCases: [
        {
          id: "case-1",
          label: "sample",
          input: "[2,7,11,15]\n9",
          expected: "[0,1]",
        },
      ],
      executionKind: "visible_run",
    });

    expect(runCode).toHaveBeenCalledWith(
      expect.objectContaining({
        titleSlug: "two-sum",
        dataInput: "[2,7,11,15]\n9",
      }),
    );
    expect(submitSolution).not.toHaveBeenCalled();
    expect(result.status).toBe("passed_visible_tests");
    expect(result.testResults[0]?.stdout).toBe("case stdout");
  });
});

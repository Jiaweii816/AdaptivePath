import { describe, expect, it } from "vitest";
import { createMockCodeRunnerProvider } from "@/server/tools/code-runner/mock-runner";
import type { CodeRunnerInput } from "@/server/tools/code-runner/code-runner.types";
import type { CodeRunStatus } from "@/types/code-runner";
import type { RawMockRunnerOutcome } from "@/server/tools/code-runner/normalize-run-result";

const baseInput: CodeRunnerInput = {
  problem: {
    slug: "search-insert-position",
    title: "Search Insert Position",
    leetcodeNumber: 35,
    methodName: "searchInsert",
    tags: ["array", "binary-search"],
  },
  language: "Python",
  code: "class Solution:\n    def searchInsert(self, nums, target):\n        return 0",
  testCases: [
    {
      id: "case-1",
      label: "insert in middle",
      input: { nums: [1, 3, 5, 6], target: 2 },
      expected: 1,
      source: "sample",
    },
  ],
};

describe("createMockCodeRunnerProvider", () => {
  it.each<[RawMockRunnerOutcome, CodeRunStatus]>([
    [{ kind: "passed" }, "passed_visible_tests"],
    [{ kind: "failed", actual: 2, expected: 1 }, "failed"],
    [{ kind: "compile_error", stderr: "compile failed" }, "compile_error"],
    [{ kind: "syntax_error", stderr: "syntax failed" }, "syntax_error"],
    [{ kind: "runtime_error", stderr: "runtime failed" }, "runtime_error"],
    [{ kind: "timeout", stderr: "timed out" }, "timeout"],
    [{ kind: "runner_error", stderr: "runner failed" }, "runner_error"],
  ])("returns normalized evidence for %s", async (outcome, status) => {
    const runner = createMockCodeRunnerProvider({ outcome });
    const result = await runner.run(baseInput);

    expect(result).toEqual(
      expect.objectContaining({
        status,
        passedCount: expect.any(Number),
        failedCount: expect.any(Number),
        stdout: expect.any(String),
        stderr: expect.any(String),
        testResults: expect.any(Array),
      }),
    );

    if (status === "failed") {
      expect(result.firstFailedCase).toEqual(
        expect.objectContaining({ label: "insert in middle" }),
      );
      expect(result.actualOutput).toBe("2");
      expect(result.expectedOutput).toBe("1");
    }
  });

  it.each<[{ input: CodeRunnerInput; status: CodeRunStatus }]>([
    [{ input: { ...baseInput, code: "   " }, status: "empty_code" }],
    [{ input: { ...baseInput, testCases: [] }, status: "no_tests" }],
    [
      {
        input: { ...baseInput, language: "JavaScript" as never },
        status: "unsupported_language",
      },
    ],
  ])("handles guard status $status", async ({ input, status }) => {
    const runner = createMockCodeRunnerProvider();

    await expect(runner.run(input)).resolves.toEqual(
      expect.objectContaining({ status }),
    );
  });
});

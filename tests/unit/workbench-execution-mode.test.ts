import { describe, expect, it } from "vitest";
import {
  errorHighlightForRunResult,
  executionModeFor,
} from "@/features/workbench/workbench-client";
import type { CodeRunResult } from "@/types/code-runner";
import type {
  WorkbenchLanguage,
  WorkbenchProblem,
} from "@/features/workbench/types";

function problemFixture(
  overrides: Partial<WorkbenchProblem> = {},
): WorkbenchProblem {
  return {
    id: "problem-1",
    leetcodeNumber: 209,
    slug: "minimum-size-subarray-sum",
    title: "Minimum Size Subarray Sum",
    difficulty: "Medium",
    statementMarkdown: "",
    examples: [],
    constraints: [],
    tags: ["Array", "Sliding Window"],
    starterCode: {
      Python: "class Solution:\n    pass",
      "C++": "class Solution {};",
    },
    methodName: "minSubArrayLen",
    inputContract: {},
    outputContract: {},
    isDemoSupported: false,
    localRunStatus: "not_ready",
    testCases: [],
    drafts: {},
    ...overrides,
  };
}

function mode(
  overrides: Partial<WorkbenchProblem>,
  language: WorkbenchLanguage,
  hasLeetCodeSession = false,
) {
  return executionModeFor(
    problemFixture(overrides),
    hasLeetCodeSession,
    language,
  );
}

describe("workbench execution mode", () => {
  it("allows local Python Run for generated Hot-150 problems without enabling Review", () => {
    const executionMode = mode({ localRunStatus: "runnable" }, "Python");

    expect(executionMode.kind).toBe("local_hot150");
    expect(executionMode.canRun).toBe(true);
    expect(executionMode.canReview).toBe(false);
    expect(executionMode.reviewKind).toBe("blocked");
  });

  it("blocks non-demo C++ local Run with explicit unsupported-language copy", () => {
    const executionMode = mode({ localRunStatus: "runnable" }, "C++");

    expect(executionMode.canRun).toBe(false);
    expect(executionMode.runDescription).toContain(
      "C++ local Run is not supported",
    );
  });

  it("keeps non-ready Hot-150 Run disabled while allowing remote Review when configured", () => {
    const executionMode = mode(
      {
        localRunStatus: "harness_review",
        localRunStatusMessage: "Reference execution needs review.",
      },
      "Python",
      true,
    );

    expect(executionMode.kind).toBe("blocked");
    expect(executionMode.canRun).toBe(false);
    expect(executionMode.canReview).toBe(true);
    expect(executionMode.reviewKind).toBe("leetcode");
    expect(executionMode.runDescription).toBe(
      "Reference execution needs review.",
    );
  });

  it("keeps demo problems fully runnable and reviewable without LeetCode", () => {
    const executionMode = mode(
      { isDemoSupported: true, localRunStatus: "runnable" },
      "Python",
    );

    expect(executionMode.kind).toBe("piston_fallback");
    expect(executionMode.canRun).toBe(true);
    expect(executionMode.canReview).toBe(true);
    expect(executionMode.reviewKind).toBe("local_demo");
  });
});

describe("workbench editor error highlight", () => {
  it("returns a valid run error location for the current code snapshot", () => {
    const result = runResult({
      errorLocation: {
        line: 2,
        column: 12,
        message: "NameError: name 'word' is not defined",
      },
    });

    expect(
      errorHighlightForRunResult(result, "class Solution:\n    return word\n"),
    ).toEqual({
      line: 2,
      column: 12,
      message: "NameError: name 'word' is not defined",
    });
  });

  it("does not highlight missing or invalid locations", () => {
    expect(
      errorHighlightForRunResult(runResult(), "class Solution:\n    pass\n"),
    ).toBeNull();

    expect(
      errorHighlightForRunResult(
        runResult({ errorLocation: { line: 4 } }),
        "class Solution:\n    pass\n",
      ),
    ).toBeNull();
  });
});

function runResult(overrides: Partial<CodeRunResult> = {}): CodeRunResult {
  return {
    status: "runtime_error",
    failureProvenance: "user_code",
    passedCount: 0,
    failedCount: 1,
    stdout: "",
    stderr: "NameError: name 'word' is not defined",
    testResults: [],
    ...overrides,
  };
}

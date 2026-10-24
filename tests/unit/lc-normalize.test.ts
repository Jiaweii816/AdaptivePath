import { describe, expect, it } from "vitest";
import { normalizeLcRunResult } from "@/server/tools/leetcode-api/normalize-lc-run-result";
import { normalizeLcSubmitResult } from "@/server/tools/leetcode-api/normalize-lc-submit-result";

describe("LeetCode result normalization", () => {
  it("maps accepted submit responses to passed evidence", () => {
    const result = normalizeLcSubmitResult({
      raw: {
        check: {
          status_msg: "Accepted",
          total_correct: 63,
          total_testcases: 63,
          status_runtime: "3 ms",
        },
      },
    });

    expect(result.status).toBe("passed_visible_tests");
    expect(result.passedCount).toBe(63);
    expect(result.failedCount).toBe(0);
    expect(result.durationMs).toBe(3);
    expect(result.failureProvenance).toBe("user_code");
    expect(result.testResults).toEqual([]);
    expect(result.rawResult).toMatchObject({ providerUsed: "lc_submit" });
  });

  it("maps wrong-answer submit responses to first failed case evidence", () => {
    const result = normalizeLcSubmitResult({
      raw: {
        check: {
          status_msg: "Wrong Answer",
          total_correct: 12,
          total_testcases: 63,
          compare_result: "111111111111000000",
          last_testcase: "[3,2,4]\n6",
          expected_output: "[1,2]",
          code_output: "[0,1]",
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.failureProvenance).toBe("user_code");
    expect(result.passedCount).toBe(12);
    expect(result.failedCount).toBe(51);
    expect(result.testResults).toEqual([]);
    expect(result.firstFailedCase).toMatchObject({
      id: "leetcode-first-failed",
      input: "[3,2,4]\n6",
      expected: "[1,2]",
      actual: "[0,1]",
    });
    expect(result.rawResult).toMatchObject({
      providerUsed: "lc_submit",
      judgeEvidence: {
        totalCorrect: 12,
        totalTestcases: 63,
        compareResult: "111111111111000000",
        firstFailedOrdinal: 13,
        lastTestcase: "[3,2,4]\n6",
        expectedOutput: "[1,2]",
        codeOutput: "[0,1]",
      },
    });
  });

  it("normalizes interpret compare_result into per-case test results", () => {
    const result = normalizeLcRunResult({
      raw: {
        check: {
          run_success: true,
          compare_result: "10",
          code_answer: ["[0,1]", "[0,0]"],
          expected_code_answer: ["[0,1]", "[1,2]"],
          status_runtime: "5 ms",
        },
      },
      testCases: [
        {
          id: "case-1",
          label: "sample",
          input: "[2,7,11,15]\n9",
          expected: "[0,1]",
        },
        {
          id: "case-2",
          label: "middle pair",
          input: "[3,2,4]\n6",
          expected: "[1,2]",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.failureProvenance).toBe("user_code");
    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.firstFailedCase?.id).toBe("case-2");
    expect(result.testResults).toMatchObject([
      { id: "case-1", status: "passed", stdoutCaptured: false },
      { id: "case-2", status: "failed", stdoutCaptured: false },
    ]);
    expect(result.rawResult).toMatchObject({ providerUsed: "lc_run" });
  });

  it("marks LeetCode service errors as judge-service provenance", () => {
    const result = normalizeLcSubmitResult({
      raw: {
        state: "FAILURE",
        status_msg: "Service Unavailable",
      },
    });

    expect(result.status).toBe("runner_error");
    expect(result.failureProvenance).toBe("judge_service");
  });

  it("keeps fatal signal runtime errors attributed to user code", () => {
    const result = normalizeLcSubmitResult({
      raw: {
        check: {
          status_msg: "Runtime Error",
          runtime_error: "Sandbox keeper received fatal signal 6",
          total_correct: 0,
          total_testcases: 63,
          last_testcase: "\"（12\"",
        },
      },
    });

    expect(result.status).toBe("runtime_error");
    expect(result.failureProvenance).toBe("user_code");
    expect(result.stderr).toBe("Sandbox keeper received fatal signal 6");
    expect(result.errorDetail).toMatchObject({
      kind: "process_aborted",
      title: "User code process aborted",
    });
    expect(result.errorDetail?.summary).toContain("user-code process");
    expect(result.errorDetail?.summary).not.toContain("Piston");
  });

  it("marks unsupported-language style submit responses as user input provenance", () => {
    const result = normalizeLcSubmitResult({
      raw: {
        status_msg: "Unsupported Language",
      },
    });

    expect(result.status).toBe("unsupported_language");
    expect(result.failureProvenance).toBe("user_input");
  });
});

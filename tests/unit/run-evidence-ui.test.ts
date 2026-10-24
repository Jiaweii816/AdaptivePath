import { describe, expect, it } from "vitest";
import type { CodeRunTestResult } from "@/types/code-runner";
import {
  actualOutputText,
  deriveTestcaseStatus,
  formatCapturedOutput,
  formatOutputDiff,
  formatTestcaseStreamOutput,
} from "@/features/workbench/run-evidence-ui";

const baseResult: CodeRunTestResult = {
  id: "case-1",
  label: "sample",
  input: { nums: [1] },
  expected: 1,
  actual: 1,
  passed: true,
  status: "passed",
};

describe("run evidence UI helpers", () => {
  it("derives explicit testcase statuses", () => {
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        testResult: baseResult,
      }),
    ).toBe("passed");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        testResult: { ...baseResult, passed: false, status: "failed" },
      }),
    ).toBe("failed");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        testResult: { ...baseResult, passed: false, status: "runtime_error" },
      }),
    ).toBe("runtime_error");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: true,
        projectOverallError: true,
      }),
    ).toBe("running");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: false,
        isPending: false,
        projectOverallError: true,
        runStatus: "failed",
      }),
    ).toBe("not_run");
  });

  it("projects whole-run errors only when allowed", () => {
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        runStatus: "syntax_error",
      }),
    ).toBe("compile_error");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        runStatus: "timeout",
      }),
    ).toBe("timeout");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: true,
        runStatus: "runner_error",
      }),
    ).toBe("internal_error");
    expect(
      deriveTestcaseStatus({
        isEvidenceSelected: true,
        isPending: false,
        projectOverallError: false,
        runStatus: "compile_error",
      }),
    ).toBe("not_run");
  });

  it("does not create a diff when actual output is missing", () => {
    const missingActual = { ...baseResult, actual: undefined, passed: false, status: "failed" as const };

    expect(actualOutputText(missingActual)).toBe("No actual output captured");
    expect(formatOutputDiff(missingActual.expected, missingActual.actual)).toBeNull();
  });

  it("formats real output diffs and captured stream states", () => {
    expect(formatOutputDiff(1, 2)).toContain("first difference at char");
    expect(formatCapturedOutput(undefined, undefined)).toEqual({
      label: "not_captured",
      text: "not captured",
    });
    expect(formatCapturedOutput("", true)).toEqual({
      label: "empty",
      text: "empty",
    });
    expect(formatCapturedOutput("debug", true)).toEqual({
      label: "captured",
      text: "debug",
    });
  });

  it("does not fall back to whole-run stdout for testcase streams", () => {
    expect(
      formatTestcaseStreamOutput({
        status: "passed",
        testValue: undefined,
        testCaptured: false,
      }),
    ).toEqual({
      label: "not_captured",
      text: "not captured",
    });

    expect(
      formatTestcaseStreamOutput({
        status: "passed",
        testValue: "debug from case 1",
        testCaptured: true,
      }),
    ).toEqual({
      label: "captured",
      text: "debug from case 1",
    });
  });
});

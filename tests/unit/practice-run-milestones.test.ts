import { describe, expect, it } from "vitest";
import {
  buildFailureSignature,
  classifyRunTransition,
  foldRunSequence,
  normalizeStatusClass,
  type PracticeRunMilestoneRun,
} from "@/server/memory/l1-trace/practice-run-milestones";
import type { CodeRunStatus } from "@/types/code-runner";

function run(
  id: string,
  status: CodeRunStatus,
  overrides: Partial<PracticeRunMilestoneRun> & {
    failedTest?: { id: string; status: string };
  } = {},
): PracticeRunMilestoneRun {
  const { failedTest, ...runOverrides } = overrides;

  return {
    id,
    runOrdinal: Number(id.replace(/\D/g, "")) || 1,
    status,
    executionFingerprint: `fingerprint-${id}`,
    selectedTestCaseIds: '["case-1"]',
    rawResultJson: JSON.stringify({
      testResults: failedTest
        ? [
            { id: "passed-first", status: "passed", passed: true },
            {
              id: failedTest.id,
              status: failedTest.status,
              passed: false,
            },
          ]
        : [],
    }),
    ...runOverrides,
  };
}

describe("practice run milestones", () => {
  it.each([
    ["passed_visible_tests", "passed"],
    ["failed", "tests_failed"],
    ["compile_error", "compile_error"],
    ["syntax_error", "compile_error"],
    ["runtime_error", "runtime_error"],
    ["timeout", "timeout"],
    ["runner_error", undefined],
    ["no_tests", undefined],
    ["empty_code", undefined],
    ["unsupported_language", undefined],
  ] as const)("normalizes %s to %s", (status, expected) => {
    expect(normalizeStatusClass(status)).toBe(expected);
  });

  it("builds the specified signature from the first non-passed test", () => {
    expect(
      buildFailureSignature(
        run("run-1", "failed", {
          failedTest: { id: "edge-2", status: "runtime_error" },
        }),
      ),
    ).toBe("tests_failed:edge-2:runtime_error");
    expect(buildFailureSignature(run("run-2", "runtime_error"))).toBe(
      "runtime_error:none:none",
    );
    expect(
      buildFailureSignature(run("run-3", "passed_visible_tests")),
    ).toBeUndefined();
  });

  it("classifies the first valid run as R1", () => {
    expect(classifyRunTransition(undefined, run("run-1", "failed"))).toEqual({
      reason: "first_run",
      after: {
        executionFingerprint: "fingerprint-run-1",
        statusClass: "tests_failed",
        failureSignature: "tests_failed:none:none",
      },
      eligibleForL2: false,
    });
  });

  it("backtracks past suppressed rows to the latest valid baseline", () => {
    const history = [
      run("run-3", "runner_error"),
      run("run-2", "no_tests"),
      run("run-1", "failed", {
        failedTest: { id: "case-1", status: "failed" },
      }),
    ];

    expect(
      classifyRunTransition(history, run("run-4", "passed_visible_tests")),
    ).toMatchObject({
      reason: "fail_to_pass",
      before: {
        statusClass: "tests_failed",
        failureSignature: "tests_failed:case-1:failed",
      },
      after: { statusClass: "passed" },
      eligibleForL2: false,
    });
  });

  it("classifies status changes as R2 and reserves fail_to_pass for a changed fingerprint", () => {
    const previous = run("run-1", "compile_error", {
      executionFingerprint: "same-code",
    });

    expect(
      classifyRunTransition(previous, run("run-2", "failed")),
    ).toMatchObject({ reason: "status_class_changed" });
    expect(
      classifyRunTransition(
        run("run-3", "failed", { executionFingerprint: "same-code" }),
        run("run-4", "passed_visible_tests", {
          executionFingerprint: "same-code",
        }),
      ),
    ).toMatchObject({ reason: "status_class_changed" });
    expect(
      classifyRunTransition(
        run("run-5", "failed", { executionFingerprint: "old-code" }),
        run("run-6", "passed_visible_tests", {
          executionFingerprint: "fixed-code",
        }),
      ),
    ).toMatchObject({ reason: "fail_to_pass" });
  });

  it("classifies a changed failure signature after a code change as R3", () => {
    const previous = run("run-1", "failed", {
      executionFingerprint: "old-code",
      failedTest: { id: "case-1", status: "failed" },
    });
    const current = run("run-2", "failed", {
      executionFingerprint: "new-code",
      failedTest: { id: "case-2", status: "runtime_error" },
    });

    expect(classifyRunTransition(previous, current)).toMatchObject({
      reason: "failure_signature_changed",
      before: { failureSignature: "tests_failed:case-1:failed" },
      after: {
        failureSignature: "tests_failed:case-2:runtime_error",
      },
      eligibleForL2: false,
    });
  });

  it.each([
    "runner_error",
    "no_tests",
    "empty_code",
    "unsupported_language",
  ] as const)("suppresses a current %s result", (status) => {
    expect(
      classifyRunTransition(run("run-1", "failed"), run("run-2", status)),
    ).toBeUndefined();
  });

  it("suppresses an exact repeat and transitions that match no rule", () => {
    const previous = run("run-1", "failed", {
      executionFingerprint: "same-code",
      selectedTestCaseIds: '["case-1","case-2"]',
      failedTest: { id: "case-2", status: "failed" },
    });

    expect(
      classifyRunTransition(previous, {
        ...previous,
        id: "run-2",
        runOrdinal: 2,
      }),
    ).toBeUndefined();
    expect(
      classifyRunTransition(previous, {
        ...previous,
        id: "run-3",
        runOrdinal: 3,
        selectedTestCaseIds: '["case-2"]',
      }),
    ).toBeUndefined();
    expect(
      classifyRunTransition(previous, {
        ...previous,
        id: "run-4",
        runOrdinal: 4,
        rawResultJson: run("replacement", "failed", {
          failedTest: { id: "case-1", status: "failed" },
        }).rawResultJson,
      }),
    ).toBeUndefined();
  });

  it("folds a run sequence, skips suppressed statuses for states, and caps ids at the latest 20", () => {
    const runs = Array.from({ length: 22 }, (_, index) =>
      run(`run-${index + 1}`, index === 21 ? "passed_visible_tests" : "failed", {
        executionFingerprint: `code-${index + 1}`,
        failedTest:
          index === 21
            ? undefined
            : {
                id: index % 2 === 0 ? "case-a" : "case-b",
                status: "failed",
              },
      }),
    );
    runs.splice(1, 0, run("run-suppressed", "runner_error"));

    expect(foldRunSequence(runs)).toEqual({
      runCount: 23,
      practiceRunLogIds: runs.slice(-20).map((item) => item.id),
      before: {
        executionFingerprint: "code-1",
        statusClass: "tests_failed",
        failureSignature: "tests_failed:case-a:failed",
      },
      after: {
        executionFingerprint: "code-22",
        statusClass: "passed",
      },
      failureSignatureCount: 2,
      eligibleForL2: false,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  PISTON_RESULT_MARKER,
  normalizeMockOutcome,
  normalizePistonResponse,
  type RawMockRunnerOutcome,
} from "@/server/tools/code-runner/normalize-run-result";
import type { CodeRunStatus, CodeRunTestCase } from "@/types/code-runner";

const testCases: CodeRunTestCase[] = [
  {
    id: "case-1",
    label: "insert in middle",
    input: { nums: [1, 3, 5, 6], target: 2 },
    expected: 1,
    source: "sample",
  },
];

describe("normalizeMockOutcome", () => {
  it.each<[RawMockRunnerOutcome, CodeRunStatus]>([
    [{ kind: "passed" }, "passed_visible_tests"],
    [{ kind: "failed", actual: 2, expected: 1 }, "failed"],
    [{ kind: "compile_error" }, "compile_error"],
    [{ kind: "syntax_error" }, "syntax_error"],
    [{ kind: "runtime_error" }, "runtime_error"],
    [{ kind: "timeout" }, "timeout"],
    [{ kind: "no_tests" }, "no_tests"],
    [{ kind: "runner_error" }, "runner_error"],
    [{ kind: "empty_code" }, "empty_code"],
    [{ kind: "unsupported_language" }, "unsupported_language"],
  ])("maps %j to %s", (outcome, status) => {
    const result = normalizeMockOutcome(outcome, testCases);

    expect(result.status).toBe(status);
    expect(result.failureProvenance).toBe(
      status === "no_tests" ||
        status === "empty_code" ||
        status === "unsupported_language"
        ? "user_input"
        : status === "runner_error"
          ? "sandbox_service"
          : "user_code",
    );
    expect(result.passedCount).toBeGreaterThanOrEqual(0);
    expect(result.failedCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
  });

  it("sets per-test statuses for mock pass and failure results", () => {
    expect(
      normalizeMockOutcome({ kind: "passed" }, testCases).testResults[0],
    ).toMatchObject({
      passed: true,
      status: "passed",
    });
    expect(
      normalizeMockOutcome(
        { kind: "failed", actual: 2, expected: 1 },
        testCases,
      ).testResults[0],
    ).toMatchObject({
      passed: false,
      status: "failed",
    });
  });
});

describe("normalizePistonResponse", () => {
  it("maps Python SyntaxError output to syntax_error", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: "",
          stderr: "SyntaxError: invalid syntax",
          code: 1,
          signal: null,
          message: null,
          status: "RE",
        },
      },
    });

    expect(result.status).toBe("syntax_error");
    expect(result.failureProvenance).toBe("user_code");
  });

  it("sets runtime_error status on the failing harness testcase", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: `${PISTON_RESULT_MARKER}${JSON.stringify({
            status: "runtime_error",
            testResults: [
              {
                id: "case-1",
                label: "sample",
                input: { nums: [1] },
                expected: 1,
                actual: null,
                passed: false,
                error: "ValueError: boom",
                errorLocation: { line: 7, column: 12 },
              },
            ],
            error: "ValueError: boom",
            errorLocation: { line: 7, column: 12 },
          })}\n`,
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.status).toBe("runtime_error");
    expect(result.failureProvenance).toBe("user_code");
    expect(result.testResults[0]).toMatchObject({
      status: "runtime_error",
      stderr: "ValueError: boom",
      stderrCaptured: true,
      errorLocation: { line: 7, column: 12 },
    });
    expect(result.errorLocation).toEqual({ line: 7, column: 12 });
    expect(result.firstFailedCase?.errorLocation).toEqual({
      line: 7,
      column: 12,
    });
  });

  it("adds a numeric-conversion detail for int/stoi runtime failures", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: `${PISTON_RESULT_MARKER}${JSON.stringify({
            status: "runtime_error",
            testResults: [
              {
                id: "case-1",
                label: "custom",
                input: { s: "（12" },
                expected: 12,
                actual: null,
                passed: false,
                error:
                  "ValueError: invalid literal for int() with base 10: '（'",
              },
            ],
            error:
              "ValueError: invalid literal for int() with base 10: '（'",
          })}\n`,
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.status).toBe("runtime_error");
    expect(result.failureProvenance).toBe("user_code");
    expect(result.errorDetail).toMatchObject({
      kind: "invalid_numeric_conversion",
      title: "String-to-number conversion failed",
    });
    expect(result.errorDetail?.summary).toContain("not a valid number");
  });

  it("promotes harness syntax_error locations to the whole run", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: `${PISTON_RESULT_MARKER}${JSON.stringify({
            status: "syntax_error",
            testResults: [],
            error: "SyntaxError: invalid syntax",
            errorLocation: {
              line: 3,
              column: 18,
              endLine: 3,
              endColumn: 19,
            },
          })}\n`,
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.status).toBe("syntax_error");
    expect(result.failedCount).toBe(1);
    expect(result.errorLocation).toEqual({
      line: 3,
      column: 18,
      endLine: 3,
      endColumn: 19,
    });
  });

  it("preserves user stdout before the private harness marker", () => {
    const result = normalizePistonResponse({
      language: "C++",
      pistonResponse: {
        run: {
          stdout: `debug from printf\n${PISTON_RESULT_MARKER}${JSON.stringify({
            status: "completed",
            testResults: [
              {
                id: "case-1",
                label: "sample",
                input: { nums: [1] },
                expected: 1,
                actual: 1,
                passed: true,
              },
            ],
          })}\n`,
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.status).toBe("passed_visible_tests");
    expect(result.stdout).toBe("debug from printf");
  });

  it("preserves per-test harness stdout and stderr separately", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: `${PISTON_RESULT_MARKER}${JSON.stringify({
            status: "completed",
            testResults: [
              {
                id: "case-1",
                label: "sample 1",
                input: { path: "/home/" },
                expected: "/home",
                actual: null,
                passed: false,
                stdout: "['', 'home', '']",
                stderr: "",
                stdoutCaptured: true,
                stderrCaptured: true,
              },
              {
                id: "case-2",
                label: "sample 2",
                input: { path: "/home//foo/" },
                expected: "/home/foo",
                actual: null,
                passed: false,
                stdout: "['', 'home', '', 'foo', '']",
                stderr: "case 2 warning",
                stdoutCaptured: true,
                stderrCaptured: true,
              },
            ],
          })}\n`,
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.testResults).toHaveLength(2);
    expect(result.testResults[0]).toMatchObject({
      id: "case-1",
      stdout: "['', 'home', '']",
      stderr: "",
      stdoutCaptured: true,
      stderrCaptured: true,
    });
    expect(result.testResults[1]).toMatchObject({
      id: "case-2",
      stdout: "['', 'home', '', 'foo', '']",
      stderr: "case 2 warning",
      stdoutCaptured: true,
      stderrCaptured: true,
    });
  });

  it("marks missing harness markers as adapter provenance", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: "plain user output without harness marker",
          stderr: "",
          code: 0,
          signal: null,
          message: null,
        },
      },
    });

    expect(result.status).toBe("runner_error");
    expect(result.failureProvenance).toBe("adapter");
  });

  it("marks Piston sandbox keeper crashes as unavailable evidence", () => {
    const result = normalizePistonResponse({
      language: "Python",
      pistonResponse: {
        run: {
          stdout: "",
          stderr: "Sandbox keeper received fatal signal 6",
          code: 1,
          signal: "SIGABRT",
          message: null,
          status: "RE",
        },
      },
    });

    expect(result.status).toBe("runner_error");
    expect(result.failureProvenance).toBe("sandbox_service");
    expect(result.stderr).toBe("Sandbox keeper received fatal signal 6");
    expect(result.errorDetail).toMatchObject({
      kind: "runner_unavailable",
      title: "Execution evidence is unavailable",
    });
  });
});

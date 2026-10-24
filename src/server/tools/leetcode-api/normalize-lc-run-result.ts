import {
  codeRunResultSchema,
  type CodeRunResult,
  type CodeRunTestCase,
  type CodeRunTestResult,
} from "@/types/code-runner";
import {
  stringifyOutput,
  truncateText,
} from "@/server/tools/code-runner/normalize-run-result";
import type { FailureProvenance } from "@/types/evidence";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";

type NormalizedRunArgs = {
  raw: unknown;
  testCases?: CodeRunTestCase[];
};

export function normalizeLcRunResult({
  raw,
  testCases = [],
}: NormalizedRunArgs): CodeRunResult {
  const rawRecord = asRecord(raw);
  const check = asOptionalRecord(rawRecord.check) ?? rawRecord;

  if (check.run_success === false) {
    const status = mapRunFailureStatus(readString(check.status_msg));

    return buildResult({
      status,
      failureProvenance: provenanceForRunStatus(status),
      passedCount: 0,
      failedCount: testCases.length || 1,
      stdout: readStdout(check),
      stderr: readError(check) ?? "",
      durationMs: parseDurationMs(
        readString(check.status_runtime) ?? readString(check.elapsed_time),
      ),
      testResults: [],
      rawResult: {
        providerUsed: "lc_run",
        ...rawRecord,
      },
    });
  }

  const flags = readCompareFlags(check.compare_result);
  const actuals = readList(
    check.code_answer ?? check.code_output ?? check.code_output_list,
  );
  const expecteds = readList(
    check.expected_code_answer ??
      check.expected_output ??
      check.correct_answer ??
      check.expected_output_list,
  );
	  const stdoutList = readList(check.std_output_list);
	  const resultCount = Math.max(testCases.length, flags.length, actuals.length);
	  const testResults = Array.from({ length: resultCount }).map<CodeRunTestResult>(
	    (_, index) => {
	      const testCase = testCases[index];
	      const expected = expecteds[index] ?? testCase?.expected ?? null;
	      const actual = actuals[index] ?? undefined;
	      const passed = flags[index] ?? actual === expected;
	      const stdoutCaptured = stdoutList[index] !== undefined;

	      return {
	        id: testCase?.id ?? `leetcode-run-case-${index + 1}`,
	        label: testCase?.label ?? `LeetCode run case ${index + 1}`,
	        input: testCase?.input ?? null,
	        expected,
	        actual,
	        stdout:
	          stdoutCaptured ? String(stdoutList[index]) : undefined,
	        stdoutCaptured,
	        stderrCaptured: false,
	        passed,
	        status: passed ? "passed" : "failed",
	      };
	    },
	  );
  const passedCount = testResults.filter((result) => result.passed).length;
  const firstFailed = testResults.find((result) => !result.passed);

  return buildResult({
    status: firstFailed ? "failed" : "passed_visible_tests",
    failureProvenance: "user_code",
    passedCount,
    failedCount: testResults.length - passedCount,
    stdout: readStdout(check),
    stderr: readError(check) ?? "",
    durationMs: parseDurationMs(
      readString(check.status_runtime) ?? readString(check.elapsed_time),
    ),
    actualOutput: stringifyOutput(firstFailed?.actual),
    expectedOutput: stringifyOutput(firstFailed?.expected),
    firstFailedCase: firstFailed
      ? {
          id: firstFailed.id,
          label: firstFailed.label,
          input: firstFailed.input,
          expected: firstFailed.expected,
          actual: firstFailed.actual,
        }
      : undefined,
    testResults,
    rawResult: {
      providerUsed: "lc_run",
      ...rawRecord,
    },
  });
}

function mapRunFailureStatus(statusMessage: string | undefined) {
  switch ((statusMessage ?? "").toLowerCase()) {
    case "compile error":
      return "compile_error";
    case "time limit exceeded":
      return "timeout";
    case "runtime error":
    case "memory limit exceeded":
      return "runtime_error";
    default:
      return "runner_error";
  }
}

function provenanceForRunStatus(status: CodeRunResult["status"]): FailureProvenance {
  switch (status) {
    case "compile_error":
    case "timeout":
    case "runtime_error":
    case "syntax_error":
    case "failed":
    case "passed_visible_tests":
      return "user_code";
    case "empty_code":
    case "no_tests":
    case "unsupported_language":
      return "user_input";
    case "runner_error":
      return "judge_service";
  }
}

function readCompareFlags(value: unknown) {
  if (typeof value === "string") {
    return value
      .trim()
      .split("")
      .filter((char) => char === "0" || char === "1")
      .map((char) => char === "1");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => entry === true || entry === 1 || entry === "1");
  }

  return [];
}

function readList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value ? [value] : [];
  }

  return value === undefined || value === null ? [] : [value];
}

function readStdout(check: Record<string, unknown>) {
  const stdoutList = readList(check.std_output_list);

  if (stdoutList.length > 0) {
    return stdoutList.map((entry) => String(entry)).join("\n");
  }

  return readString(check.std_output) ?? "";
}

function readError(check: Record<string, unknown>) {
  return (
    readString(check.full_compile_error) ??
    readString(check.compile_error) ??
    readString(check.runtime_error) ??
    readString(check.status_msg)
  );
}

function parseDurationMs(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(\d+)/);

  return match ? Number(match[1]) : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asOptionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return asOptionalRecord(value) ?? {};
}

function buildResult(result: CodeRunResult) {
  return attachCodeRunErrorDetail(codeRunResultSchema.parse({
    ...result,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr),
  }));
}

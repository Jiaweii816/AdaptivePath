import { codeRunResultSchema, type CodeRunResult } from "@/types/code-runner";
import {
  stringifyOutput,
  truncateText,
} from "@/server/tools/code-runner/normalize-run-result";
import type { FailureProvenance } from "@/types/evidence";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";

type NormalizedSubmitArgs = {
  raw: unknown;
};

export function normalizeLcSubmitResult({
  raw,
}: NormalizedSubmitArgs): CodeRunResult {
  const rawRecord = asRecord(raw);
  const check = asOptionalRecord(rawRecord.check) ?? rawRecord;
  const statusMessage = readString(check.status_msg) ?? readString(check.status);
  const status = mapSubmitStatus({
    statusMessage,
    runSuccess: check.run_success,
  });
  const totalTestcases = readNumber(check.total_testcases);
  const totalCorrect = readNumber(check.total_correct);
  const compareResult = readString(check.compare_result);
  const passedCount =
    status === "passed_visible_tests"
      ? totalTestcases ?? totalCorrect ?? 0
      : totalCorrect ?? 0;
  const failedCount =
    totalTestcases !== undefined
      ? Math.max(0, totalTestcases - passedCount)
      : status === "passed_visible_tests"
        ? 0
        : 1;
  const firstFailedCase =
    status !== "passed_visible_tests"
      ? {
          id: "leetcode-first-failed",
          label: statusMessage ?? "LeetCode judge failure",
          input: readString(check.last_testcase) ?? null,
          expected:
            readString(check.expected_output) ??
            readString(check.expected_code_answer) ??
            null,
          actual:
            readString(check.code_output) ??
            readString(check.code_answer) ??
            undefined,
          error: readError(check),
        }
      : undefined;

  return buildResult({
    status,
    failureProvenance: provenanceForSubmitStatus(status),
    passedCount,
    failedCount,
    stdout: readString(check.std_output) ?? "",
    stderr: readError(check) ?? "",
    durationMs: parseDurationMs(readString(check.status_runtime)),
    actualOutput: stringifyOutput(firstFailedCase?.actual),
    expectedOutput: stringifyOutput(firstFailedCase?.expected),
    firstFailedCase,
    testResults: [],
    rawResult: {
      providerUsed: "lc_submit",
      judgeEvidence: {
        statusMessage,
        totalCorrect,
        totalTestcases,
        compareResult,
        firstFailedOrdinal:
          status !== "passed_visible_tests" && totalCorrect !== undefined
            ? totalCorrect + 1
            : undefined,
        lastTestcase: readString(check.last_testcase),
        expectedOutput:
          readString(check.expected_output) ??
          readString(check.expected_code_answer),
        codeOutput:
          readString(check.code_output) ?? readString(check.code_answer),
      },
      ...rawRecord,
    },
  });
}

function provenanceForSubmitStatus(status: CodeRunResult["status"]): FailureProvenance {
  switch (status) {
    case "passed_visible_tests":
    case "failed":
    case "timeout":
    case "runtime_error":
    case "compile_error":
    case "syntax_error":
      return "user_code";
    case "empty_code":
    case "no_tests":
    case "unsupported_language":
      return "user_input";
    case "runner_error":
      return "judge_service";
  }
}

function mapSubmitStatus(args: {
  statusMessage?: string;
  runSuccess: unknown;
}): CodeRunResult["status"] {
  if (args.runSuccess === false && !args.statusMessage) {
    return "runner_error";
  }

  switch ((args.statusMessage ?? "").toLowerCase()) {
    case "accepted":
      return "passed_visible_tests";
    case "wrong answer":
    case "output limit exceeded":
      return "failed";
    case "time limit exceeded":
      return "timeout";
    case "memory limit exceeded":
    case "runtime error":
      return "runtime_error";
    case "compile error":
      return "compile_error";
    case "unsupported language":
      return "unsupported_language";
    case "empty code":
      return "empty_code";
    case "no testcases":
    case "no tests":
      return "no_tests";
    default:
      return args.runSuccess === false ? "runner_error" : "runner_error";
  }
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

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return asOptionalRecord(value) ?? {};
}

function asOptionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function buildResult(result: CodeRunResult) {
  return attachCodeRunErrorDetail(codeRunResultSchema.parse({
    ...result,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr),
  }));
}

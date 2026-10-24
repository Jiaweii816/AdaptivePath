import { z } from "zod";
import {
  codeRunErrorLocationSchema,
  codeRunResultSchema,
  type CodeRunFirstFailedCase,
  type CodeRunResult,
  type CodeRunStatus,
  type CodeRunTestCase,
  type CodeRunTestResult,
  type CodeRunnerLanguage,
} from "@/types/code-runner";
import type { FailureProvenance } from "@/types/evidence";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";

export const PISTON_RESULT_MARKER = "__PATTERNCOACH_RESULT__:";
const MAX_OUTPUT_LENGTH = 16 * 1024;

export const rawMockRunnerOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passed") }),
  z.object({
    kind: z.literal("failed"),
    actual: z.unknown().optional(),
    expected: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("compile_error"),
    stderr: z.string().optional(),
  }),
  z.object({
    kind: z.literal("syntax_error"),
    stderr: z.string().optional(),
  }),
  z.object({
    kind: z.literal("runtime_error"),
    stderr: z.string().optional(),
  }),
  z.object({ kind: z.literal("timeout"), stderr: z.string().optional() }),
  z.object({ kind: z.literal("no_tests") }),
  z.object({ kind: z.literal("runner_error"), stderr: z.string().optional() }),
  z.object({ kind: z.literal("empty_code") }),
  z.object({ kind: z.literal("unsupported_language"), stderr: z.string().optional() }),
]);

export const pistonStageResultSchema = z.object({
  stdout: z.string().default(""),
  stderr: z.string().default(""),
  output: z.string().optional(),
  code: z.number().nullable().optional(),
  signal: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  wall_time: z.number().optional(),
});

export const pistonExecuteResponseSchema = z.object({
  language: z.string().optional(),
  version: z.string().optional(),
  compile: pistonStageResultSchema.optional(),
  run: pistonStageResultSchema.optional(),
  message: z.string().optional(),
});

const harnessTestResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  input: z.unknown(),
  expected: z.unknown(),
  actual: z.unknown().optional(),
  passed: z.boolean(),
  error: z.string().optional(),
  errorLocation: codeRunErrorLocationSchema.optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  stdoutCaptured: z.boolean().optional(),
  stderrCaptured: z.boolean().optional(),
});

const harnessPayloadSchema = z.object({
  status: z.enum(["completed", "runtime_error", "syntax_error"]),
  testResults: z.array(harnessTestResultSchema).default([]),
  error: z.string().optional(),
  errorLocation: codeRunErrorLocationSchema.optional(),
});

export type RawMockRunnerOutcome = z.infer<typeof rawMockRunnerOutcomeSchema>;
export type PistonExecuteResponse = z.infer<typeof pistonExecuteResponseSchema>;

export function truncateText(value: string | null | undefined) {
  const text = value ?? "";

  if (text.length <= MAX_OUTPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_OUTPUT_LENGTH)}\n[truncated]`;
}

export function stringifyOutput(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeMockOutcome(
  rawOutcome: RawMockRunnerOutcome,
  testCases: CodeRunTestCase[] = [],
): CodeRunResult {
  const outcome = rawMockRunnerOutcomeSchema.parse(rawOutcome);
  const firstTest = testCases[0];

  switch (outcome.kind) {
    case "passed": {
      const testResults = testCases.map<CodeRunTestResult>((testCase) => ({
        id: testCase.id,
        label: testCase.label,
        input: testCase.input,
        expected: testCase.expected,
        actual: testCase.expected,
        passed: true,
        status: "passed",
        stdoutCaptured: false,
        stderrCaptured: false,
      }));

      return buildResult({
        status: "passed_visible_tests",
        failureProvenance: "user_code",
        passedCount: testResults.length,
        failedCount: 0,
        testResults,
        stdout: "mock runner: visible tests passed",
        stderr: "",
      });
    }

    case "failed": {
      const failedCase = firstTest
        ? {
            id: firstTest.id,
            label: firstTest.label,
            input: firstTest.input,
            expected: outcome.expected ?? firstTest.expected,
            actual: outcome.actual ?? "__mock_actual__",
          }
        : undefined;
      const testResults = failedCase
        ? [
            {
              ...failedCase,
              passed: false,
              status: "failed" as const,
              stdoutCaptured: false,
              stderrCaptured: false,
            },
          ]
        : [];

      return buildResult({
        status: "failed",
        failureProvenance: "user_code",
        passedCount: 0,
        failedCount: failedCase ? 1 : 0,
        testResults,
        firstFailedCase: failedCase,
        actualOutput: stringifyOutput(failedCase?.actual),
        expectedOutput: stringifyOutput(failedCase?.expected),
        stdout: "mock runner: visible test failed",
        stderr: "",
      });
    }

    case "compile_error":
      return buildSimpleStatus("compile_error", outcome.stderr, {
        failureProvenance: "user_code",
      });
    case "syntax_error":
      return buildSimpleStatus("syntax_error", outcome.stderr, {
        failureProvenance: "user_code",
      });
    case "runtime_error":
      return buildSimpleStatus("runtime_error", outcome.stderr, {
        failureProvenance: "user_code",
      });
    case "timeout":
      return buildSimpleStatus("timeout", outcome.stderr, {
        failureProvenance: "user_code",
      });
    case "no_tests":
      return buildSimpleStatus("no_tests", "", {
        failureProvenance: "user_input",
      });
    case "runner_error":
      return buildSimpleStatus("runner_error", outcome.stderr, {
        failureProvenance: "sandbox_service",
      });
    case "empty_code":
      return buildSimpleStatus("empty_code", "", {
        failureProvenance: "user_input",
      });
    case "unsupported_language":
      return buildSimpleStatus("unsupported_language", outcome.stderr, {
        failureProvenance: "user_input",
      });
  }
}

export function normalizePistonResponse(args: {
  pistonResponse: PistonExecuteResponse;
  language?: CodeRunnerLanguage;
  durationMs?: number;
}): CodeRunResult {
  const pistonResponse = pistonExecuteResponseSchema.parse(args.pistonResponse);
  const durationMs =
    typeof args.durationMs === "number" && Number.isFinite(args.durationMs)
      ? Math.max(0, Math.trunc(args.durationMs))
      : undefined;
  const compile = pistonResponse.compile;
  const run = pistonResponse.run;

  if (pistonResponse.message && !run && !compile) {
    return buildSimpleStatus("runner_error", pistonResponse.message, {
      rawResult: pistonResponse,
      durationMs,
      failureProvenance: "sandbox_service",
    });
  }

  if (isTimeoutStage(compile) || isTimeoutStage(run)) {
    return buildSimpleStatus("timeout", compile?.stderr || run?.stderr, {
      rawResult: pistonResponse,
      durationMs,
      failureProvenance: "user_code",
    });
  }

  if (compile && isFailedStage(compile)) {
    return buildSimpleStatus("compile_error", compile.stderr || compile.output, {
      rawResult: pistonResponse,
      durationMs,
      failureProvenance: "user_code",
    });
  }

  if (!run) {
    return buildSimpleStatus("runner_error", "Piston returned no run stage.", {
      rawResult: pistonResponse,
      durationMs,
      failureProvenance: "sandbox_service",
    });
  }

  const marker = extractHarnessPayload(run.stdout);
  const userStdout = marker?.userStdout ?? run.stdout;

  if (!marker) {
    const runnerMessage =
      run.stderr || run.output || run.message || "No PatternCoach harness result was emitted.";

    if (isSandboxKeeperFailure(runnerMessage)) {
      return buildSimpleStatus("runner_error", runnerMessage, {
        rawResult: pistonResponse,
        stdout: userStdout,
        durationMs,
        failureProvenance: "sandbox_service",
      });
    }

    const failedStatus =
      args.language === "Python" && /SyntaxError/i.test(run.stderr || run.output || "")
        ? "syntax_error"
        : "runtime_error";

    return buildSimpleStatus(
      isFailedStage(run) ? failedStatus : "runner_error",
      runnerMessage,
      {
        rawResult: pistonResponse,
        stdout: userStdout,
        durationMs,
        failureProvenance: isFailedStage(run) ? "user_code" : "adapter",
      },
    );
  }

  if (!marker.payload.success) {
    return buildSimpleStatus("runner_error", marker.payload.error, {
      rawResult: pistonResponse,
      stdout: userStdout,
      stderr: run.stderr,
      durationMs,
      failureProvenance: "adapter",
    });
  }

  const harness = harnessPayloadSchema.parse(marker.payload.data);
  const testResults = normalizeHarnessTestResults(
    harness.testResults,
    harness.status,
  );
  const firstFailedCase = testResults.find((result) => !result.passed);

  if (harness.status === "syntax_error") {
    return buildResult({
      status: "syntax_error",
      failureProvenance: "user_code",
      passedCount: 0,
      failedCount: 1,
      testResults,
      stdout: userStdout,
      stderr: run.stderr || harness.error || "",
      errorLocation: harness.errorLocation,
      rawResult: pistonResponse,
      durationMs,
    });
  }

  if (harness.status === "runtime_error") {
    const errorLocation =
      harness.errorLocation ?? firstFailedCase?.errorLocation;

    return buildResult({
      status: "runtime_error",
      failureProvenance: "user_code",
      passedCount: testResults.filter((result) => result.passed).length,
      failedCount: firstFailedCase || harness.error ? 1 : 0,
      firstFailedCase: firstFailedCase
        ? toFirstFailedCase(firstFailedCase)
        : undefined,
      testResults,
      stdout: userStdout,
      stderr: run.stderr || harness.error || "",
      errorLocation,
      actualOutput: stringifyOutput(firstFailedCase?.actual),
      expectedOutput: stringifyOutput(firstFailedCase?.expected),
      rawResult: pistonResponse,
      durationMs,
    });
  }

  if (firstFailedCase) {
    const passedCount = testResults.filter((result) => result.passed).length;

    return buildResult({
      status: "failed",
      failureProvenance: "user_code",
      passedCount,
      failedCount: testResults.length - passedCount,
      firstFailedCase: toFirstFailedCase(firstFailedCase),
      testResults,
      stdout: userStdout,
      stderr: run.stderr,
      actualOutput: stringifyOutput(firstFailedCase.actual),
      expectedOutput: stringifyOutput(firstFailedCase.expected),
      rawResult: pistonResponse,
      durationMs,
    });
  }

  return buildResult({
    status: "passed_visible_tests",
    failureProvenance: "user_code",
    passedCount: testResults.length,
    failedCount: 0,
    testResults,
    stdout: userStdout,
    stderr: run.stderr,
    rawResult: pistonResponse,
    durationMs,
  });
}

export function normalizeIsolatedPistonCaseResults(args: {
  caseResults: Array<{ testCase: CodeRunTestCase; result: CodeRunResult }>;
  durationMs?: number;
}): CodeRunResult {
  const testResults: CodeRunTestResult[] = [];
  const firstProblem = args.caseResults.find(
    ({ result }) => result.status !== "passed_visible_tests",
  )?.result;

  for (const { testCase, result } of args.caseResults) {
    if (result.testResults.length > 0) {
      testResults.push(...result.testResults);
      continue;
    }

    const synthesized = synthesizeIsolatedCaseResult(testCase, result);

    if (synthesized) {
      testResults.push(synthesized);
    }
  }

  const firstFailedCase = testResults.find((result) => !result.passed);
  const passedCount = testResults.filter((result) => result.passed).length;
  const failedCount = testResults.filter((result) => !result.passed).length;
  const status = combinedStatus(firstProblem, firstFailedCase);
  const fallbackFailedCount =
    failedCount > 0 ? failedCount : status === "passed_visible_tests" ? 0 : 1;

  return buildResult({
    status,
    failureProvenance:
      firstProblem?.failureProvenance ??
      (status === "passed_visible_tests" || status === "failed"
        ? "user_code"
        : undefined),
    passedCount,
    failedCount: fallbackFailedCount,
    firstFailedCase: firstFailedCase
      ? toFirstFailedCase(firstFailedCase)
      : firstProblem?.firstFailedCase,
    testResults,
    stdout: firstNonEmpty(
      ...args.caseResults.map(({ result }) => result.stdout),
    ) ?? "",
    stderr: firstProblem?.stderr ?? "",
    actualOutput: stringifyOutput(
      firstFailedCase?.actual ?? firstProblem?.firstFailedCase?.actual,
    ),
    expectedOutput: stringifyOutput(
      firstFailedCase?.expected ?? firstProblem?.firstFailedCase?.expected,
    ),
    errorLocation: firstProblem?.errorLocation,
    rawResult: {
      strategy: "isolated_piston_cases",
      caseResults: args.caseResults.map(({ testCase, result }) => ({
        testCaseId: testCase.id,
        status: result.status,
        failureProvenance: result.failureProvenance,
        rawResult: result.rawResult,
      })),
    },
    durationMs: args.durationMs,
  });
}

function buildSimpleStatus(
  status: CodeRunStatus,
  stderr = "",
  extra: Partial<CodeRunResult> & { failureProvenance?: FailureProvenance } = {},
) {
  return buildResult({
    status,
    passedCount: 0,
    failedCount: 0,
    stdout: extra.stdout ?? "",
    stderr,
    testResults: [],
    ...extra,
  });
}

function buildResult(result: CodeRunResult): CodeRunResult {
  return attachCodeRunErrorDetail(codeRunResultSchema.parse({
    ...result,
    stdout: truncateText(result.stdout),
    stderr: truncateText(result.stderr),
  }));
}

function isTimeoutStage(stage: PistonExecuteResponse["run"]) {
  return stage?.status === "TO" || stage?.message?.toLowerCase().includes("timeout");
}

function isFailedStage(stage: PistonExecuteResponse["run"]) {
  return Boolean(
    stage &&
      (stage.status ||
        (typeof stage.code === "number" && stage.code !== 0) ||
        stage.signal),
  );
}

function isSandboxKeeperFailure(message: string) {
  return /sandbox keeper/i.test(message);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

function combinedStatus(
  firstProblem: CodeRunResult | undefined,
  firstFailedCase: CodeRunTestResult | undefined,
): CodeRunStatus {
  if (!firstProblem && !firstFailedCase) {
    return "passed_visible_tests";
  }

  if (firstProblem?.status === "compile_error") {
    return "compile_error";
  }

  if (firstProblem?.status === "syntax_error") {
    return "syntax_error";
  }

  if (firstProblem?.status === "runner_error") {
    return "runner_error";
  }

  if (firstProblem?.status === "timeout") {
    return "timeout";
  }

  if (firstProblem?.status === "runtime_error") {
    return "runtime_error";
  }

  return "failed";
}

function synthesizeIsolatedCaseResult(
  testCase: CodeRunTestCase,
  result: CodeRunResult,
): CodeRunTestResult | undefined {
  if (
    result.status !== "runner_error" &&
    result.status !== "timeout" &&
    result.status !== "runtime_error"
  ) {
    return undefined;
  }

  return {
    id: testCase.id,
    label: testCase.label,
    input: testCase.input,
    expected: testCase.expected,
    actual: undefined,
    passed: false,
    error: firstNonEmpty(
      result.firstFailedCase?.error,
      result.stderr,
      result.errorDetail?.summary,
    ),
    status:
      result.status === "timeout"
        ? "timeout"
        : result.status === "runtime_error"
          ? "runtime_error"
          : "internal_error",
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutCaptured: result.stdout.length > 0,
    stderrCaptured: result.stderr.length > 0,
  };
}

function normalizeHarnessTestResults(
  results: Array<z.infer<typeof harnessTestResultSchema>>,
  harnessStatus: z.infer<typeof harnessPayloadSchema>["status"],
): CodeRunTestResult[] {
  return results.map((result) => {
    const isRuntimeError =
      harnessStatus === "runtime_error" && !result.passed && Boolean(result.error);
    const stdoutCaptured =
      result.stdoutCaptured ?? result.stdout !== undefined;
    const stderr =
      result.stderr !== undefined ? result.stderr : result.error;
    const stderrCaptured =
      result.stderrCaptured ?? (stderr !== undefined && stderr.length > 0);

    return {
      ...result,
      status: result.passed ? "passed" : isRuntimeError ? "runtime_error" : "failed",
      stdout:
        result.stdout === undefined ? undefined : truncateText(result.stdout),
      stderr: stderr === undefined ? undefined : truncateText(stderr),
      stdoutCaptured,
      stderrCaptured,
    };
  });
}

function toFirstFailedCase(
  result: CodeRunTestResult,
): CodeRunFirstFailedCase {
  return {
    id: result.id,
    label: result.label,
    input: result.input,
    expected: result.expected,
    actual: result.actual,
    error: result.error,
    errorLocation: result.errorLocation,
  };
}

function extractHarnessPayload(stdout: string):
  | {
      userStdout: string;
      payload:
        | { success: true; data: unknown }
        | { success: false; error: string };
    }
  | undefined {
  const markerIndex = stdout.lastIndexOf(PISTON_RESULT_MARKER);

  if (markerIndex < 0) {
    return undefined;
  }

  const userStdout = stdout.slice(0, markerIndex).replace(/\n$/, "");
  const markerText = stdout.slice(markerIndex + PISTON_RESULT_MARKER.length);
  const jsonLine = markerText.split(/\r?\n/, 1)[0]?.trim() ?? "";

  try {
    return {
      userStdout,
      payload: { success: true, data: JSON.parse(jsonLine) as unknown },
    };
  } catch (error) {
    return {
      userStdout,
      payload: {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to parse PatternCoach harness result.",
      },
    };
  }
}

import type {
  CodeRunResult,
  CodeRunStatus,
  CodeRunTestResult,
  CodeRunTestStatus,
} from "@/types/code-runner";

export type CapturedOutputDisplay = {
  label: "captured" | "empty" | "not_captured";
  text: string;
};

export function deriveTestcaseStatus(args: {
  isEvidenceSelected: boolean;
  isPending: boolean;
  projectOverallError: boolean;
  runStatus?: CodeRunStatus;
  testResult?: CodeRunTestResult;
}): CodeRunTestStatus {
  if (args.testResult) {
    return args.testResult.status;
  }

  if (args.isPending && args.isEvidenceSelected) {
    return "running";
  }

  if (!args.isEvidenceSelected || !args.projectOverallError || !args.runStatus) {
    return "not_run";
  }

  switch (args.runStatus) {
    case "compile_error":
    case "syntax_error":
      return "compile_error";
    case "runtime_error":
      return "runtime_error";
    case "timeout":
      return "timeout";
    case "runner_error":
    case "empty_code":
    case "unsupported_language":
      return "internal_error";
    case "failed":
    case "no_tests":
    case "passed_visible_tests":
      return "not_run";
  }
}

export function testcaseStatusLabel(status: CodeRunTestStatus) {
  switch (status) {
    case "not_run":
      return "not_run";
    case "running":
      return "running";
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "runtime_error":
      return "runtime_error";
    case "compile_error":
      return "compile_error";
    case "timeout":
      return "timeout";
    case "internal_error":
      return "internal_error";
  }
}

export function isErrorStatus(status: CodeRunTestStatus) {
  return (
    status === "runtime_error" ||
    status === "compile_error" ||
    status === "timeout" ||
    status === "internal_error"
  );
}

export function hasActualOutput(testResult: CodeRunTestResult | undefined) {
  return Boolean(testResult && "actual" in testResult && testResult.actual !== undefined);
}

export function actualOutputText(testResult: CodeRunTestResult | undefined) {
  if (!testResult || !hasActualOutput(testResult)) {
    return "No actual output captured";
  }

  return formatOutputValue(testResult.actual);
}

export function formatCapturedOutput(
  value: string | undefined,
  captured: boolean | undefined,
): CapturedOutputDisplay {
  if (captured === false || value === undefined) {
    return { label: "not_captured", text: "not captured" };
  }

  if (value.length === 0) {
    return { label: "empty", text: "empty" };
  }

  return { label: "captured", text: value };
}

export function formatTestcaseStreamOutput(args: {
  status: CodeRunTestStatus;
  testValue: string | undefined;
  testCaptured: boolean | undefined;
}): CapturedOutputDisplay {
  if (args.status === "not_run") {
    return formatCapturedOutput(undefined, undefined);
  }

  if (args.testValue !== undefined) {
    return formatCapturedOutput(args.testValue, args.testCaptured ?? true);
  }

  return formatCapturedOutput(undefined, args.testCaptured);
}

export function formatOutputDiff(
  expected: unknown,
  actual: unknown,
): string | null {
  if (actual === undefined) {
    return null;
  }

  const expectedText = formatOutputValue(expected);
  const actualText = formatOutputValue(actual);

  if (expectedText === actualText) {
    return "matches";
  }

  if (expectedText.includes("\n") || actualText.includes("\n")) {
    return [
      "- expected",
      ...expectedText.split("\n").map((line) => `- ${line}`),
      "+ actual",
      ...actualText.split("\n").map((line) => `+ ${line}`),
    ].join("\n");
  }

  const firstDiffIndex = firstDifferenceIndex(expectedText, actualText);
  const expectedSlice = contextSlice(expectedText, firstDiffIndex);
  const actualSlice = contextSlice(actualText, firstDiffIndex);

  return [
    `first difference at char ${firstDiffIndex}`,
    `expected: ${expectedSlice}`,
    `actual:   ${actualSlice}`,
  ].join("\n");
}

export function runEvidenceTotal(args: {
  result: CodeRunResult;
  selectedTestCaseIds: string[];
}) {
  const returnedTotal = args.result.passedCount + args.result.failedCount;

  if (args.result.testResults.length > 0) {
    return Math.max(args.selectedTestCaseIds.length, returnedTotal);
  }

  return returnedTotal || args.selectedTestCaseIds.length;
}

function formatOutputValue(value: unknown) {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return parsed.ok ? stringifyPretty(parsed.value) : value;
  }

  return stringifyPretty(value);
}

function stringifyPretty(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(value: string):
  | { ok: true; value: unknown }
  | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function firstDifferenceIndex(left: string, right: string) {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return 0;
}

function contextSlice(value: string, index: number) {
  const start = Math.max(0, index - 20);
  const end = Math.min(value.length, index + 21);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";

  return `${prefix}${value.slice(start, end)}${suffix}`;
}

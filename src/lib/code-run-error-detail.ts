import {
  codeRunResultSchema,
  type CodeRunErrorDetail,
  type CodeRunResult,
  type CodeRunStatus,
  type CodeRunnerLanguage,
} from "@/types/code-runner";
import type { FailureProvenance } from "@/types/evidence";

type ErrorDetailInput = {
  status: CodeRunStatus;
  stderr?: string;
  failureProvenance?: FailureProvenance;
  firstFailedCase?: {
    error?: string;
  };
  rawResult?: unknown;
  language?: CodeRunnerLanguage;
};

type ErrorDetailDraft = Omit<CodeRunErrorDetail, "likelyCauses"> & {
  likelyCauses?: string[];
};

export function attachCodeRunErrorDetail(result: CodeRunResult): CodeRunResult {
  const parsed = codeRunResultSchema.parse(result);
  const errorDetail = parsed.errorDetail ?? deriveCodeRunErrorDetail(parsed);

  return errorDetail
    ? codeRunResultSchema.parse({ ...parsed, errorDetail })
    : parsed;
}

export function getCodeRunErrorDetail(
  result: CodeRunResult,
): CodeRunErrorDetail | undefined {
  return result.errorDetail ?? deriveCodeRunErrorDetail(result);
}

export function deriveCodeRunErrorDetail(
  input: ErrorDetailInput,
): CodeRunErrorDetail | undefined {
  const rawMessage = firstNonEmpty(
    input.firstFailedCase?.error,
    input.stderr,
    readRawRuntimeMessage(input.rawResult),
  );

  if (input.status === "passed_visible_tests" || input.status === "failed") {
    return undefined;
  }

  if (
    input.status === "empty_code" ||
    input.status === "no_tests" ||
    input.status === "unsupported_language"
  ) {
    return detail({
      kind: "user_input",
      title: "Input setup needs attention",
      summary: userInputSummary(input.status),
      nextStep: userInputNextStep(input.status),
      rawMessage,
    });
  }

  if (input.status === "compile_error") {
    return detail({
      kind: "compile_error",
      title: "User code did not compile",
      summary:
        "The compiler rejected the submitted code before any tests could run.",
      likelyCauses: [
        "missing include or type declaration",
        "mismatched braces or parentheses",
        "calling a method with the wrong signature",
      ],
      nextStep:
        "Fix the first compiler error first, then rerun the same selected tests.",
      rawMessage,
    });
  }

  if (input.status === "syntax_error") {
    return detail({
      kind: "syntax_error",
      title: "User code has a syntax error",
      summary:
        "The interpreter could not parse the submitted code, so the algorithm did not run yet.",
      likelyCauses: [
        "indentation mismatch",
        "missing colon or bracket",
        "invalid token near the reported line",
      ],
      nextStep:
        "Start at the reported line or the line just above it, fix syntax, then rerun.",
      rawMessage,
    });
  }

  if (input.status === "timeout") {
    return detail({
      kind: "timeout",
      title: "User code timed out",
      summary:
        "The code ran but did not finish within the execution time limit.",
      likelyCauses: [
        "infinite loop",
        "loop boundary not moving",
        "algorithm complexity too high for the input size",
      ],
      nextStep:
        "Check that each loop makes progress; if it does, inspect the main complexity bottleneck.",
      rawMessage,
    });
  }

  if (input.status === "runner_error") {
    return detail({
      kind: "runner_unavailable",
      title: "Execution evidence is unavailable",
      summary:
        "The execution tool did not return trustworthy code behavior for this attempt.",
      likelyCauses:
        input.failureProvenance === "user_code"
          ? ["user code stopped before the harness could report a case"]
          : [
              "judge or sandbox service issue",
              "adapter error",
              "network or provider error",
            ],
      nextStep:
        "Treat this as unavailable evidence, not a code verdict; rerun after the service is reachable.",
      rawMessage,
    });
  }

  if (input.status !== "runtime_error") {
    return rawMessage
      ? detail({
          kind: "unknown",
          title: "Run did not complete normally",
          summary:
            "The execution result did not map to a more specific diagnostic bucket.",
          nextStep: "Use the raw message and selected test to narrow the first failing operation.",
          rawMessage,
        })
      : undefined;
  }

  return runtimeErrorDetail(input, rawMessage);
}

function runtimeErrorDetail(
  input: ErrorDetailInput,
  rawMessage: string | undefined,
): CodeRunErrorDetail {
  const text = compactText(rawMessage);
  const language = input.language;

  if (matches(text, /invalid literal for int|invalid_argument|stoi|stol|stoll|stof|stod|numberformatexception|parseint|parse integer|base 10/i)) {
    return detail({
      kind: "invalid_numeric_conversion",
      title: "String-to-number conversion failed",
      summary:
        "A conversion such as int(...), stoi(...), or similar received text that was not a valid number.",
      likelyCauses: [
        "the parsed string contains punctuation or brackets",
        "the parsed string is empty",
        "the code split the input text at the wrong boundary",
      ],
      nextStep:
        "Inspect the exact substring being parsed before converting it; validate or strip it before int/stoi.",
      rawMessage,
    });
  }

  if (matches(text, /segmentation fault|sigsegv|fatal signal 11|signal:? 11\b|access violation/i)) {
    return detail({
      kind: "segmentation_fault",
      title: "User code accessed invalid memory",
      summary:
        "The user-code process crashed with an invalid memory access; the execution service only reported that crash.",
      likelyCauses: [
        "array or vector index out of range",
        "null pointer dereference",
        "using an invalid iterator or reference",
      ],
      nextStep:
        "Trace the failing case to the first index, pointer, or iterator access that can be invalid.",
      rawMessage,
    });
  }

  if (matches(text, /fatal signal 6|sigabrt|signal:? 6\b|abort(?:ed)?|terminate called/i)) {
    return detail({
      kind: "process_aborted",
      title: "User code process aborted",
      summary:
        "The execution service stayed available; it reported that the user-code process stopped with SIGABRT during runtime.",
      likelyCauses:
        language === "C++"
          ? [
              "uncaught C++ exception such as stoi/stoll invalid_argument",
              "assert(false) or abort()",
              "out-of-range access or corrupted memory",
            ]
          : [
              "uncaught runtime exception",
              "assert/abort in native code",
              "string-to-number conversion on non-numeric text",
            ],
      nextStep:
        "Look at the operation on the failing path that can throw or abort; validate string parsing and index bounds first.",
      rawMessage,
    });
  }

  if (matches(text, /indexerror|out_of_range|range_check|subscript|heap-buffer-overflow|stack-buffer-overflow|list index out of range|string index out of range/i)) {
    return detail({
      kind: "index_out_of_range",
      title: "Index or range access failed",
      summary:
        "The code tried to read or write outside a valid array, string, vector, or range.",
      likelyCauses: [
        "off-by-one boundary",
        "empty input not handled",
        "left/right pointer moved past the valid interval",
      ],
      nextStep:
        "Trace the failing case until the index is computed, then check it against the container length.",
      rawMessage,
    });
  }

  if (matches(text, /keyerror|unordered_map::at|map::at|no such key/i)) {
    return detail({
      kind: "missing_key",
      title: "Missing key access failed",
      summary:
        "The code read a dictionary or map key that was not present.",
      likelyCauses: [
        "using direct indexing when the key may be absent",
        "key/value stored in the opposite direction",
        "state not initialized before lookup",
      ],
      nextStep:
        "Check whether the key exists before reading it, or use a safe lookup path for this branch.",
      rawMessage,
    });
  }

  if (matches(text, /zerodivisionerror|division by zero|divide by zero|floating point exception|sigfpe|signal:? 8\b/i)) {
    return detail({
      kind: "divide_by_zero",
      title: "Division by zero",
      summary:
        "The code reached a division or modulo operation with zero as the divisor.",
      likelyCauses: [
        "empty count or length",
        "uninitialized divisor",
        "branch missing the zero case",
      ],
      nextStep:
        "Trace the divisor value immediately before division and add the missing zero-case branch.",
      rawMessage,
    });
  }

  if (matches(text, /recursionerror|maximum recursion depth|stack overflow|stack-overflow/i)) {
    return detail({
      kind: "recursion_or_stack_overflow",
      title: "Recursion or stack overflow",
      summary:
        "The code recursed too deeply or exhausted the call stack before finishing.",
      likelyCauses: [
        "missing base case",
        "recursive call does not shrink the input",
        "deep input needs an iterative approach",
      ],
      nextStep:
        "Check the base case and verify every recursive branch moves toward it.",
      rawMessage,
    });
  }

  if (matches(text, /bad_alloc|out of memory|memory limit exceeded|cannot allocate memory/i)) {
    return detail({
      kind: "memory_exhausted",
      title: "Memory limit hit during user code",
      summary:
        "The code allocated more memory than the execution limit allows.",
      likelyCauses: [
        "building a very large intermediate structure",
        "accidental infinite growth",
        "copying large containers repeatedly",
      ],
      nextStep:
        "Find the largest data structure allocated in the failing path and reduce or stream it.",
      rawMessage,
    });
  }

  if (matches(text, /assertionerror|assertion failed|\bassert\b/i)) {
    return detail({
      kind: "assertion_failure",
      title: "Assertion failed inside user code",
      summary:
        "An assertion in the submitted code or linked runtime failed during execution.",
      likelyCauses: [
        "an invariant was violated",
        "input shape differed from what the code assumed",
        "a debug assert remained in the submitted code",
      ],
      nextStep:
        "Check the asserted condition on the failing case and decide whether the condition or the code path is wrong.",
      rawMessage,
    });
  }

  return detail({
    kind: "uncaught_exception",
    title: "User code raised a runtime exception",
    summary:
      "The code started running but stopped because an exception or runtime failure was not handled.",
    likelyCauses: [
      "invalid type or value for an operation",
      "missing boundary check",
      "unexpected input shape on the failing case",
    ],
    nextStep:
      "Use the raw message and the failing input to locate the first operation that can raise.",
    rawMessage,
  });
}

function detail(value: ErrorDetailDraft): CodeRunErrorDetail {
  return {
    ...value,
    likelyCauses: value.likelyCauses ?? [],
    rawMessage: value.rawMessage?.trim() || undefined,
  };
}

function userInputSummary(status: CodeRunStatus) {
  switch (status) {
    case "empty_code":
      return "No code was provided for execution.";
    case "no_tests":
      return "There were no selected visible tests to run.";
    case "unsupported_language":
      return "This MVP can run only Python and C++ code.";
    default:
      return "The execution request is missing required user input.";
  }
}

function userInputNextStep(status: CodeRunStatus) {
  switch (status) {
    case "empty_code":
      return "Add a solution draft or ask for a thought-only hint instead of running.";
    case "no_tests":
      return "Select at least one visible test or add a custom test.";
    case "unsupported_language":
      return "Switch the workbench language to Python or C++.";
    default:
      return "Fix the request setup, then rerun.";
  }
}

function compactText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function matches(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim())?.trim();
}

function readRawRuntimeMessage(value: unknown): string | undefined {
  const raw = asRecord(value);
  const check = raw ? (asRecord(raw.check) ?? raw) : undefined;
  const run = raw ? asRecord(raw.run) : undefined;
  const compile = raw ? asRecord(raw.compile) : undefined;

  return firstNonEmpty(
    readString(check?.runtime_error),
    readString(check?.full_runtime_error),
    readString(check?.status_msg),
    readString(run?.stderr),
    readString(run?.output),
    readString(run?.message),
    readString(run?.signal),
    readString(compile?.stderr),
    readString(raw?.message),
  );
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

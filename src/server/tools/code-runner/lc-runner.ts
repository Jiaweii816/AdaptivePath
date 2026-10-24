import type { CodeRunResult, CodeRunTestCase } from "@/types/code-runner";
import type { FailureProvenance } from "@/types/evidence";
import {
  LcAuthError,
  LcExternalServiceError,
  LeetCodeApiClient,
} from "@/server/tools/leetcode-api/lc-api-client";
import { normalizeLcRunResult } from "@/server/tools/leetcode-api/normalize-lc-run-result";
import { normalizeLcSubmitResult } from "@/server/tools/leetcode-api/normalize-lc-submit-result";
import type { CodeRunnerInput, CodeRunnerProvider } from "./code-runner.types";
import { normalizeMockOutcome } from "./normalize-run-result";

export type LcRunnerOptions = {
  client?: Pick<LeetCodeApiClient, "submitSolution" | "runCode">;
};

export function createLcRunnerProvider(
  options: LcRunnerOptions = {},
): CodeRunnerProvider {
  const client = options.client ?? new LeetCodeApiClient();

  return {
    async run(input: CodeRunnerInput) {
      if (!input.code.trim()) {
        return withProvider(
          normalizeMockOutcome({ kind: "empty_code" }, input.testCases),
          input.executionKind,
        );
      }

      const lang = toLeetCodeLanguage(input.language);

      if (!lang) {
        return withProvider(
          normalizeMockOutcome(
            { kind: "unsupported_language" },
            input.testCases,
          ),
          input.executionKind,
        );
      }

      try {
        if (usesInterpretSolution(input.executionKind)) {
          const dataInput = buildDataInput(input.testCases);

          if (!dataInput) {
            return withProvider(
              normalizeMockOutcome({ kind: "no_tests" }, input.testCases),
              input.executionKind ?? "visible_run",
            );
          }

          const raw = await client.runCode({
            titleSlug: input.problem.slug,
            lang,
            typedCode: input.code,
            dataInput,
          });

          return normalizeLcRunResult({
            raw,
            testCases: input.testCases,
          });
        }

        const raw = await client.submitSolution({
          titleSlug: input.problem.slug,
          lang,
          typedCode: input.code,
        });

        return normalizeLcSubmitResult({ raw });
      } catch (error) {
        return withProvider(
          withProvenance(
            normalizeMockOutcome(
              {
                kind: "runner_error",
                stderr: toUserSafeRunnerError(error),
              },
              input.testCases,
            ),
            runnerErrorProvenance(error),
          ),
          input.executionKind,
        );
      }
    },
  };
}

function runnerErrorProvenance(error: unknown): FailureProvenance {
  if (error instanceof LcAuthError || error instanceof LcExternalServiceError) {
    return "judge_service";
  }

  return "network";
}

function withProvenance<T extends { failureProvenance?: FailureProvenance }>(
  result: T,
  failureProvenance: FailureProvenance,
) {
  return { ...result, failureProvenance };
}

function toUserSafeRunnerError(error: unknown) {
  if (error instanceof LcAuthError) {
    return error.message;
  }

  if (error instanceof LcExternalServiceError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown remote runner error.";
}

export function toLeetCodeLanguage(language: CodeRunnerInput["language"]) {
  if (language === "Python") {
    return "python3";
  }

  if (language === "C++") {
    return "cpp";
  }

  return null;
}

export function buildDataInput(testCases: CodeRunTestCase[]) {
  const chunks = testCases
    .map((testCase) => dataInputForTestCase(testCase))
    .filter((value): value is string => Boolean(value?.trim()));

  return chunks.join("\n");
}

function dataInputForTestCase(testCase: CodeRunTestCase) {
  if (typeof testCase.input === "string") {
    return testCase.input;
  }

  if (
    testCase.input &&
    typeof testCase.input === "object" &&
    !Array.isArray(testCase.input)
  ) {
    const record = testCase.input as Record<string, unknown>;

    if (typeof record.dataInput === "string") {
      return record.dataInput;
    }

    return Object.values(record).map(toLeetCodeInputLine).join("\n");
  }

  return toLeetCodeInputLine(testCase.input);
}

function toLeetCodeInputLine(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === undefined) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function withProvider(
  result: CodeRunResult,
  executionKind: CodeRunnerInput["executionKind"],
): CodeRunResult {
  const providerUsed = usesInterpretSolution(executionKind)
    ? "lc_run"
    : "lc_submit";

  return {
    ...result,
    rawResult: {
      providerUsed,
      result: result.rawResult,
    },
  };
}

function usesInterpretSolution(
  executionKind: CodeRunnerInput["executionKind"],
) {
  return executionKind === "chat_run" || executionKind === "visible_run";
}

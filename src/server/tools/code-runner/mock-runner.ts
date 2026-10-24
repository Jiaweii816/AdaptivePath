import type { CodeRunnerInput, CodeRunnerProvider } from "./code-runner.types";
import {
  normalizeMockOutcome,
  type RawMockRunnerOutcome,
} from "./normalize-run-result";

export type MockRunnerOptions = {
  outcome?: RawMockRunnerOutcome;
};

export function createMockCodeRunnerProvider(
  options: MockRunnerOptions = {},
): CodeRunnerProvider {
  return {
    async run(input: CodeRunnerInput) {
      if (!input.code.trim()) {
        return withProvider(
          normalizeMockOutcome({ kind: "empty_code" }, input.testCases),
        );
      }

      if (input.language !== "Python" && input.language !== "C++") {
        return withProvider(
          normalizeMockOutcome(
            { kind: "unsupported_language" },
            input.testCases,
          ),
        );
      }

      if (input.testCases.length === 0) {
        return withProvider(
          normalizeMockOutcome({ kind: "no_tests" }, input.testCases),
        );
      }

      return withProvider(
        normalizeMockOutcome(
          options.outcome ?? { kind: "passed" },
          input.testCases,
        ),
      );
    },
  };
}

function withProvider(result: ReturnType<typeof normalizeMockOutcome>) {
  return {
    ...result,
    rawResult: {
      providerUsed: "mock",
      result: result.rawResult,
    },
  };
}

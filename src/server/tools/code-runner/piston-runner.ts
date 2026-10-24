import { getDemoProblemAdapter } from "@/data/demo-problems";
import {
  comparisonStrategySchema,
  normalizeLeetCodeMetaData,
  problemExecutionContractSchema,
} from "@/data/hot150/local-run-types";
import { codeRunnerLimitsSchema } from "./code-runner.types";
import type { CodeRunnerInput, CodeRunnerProvider } from "./code-runner.types";
import type { CodeRunResult, CodeRunTestCase } from "@/types/code-runner";
import { buildCppWrapper } from "./build-cpp-wrapper";
import { buildPythonLocalHot150Wrapper } from "./build-python-local-hot150-wrapper";
import { buildPythonWrapper } from "./build-python-wrapper";
import {
  normalizeIsolatedPistonCaseResults,
  normalizeMockOutcome,
  normalizePistonResponse,
} from "./normalize-run-result";
import type { FailureProvenance } from "@/types/evidence";
import { PistonClient, type PistonExecuteRequest } from "./piston-client";

const DEFAULT_PISTON_OUTPUT_MAX_SIZE_BYTES = 16 * 1024 * 1024;
type PistonOutputEnv = {
  PISTON_OUTPUT_MAX_SIZE?: string;
};

export type PistonRunnerOptions = {
  client?: PistonClient;
  providerUsed?: "piston" | "piston_fallback" | "local_hot150";
};

export function createPistonRunnerProvider(
  options: PistonRunnerOptions = {},
): CodeRunnerProvider {
  const client = options.client ?? new PistonClient();
  const providerUsed = options.providerUsed ?? "piston";

  return {
    async run(input: CodeRunnerInput) {
      if (!input.code.trim()) {
        return withProvider(
          normalizeMockOutcome({ kind: "empty_code" }, input.testCases),
          providerUsed,
        );
      }

      if (input.language !== "Python" && input.language !== "C++") {
        return withProvider(
          normalizeMockOutcome(
            { kind: "unsupported_language" },
            input.testCases,
          ),
          providerUsed,
        );
      }

      const adapter = getDemoProblemAdapter(input.problem.slug);

      if (!adapter) {
        if (providerUsed === "piston_fallback") {
          return withProvider(
            withProvenance(
              normalizeMockOutcome(
                {
                  kind: "runner_error",
                  stderr:
                    "Local Piston fallback only supports the three demo problems. Review My Code for non-demo problems requires the remote LeetCode judge.",
                },
                input.testCases,
              ),
              "adapter",
            ),
            providerUsed,
          );
        }

        if (input.language === "C++") {
          return withProvider(
            normalizeMockOutcome(
              {
                kind: "unsupported_language",
                stderr:
                  "C++ local Run is not supported yet for this problem; use Python or open the official problem.",
              },
              input.testCases,
            ),
            providerUsed,
          );
        }

        if (input.problem.localRunStatus !== "runnable") {
          return withProvider(
            withProvenance(
              normalizeMockOutcome(
                {
                  kind: "runner_error",
                  stderr:
                    input.problem.localRunStatusMessage ??
                    "Local Run is not generated yet for this Hot-150 problem.",
                },
                input.testCases,
              ),
              "adapter",
            ),
            providerUsed,
          );
        }
      }

      if (input.testCases.length === 0) {
        return withProvider(
          normalizeMockOutcome({ kind: "no_tests" }, input.testCases),
          providerUsed,
        );
      }

      const limits = codeRunnerLimitsSchema.parse(input.limits ?? {});
      const startedAt = Date.now();

      try {
        const executeTests = async (testCases: CodeRunTestCase[]) => {
          const pistonResponse = await client.execute({
            ...buildPistonExecuteRequest({
              input,
              adapter,
              testCases,
            }),
            compile_timeout: limits.compileTimeoutMs,
            run_timeout: limits.runTimeoutMs,
            compile_cpu_time: limits.compileTimeoutMs,
            run_cpu_time: limits.runTimeoutMs,
            compile_memory_limit: limits.memoryLimitBytes,
            run_memory_limit: limits.memoryLimitBytes,
            output_max_size: readPistonOutputMaxSize(),
          });

          return normalizePistonResponse({
            pistonResponse,
            language: input.language,
            durationMs: Math.max(0, Date.now() - startedAt),
          });
        };

        if (shouldRunLocalHot150CasesInIsolation(input, Boolean(adapter), providerUsed)) {
          const caseResults: Array<{
            testCase: CodeRunTestCase;
            result: CodeRunResult;
          }> = [];

          for (const testCase of input.testCases) {
            const result = await executeTests([testCase]);

            caseResults.push({ testCase, result });

            if (shouldStopIsolatedLocalRun(result)) {
              break;
            }
          }

          return withProvider(
            normalizeIsolatedPistonCaseResults({
              caseResults,
              durationMs: Math.max(0, Date.now() - startedAt),
            }),
            providerUsed,
          );
        }

        return withProvider(await executeTests(input.testCases), providerUsed);
      } catch (error) {
        return withProvider(
          withProvenance(
            normalizeMockOutcome(
              {
                kind: "runner_error",
                stderr:
                  error instanceof Error
                    ? error.message
                    : "Unknown Piston runner error.",
              },
              input.testCases,
            ),
            "network",
          ),
          providerUsed,
        );
      }
    },
  };
}

export function readPistonOutputMaxSize(env?: PistonOutputEnv) {
  const rawValue =
    env?.PISTON_OUTPUT_MAX_SIZE ?? process.env.PISTON_OUTPUT_MAX_SIZE;
  const parsed =
    rawValue === undefined ? NaN : Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PISTON_OUTPUT_MAX_SIZE_BYTES;
}

function buildPistonExecuteRequest(args: {
  input: CodeRunnerInput;
  adapter: ReturnType<typeof getDemoProblemAdapter>;
  testCases: CodeRunTestCase[];
}): PistonExecuteRequest {
  const { input, adapter, testCases } = args;

  if (input.language === "Python") {
    return {
      language: "python",
      version: "*",
      files: [
        {
          name: "main.py",
          content: adapter
            ? buildPythonWrapper({
                adapter,
                userCode: input.code,
                testCases,
              })
            : buildPythonLocalHot150Wrapper({
                comparisonConfig: input.problem.comparisonConfig ?? {},
                comparisonStrategy: comparisonStrategySchema.parse(
                  input.problem.comparisonStrategy ?? "exact",
                ),
                contract: normalizeLocalContract(input),
                userCode: input.code,
                testCases,
              }),
        },
      ],
    };
  }

  return {
    language: "c++",
    version: "*",
    files: [
      {
        name: "main.cpp",
        content: buildCppWrapper({
          adapter: adapter!,
          userCode: input.code,
          testCases,
        }),
      },
    ],
  };
}

function shouldRunLocalHot150CasesInIsolation(
  input: CodeRunnerInput,
  hasDemoAdapter: boolean,
  providerUsed: NonNullable<PistonRunnerOptions["providerUsed"]>,
) {
  return (
    providerUsed !== "piston_fallback" &&
    !hasDemoAdapter &&
    input.language === "Python" &&
    input.testCases.length > 1
  );
}

function shouldStopIsolatedLocalRun(result: CodeRunResult) {
  return (
    result.status === "compile_error" ||
    result.status === "syntax_error" ||
    result.status === "runtime_error" ||
    result.status === "timeout" ||
    result.status === "runner_error"
  );
}

function normalizeLocalContract(input: CodeRunnerInput) {
  const parsed = problemExecutionContractSchema.safeParse(
    input.problem.inputContract,
  );

  if (parsed.success) {
    return parsed.data;
  }

  let metadata;

  try {
    metadata = normalizeLeetCodeMetaData(input.problem.inputContract);
  } catch {
    metadata = null;
  }

  if (metadata?.name) {
    return metadata;
  }

  return problemExecutionContractSchema.parse({
    name: input.problem.methodName,
    params: [],
    returnType: input.problem.outputContract?.type ?? "unknown",
    contractKind: input.problem.contractKind ?? "pure_function",
  });
}

function withProvenance<T extends { failureProvenance?: FailureProvenance }>(
  result: T,
  failureProvenance: FailureProvenance,
) {
  return { ...result, failureProvenance };
}

function withProvider(
  result: ReturnType<typeof normalizeMockOutcome> | ReturnType<typeof normalizePistonResponse>,
  providerUsed: NonNullable<PistonRunnerOptions["providerUsed"]>,
) {
  return {
    ...result,
    rawResult: {
      providerUsed,
      result: result.rawResult,
    },
  };
}

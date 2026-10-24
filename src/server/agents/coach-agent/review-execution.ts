import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import type { CodeRunnerProvider } from "@/server/tools/code-runner/code-runner.types";
import { runCodeWithTests } from "@/server/tools/code-runner/run-code-with-tests";
import { startTraceStep, type TraceContext } from "@/server/llm/trace-context";
import type {
  CodeRunResult,
  CodeRunTestCase,
  CodeRunnerLanguage,
} from "@/types/code-runner";
import { getDemoProblem, parseJson } from "./review-context";
import { appendReviewRunnerTrace } from "./review-trace";

type ReviewExecutionArgs = {
  problem: Awaited<ReturnType<typeof getDemoProblem>>;
  tags: string[];
  language: CodeRunnerLanguage;
  code: string;
  testCases: CodeRunTestCase[];
  codeRunnerProvider?: CodeRunnerProvider;
  traceContext?: TraceContext;
  codeHash: string;
  executionFingerprint: string;
};

export async function runReviewCodeWithTrust(args: ReviewExecutionArgs) {
  const baseInput = {
    problem: buildCodeRunnerProblem(args.problem, args.tags),
    language: args.language,
    code: args.code,
    testCases: args.testCases,
  };
  const primaryRunResult = await runTracedReviewExecution({
    ...args,
    baseInput,
    phase: "primary",
    executionKind: "review",
    provider: args.codeRunnerProvider,
  });
  const primaryProvider = readProviderUsed(primaryRunResult);
  const primaryVerdict = classifyExecutionEvidence(primaryRunResult, {
    consumer: "review",
    providerUsed: primaryProvider,
  });

  return { runResult: primaryRunResult, evidenceVerdict: primaryVerdict };
}

type ReviewRunnerProblem = ReturnType<typeof buildCodeRunnerProblem>;
type TracedReviewExecutionArgs = ReviewExecutionArgs & {
  baseInput: {
    problem: ReviewRunnerProblem;
    language: CodeRunnerLanguage;
    code: string;
    testCases: CodeRunTestCase[];
  };
  phase: "primary";
  executionKind: "review";
  provider?: CodeRunnerProvider;
};

async function runTracedReviewExecution(args: TracedReviewExecutionArgs) {
  const step = startTraceStep(args.traceContext, { spanKind: "runner" });
  const startedAt = Date.now();
  try {
    const result = await runCodeWithTests(
      { ...args.baseInput, executionKind: args.executionKind },
      args.provider,
    );
    const evidenceVerdict = classifyExecutionEvidence(result, {
      consumer: "review",
      providerUsed: readProviderUsed(result),
    });
    await traceReviewRunnerSuccess(args, step, startedAt, result, evidenceVerdict);
    return result;
  } catch (error) {
    await traceReviewRunnerError(args, step, startedAt, error);
    throw error;
  }
}

function runnerTraceBase(
  args: TracedReviewExecutionArgs,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
) {
  return {
    traceContext: args.traceContext!,
    step,
    phase: args.phase,
    executionKind: args.executionKind,
    language: args.language,
    code: args.code,
    codeHash: args.codeHash,
    executionFingerprint: args.executionFingerprint,
    problem: args.problem,
    tests: args.testCases,
    durationMs: Date.now() - startedAt,
  };
}

async function traceReviewRunnerSuccess(
  args: TracedReviewExecutionArgs,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
  result: CodeRunResult,
  evidenceVerdict: ReturnType<typeof classifyExecutionEvidence>,
) {
  if (!args.traceContext) return;
  await appendReviewRunnerTrace({
    ...runnerTraceBase(args, step, startedAt),
    result,
    evidenceVerdict,
  });
}

async function traceReviewRunnerError(
  args: TracedReviewExecutionArgs,
  step: ReturnType<typeof startTraceStep>,
  startedAt: number,
  error: unknown,
) {
  if (!args.traceContext) return;
  await appendReviewRunnerTrace({
    ...runnerTraceBase(args, step, startedAt),
    error,
  });
}

function buildCodeRunnerProblem(
  problem: Awaited<ReturnType<typeof getDemoProblem>>,
  tags: string[],
) {
  return {
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: problem.leetcodeNumber,
    methodName: problem.methodName,
    tags,
    inputContract: parseJson(problem.inputContractJson, undefined),
    outputContract: parseJson(problem.outputContractJson, undefined),
    isDemoSupported: problem.isDemoSupported,
    localRunStatus: problem.localRunStatus,
    localRunStatusMessage: problem.localRunStatusMessage,
    comparisonStrategy: problem.comparisonStrategy,
    comparisonConfig: parseJson(problem.comparisonConfigJson, {}),
    contractKind: problem.contractKind,
  };
}

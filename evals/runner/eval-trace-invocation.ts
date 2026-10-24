import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  appendTraceEventBestEffort,
  attachTraceRunReferences,
  createTraceContext,
  recordProcessMemorySample,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import type { CodeRunResult, CodeRunnerLanguage } from "@/types/code-runner";

type EvalInvocationIdentity = {
  suiteName: string;
  runId: string;
  caseId: string;
  repeatIndex: number;
};

export function buildSyntheticEvalTraceRequest(
  identity: EvalInvocationIdentity,
  occurredAt: Date,
) {
  return {
    browserInstanceId: `eval-${stableDigest(identity).slice(0, 32)}`,
    clientOccurredAt: occurredAt.toISOString(),
  };
}

export async function createSyntheticEvalReviewTraceContext(args: {
  prisma: PrismaClient;
  identity: EvalInvocationIdentity;
  occurredAt: Date;
  userId: string;
  problemId: string;
  chatSessionId: string;
  task: string;
  language?: CodeRunnerLanguage;
  code?: string;
  selectedTestCaseIds?: string[];
  runResult?: CodeRunResult;
}): Promise<TraceContext> {
  const request = buildSyntheticEvalTraceRequest(args.identity, args.occurredAt);
  const turn = await ensureWorkspaceTraceTurn(args.prisma, {
    userId: args.userId,
    problemId: args.problemId,
    browserInstanceId: request.browserInstanceId,
    action: "review",
    cutoverEnabled: true,
    captureLevel: "full",
    traceRunId: `eval-trace-${stableDigest({ ...args.identity, action: "review" })}`,
    now: args.occurredAt,
    snapshot: {
      language: args.language,
      code: args.code,
      selectedTestCaseIds: args.selectedTestCaseIds,
      clientOccurredAt: request.clientOccurredAt,
      metadata: {
        syntheticEvalInvocation: true,
        suiteName: args.identity.suiteName,
        evalRunId: args.identity.runId,
        caseId: args.identity.caseId,
        repeatIndex: args.identity.repeatIndex,
        chatSessionId: args.chatSessionId,
      },
    },
  });
  if (!turn.enabled) {
    throw new Error("Synthetic eval Trace Invocation unexpectedly disabled.");
  }
  const context = createTraceContext({
    prisma: args.prisma,
    userId: args.userId,
    path: "review",
    task: args.task,
    problemId: args.problemId,
    chatSessionId: args.chatSessionId,
    traceRunId: turn.traceRunId,
    workspaceSessionId: turn.workspaceSessionId,
    turnOrdinal: turn.turnOrdinal,
    captureLevel: turn.captureLevel,
    // Direct-call evals have no API-action finally block, so the harness owns
    // the recorder and MUST call finalizeSyntheticEvalReviewTraceContext().
    // Keeping the normal buffer/final-flush contract prevents an open eval Run
    // from masquerading as complete merely because individual rows exist.
    bufferedRecorder: true,
  });
  await attachTraceRunReferences(context, { chatSessionId: args.chatSessionId });
  if (args.runResult) {
    const runnerStep = startTraceStep(context, { spanKind: "runner" });
    await appendTraceEventBestEffort(context, {
      eventId: `${context.traceRunId}:eval-runner-replay`,
      step: runnerStep,
      stage: "execution_evidence",
      kind: "runner",
      title: "Code execution evidence · eval fixture replay",
      status:
        args.runResult.status === "runner_error" ? "failed" : "succeeded",
      durationMs: args.runResult.durationMs,
      details: {
        input: {
          executionKind: "review",
          language: args.language,
          code: args.code,
          selectedTestCaseIds: args.selectedTestCaseIds,
        },
        output: {
          normalizedEvidence: args.runResult,
          stdout: args.runResult.stdout,
          stderr: args.runResult.stderr,
        },
        metadata: {
          operation: "run_code_with_tests",
          provider: "eval_fixture_replay",
          replayed: true,
          resultStatus: args.runResult.status,
        },
      },
    });
  }
  return context;
}

/**
 * Completes a direct-call eval Run through the same recorder final-flush
 * contract as a foreground request. This helper never upgrades degraded
 * telemetry: it re-reads the durable Run and rejects anything other than a
 * complete Run with a committed finalFlushAt before the harness may score it.
 */
export async function finalizeSyntheticEvalReviewTraceContext(args: {
  traceContext: TraceContext;
  status: "succeeded" | "failed";
  error?: unknown;
}) {
  const { traceContext } = args;
  if (!traceContext.recorder) {
    throw new Error(
      `Synthetic eval Trace Run ${traceContext.traceRunId} has no recorder.`,
    );
  }

  if (args.error !== undefined) {
    await appendTraceEventBestEffort(traceContext, {
      eventId: `${traceContext.traceRunId}:eval-terminal-error`,
      stage: "eval_direct_call",
      kind: "error",
      title: "Direct eval invocation failed",
      status: "failed",
      details: {
        output: { error: normalizeError(args.error) },
        metadata: {
          operation: "eval_direct_call",
          terminal: true,
        },
      },
    });
  }

  recordProcessMemorySample(traceContext, "end");
  const final = await traceContext.recorder.finalize({ status: args.status });
  const run = await traceContext.prisma.agentTraceRun.findUniqueOrThrow({
    where: { id: traceContext.traceRunId },
    select: {
      status: true,
      traceCompleteness: true,
      finalFlushAt: true,
    },
  });
  if (
    !final.ok ||
    final.degraded ||
    run.traceCompleteness !== "complete" ||
    run.finalFlushAt === null
  ) {
    throw new Error(
      `Synthetic eval Trace Run ${traceContext.traceRunId} did not finalize completely (status=${run.status}, completeness=${run.traceCompleteness}, finalFlush=${run.finalFlushAt ? "yes" : "no"}).`,
    );
  }
  return run;
}

function stableDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: typeof error, message: String(error) };
}

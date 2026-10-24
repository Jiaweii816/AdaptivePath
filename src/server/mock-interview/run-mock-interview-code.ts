import prisma from "@/server/db/prisma";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  createTraceContext,
  setTraceRunnerMs,
} from "@/server/llm/trace-context";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import { runCodeWithTests } from "@/server/tools/code-runner/run-code-with-tests";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";
import { getLocalUserAndProfile, loadSelectedVisibleTests, parseJson } from "@/server/agents/coach-agent/review-pipeline";
import { MockInterviewError } from "./mock-interview-utils";
import {
  mockInterviewRunCodeRequestSchema,
  type MockInterviewRunCodeResponse,
} from "@/types/mock-interview";

const json = (value: unknown) => JSON.stringify(value);

export async function runMockInterviewCode(
  rawInput: unknown,
): Promise<MockInterviewRunCodeResponse> {
  const pathStartedAt = Date.now();
  const input = mockInterviewRunCodeRequestSchema.parse(rawInput);
  const { user } = await getLocalUserAndProfile();
  const session = await prisma.mockInterviewSession.findFirst({
    where: { id: input.sessionId, userId: user.id },
    include: { problem: true },
  });

  if (!session) {
    throw new MockInterviewError("Mock interview session was not found.", 404);
  }

  if (session.status === "completed") {
    throw new MockInterviewError("This mock interview is already completed.", 409);
  }

  const selectedTestCases = await loadSelectedVisibleTests({
    problemId: session.problemId,
    userId: user.id,
    selectedTestCaseIds: input.selectedTestCaseIds,
  });
  const problemTags = parseJson<string[]>(session.problem.tags, []);
  const traceContext = createTraceContext({
    prisma,
    userId: user.id,
    path: "mock_interview",
    task: "mock_interview.run_code",
    problemId: session.problemId,
  });
  const runnerStartedAt = Date.now();
  const runResult = await runCodeWithTests({
    problem: {
      slug: session.problem.slug,
      title: session.problem.title,
      leetcodeNumber: session.problem.leetcodeNumber,
      methodName: session.problem.methodName,
      tags: problemTags,
      inputContract: parseJson(session.problem.inputContractJson, undefined),
      outputContract: parseJson(session.problem.outputContractJson, undefined),
      isDemoSupported: session.problem.isDemoSupported,
      localRunStatus: session.problem.localRunStatus,
      localRunStatusMessage: session.problem.localRunStatusMessage,
      comparisonStrategy: session.problem.comparisonStrategy,
      comparisonConfig: parseJson(session.problem.comparisonConfigJson, {}),
      contractKind: session.problem.contractKind,
    },
    language: input.language,
    code: input.code,
    testCases: selectedTestCases,
    executionKind: "visible_run",
  });
  setTraceRunnerMs(traceContext, Date.now() - runnerStartedAt);
  const evidenceVerdict = classifyExecutionEvidence(runResult, {
    consumer: "mock_interview",
    providerUsed: readProviderUsed(runResult),
  });
  const executionFingerprint = fingerprintCodeForExecution({
    language: input.language,
    code: input.code,
  });

  const result = await prisma.$transaction(async (tx) => {
    const codeSnapshot = await tx.mockInterviewCodeSnapshot.create({
      data: {
        sessionId: session.id,
        problemId: session.problemId,
        language: input.language,
        code: input.code,
      },
    });
    const runEvidence = await tx.mockInterviewRunEvidence.create({
      data: {
        sessionId: session.id,
        codeSnapshotId: codeSnapshot.id,
        problemId: session.problemId,
        status: runResult.status,
        passedCount: runResult.passedCount,
        failedCount: runResult.failedCount,
        durationMs: runResult.durationMs,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        actualOutput: runResult.actualOutput,
        expectedOutput: runResult.expectedOutput,
        firstFailedCaseJson: runResult.firstFailedCase
          ? json(runResult.firstFailedCase)
          : null,
        rawResultJson: json(runResultWithEvidenceVerdict(runResult, evidenceVerdict)),
      },
    });

    await appendL1TraceEvent(tx, {
      userId: user.id,
      problemId: session.problemId,
      eventType: "mock_interview_run_evidence",
      source: "mock_interview:run_code",
      content: `${runResult.status}: ${runResult.passedCount} passed, ${runResult.failedCount} failed`,
      eventJson: {
        traceRunId: traceContext.traceRunId,
        sessionId: session.id,
        codeSnapshotId: codeSnapshot.id,
        runEvidenceId: runEvidence.id,
        executionFingerprint,
        status: runResult.status,
        passedCount: runResult.passedCount,
        failedCount: runResult.failedCount,
        evidenceVerdict,
        firstFailedCase: runResult.firstFailedCase,
        timings: {
          totalMs: Date.now() - pathStartedAt,
          runnerMs: traceContext.runnerMs,
        },
      },
    });

    return { codeSnapshot, runEvidence };
  });

  return {
    ok: true,
    codeSnapshotId: result.codeSnapshot.id,
    runEvidenceId: result.runEvidence.id,
    runResult,
  };
}

function runResultWithEvidenceVerdict<T extends { rawResult?: unknown }>(
  result: T,
  evidenceVerdict: unknown,
) {
  return {
    ...result,
    rawResult: {
      ...rawResultRecord(result.rawResult),
      evidenceVerdict,
    },
  };
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

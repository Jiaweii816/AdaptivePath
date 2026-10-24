import { z } from "zod";
import prisma from "@/server/db/prisma";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import {
  formatEvidenceSource,
  formatRunnerProvider,
  readProviderUsed,
} from "@/server/tools/code-runner/evidence-metadata";
import { classifyExecutionEvidence } from "@/lib/evidence-trust";
import { runCodeWithTests } from "@/server/tools/code-runner/run-code-with-tests";
import {
  codeRunnerLanguageSchema,
  type CodeRunResult,
} from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import {
  getDemoProblem,
  getLocalUserAndProfile,
  loadSelectedVisibleTests,
  parseJson,
} from "@/server/agents/coach-agent/review-pipeline";
import { startPlannerPlanItem } from "@/server/planner/planner-service";
import {
  requireRuntimeTraceActionContext,
  runtimeTraceActionRequestFields,
  type WorkspaceTraceTurnInfo,
} from "@/server/observability/runtime-trace-request";
import {
  ensureWorkspaceTraceTurnBestEffort,
  finalizeForegroundWorkspaceTrace,
} from "@/server/observability/workspace-trace-finalize";
import {
  appendTraceEventBestEffort,
  attachTraceRunReferences,
  createTraceContext,
  setTraceRunnerMs,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import {
  classifyRunTransition,
  normalizeStatusClass,
} from "@/server/memory/l1-trace/practice-run-milestones";

const json = (value: unknown) => JSON.stringify(value);

export const practiceRunRequestSchema = z
  .object({
    problemId: z.string().optional(),
    problemSlug: z.string().optional(),
    language: codeRunnerLanguageSchema,
    code: z.string(),
    selectedTestCaseIds: z.array(z.string()).default([]),
    planItemId: z.string().optional(),
    ...runtimeTraceActionRequestFields,
  })
  .refine((value) => value.problemId || value.problemSlug, {
    message: "A problemId or problemSlug is required.",
    path: ["problemId"],
  })
  .superRefine(requireRuntimeTraceActionContext);

export type PracticeRunRequest = z.infer<typeof practiceRunRequestSchema>;

export type PracticeRunResult = {
  ok: true;
  problem: {
    id: string;
    slug: string;
    title: string;
  };
  practiceRunLogId: string;
  runOrdinal: number;
  summary: string;
  runResult: CodeRunResult;
  evidence: {
    source: "practice_run";
    language: z.infer<typeof codeRunnerLanguageSchema>;
    selectedTestCaseIds: string[];
    runnerProvider: string;
    evidenceSource: string;
    evidenceVerdict?: EvidenceVerdict;
    runResult: CodeRunResult;
  };
  trace?: WorkspaceTraceTurnInfo;
};

export async function runPracticeTests(
  rawInput: unknown,
): Promise<PracticeRunResult> {
  const input = practiceRunRequestSchema.parse(rawInput);
  const { user } = await getLocalUserAndProfile();
  const problem = await getDemoProblem(input);
  if (input.planItemId) {
    await startPlannerPlanItem({ planItemId: input.planItemId }).catch(
      () => undefined,
    );
  }
  const tags = parseJson<string[]>(problem.tags, []);
  const selectedTestCases = await loadSelectedVisibleTests({
    problemId: problem.id,
    userId: user.id,
    selectedTestCaseIds: input.selectedTestCaseIds,
  });
  const selectedTestCaseIds = selectedTestCases.map((testCase) => testCase.id);
  const codeHash = hashCodeForRun({
    language: input.language,
    code: input.code,
  });
  const executionFingerprint = fingerprintCodeForExecution({
    language: input.language,
    code: input.code,
  });
  const workspaceTraceTurn = input.browserInstanceId
    ? await ensureWorkspaceTraceTurnBestEffort(prisma, {
        userId: user.id,
        problemId: problem.id,
        browserInstanceId: input.browserInstanceId,
        action: "practice_run",
        snapshot: {
          language: input.language,
          code: input.code,
          codeHash,
          executionFingerprint,
          selectedTestCaseIds,
          testContext: selectedTestCases.map((testCase) => ({
            id: testCase.id,
            label: testCase.label,
            input: testCase.input,
            expected: testCase.expected,
            source: testCase.source,
          })),
          clientOccurredAt: input.clientOccurredAt,
          metadata: {
            instrumentationPhase: "phase4_foreground",
            planItemId: input.planItemId,
          },
        },
      })
    : ({ enabled: false } as const);
  const workspaceTraceInfo: WorkspaceTraceTurnInfo | undefined =
    workspaceTraceTurn.enabled
      ? {
          workspaceSessionId: workspaceTraceTurn.workspaceSessionId,
          traceRunId: workspaceTraceTurn.traceRunId,
          turnOrdinal: workspaceTraceTurn.turnOrdinal,
        }
      : undefined;
  const traceContext: TraceContext | undefined = workspaceTraceTurn.enabled
    ? createTraceContext({
        prisma,
        userId: user.id,
        problemId: problem.id,
        path: "practice_run",
        task: "practice_run.visible_tests",
        traceRunId: workspaceTraceTurn.traceRunId,
        workspaceSessionId: workspaceTraceTurn.workspaceSessionId,
        turnOrdinal: workspaceTraceTurn.turnOrdinal,
        captureLevel: workspaceTraceTurn.captureLevel,
        initialTraceOverheadMs: workspaceTraceTurn.initialTraceOverheadMs,
      })
    : undefined;
  let traceOutcome: "succeeded" | "failed" = "failed";

  try {
  const codeDraft = await prisma.codeDraft.upsert({
    where: {
      userId_problemId_language: {
        userId: user.id,
        problemId: problem.id,
        language: input.language,
      },
    },
    update: {
      content: input.code,
      selectedTestCaseIds: json(selectedTestCaseIds),
    },
    create: {
      userId: user.id,
      problemId: problem.id,
      language: input.language,
      content: input.code,
      selectedTestCaseIds: json(selectedTestCaseIds),
    },
  });

  const runnerStep = startTraceStep(traceContext, { spanKind: "runner" });
  await appendTraceEventBestEffortIfPresent(traceContext, {
    step: runnerStep,
    stage: "practice_runner",
    kind: "runner",
    title: "Runner request · visible tests",
    status: "started",
    details: {
      input: {
        problemSlug: problem.slug,
        language: input.language,
        codeHash,
        executionFingerprint,
        selectedTestCaseIds,
        executionKind: "visible_run",
      },
      metadata: { eventRole: "request" },
    },
  });
  const runnerStartedAt = performance.now();
  let runResult: CodeRunResult;
  try {
    runResult = await runCodeWithTests({
      problem: {
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
      },
      language: input.language,
      code: input.code,
      testCases: selectedTestCases,
      executionKind: "visible_run",
    });
  } catch (error) {
    const runnerMs = Math.max(0, performance.now() - runnerStartedAt);
    setTraceRunnerMs(traceContext, runnerMs);
    await appendTraceEventBestEffortIfPresent(traceContext, {
      step: runnerStep,
      stage: "practice_runner",
      kind: "runner",
      title: "Runner result · visible tests",
      status: "failed",
      durationMs: runnerMs,
      details: {
        output: { error: normalizeTraceError(error) },
        metadata: { eventRole: "result" },
      },
    });
    throw error;
  }
  const runnerCompletedAt = new Date();
  const runnerMs = Math.max(0, performance.now() - runnerStartedAt);
  setTraceRunnerMs(traceContext, runnerMs);
  await appendTraceEventBestEffortIfPresent(traceContext, {
    step: runnerStep,
    stage: "practice_runner",
    kind: "runner",
    title: "Runner result · visible tests",
    status: runResult.status === "runner_error" ? "failed" : "succeeded",
    durationMs: runnerMs,
    details: {
      output: runResult,
      metadata: {
        eventRole: "result",
        runnerProvider: readProviderUsed(runResult) ?? "unknown",
        resultStatus: runResult.status,
        passedCount: runResult.passedCount,
        failedCount: runResult.failedCount,
      },
    },
  });
  const runOrdinal =
    (await prisma.practiceRunLog.count({
      where: {
        userId: user.id,
        problemId: problem.id,
        language: input.language,
      },
    })) + 1;
  const totalCount = Math.max(
    selectedTestCases.length,
    runResult.passedCount + runResult.failedCount,
  );
  const summary = `execute ${runOrdinal}: ${runResult.passedCount}/${totalCount} visible tests passed`;
  const providerUsed = readProviderUsed(runResult);
  const evidenceVerdict = classifyExecutionEvidence(runResult, {
    consumer: "practice_run",
    providerUsed,
  });
  const provider = providerUsed ?? "unknown";
  const rawResultJson = json(
    runResultWithEvidenceVerdict(runResult, evidenceVerdict),
  );
  const previousRuns = await prisma.practiceRunLog.findMany({
    where: {
      userId: user.id,
      problemId: problem.id,
      language: input.language,
    },
    orderBy: { runOrdinal: "desc" },
    select: {
      id: true,
      runOrdinal: true,
      status: true,
      executionFingerprint: true,
      selectedTestCaseIds: true,
      rawResultJson: true,
    },
  });
  const previousRun = previousRuns.find(
    (candidate) => normalizeStatusClass(candidate.status) !== undefined,
  );
  const currentRun = {
    runOrdinal,
    status: runResult.status,
    executionFingerprint,
    selectedTestCaseIds: json(selectedTestCaseIds),
    rawResultJson,
  };
  const transition = classifyRunTransition(previousRun, currentRun);
  const persistenceStartedAt = performance.now();
  const log = await prisma.$transaction(async (transaction) => {
    const createdLog = await transaction.practiceRunLog.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        codeDraftId: codeDraft.id,
        language: input.language,
        codeSnapshot: input.code,
        codeHash,
        executionFingerprint,
        runOrdinal,
        selectedTestCaseIds: currentRun.selectedTestCaseIds,
        status: runResult.status,
        passedCount: runResult.passedCount,
        totalCount,
        summary,
        provider,
        rawResultJson,
        durationMs: runResult.durationMs,
      },
    });

    if (transition) {
      const practiceRunLogIds = previousRun
        ? [previousRun.id, createdLog.id]
        : [createdLog.id];
      const content =
        previousRun && transition.before
          ? `${transition.reason}: ${transition.before.statusClass} -> ${transition.after.statusClass} (run ${previousRun.runOrdinal} -> run ${runOrdinal})`
          : `${transition.reason}: ${transition.after.statusClass} (run ${runOrdinal})`;

      await appendL1TraceEvent(transaction, {
        userId: user.id,
        problemId: problem.id,
        eventType: "practice_run_milestone",
        eventJson: {
          reason: transition.reason,
          practiceRunLogIds,
          ...(transition.before ? { before: transition.before } : {}),
          after: transition.after,
          eligibleForL2: false,
        },
        content,
        source: "practice_run",
        occurredAt: runnerCompletedAt,
      });
    }

    return createdLog;
  });
  const persistenceMs = Math.max(0, performance.now() - persistenceStartedAt);
  await appendTraceEventBestEffortIfPresent(traceContext, {
    stage: "practice_persistence",
    kind: "persistence",
    title: "Persist Practice Run Log",
    status: "succeeded",
    durationMs: persistenceMs,
    details: {
      stateDelta: {
        codeDraftId: codeDraft.id,
        practiceRunLogId: log.id,
        runOrdinal,
        status: runResult.status,
      },
      metadata: { operation: "practiceRunLog.create" },
    },
  });
  if (traceContext) {
    await attachTraceRunReferences(traceContext, { runId: log.id }).catch(
      (error) => console.warn("Unable to attach Practice Run trace reference.", error),
    );
  }
  traceOutcome = "succeeded";

  return {
    ok: true,
    problem: {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
    },
    practiceRunLogId: log.id,
    runOrdinal,
    summary,
    runResult,
    evidence: {
      source: "practice_run",
      language: input.language,
      selectedTestCaseIds,
      runnerProvider: formatRunnerProvider(providerUsed),
      evidenceSource: formatEvidenceSource(providerUsed),
      evidenceVerdict,
      runResult,
    },
    trace: workspaceTraceInfo,
  };
  } finally {
    await finalizeForegroundWorkspaceTrace(
      prisma,
      workspaceTraceTurn,
      traceContext,
      { status: traceOutcome },
    );
  }
}

async function appendTraceEventBestEffortIfPresent(
  traceContext: TraceContext | undefined,
  input: Parameters<typeof appendTraceEventBestEffort>[1],
) {
  if (!traceContext) return;
  await appendTraceEventBestEffort(traceContext, input);
}

function normalizeTraceError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
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

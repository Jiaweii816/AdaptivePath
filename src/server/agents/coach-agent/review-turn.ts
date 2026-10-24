import { attachTraceRunReferences } from "@/server/llm/trace-context";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { foldRunSequence } from "@/server/memory/l1-trace/practice-run-milestones";
import { finalizeForegroundWorkspaceTrace } from "@/server/observability/workspace-trace-finalize";
import {
  formatEvidenceSource,
  formatRunnerProvider,
  readProviderUsed,
} from "@/server/tools/code-runner/evidence-metadata";
import { completeReviewBackground } from "./review-background";
import { loadReviewAssistedRepairChain } from "./review-assisted-repair";
import { evaluateReview } from "./review-evaluation";
import type { ReviewPipelineResult } from "./review-pipeline-contract";
import { projectReviewMemoryBriefForClient } from "./review-memory-client-projection";
import { persistReview } from "./review-persistence";
import { initializeReviewSession } from "./review-session";
import type { resolveReviewSetup } from "./review-setup";
import {
  appendReviewInputResolvedTrace,
  appendReviewUnhandledErrorTrace,
} from "./review-trace";

type ReviewSetup = Awaited<ReturnType<typeof resolveReviewSetup>>;

export async function executeReviewTurn(
  setup: ReviewSetup,
  pathStartedAt: number,
): Promise<ReviewPipelineResult> {
  let traceOutcome: "succeeded" | "failed" | "degraded" = "failed";
  try {
    const result = await runReviewStages(setup, pathStartedAt);
    traceOutcome = result.degraded ? "degraded" : "succeeded";
    return result;
  } catch (error) {
    if (setup.traceContext) {
      await appendReviewUnhandledErrorTrace({
        traceContext: setup.traceContext,
        error,
        durationMs: Date.now() - pathStartedAt,
      });
    }
    throw error;
  } finally {
    await finalizeForegroundWorkspaceTrace(
      setup.db,
      setup.workspaceTraceTurn,
      setup.traceContext,
      { status: traceOutcome },
    );
  }
}

async function runReviewStages(setup: ReviewSetup, pathStartedAt: number) {
  await traceResolvedInput(setup);
  const session = await initializeReviewSession({
    db: setup.db,
    input: setup.input,
    userId: setup.user.id,
    problem: setup.problem,
    selectedTestCaseIds: setup.selectedTestCaseIds,
    responseLanguage: setup.responseLanguage,
    memoryOrigin: setup.memoryOrigin,
    traceContext: setup.traceContext,
  });
  const reviewCheckpoint = await appendReviewCheckpointMilestone(
    setup,
    pathStartedAt,
  );
  const evaluation = await evaluateReview({
    ...setup,
    chatSessionId: session.chatSession.id,
  });
  const assistedRepairChain = await loadReviewAssistedRepairChain(setup.db, {
    userId: setup.user.id,
    problemId: setup.problem.id,
    chatSessionId: session.chatSession.id,
    language: setup.input.language,
    memoryOrigin: setup.memoryOrigin,
    passedAt: evaluation.runnerCompletedAt,
    passedStatus: evaluation.runResult.status,
    passedCodeHash: setup.codeHash,
    passedExecutionFingerprint: setup.executionFingerprint,
    passedSelectedTestCaseIds: setup.selectedTestCaseIds,
    evidenceVerdict: evaluation.evidenceVerdict,
  });
  const outcome = await persistReview(
    buildPersistenceArgs(
      setup,
      session,
      evaluation,
      pathStartedAt,
      assistedRepairChain,
      reviewCheckpoint,
    ),
  );
  await completeReviewBackground({
    db: setup.db,
    outcome,
    userId: setup.user.id,
    problemId: setup.problem.id,
    backgroundJobsDisabled: setup.backgroundJobsDisabled,
    traceContext: setup.traceContext,
    ftsStore: setup.deps.ftsStore,
  });
  await attachReviewTraceReferences(setup, outcome);
  return buildPipelineResult(setup, session, evaluation, outcome);
}

async function appendReviewCheckpointMilestone(
  setup: ReviewSetup,
  pathStartedAt: number,
) {
  const previousCheckpoint = await setup.db.l1MemoryEvent.findFirst({
    where: {
      userId: setup.user.id,
      problemId: setup.problem.id,
      eventType: "practice_run_milestone",
      memoryOrigin: setup.memoryOrigin,
      eventJson: { contains: '"reason":"review_checkpoint"' },
    },
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });
  const runs = await setup.db.practiceRunLog.findMany({
    where: {
      userId: setup.user.id,
      problemId: setup.problem.id,
      language: setup.input.language,
      ...(previousCheckpoint
        ? { createdAt: { gt: previousCheckpoint.occurredAt } }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { runOrdinal: "asc" }],
    select: {
      id: true,
      runOrdinal: true,
      status: true,
      executionFingerprint: true,
      selectedTestCaseIds: true,
      rawResultJson: true,
    },
  });
  if (runs.length === 0) {
    return { milestoneEventId: null, practiceRunLogIds: [] };
  }

  const folded = foldRunSequence(runs);
  const beforeStatus = folded.before?.statusClass ?? "none";
  const afterStatus = folded.after?.statusClass ?? "none";
  const milestone = await appendL1TraceEvent(setup.db, {
    userId: setup.user.id,
    problemId: setup.problem.id,
    eventType: "practice_run_milestone",
    eventJson: {
      reason: "review_checkpoint",
      ...folded,
      eligibleForL2: false,
    },
    content: `review_checkpoint: ${beforeStatus} -> ${afterStatus} (${folded.runCount} runs)`,
    source: "review_pipeline",
    occurredAt: new Date(pathStartedAt),
    memoryOrigin: setup.memoryOrigin,
  });
  return {
    milestoneEventId: milestone.id,
    practiceRunLogIds: runs.map((run) => run.id),
  };
}

async function traceResolvedInput(setup: ReviewSetup) {
  if (!setup.traceContext) return;
  await appendReviewInputResolvedTrace({
    traceContext: setup.traceContext,
    durationMs: setup.inputResolveDurationMs,
    problem: {
      id: setup.problem.id,
      slug: setup.problem.slug,
      title: setup.problem.title,
    },
    language: setup.input.language,
    codeHash: setup.codeHash,
    executionFingerprint: setup.executionFingerprint,
    selectedTestCaseIds: setup.selectedTestCaseIds,
    responseLanguage: setup.responseLanguage,
    userState: setup.input.userState,
    userQuestion: setup.input.userQuestion,
  });
}

type Session = Awaited<ReturnType<typeof initializeReviewSession>>;
type Evaluation = Awaited<ReturnType<typeof evaluateReview>>;

function buildPersistenceArgs(
  setup: ReviewSetup,
  session: Session,
  evaluation: Evaluation,
  pathStartedAt: number,
  assistedRepairChain: Awaited<
    ReturnType<typeof loadReviewAssistedRepairChain>
  >,
  reviewCheckpoint: Awaited<
    ReturnType<typeof appendReviewCheckpointMilestone>
  >,
) {
  return {
    db: setup.db,
    userId: setup.user.id,
    problem: setup.problem,
    tags: setup.tags,
    chatSessionId: session.chatSession.id,
    codeDraftId: session.codeDraft.id,
    language: setup.input.language,
    code: setup.input.code,
    userState: setup.input.userState,
    userQuestion: setup.input.userQuestion,
    activeSeconds: setup.input.activeSeconds,
    selectedTestCaseIds: setup.selectedTestCaseIds,
    selectedTestsJson: setup.selectedTestsJson,
    codeHash: setup.codeHash,
    executionFingerprint: setup.executionFingerprint,
    runResult: evaluation.runResult,
    evidenceVerdict: evaluation.evidenceVerdict,
    coachResult: evaluation.coachResult,
    sanitizedSelfCheck: evaluation.sanitizedSelfCheck,
    plannerContext: evaluation.plannerContext,
    workspaceMetadata: evaluation.workspaceMetadata,
    arbitrationSkipReason: evaluation.arbitrationSkipReason,
    assistedRepairChain,
    activitySourceItems: [
      ...reviewCheckpoint.practiceRunLogIds.map((sourceId) => ({
        sourceType: "practice_run" as const,
        sourceId,
        evidenceRole: "execution_evidence" as const,
      })),
      ...(reviewCheckpoint.milestoneEventId
        ? [
            {
              sourceType: "l1_event" as const,
              sourceId: reviewCheckpoint.milestoneEventId,
              evidenceRole: "trace" as const,
            },
          ]
        : []),
    ],
    memoryOrigin: setup.memoryOrigin,
    pathStartedAt,
    l1OccurredAt: {
      reviewAttempt: new Date(pathStartedAt),
      runEvidence: evaluation.runnerCompletedAt,
      diagnosis: evaluation.diagnosisCompletedAt,
      coachReply: evaluation.diagnosisCompletedAt,
    },
    traceContext: setup.traceContext,
    campaignContext: setup.campaignContext,
  };
}

type PersistenceOutcome = Awaited<ReturnType<typeof persistReview>>;

async function attachReviewTraceReferences(
  setup: ReviewSetup,
  outcome: PersistenceOutcome,
) {
  if (!setup.traceContext) return;
  await attachTraceRunReferences(setup.traceContext, {
    reviewAttemptId: outcome.reviewAttempt.id,
    runId: outcome.runEvidence.id,
  });
}

function buildPipelineResult(
  setup: ReviewSetup,
  session: Session,
  evaluation: Evaluation,
  outcome: PersistenceOutcome,
): ReviewPipelineResult {
  const providerUsed = readProviderUsed(evaluation.runResult);
  return {
    ok: true,
    problem: {
      id: setup.problem.id,
      slug: setup.problem.slug,
      title: setup.problem.title,
    },
    chatSessionId: session.chatSession.id,
    reviewAttemptId: outcome.reviewAttempt.id,
    problemHistoryId: outcome.problemHistory.id,
    runResult: evaluation.runResult,
    evidence: {
      source: "review",
      language: setup.input.language,
      selectedTestCaseIds: setup.selectedTestCaseIds,
      runnerProvider: formatRunnerProvider(providerUsed),
      evidenceSource: formatEvidenceSource(providerUsed),
      evidenceVerdict: evaluation.evidenceVerdict,
      runResult: evaluation.runResult,
    },
    diagnosis: evaluation.coachResult.diagnosis,
    coachReply: evaluation.coachResult.coachReply,
    memoryBrief: projectReviewMemoryBriefForClient(evaluation.reviewMemory),
    degraded: evaluation.coachResult.degraded,
    trace: setup.workspaceTraceInfo,
  };
}

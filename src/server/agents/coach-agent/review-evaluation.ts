import type { PrismaClient } from "@prisma/client";
import {
  setTraceRunnerMs,
  startTraceStep,
  type TraceContext,
} from "@/server/llm/trace-context";
import type { CodeRunTestCase } from "@/types/code-runner";
import type { CoachReviewResult } from "@/types/coach";
import { getCoachProvider } from "./coach-provider";
import {
  buildCurrentWorkspaceContext,
  buildWorkspaceMetadata,
} from "./current-workspace-context";
import {
  buildCoachProblemContext,
  buildCoachUserContext,
  buildReviewPlannerContext,
  getDemoProblem,
  getLocalUserAndProfile,
} from "./review-context";
import { runReviewCodeWithTrust } from "./review-execution";
import {
  formatEvidenceSource,
  formatRunnerProvider,
  readProviderUsed,
} from "@/server/tools/code-runner/evidence-metadata";
import { loadReviewMemoryContext } from "./review-memory";
import { buildNonVerdictReviewResult } from "./review-non-verdict";
import type { ReviewPipelineDeps, ReviewRequest } from "./review-pipeline-contract";
import {
  buildLlmUnavailableResult,
  callReviewProviderOnce,
  sanitizePersistableSelfCheck,
} from "./review-provider";
import { alignReviewResultWithRunEvidence } from "./review-result-guard";
import {
  appendReviewArbitrationRequestTrace,
  appendReviewGuardTrace,
} from "./review-trace";

type EvaluationArgs = {
  db: PrismaClient;
  deps: ReviewPipelineDeps;
  input: ReviewRequest;
  user: Awaited<ReturnType<typeof getLocalUserAndProfile>>["user"];
  profile: Awaited<ReturnType<typeof getLocalUserAndProfile>>["profile"];
  problem: Awaited<ReturnType<typeof getDemoProblem>>;
  tags: string[];
  selectedTestCases: CodeRunTestCase[];
  latestVisibleUserMessage?: string;
  responseLanguage: "zh" | "en";
  codeHash: string;
  executionFingerprint: string;
  chatSessionId: string;
  traceContext?: TraceContext;
};

export async function evaluateReview(args: EvaluationArgs) {
  const runContext = await runAndLoadContext(args);
  const providerResult = await getCoachResult(args, runContext);
  const guarded = await guardCoachResult(args, runContext, providerResult);
  const diagnosisCompletedAt = new Date();
  return {
    ...runContext,
    ...guarded,
    diagnosisCompletedAt,
    workspaceMetadata: buildReviewWorkspace(args, runContext),
  };
}

async function runAndLoadContext(args: EvaluationArgs) {
  const runnerStartedAt = Date.now();
  const reviewRun = await runReviewCodeWithTrust({
    problem: args.problem,
    tags: args.tags,
    language: args.input.language,
    code: args.input.code,
    testCases: args.selectedTestCases,
    codeRunnerProvider: args.deps.codeRunnerProvider,
    traceContext: args.traceContext,
    codeHash: args.codeHash,
    executionFingerprint: args.executionFingerprint,
  });
  const runnerCompletedAt = new Date();
  setTraceRunnerMs(args.traceContext, Date.now() - runnerStartedAt);
  await emitEvidenceProgress(args, reviewRun);
  const plannerContext = args.deps.prisma
    ? undefined
    : await buildReviewPlannerContext({
        userId: args.user.id,
        currentProblemId: args.problem.id,
        currentPlanItemId: args.input.planItemId,
      });
  const reviewMemory = await loadReviewMemoryContext(args.db, {
    userId: args.user.id,
    problemId: args.problem.id,
    problemTags: args.tags,
    queryText: reviewQueryText(args),
    code: args.input.code,
    currentSignal: {
      failedCaseSummary: reviewRun.runResult.firstFailedCase
        ? JSON.stringify(reviewRun.runResult.firstFailedCase)
        : undefined,
    },
    profile: args.profile,
    ftsStore: args.deps.ftsStore,
    traceContext: args.traceContext,
  });
  return { ...reviewRun, runnerCompletedAt, plannerContext, reviewMemory };
}

async function emitEvidenceProgress(
  args: EvaluationArgs,
  reviewRun: Awaited<ReturnType<typeof runReviewCodeWithTrust>>,
) {
  if (!args.deps.onProgress) return;
  const providerUsed = readProviderUsed(reviewRun.runResult);
  try {
    await args.deps.onProgress({
      type: "evidence",
      evidence: {
        source: "review",
        language: args.input.language,
        selectedTestCaseIds: args.selectedTestCases.map((testCase) => testCase.id),
        runnerProvider: formatRunnerProvider(providerUsed),
        evidenceSource: formatEvidenceSource(providerUsed),
        evidenceVerdict: reviewRun.evidenceVerdict,
        runResult: reviewRun.runResult,
      },
    });
  } catch (error) {
    console.warn("Unable to emit Review evidence progress.", error);
  }
}

function reviewQueryText(args: EvaluationArgs) {
  return (
    args.input.userQuestion ??
    args.latestVisibleUserMessage ??
    args.problem.title
  );
}

type RunContext = Awaited<ReturnType<typeof runAndLoadContext>>;

async function getCoachResult(args: EvaluationArgs, context: RunContext) {
  const nonVerdict = buildNonVerdictReviewResult({
    evidenceVerdict: context.evidenceVerdict,
    problemSlug: args.problem.slug,
    problemTags: args.tags,
    runResult: context.runResult,
    responseLanguage: args.responseLanguage,
  });
  if (nonVerdict) return nonVerdict;
  try {
    return await callReviewProviderOnce(
      args.deps.coachProvider ?? getCoachProvider(),
      buildProviderInput(args, context),
      args.traceContext,
    );
  } catch (error) {
    console.error("Coach review provider threw; degrading to Tier 3.", error);
    return buildLlmUnavailableResult({
      problemSlug: args.problem.slug,
      problemTags: args.tags,
      runResult: context.runResult,
      responseLanguage: args.responseLanguage,
      error,
    });
  }
}

function buildProviderInput(args: EvaluationArgs, context: RunContext) {
  return {
    problem: buildCoachProblemContext(args.problem, args.tags),
    user: buildCoachUserContext(args.profile),
    memory: context.reviewMemory,
    planner: context.plannerContext,
    language: args.input.language,
    code: args.input.code,
    runResult: context.runResult,
    evidenceVerdict: context.evidenceVerdict,
    userState: args.input.userState,
    userQuestion: args.input.userQuestion,
    responseLanguage: args.responseLanguage,
    traceContext: args.traceContext,
  };
}

async function guardCoachResult(
  args: EvaluationArgs,
  context: RunContext,
  providerResult: CoachReviewResult,
) {
  const startedAt = Date.now();
  let coachResult = alignReviewResultWithRunEvidence({
    coachResult: providerResult,
    problemSlug: args.problem.slug,
    problemTitle: args.problem.title,
    problemTags: args.tags,
    code: args.input.code,
    runResult: context.runResult,
    evidenceVerdict: context.evidenceVerdict,
    responseLanguage: args.responseLanguage,
    planner: context.plannerContext,
  });
  const sanitizedSelfCheck = sanitizePersistableSelfCheck({
    coachResult,
    runStatus: context.runResult.status,
  });
  coachResult = {
    ...coachResult,
    diagnosis: { ...coachResult.diagnosis, selfCheck: sanitizedSelfCheck },
  };
  await traceGuard(args, context, providerResult, coachResult, startedAt);
  const arbitrationSkipReason = await traceArbitration(
    args,
    context,
    coachResult,
  );
  return { coachResult, sanitizedSelfCheck, arbitrationSkipReason };
}

async function traceGuard(
  args: EvaluationArgs,
  context: RunContext,
  providerResult: CoachReviewResult,
  visibleResult: CoachReviewResult,
  startedAt: number,
) {
  if (!args.traceContext) return;
  const step = startTraceStep(args.traceContext, { spanKind: "guard" });
  await appendReviewGuardTrace({
    traceContext: args.traceContext,
    step,
    durationMs: Date.now() - startedAt,
    providerResult,
    visibleResult,
    evidenceVerdict: context.evidenceVerdict,
    selfCheckChanged:
      JSON.stringify(providerResult.diagnosis.selfCheck ?? null) !==
      JSON.stringify(visibleResult.diagnosis.selfCheck ?? null),
  });
}

async function traceArbitration(
  args: EvaluationArgs,
  context: RunContext,
  result: CoachReviewResult,
) {
  const candidates = result.diagnosis.memoryUpdateCandidate.facts.map((fact) => ({
    ...fact,
    opcode: "reinforce",
  }));
  const reason = result.degraded?.memorySkipped
    ? ("memory_skipped" as const)
    : candidates.length === 0
      ? ("no_candidate" as const)
      : undefined;
  if (args.traceContext) {
    await appendReviewArbitrationRequestTrace({
      traceContext: args.traceContext,
      eligible: reason === undefined,
      reason,
      candidates,
    });
  }
  return reason;
}

function buildReviewWorkspace(args: EvaluationArgs, context: RunContext) {
  return buildWorkspaceMetadata(
    buildCurrentWorkspaceContext({
      problem: buildCoachProblemContext(args.problem, args.tags),
      language: args.input.language,
      code: args.input.code,
      selectedTests: args.selectedTestCases,
      latestAuthoritativeRunEvidence: {
        id: `review:${args.chatSessionId}`,
        storageSource: "review",
        producer: "user_action",
        subject: "current_user_code",
        authority: "authoritative",
        scope: { kind: "selected_suite", totalCount: args.selectedTestCases.length },
        oracle: "stored_expected",
        createdAt: new Date().toISOString(),
        codeHash: args.codeHash,
        executionFingerprint: args.executionFingerprint,
        result: context.runResult,
        evidenceVerdict: context.evidenceVerdict,
      },
      memory: context.reviewMemory,
      user: buildCoachUserContext(args.profile),
    }),
  );
}

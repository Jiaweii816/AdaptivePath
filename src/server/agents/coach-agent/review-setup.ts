import prisma from "@/server/db/prisma";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import { createTraceContext } from "@/server/llm/trace-context";
import { resolveMemoryOrigin } from "@/server/memory/memory-origin";
import { startPlannerPlanItem } from "@/server/planner/planner-service";
import {
  CampaignBindingError,
  resolveCampaignAttemptForWorkspaceSession,
  validateCampaignReviewContext,
} from "@/server/campaign/services";
import { ensureWorkspaceTraceTurnBestEffort } from "@/server/observability/workspace-trace-finalize";
import type { WorkspaceTraceTurnInfo } from "@/server/observability/runtime-trace-request";
import {
  getDemoProblem,
  getLocalUserAndProfile,
  inferResponseLanguage,
  loadLatestVisibleUserMessageForReview,
  loadSelectedVisibleTests,
  parseJson,
} from "./review-context";
import {
  ReviewPipelineError,
  reviewRequestSchema,
  type ReviewPipelineDeps,
} from "./review-pipeline-contract";

export async function resolveReviewSetup(
  rawInput: unknown,
  deps: ReviewPipelineDeps,
  pathStartedAt: number,
) {
  const db = deps.prisma ?? prisma;
  const input = reviewRequestSchema.parse(rawInput);
  const memoryOrigin = resolveMemoryOrigin();
  const { user, profile } = await getLocalUserAndProfile(db);
  const problem = await getDemoProblem(input, db);
  await startPlanItemBestEffort(input.planItemId);
  const inputContext = await resolveReviewInputContext({
    db,
    input,
    user,
    profile,
    problem,
  });
  const inputResolveDurationMs = Date.now() - pathStartedAt;
  const trace = await startReviewWorkspaceTrace({
    db,
    input,
    userId: user.id,
    problemId: problem.id,
    pathStartedAt,
    ...inputContext,
  });
  const campaignContext = await resolveReviewCampaignContext({
    db,
    trace,
    userId: user.id,
    problemId: problem.id,
    problemSlug: problem.slug,
  });
  return {
    db,
    deps,
    input,
    memoryOrigin,
    inputResolveDurationMs,
    backgroundJobsDisabled: deps.backgroundJobsPolicy === "disabled",
    user,
    profile,
    problem,
    ...inputContext,
    ...trace,
    campaignContext,
  };
}

async function resolveReviewCampaignContext(args: {
  db: NonNullable<ReviewPipelineDeps["prisma"]>;
  trace: Awaited<ReturnType<typeof startReviewWorkspaceTrace>>;
  userId: string;
  problemId: string;
  problemSlug: string;
}) {
  if (!args.trace.workspaceTraceTurn.enabled) return null;
  const context = await resolveCampaignAttemptForWorkspaceSession(
    args.db,
    args.trace.workspaceTraceTurn.workspaceSessionId,
  );
  if (!context) return null;
  try {
    await validateCampaignReviewContext(args.db, {
      context,
      userId: args.userId,
      problemId: args.problemId,
      problemSlug: args.problemSlug,
    });
    return context;
  } catch (error) {
    if (error instanceof CampaignBindingError) {
      throw new ReviewPipelineError(error.message, error.status);
    }
    throw error;
  }
}

async function startPlanItemBestEffort(planItemId?: string) {
  if (!planItemId) return;
  await startPlannerPlanItem({ planItemId }).catch(() => undefined);
}

type InputContextArgs = {
  db: NonNullable<ReviewPipelineDeps["prisma"]>;
  input: ReturnType<typeof reviewRequestSchema.parse>;
  user: Awaited<ReturnType<typeof getLocalUserAndProfile>>["user"];
  profile: Awaited<ReturnType<typeof getLocalUserAndProfile>>["profile"];
  problem: Awaited<ReturnType<typeof getDemoProblem>>;
};

async function resolveReviewInputContext(args: InputContextArgs) {
  const tags = parseJson<string[]>(args.problem.tags, []);
  const latestVisibleUserMessage = args.input.userQuestion
    ? undefined
    : await loadLatestVisibleUserMessageForReview(args.db, {
        userId: args.user.id,
        problemId: args.problem.id,
      });
  const responseLanguage = inferResponseLanguage({
    explicit: args.input.responseLanguage,
    userQuestion: args.input.userQuestion ?? latestVisibleUserMessage,
    explanationStyle: args.profile.explanationStyle,
    outputPreferences: args.profile.outputPreferences,
  });
  const selectedTestCases = await loadSelectedVisibleTests(
    {
      problemId: args.problem.id,
      userId: args.user.id,
      selectedTestCaseIds: args.input.selectedTestCaseIds,
    },
    args.db,
  );
  return {
    tags,
    latestVisibleUserMessage,
    responseLanguage,
    selectedTestCases,
    selectedTestCaseIds: selectedTestCases.map((testCase) => testCase.id),
    selectedTestsJson: selectedTestCases.map(({ id, label, input, expected, source }) => ({
      id,
      label,
      input,
      expected,
      source,
    })),
    codeHash: hashCodeForRun(args.input),
    executionFingerprint: fingerprintCodeForExecution(args.input),
  };
}

type TraceSetupArgs = Awaited<ReturnType<typeof resolveReviewInputContext>> & {
  db: InputContextArgs["db"];
  input: InputContextArgs["input"];
  userId: string;
  problemId: string;
  pathStartedAt: number;
};

async function startReviewWorkspaceTrace(args: TraceSetupArgs) {
  const workspaceTraceTurn = args.input.browserInstanceId
    ? await ensureWorkspaceTraceTurnBestEffort(args.db, {
        userId: args.userId,
        problemId: args.problemId,
        browserInstanceId: args.input.browserInstanceId,
        action: "review",
        snapshot: buildTraceSnapshot(args),
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
  const traceContext = workspaceTraceTurn.enabled
    ? createTraceContext({
        prisma: args.db,
        userId: args.userId,
        path: "review",
        task: "review.diagnose_and_reply",
        problemId: args.problemId,
        traceRunId: workspaceTraceTurn.traceRunId,
        workspaceSessionId: workspaceTraceTurn.workspaceSessionId,
        turnOrdinal: workspaceTraceTurn.turnOrdinal,
        captureLevel: workspaceTraceTurn.captureLevel,
        memoryOrigin: workspaceTraceTurn.memoryOrigin,
        initialTraceOverheadMs: workspaceTraceTurn.initialTraceOverheadMs,
      })
    : undefined;
  return { workspaceTraceTurn, workspaceTraceInfo, traceContext };
}

function buildTraceSnapshot(args: TraceSetupArgs) {
  return {
    language: args.input.language,
    code: args.input.code,
    codeHash: args.codeHash,
    executionFingerprint: args.executionFingerprint,
    selectedTestCaseIds: args.selectedTestCaseIds,
    testContext: args.selectedTestsJson,
    clientOccurredAt: args.input.clientOccurredAt,
    metadata: {
      instrumentationPhase: "phase4_review",
      responseLanguage: args.responseLanguage,
      planItemId: args.input.planItemId,
    },
  };
}

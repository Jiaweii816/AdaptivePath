import { Prisma, type PrismaClient } from "@prisma/client";
import { fingerprintCodeForExecution, hashSelectedTestSuite } from "@/server/code/code-hash";
import {
  classifyExecutionEvidence,
  readEvidenceVerdict,
} from "@/lib/evidence-trust";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import {
  codeRunResultSchema,
  codeRunnerLanguageSchema,
  type CodeRunResult,
} from "@/types/code-runner";
import type { EvidenceVerdict } from "@/types/evidence";
import type { NormalizedSettlementInput } from "../domain";
import type { CampaignDb } from "../store";
import { CampaignCoreService, type CampaignClock } from "./campaign-core-service";

export type CampaignBindingErrorCode =
  | "task_not_found"
  | "wrong_learner"
  | "wrong_problem"
  | "wrong_workspace"
  | "campaign_inactive"
  | "task_not_startable"
  | "workspace_already_bound"
  | "stale_review"
  | "review_not_found"
  | "evidence_not_found";

export class CampaignBindingError extends Error {
  constructor(
    readonly code: CampaignBindingErrorCode,
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "CampaignBindingError";
  }
}

export type CampaignWorkspaceAttemptContext = Readonly<{
  campaignId: string;
  taskId: string;
  taskItemId: string;
  attemptId: string;
  problemSlug: string;
  nodeId: string;
  slotRole: string;
  workspaceSessionId: string;
  settled: boolean;
}>;

export type CampaignReviewEvidenceSnapshot = Readonly<{
  reviewAttemptId: string;
  codeRevision: string;
  executionFingerprint: string;
  selectedSuiteFingerprint: string;
  evidenceProblemSlug: string;
  evidenceSubject: "current_user_code";
  evidenceScope: "selected_suite";
  evidenceClass: string;
  evidenceAuthority: "authoritative";
  evidenceCanVerdict: boolean;
  verdict: string;
}>;

/**
 * Starts one attempt per task/tab pair. WorkspaceSession is already tab-local,
 * so the database pair is also the refresh/resume idempotency key.
 */
export async function startOrResumeCampaignTaskItemAttempt(
  db: PrismaClient,
  input: {
    userId: string;
    taskItemId: string;
    workspaceSessionId: string;
    now: Date;
  },
) {
  try {
    return await db.$transaction(async (tx) => {
      const [taskItem, workspace] = await Promise.all([
        tx.campaignTaskItem.findUnique({
          where: { id: input.taskItemId },
          include: {
            settlement: { select: { id: true } },
            dailyTask: { include: { campaign: true } },
          },
        }),
        tx.problemWorkspaceSession.findUnique({
          where: { id: input.workspaceSessionId },
          include: { problem: true },
        }),
      ]);
      if (!taskItem) {
        throw new CampaignBindingError("task_not_found", "Campaign task item was not found.", 404);
      }
      if (taskItem.dailyTask.campaign.userId !== input.userId) {
        throw new CampaignBindingError("wrong_learner", "Campaign task item belongs to another learner.", 403);
      }
      if (!workspace || workspace.userId !== input.userId) {
        throw new CampaignBindingError("wrong_workspace", "WorkspaceSession belongs to another learner.", 403);
      }
      if (workspace.problem.slug !== taskItem.problemSlug) {
        throw new CampaignBindingError("wrong_problem", "WorkspaceSession problem does not match Campaign task item.");
      }
      if (taskItem.dailyTask.campaign.status !== "active") {
        throw new CampaignBindingError("campaign_inactive", "Campaign is not active.");
      }
      if (taskItem.status === "deferred") {
        throw new CampaignBindingError(
          "task_not_startable",
          "This Campaign task was carried forward. Open its current-day continuation instead.",
        );
      }

      const existing = await tx.campaignTaskItemAttempt.findUnique({
        where: {
          taskItemId_workspaceSessionId: {
            taskItemId: taskItem.id,
            workspaceSessionId: workspace.id,
          },
        },
      });
      if (existing) {
        return {
          kind: taskItem.settlement ? ("read_only" as const) : ("resumed" as const),
          attempt: existing,
        };
      }
      if (taskItem.settlement || taskItem.status === "settled") {
        throw new CampaignBindingError(
          "task_not_startable",
          "Campaign task item is already settled and can only be viewed read-only.",
        );
      }
      if (!["pending", "in_progress"].includes(taskItem.status)) {
        throw new CampaignBindingError("task_not_startable", "Campaign task item cannot be started.");
      }
      const workspaceAttempt = await tx.campaignTaskItemAttempt.findFirst({
        where: {
          workspaceSessionId: workspace.id,
          completedAt: null,
          taskItem: {
            settlement: { is: null },
            status: { in: ["pending", "in_progress"] },
          },
        },
        select: { taskItemId: true },
      });
      if (workspaceAttempt && workspaceAttempt.taskItemId !== taskItem.id) {
        throw new CampaignBindingError(
          "workspace_already_bound",
          "WorkspaceSession already has another active Campaign task attempt.",
        );
      }
      const attempt = await tx.campaignTaskItemAttempt.create({
        data: {
          taskItemId: taskItem.id,
          workspaceSessionId: workspace.id,
          startedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      if (taskItem.status === "pending") {
        await tx.campaignTaskItem.update({
          where: { id: taskItem.id },
          data: { status: "in_progress", updatedAt: input.now },
        });
      }
      return { kind: "started" as const, attempt };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const attempt = await db.campaignTaskItemAttempt.findUnique({
        where: {
          taskItemId_workspaceSessionId: {
            taskItemId: input.taskItemId,
            workspaceSessionId: input.workspaceSessionId,
          },
        },
      });
      if (attempt) return { kind: "resumed" as const, attempt };
    }
    throw error;
  }
}

/** Resolves server-trusted Campaign context; ordinary workspaces return null. */
export async function resolveCampaignAttemptForWorkspaceSession(
  db: CampaignDb,
  workspaceSessionId: string,
): Promise<CampaignWorkspaceAttemptContext | null> {
  const attempt = await db.campaignTaskItemAttempt.findFirst({
    where: { workspaceSessionId },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    include: {
      settlement: { select: { id: true } },
      taskItem: { include: { dailyTask: true } },
    },
  });
  if (!attempt || !attempt.workspaceSessionId) return null;
  return {
    campaignId: attempt.taskItem.dailyTask.campaignId,
    taskId: attempt.taskItem.dailyTaskId,
    taskItemId: attempt.taskItemId,
    attemptId: attempt.id,
    problemSlug: attempt.taskItem.problemSlug,
    nodeId: attempt.taskItem.nodeId,
    slotRole: attempt.taskItem.slotRole,
    workspaceSessionId: attempt.workspaceSessionId,
    settled: Boolean(attempt.settlement),
  };
}

export async function validateCampaignReviewContext(
  db: CampaignDb,
  input: {
    context: CampaignWorkspaceAttemptContext;
    userId: string;
    problemId: string;
    problemSlug: string;
  },
) {
  const attempt = await db.campaignTaskItemAttempt.findUnique({
    where: { id: input.context.attemptId },
    include: {
      workspaceSession: true,
      taskItem: { include: { dailyTask: { include: { campaign: true } } } },
    },
  });
  if (!attempt || attempt.workspaceSessionId !== input.context.workspaceSessionId) {
    throw new CampaignBindingError("wrong_workspace", "Campaign attempt no longer matches this WorkspaceSession.");
  }
  if (
    attempt.workspaceSession?.userId !== input.userId ||
    attempt.workspaceSession.problemId !== input.problemId ||
    attempt.taskItem.dailyTask.campaign.userId !== input.userId
  ) {
    throw new CampaignBindingError("wrong_learner", "Campaign Review ownership validation failed.", 403);
  }
  if (
    attempt.taskItem.problemSlug !== input.problemSlug ||
    attempt.taskItem.problemSlug !== input.context.problemSlug
  ) {
    throw new CampaignBindingError("wrong_problem", "Campaign Review problem does not match its task item.");
  }
  if (attempt.taskItem.dailyTask.campaign.status !== "active") {
    throw new CampaignBindingError("campaign_inactive", "Campaign is not active.");
  }
  if (attempt.taskItem.status === "deferred") {
    throw new CampaignBindingError("stale_review", "This Campaign task was carried forward before the Review completed.");
  }
  return attempt;
}

/** Called inside the existing Review persistence transaction. */
export async function bindCampaignAttemptToPersistedReview(
  tx: Prisma.TransactionClient,
  context: CampaignWorkspaceAttemptContext,
  snapshot: CampaignReviewEvidenceSnapshot,
) {
  if (context.settled) return { updated: false as const, reason: "already_settled" as const };
  const updated = await tx.campaignTaskItemAttempt.updateMany({
    where: {
      id: context.attemptId,
      workspaceSessionId: context.workspaceSessionId,
      completedAt: null,
      taskItem: { settlement: { is: null } },
    },
    data: { ...snapshot, updatedAt: new Date() },
  });
  return updated.count === 1
    ? { updated: true as const }
    : { updated: false as const, reason: "already_settled" as const };
}

export type CampaignSettlementAdapterResult =
  | { kind: "not_campaign" }
  | { kind: "settled"; settlementId: string; positiveForMastery: boolean }
  | { kind: "already_settled"; settlementId: string; positiveForMastery: boolean };

export async function buildCampaignSettlementInputFromReview(
  db: CampaignDb,
  input: { userId: string; reviewAttemptId: string },
): Promise<
  | { kind: "not_campaign" }
  | { kind: "already_settled"; settlementId: string; positiveForMastery: boolean }
  | {
      kind: "campaign";
      campaignId: string;
      taskItemId: string;
      attemptId: string;
      normalized: NormalizedSettlementInput;
    }
> {
  const review = await db.reviewAttempt.findFirst({
    where: { id: input.reviewAttemptId, userId: input.userId },
    include: {
      problem: true,
      plannerOutcome: true,
      runEvidences: {
        where: { source: "review" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
      campaignTaskItemAttempts: {
        include: {
          workspaceSession: true,
          taskItem: { include: { dailyTask: { include: { campaign: true } }, settlement: { select: { id: true } } } },
        },
      },
    },
  });
  if (!review) {
    throw new CampaignBindingError("review_not_found", "Review attempt was not found.", 404);
  }
  const attempt = review.campaignTaskItemAttempts[0];
  if (!attempt) {
    const settled = await rejectStaleCampaignReviewIfNeeded(db, input.userId, review.id);
    if (settled) {
      return {
        kind: "already_settled",
        settlementId: settled.id,
        positiveForMastery: settled.positiveForMastery,
      };
    }
    return { kind: "not_campaign" };
  }
  if (!review.plannerOutcome) {
    throw new CampaignBindingError("evidence_not_found", "Persisted self-rating is required before Campaign settlement.");
  }
  const run = review.runEvidences[0];
  if (!run) {
    throw new CampaignBindingError("evidence_not_found", "Persisted Review evidence was not found.");
  }
  if (
    !attempt.workspaceSession ||
    attempt.workspaceSession.userId !== input.userId ||
    attempt.workspaceSession.problemId !== review.problemId ||
    attempt.taskItem.dailyTask.campaign.userId !== input.userId
  ) {
    throw new CampaignBindingError("wrong_workspace", "Campaign attempt, Review, and WorkspaceSession do not align.");
  }
  if (
    attempt.taskItem.problemSlug !== review.problem.slug ||
    attempt.evidenceProblemSlug !== review.problem.slug ||
    attempt.evidenceSubject !== "current_user_code"
  ) {
    throw new CampaignBindingError("wrong_problem", "Persisted Review evidence belongs to another problem.");
  }
  if (attempt.reviewAttemptId !== review.id) {
    throw new CampaignBindingError("stale_review", "A newer Review has replaced this Campaign attempt evidence.");
  }

  const runResult = parsePersistedRunResult(run.rawResultJson);
  const evidenceVerdict = readPersistedEvidenceVerdict(runResult);
  const computedRevision = fingerprintCodeForExecution({
    language: codeRunnerLanguageSchema.parse(review.language),
    code: review.codeSnapshot,
  });
  const suiteFingerprint = hashSelectedTestSuite(parseStringArray(review.selectedTestCaseIds));
  const revisionMatches =
    Boolean(run.executionFingerprint) &&
    run.executionFingerprint === computedRevision &&
    attempt.codeRevision === computedRevision &&
    attempt.executionFingerprint === computedRevision &&
    attempt.selectedSuiteFingerprint === suiteFingerprint;
  const problemMatches = attempt.evidenceProblemSlug === attempt.taskItem.problemSlug;
  if (!revisionMatches) {
    throw new CampaignBindingError(
      "stale_review",
      "Campaign Review evidence no longer matches the persisted code revision and selected suite.",
    );
  }
  const localEvidence = await findLocalVisibleEvidence(db, {
    userId: input.userId,
    problemId: review.problemId,
    workspaceSessionId: attempt.workspaceSession.id,
    attemptStartedAt: attempt.startedAt,
    attemptCompletedAt: attempt.completedAt,
    reviewCreatedAt: review.createdAt,
    reviewCodeSnapshot: review.codeSnapshot,
    computedRevision,
    selectedSuiteFingerprint: suiteFingerprint,
  });
  const normalized: NormalizedSettlementInput = {
    reviewCompleted: true,
    passed: run.status === "passed_visible_tests",
    selfRating: review.plannerOutcome.selfRating,
    evidenceCanVerdict:
      evidenceVerdict.capabilities.canVerdict &&
      attempt.evidenceCanVerdict === true &&
      attempt.evidenceClass === evidenceVerdict.evidenceClass &&
      attempt.evidenceAuthority === "authoritative",
    evidenceMatchesCurrentRevision: true,
    evidenceMatchesTaskProblem: problemMatches,
    evidenceClass: evidenceVerdict.evidenceClass,
    evidenceAuthority:
      attempt.evidenceAuthority === "authoritative" ? "authoritative" : "advisory",
    evidenceSubject: attempt.evidenceSubject,
    evidenceScope: attempt.evidenceScope,
    evidenceSource: "review",
    evidenceReferenceId: run.id,
    verdict: runResult.status,
    codeRevision: computedRevision,
    localEvidence,
  };
  return {
    kind: "campaign",
    campaignId: attempt.taskItem.dailyTask.campaignId,
    taskItemId: attempt.taskItemId,
    attemptId: attempt.id,
    normalized,
  };
}

async function findLocalVisibleEvidence(
  db: CampaignDb,
  input: {
    userId: string;
    problemId: string;
    workspaceSessionId: string;
    attemptStartedAt: Date;
    attemptCompletedAt: Date | null;
    reviewCreatedAt: Date;
    reviewCodeSnapshot: string;
    computedRevision: string;
    selectedSuiteFingerprint: string;
  },
): Promise<NonNullable<NormalizedSettlementInput["localEvidence"]> | null> {
  const traces = await db.agentTraceRun.findMany({
    where: {
      workspaceSessionId: input.workspaceSessionId,
      path: "practice_run",
      runId: { not: null },
    },
    select: { runId: true },
  });
  const runIds = traces.flatMap((trace) => trace.runId ? [trace.runId] : []);
  if (runIds.length === 0) return null;
  const runs = await db.practiceRunLog.findMany({
    where: {
      id: { in: runIds },
      userId: input.userId,
      problemId: input.problemId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const candidate = runs.find(
    (run) => run.createdAt >= input.attemptStartedAt && run.createdAt <= input.reviewCreatedAt,
  );
  if (!candidate) return null;

  const canonicalTests = await db.problemTestCase.findMany({
    where: { problemId: input.problemId, userId: null, isVisible: true },
    select: { id: true },
  });
  const selectedIds = parseStringArray(candidate.selectedTestCaseIds);
  const canonicalIds = canonicalTests.map((test) => test.id);
  const fullVisibleSuite = sameStringSet(selectedIds, canonicalIds);
  const runResult = parsePersistedRunResult(candidate.rawResultJson);
  const verdict = readPersistedEvidenceVerdict(runResult);
  const laterRevisionExists = runs.some(
    (run) => run.createdAt > input.reviewCreatedAt &&
      (!input.attemptCompletedAt || run.createdAt <= input.attemptCompletedAt) &&
      run.executionFingerprint !== input.computedRevision,
  );
  return {
    referenceId: candidate.id,
    evidenceClass: verdict.evidenceClass,
    evidenceAuthority: "advisory",
    evidenceScope: "full_visible_suite",
    subject: "current_user_code",
    canVerdict: verdict.capabilities.canVerdict,
    verdict: verdict.capabilities.canVerdict
      ? candidate.status === "passed_visible_tests" ? "passed" : "failed"
      : "unavailable",
    ownershipAligned: true,
    revisionAligned:
      candidate.executionFingerprint === input.computedRevision &&
      candidate.codeSnapshot === input.reviewCodeSnapshot,
    executionFingerprintAligned: candidate.executionFingerprint === input.computedRevision,
    suiteAligned:
      hashSelectedTestSuite(selectedIds) === input.selectedSuiteFingerprint,
    fullVisibleSuite,
    customInput: selectedIds.some((id) => !canonicalIds.includes(id)),
    assistantCandidate: false,
    supersededAfterReview: laterRevisionExists,
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}

export async function settleCampaignTaskItemFromPersistedReview(
  db: PrismaClient,
  input: { userId: string; reviewAttemptId: string; settledAt: Date },
  clock?: CampaignClock,
): Promise<CampaignSettlementAdapterResult> {
  const built = await buildCampaignSettlementInputFromReview(db, input);
  if (built.kind === "not_campaign") return built;
  if (built.kind === "already_settled") return built;
  const before = await db.campaignTaskItemSettlement.findUnique({
    where: { taskItemId: built.taskItemId },
  });
  const settlement = await new CampaignCoreService(db, clock).settleTaskItem({
    campaignId: built.campaignId,
    taskItemId: built.taskItemId,
    attemptId: built.attemptId,
    settledAt: input.settledAt,
    normalized: built.normalized,
  });
  const alreadySettled = Boolean(before) || settlement.attemptId !== built.attemptId;
  return {
    kind: alreadySettled ? "already_settled" : "settled",
    settlementId: settlement.id,
    positiveForMastery: settlement.positiveForMastery,
  };
}

async function rejectStaleCampaignReviewIfNeeded(
  db: CampaignDb,
  userId: string,
  reviewAttemptId: string,
) {
  const traceRun = await db.agentTraceRun.findFirst({
    where: { reviewAttemptId, userId, workspaceSessionId: { not: null } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { workspaceSessionId: true },
  });
  if (!traceRun?.workspaceSessionId) return;
  const context = await resolveCampaignAttemptForWorkspaceSession(db, traceRun.workspaceSessionId);
  if (context) {
    if (context.settled) {
      return db.campaignTaskItemSettlement.findUnique({
        where: { taskItemId: context.taskItemId },
        select: { id: true, positiveForMastery: true },
      });
    }
    throw new CampaignBindingError("stale_review", "A newer Review has replaced this Campaign attempt evidence.");
  }
  return null;
}

function parsePersistedRunResult(rawResultJson: string): CodeRunResult {
  try {
    return codeRunResultSchema.parse(JSON.parse(rawResultJson));
  } catch {
    throw new CampaignBindingError("evidence_not_found", "Persisted Review evidence is unreadable.");
  }
}

function readPersistedEvidenceVerdict(runResult: CodeRunResult): EvidenceVerdict {
  const raw =
    runResult.rawResult && typeof runResult.rawResult === "object" && !Array.isArray(runResult.rawResult)
      ? (runResult.rawResult as Record<string, unknown>)
      : {};
  return (
    readEvidenceVerdict(raw.evidenceVerdict) ??
    classifyExecutionEvidence(runResult, {
      consumer: "review",
      providerUsed: readProviderUsed(runResult),
    })
  );
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

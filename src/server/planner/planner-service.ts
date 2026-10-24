import { Prisma, type PrismaClient } from "@prisma/client";
import { hot150Problems, type Hot150Problem } from "@/data/hot150";
import {
  irisDefaultProfile,
  irisHandle,
} from "@/features/onboarding/profile-defaults";
import { classifyExecutionEvidence, readEvidenceVerdict } from "@/lib/evidence-trust";
import { attachCodeRunErrorDetail } from "@/lib/code-run-error-detail";
import prisma from "@/server/db/prisma";
import { settleCampaignTaskItemFromPersistedReview } from "@/server/campaign/services";
import { loadGrowthStats } from "@/server/growth/growth-stats";
import {
  readLearnerClaimSemantics,
  type LearnerClaimFactLike,
} from "@/server/memory/claims/learner-claim-semantics";
import { isTrustedL2FactForConsumption } from "@/server/memory/integrity/memory-integrity-policy";
import {
  resolveLearnerActivityLedgerOrigins,
  resolveMemoryOrigin,
} from "@/server/memory/memory-origin";
import { listActiveSlots } from "@/server/memory/store/synthesis-store";
import { mechanismMatchesHot150ProblemTags } from "@/server/problems/hot150-taxonomy";
import { readProviderUsed } from "@/server/tools/code-runner/evidence-metadata";
import { codeRunResultSchema, type CodeRunResult } from "@/types/code-runner";
import {
  addPlannerDays,
  calculateDailyDose,
  daysBetweenPlannerDates,
  estimatePlanProblemCount,
  formatPlannerTag,
  interleaveHot150Problems,
  intervalForRating,
  mergeWhy,
  normalizePlannerTag,
  plannerDisplayTags,
  plannerPatternTags,
  primaryPatternTag,
  sourcePriority,
  startOfPlannerDay,
  toPlannerDateInput,
} from "./planner-rules";
import {
  PLANNER_REPLAN_FAILURE_THRESHOLD,
  PLANNER_REPLAN_LOOKBACK_DAYS,
  plannerGoalInputSchema,
  plannerOutcomeInputSchema,
  plannerSkipInputSchema,
  plannerStartInputSchema,
  type PlannerGoalInput,
  type PlannerOutcomeInput,
  type PlannerPlanItemSource,
  type PlannerStartInput,
  type PlannerSelfRating,
  type PlannerWhy,
  type TodayDoseItem,
  type TodayPlannerData,
} from "./planner.types";
import { buildReviewFocusBoard } from "./review-focus/build-review-focus-board";
import { projectPlannerProposal } from "./planner-proposal-presenter";

const json = (value: unknown) => JSON.stringify(value);
const REPLAN_CANDIDATE_EXCLUSION_DAYS = 3;
const replanReplacementUnavailableMessage =
  "No standard plan item is available to replace today or tomorrow.";
const skippedFromTodayWhy = {
  source: "plan",
  label: "Deferred",
  detail: "Skipped from Today; moved to the end of your plan.",
} satisfies PlannerWhy;
const displacedByReplanWhy = {
  source: "plan",
  label: "Deferred",
  detail: "Moved back because a re-plan reinforcement problem took this slot.",
} satisfies PlannerWhy;

type PlannerDb = PrismaClient;
type PlannerStore = PrismaClient | Prisma.TransactionClient;

type GoalRecord = Awaited<ReturnType<typeof loadActiveGoalForUser>>;
type DoseEntry = TodayDoseItem & {
  mandatory: boolean;
  rank: number;
  sortOrder: number;
  priorityDate: Date | null;
};

export class PlannerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

export async function createOrUpdatePlannerGoal(
  rawInput: PlannerGoalInput,
  options: { now?: Date; db?: PlannerDb } = {},
) {
  const db = options.db ?? prisma;
  const input = plannerGoalInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  const interviewDate = parsePlannerDate(input.interviewDate, now);
  const dailyDoseTarget = calculateDailyDose(input.weeklyHours);
  const problemCount = estimatePlanProblemCount({
    weeklyHours: input.weeklyHours,
    interviewDate,
    now,
  });
  const user = await getPlannerUser(db);
  const selectedProblems = interleaveHot150Problems(hot150Problems).slice(
    0,
    problemCount,
  );

  return db.$transaction(async (tx) => {
    await tx.readinessGoal.updateMany({
      where: { userId: user.id, status: "active" },
      data: { status: "archived" },
    });

    const goal = await tx.readinessGoal.create({
      data: {
        userId: user.id,
        targetLabel: input.targetLabel,
        interviewDate,
        weeklyHours: input.weeklyHours,
        dailyDoseTarget,
        planVersion: 1,
        status: "active",
      },
    });

    for (const [index, catalogProblem] of selectedProblems.entries()) {
      const problem = await upsertHot150Problem(tx, catalogProblem);
      const scheduledDate = addPlannerDays(
        startOfPlannerDay(now),
        Math.floor(index / dailyDoseTarget),
      );

      await tx.plannerPlanItem.create({
        data: {
          userId: user.id,
          goalId: goal.id,
          problemId: problem.id,
          source: "plan",
          status: "pending",
          scheduledDate,
          sortOrder: index,
          whyJson: json([
            {
              source: "plan",
              label: "New",
              detail: `${catalogProblem.section} in the Hot 150 interleaved plan.`,
            },
          ] satisfies PlannerWhy[]),
        },
      });
    }

    return goal;
  });
}

export async function getTodayPlannerData(
  options: { now?: Date; db?: PlannerDb } = {},
): Promise<TodayPlannerData> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const user = await getPlannerUser(db);
  const profile = await db.userProfile.findUnique({
    where: { userId: user.id },
  });
  const displayName = profile?.displayName ?? irisDefaultProfile.displayName;
  const goal = await loadActiveGoalForUser(db, user.id);

  if (!goal) {
    return {
      hasGoal: false,
      displayName,
      defaultTargetLabel: "General FAANG",
      defaultInterviewDate: toDateInput(addPlannerDays(startOfPlannerDay(now), 60)),
      defaultWeeklyHours: 8,
    };
  }

  const doseResult = await buildTodayDose(db, {
    userId: user.id,
    goal,
    now,
  });
  const growth = await loadGrowthStats(db, user.id, now);
  const reviewFocus = await buildReviewFocusBoard(db, {
    userId: user.id,
    goalId: goal.id,
    now,
  });
  const proposals = await db.plannerProposal.findMany({
    where: { userId: user.id, goalId: goal.id, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  return {
    hasGoal: true,
    displayName,
    goal: {
      id: goal.id,
      targetLabel: goal.targetLabel,
      interviewDate: toDateInput(goal.interviewDate),
      weeklyHours: goal.weeklyHours,
      dailyDoseTarget: goal.dailyDoseTarget,
      daysRemaining: daysBetweenPlannerDates(now, goal.interviewDate),
      planVersion: goal.planVersion,
    },
    coverage: doseResult.coverage,
    growth: {
      streakDays: growth.streakDays,
      weeklyProblemCount: growth.weeklyProblemCount,
      solvedCount: growth.solvedCount,
      top150Total: growth.top150Total,
    },
    dose: doseResult.dose,
    reviewFocus,
    proposals: proposals.map(projectPlannerProposal),
  };
}

export async function buildTodayDose(
  db: PlannerDb,
  args: {
    includeCompletedToday?: boolean;
    userId: string;
    goal: NonNullable<GoalRecord>;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const today = startOfPlannerDay(now);
  const tomorrow = addPlannerDays(today, 1);
  const nextWeek = addPlannerDays(today, 7);
  const existingTodaySnapshot = await loadDoseSnapshotItems(db, {
    userId: args.userId,
    goalId: args.goal.id,
    doseDate: today,
  });
  const existingTodayPracticeSnapshot =
    existingTodaySnapshot.filter(isPracticeDoseSnapshotItem);
  const hasLegacyReviewOnlySnapshot =
    existingTodaySnapshot.length > 0 && existingTodayPracticeSnapshot.length === 0;
  const previousSnapshotDate =
    existingTodayPracticeSnapshot.length === 0
      ? await loadLatestPreviousPracticeDoseDate(db, {
          userId: args.userId,
          goalId: args.goal.id,
          beforeDate: today,
        })
      : null;

  await backfillStartedPlanItems(db, {
    activeAfter: previousSnapshotDate ?? today,
    activeBefore: tomorrow,
    userId: args.userId,
    goalId: args.goal.id,
    now,
  });
  const [
    planItems,
    weaknessTags,
    outcomesToday,
  ] = await Promise.all([
    db.plannerPlanItem.findMany({
      where: {
        goalId: args.goal.id,
        status: { not: "replaced" },
      },
      include: { problem: true },
      orderBy: [{ scheduledDate: "asc" }, { sortOrder: "asc" }],
    }),
    loadWeaknessTags(db, args.userId),
    db.plannerOutcome.findMany({
      where: {
        userId: args.userId,
        goalId: args.goal.id,
        createdAt: { gte: today, lt: tomorrow },
      },
      include: { planItem: true },
    }),
  ]);
  const previousSnapshotItems =
    existingTodayPracticeSnapshot.length === 0 && previousSnapshotDate
      ? await loadDoseSnapshotItems(db, {
          userId: args.userId,
          goalId: args.goal.id,
          doseDate: previousSnapshotDate,
        })
      : [];
  const snapshotItems =
    existingTodayPracticeSnapshot.length > 0
      ? existingTodayPracticeSnapshot
      : previousSnapshotItems.filter(isPracticeDoseSnapshotItem);
  const isCarryingPreviousSnapshot =
    existingTodayPracticeSnapshot.length === 0 && snapshotItems.length > 0;
  const completedTodayProblemIds = new Set(
    args.includeCompletedToday === false || hasLegacyReviewOnlySnapshot
      ? []
      : outcomesToday.map((outcome) => outcome.problemId),
  );
  const snapshotProblemIds = new Set(
    snapshotItems.map((item) => item.problemId),
  );
  const hasSnapshot = snapshotItems.length > 0;
  const entries = new Map<string, DoseEntry>();
  const snapshotEntries = snapshotItems.map((item) => ({
    item,
    status: statusForPlanItem({
      completedTodayProblemIds,
      planItem: item.planItem,
      problemId: item.problemId,
    }),
  }));

  for (const { item, status } of snapshotEntries) {
    if (isCarryingPreviousSnapshot && status === "completed") {
      continue;
    }
    if (isDeferredToday(item.planItem, today)) {
      continue;
    }

    upsertDoseEntry(entries, {
      mandatory: true,
      planItemId: item.planItemId ?? undefined,
      priorityDate: item.planItem?.scheduledDate ?? item.doseDate,
      problem: item.problem,
      rank: 0,
      source: normalizeDoseSource(item.source),
      status,
      scheduledDate: item.planItem?.scheduledDate ?? null,
      sortOrder: item.sortOrder,
      why:
        parseWhy(item.whyJson)[0] ??
        ({
          source: normalizeDoseSource(item.source),
          label: "New",
          detail: "Pinned in today's readiness dose.",
        } satisfies PlannerWhy),
    });
  }

  for (const item of planItems) {
    if (
      item.status !== "pending" ||
      !item.startedAt ||
      isDeferredToday(item, today)
    ) {
      continue;
    }

    upsertDoseEntry(entries, {
      mandatory: false,
      planItemId: item.id,
      priorityDate: item.lastOpenedAt ?? item.startedAt,
      problem: item.problem,
      rank: 1,
      source: item.source as PlannerPlanItemSource,
      status: "in_progress",
      scheduledDate: item.scheduledDate,
      sortOrder: item.sortOrder,
      why: {
        source: item.source as PlannerPlanItemSource,
        label: "Continue",
        detail: "Started earlier; continue from your saved draft.",
      },
    });
  }

  for (const item of planItems) {
    if (
      item.status !== "pending" ||
      item.startedAt ||
      isDeferredToday(item, today) ||
      !item.scheduledDate ||
      startOfPlannerDay(item.scheduledDate) >= today
    ) {
      continue;
    }

    upsertDoseEntry(entries, {
      mandatory: false,
      planItemId: item.id,
      priorityDate: item.scheduledDate,
      problem: item.problem,
      rank: hasSnapshot ? 5 : 1,
      source: item.source as PlannerPlanItemSource,
      status: "pending",
      scheduledDate: item.scheduledDate,
      sortOrder: item.sortOrder,
      why: {
        source: item.source as PlannerPlanItemSource,
        label: "Carryover",
        detail: "Unfinished from an earlier Today dose.",
      },
    });
  }

  const weaknessMatchedProblemIds = new Set<string>();
  for (const tag of weaknessTags) {
    const match = planItems.find(
      (item) =>
        item.status === "pending" &&
        !isDeferredToday(item, today) &&
        !weaknessMatchedProblemIds.has(item.problemId) &&
        weaknessMechanismMatchesProblem(tag, parseTags(item.problem.tags)),
    );

    if (!match) {
      continue;
    }
    weaknessMatchedProblemIds.add(match.problemId);

    const isCompletedToday = shouldShowCompletedToday({
      completedTodayProblemIds,
      problemId: match.problemId,
      snapshotProblemIds,
      snapshotItemsCount: snapshotItems.length,
    });
    upsertDoseEntry(entries, {
      mandatory: isCompletedToday,
      planItemId: match.id,
      priorityDate: match.scheduledDate,
      problem: match.problem,
      rank: 3,
      source: "weakness",
      status: isCompletedToday
        ? "completed"
        : match.startedAt
          ? "in_progress"
          : "pending",
      scheduledDate: match.scheduledDate,
      sortOrder: match.sortOrder,
      why: {
        source: "weakness",
        label: "Weakness",
        detail: `Matches active weakness signal: ${formatPlannerTag(tag)}.`,
      },
    });
  }

  for (const item of planItems) {
    if (
      item.status !== "pending" &&
      !completedTodayProblemIds.has(item.problemId)
    ) {
      continue;
    }
    if (isDeferredToday(item, today)) {
      continue;
    }

    const isDue =
      !item.scheduledDate || startOfPlannerDay(item.scheduledDate) <= today;
    const shouldFill =
      entries.size < args.goal.dailyDoseTarget ||
      completedTodayProblemIds.has(item.problemId);

    if (!isDue && !shouldFill) {
      continue;
    }

    const why = parseWhy(item.whyJson);
    const isCompletedToday = shouldShowCompletedToday({
      completedTodayProblemIds,
      problemId: item.problemId,
      snapshotProblemIds,
      snapshotItemsCount: snapshotItems.length,
    });
    upsertDoseEntry(entries, {
      mandatory: isCompletedToday,
      planItemId: item.id,
      priorityDate: item.scheduledDate,
      problem: item.problem,
      rank: item.source === "replan" ? 4 : 5,
      source: item.source as PlannerPlanItemSource,
      status: isCompletedToday
        ? "completed"
        : item.status === "completed"
          ? "completed"
          : item.startedAt
            ? "in_progress"
          : "pending",
      scheduledDate: item.scheduledDate,
      sortOrder: item.sortOrder,
      why:
        why[0] ??
        ({
          source: "plan",
          label: "New",
          detail: "Next Hot 150 problem in the interleaved plan.",
        } satisfies PlannerWhy),
    });
  }

  const sortedEntries = [...entries.values()].sort(compareDoseEntries);
  const selectedEntries: DoseEntry[] = [];
  const selectedProblemIds = new Set<string>();
  const takeEntry = (item: DoseEntry) => {
    if (
      selectedEntries.length >= args.goal.dailyDoseTarget ||
      selectedProblemIds.has(item.problemId)
    ) {
      return;
    }

    selectedEntries.push(item);
    selectedProblemIds.add(item.problemId);
  };

  for (const item of sortedEntries) {
    if (item.mandatory) {
      takeEntry(item);
    }
  }

  for (const item of sortedEntries) {
    if (item.status !== "completed") {
      takeEntry(item);
    }
  }

  const dose = selectedEntries.map(stripDoseSortFields);
  await materializeTodayDoseSnapshot(db, {
    userId: args.userId,
    goalId: args.goal.id,
    doseDate: today,
    dose,
  });

  return {
    dose,
    coverage: buildCoverage(planItems, outcomesToday),
    nextWeek,
  };
}

export async function findNextTodayDoseItem(
  options: {
    userId: string;
    currentPlanItemId?: string;
    currentProblemId?: string;
    now?: Date;
    db?: PlannerDb;
  },
): Promise<TodayDoseItem | null> {
  const db = options.db ?? prisma;
  const goal = await loadActiveGoalForUser(db, options.userId);

  if (!goal) {
    return null;
  }

  const { dose } = await buildTodayDose(db, {
    userId: options.userId,
    goal,
    now: options.now,
  });
  const currentIndex = dose.findIndex((item) =>
    isCurrentDoseItem(item, {
      planItemId: options.currentPlanItemId,
      problemId: options.currentProblemId,
    }),
  );
  const afterCurrent = currentIndex >= 0 ? dose.slice(currentIndex + 1) : dose;
  const nextAfterCurrent = afterCurrent.find(
    (item) =>
      item.status === "pending" &&
      !isCurrentDoseItem(item, {
        planItemId: options.currentPlanItemId,
        problemId: options.currentProblemId,
      }),
  );

  if (nextAfterCurrent) {
    return nextAfterCurrent;
  }

  return (
    dose.find(
      (item) =>
        item.status === "pending" &&
        !isCurrentDoseItem(item, {
          planItemId: options.currentPlanItemId,
          problemId: options.currentProblemId,
        }),
    ) ?? null
  );
}

export async function advancePlannerDoseBatch(
  options: { now?: Date; db?: PlannerDb } = {},
) {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const today = startOfPlannerDay(now);
  const user = await getPlannerUser(db);
  const goal = await loadActiveGoalForUser(db, user.id);

  if (!goal) {
    throw new PlannerError("No active readiness goal was found.", 404);
  }

  const { dose } = await buildTodayDose(db, {
    userId: user.id,
    goal,
    now,
  });

  if (dose.length === 0 || dose.some((item) => item.status !== "completed")) {
    const alreadyAdvanced = await alreadyAdvancedResult(db, {
      userId: user.id,
      goalId: goal.id,
      today,
      dose,
    });

    if (alreadyAdvanced) {
      return alreadyAdvanced;
    }

    throw new PlannerError(
      "Complete the current dose before continuing to the next one.",
      400,
    );
  }

  const completedPlanItemIds = dose
    .map((item) => item.planItemId)
    .filter((id): id is string => Boolean(id));
  await db.$transaction(async (tx) => {
    await tx.plannerDailyDoseItem.deleteMany({
      where: {
        userId: user.id,
        goalId: goal.id,
        doseDate: today,
      },
    });

    if (completedPlanItemIds.length > 0) {
      await tx.plannerPlanItem.updateMany({
        where: {
          id: { in: completedPlanItemIds },
          userId: user.id,
          goalId: goal.id,
          status: "completed",
        },
        data: {
          scheduledDate: addPlannerDays(today, -1),
        },
      });
    }
  });
  const nextDose = await buildTodayDose(db, {
    includeCompletedToday: false,
    userId: user.id,
    goal,
    now,
  });
  const nextPlanItemIds = nextDose.dose
    .filter((item) => item.status !== "completed")
    .map((item) => item.planItemId)
    .filter((id): id is string => Boolean(id));

  if (nextPlanItemIds.length === 0) {
    throw new PlannerError("No next dose is available.", 404);
  }

  const fromDate =
    nextDose.dose.find((item) => item.scheduledDate)?.scheduledDate ??
    toDateInput(today);

  await db.plannerPlanItem.updateMany({
    where: {
      id: { in: nextPlanItemIds },
      userId: user.id,
      goalId: goal.id,
      status: "pending",
    },
    data: {
      scheduledDate: today,
    },
  });

  return {
    advancedCount: nextPlanItemIds.length,
    fromDate,
    toDate: toDateInput(today),
  };
}

export const advancePlannerDay = advancePlannerDoseBatch;

export async function skipPlannerDoseItem(
  rawInput: unknown,
  options: { now?: Date; db?: PlannerDb } = {},
) {
  const db = options.db ?? prisma;
  const input = plannerSkipInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  const today = startOfPlannerDay(now);
  const user = await getPlannerUser(db);
  const goal = await loadActiveGoalForUser(db, user.id);

  if (!goal) {
    throw new PlannerError("No active readiness goal was found.", 404);
  }

  await db.$transaction(async (tx) => {
    const planItem = await tx.plannerPlanItem.findFirst({
      where: {
        id: input.planItemId,
        userId: user.id,
        goalId: goal.id,
      },
      include: { problem: true },
    });

    if (!planItem) {
      throw new PlannerError("Planner item was not found.", 404);
    }

    if (planItem.status !== "pending") {
      throw new PlannerError("Only pending planner items can be skipped.", 400);
    }

    const [maxPendingDate, maxSort] = await Promise.all([
      tx.plannerPlanItem.aggregate({
        where: {
          userId: user.id,
          goalId: goal.id,
          status: "pending",
        },
        _max: { scheduledDate: true },
      }),
      tx.plannerPlanItem.aggregate({
        where: {
          userId: user.id,
          goalId: goal.id,
        },
        _max: { sortOrder: true },
      }),
    ]);
    const queueTailDate = maxPendingDate._max.scheduledDate ?? today;
    const why = prependPlannerWhy(parseWhy(planItem.whyJson), skippedFromTodayWhy);

    await tx.plannerPlanItem.update({
      where: { id: planItem.id },
      data: {
        scheduledDate: addPlannerDays(queueTailDate, 1),
        sortOrder: (maxSort._max.sortOrder ?? planItem.sortOrder) + 1,
        whyJson: json(why),
        startedAt: null,
        lastOpenedAt: null,
        deferredFromDate: today,
      },
    });

    await tx.plannerDailyDoseItem.deleteMany({
      where: {
        userId: user.id,
        goalId: goal.id,
        doseDate: today,
        OR: [
          { planItemId: planItem.id },
          { problemId: planItem.problemId },
        ],
      },
    });
  });

  return getTodayPlannerData({ db, now });
}

export async function startPlannerPlanItem(
  rawInput: PlannerStartInput,
  options: { now?: Date; db?: PlannerDb } = {},
) {
  const db = options.db ?? prisma;
  const input = plannerStartInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  const user = await getPlannerUser(db);
  const goal = await loadActiveGoalForUser(db, user.id);

  if (!goal) {
    throw new PlannerError("No active readiness goal was found.", 404);
  }

  const planItem = await db.plannerPlanItem.findFirst({
    where: {
      id: input.planItemId,
      userId: user.id,
      goalId: goal.id,
    },
    include: { problem: true },
  });

  if (!planItem) {
    throw new PlannerError("Planner item was not found.", 404);
  }

  if (planItem.status === "completed" || planItem.status === "replaced") {
    throw new PlannerError("This planner item is already closed.", 400);
  }

  const updated = await db.plannerPlanItem.update({
    where: { id: planItem.id },
    data: {
      startedAt: planItem.startedAt ?? now,
      lastOpenedAt: now,
    },
    include: { problem: true },
  });

  await buildTodayDose(db, {
    userId: user.id,
    goal,
    now,
  });

  return {
    planItemId: updated.id,
    problemId: updated.problemId,
    slug: updated.problem.slug,
    startedAt: updated.startedAt,
    lastOpenedAt: updated.lastOpenedAt,
  };
}

export async function recordPlannerOutcome(
  rawInput: PlannerOutcomeInput,
  options: { now?: Date; db?: PlannerDb } = {},
) {
  const db = options.db ?? prisma;
  const input = plannerOutcomeInputSchema.parse(rawInput);
  const now = options.now ?? new Date();
  const memoryOrigin = resolveMemoryOrigin();
  const user = await getPlannerUser(db);
  const existing = await db.plannerOutcome.findUnique({
    where: { reviewAttemptId: input.reviewAttemptId },
  });

  if (existing) {
    const campaignSettlement = await settleCampaignTaskItemFromPersistedReview(db, {
      userId: user.id,
      reviewAttemptId: existing.reviewAttemptId,
      settledAt: existing.createdAt,
    });
    return {
      outcome: existing,
      proposalCreated: false,
      alreadyRecorded: true,
      campaignSettlement,
    };
  }

  const [goal, reviewAttempt, problemHistory] = await Promise.all([
    loadActiveGoalForUser(db, user.id),
    db.reviewAttempt.findFirst({
      where: { id: input.reviewAttemptId, userId: user.id, memoryOrigin },
      include: { diagnosisResult: true, problem: true },
    }),
    db.problemHistory.findFirst({
      where: { id: input.problemHistoryId, userId: user.id, memoryOrigin },
      include: { problem: true },
    }),
  ]);

  if (!reviewAttempt) {
    throw new PlannerError("Review attempt was not found.", 404);
  }

  if (!problemHistory || problemHistory.reviewAttemptId !== reviewAttempt.id) {
    throw new PlannerError("Problem history was not found for this review.", 404);
  }

  const patternTags = collectPatternTags({
    problemTags: parseTags(reviewAttempt.problem.tags),
    historyTags: parseTags(problemHistory.problemTags),
    diagnosisJson: reviewAttempt.diagnosisResult?.diagnosisJson,
    mistakeTags: parseTags(reviewAttempt.diagnosisResult?.mistakeTags),
    skillTags: parseTags(reviewAttempt.diagnosisResult?.skillTags),
  });

  let result: {
    goal: GoalRecord;
    outcome: Awaited<ReturnType<PrismaClient["plannerOutcome"]["create"]>>;
  };

  try {
    result = await db.$transaction(async (tx) => {
      const planItem = goal
        ? await resolvePlanItem(tx, {
            userId: user.id,
            goalId: goal.id,
            planItemId: input.planItemId,
            problemId: reviewAttempt.problemId,
          })
        : null;

      const outcome = await tx.plannerOutcome.create({
        data: {
          userId: user.id,
          goalId: goal?.id,
          planItemId: planItem?.id,
          problemId: reviewAttempt.problemId,
          reviewAttemptId: reviewAttempt.id,
          problemHistoryId: problemHistory.id,
          selfRating: input.selfRating,
          patternTagsJson: json(patternTags),
          createdAt: now,
        },
      });

      if (planItem) {
        await tx.plannerPlanItem.update({
          where: { id: planItem.id },
          data: {
            status: "completed",
            completedAt: now,
          },
        });
      }

      if (goal) {
        await upsertReviewSchedule(tx, {
          userId: user.id,
          goalId: goal.id,
          problemId: reviewAttempt.problemId,
          patternTag: patternTags[0],
          rating: input.selfRating,
          outcomeId: outcome.id,
          now,
        });
      }

      return { outcome, goal };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await db.plannerOutcome.findUnique({
        where: { reviewAttemptId: input.reviewAttemptId },
      });
      if (duplicate) {
        const campaignSettlement = await settleCampaignTaskItemFromPersistedReview(db, {
          userId: user.id,
          reviewAttemptId: duplicate.reviewAttemptId,
          settledAt: duplicate.createdAt,
        });
        return {
          outcome: duplicate,
          proposalCreated: false,
          alreadyRecorded: true,
          campaignSettlement,
        };
      }
    }
    throw error;
  }

  const campaignSettlement = await settleCampaignTaskItemFromPersistedReview(db, {
    userId: user.id,
    reviewAttemptId: result.outcome.reviewAttemptId,
    settledAt: result.outcome.createdAt,
  });
  const shouldCheckReplan =
    input.selfRating === "struggled" || input.selfRating === "unsolved";
  const proposalCreated = result.goal && shouldCheckReplan
    ? await maybeCreateRepeatedFailureProposal(db, {
        userId: user.id,
        goalId: result.goal.id,
        patternTags,
        currentProblemSlug: reviewAttempt.problem.slug,
        now,
      })
    : false;

  return {
    outcome: result.outcome,
    proposalCreated,
    alreadyRecorded: false,
    campaignSettlement,
  };
}

export async function applyPlannerProposal(
  proposalId: string,
  decision: "accept" | "reject",
  options: { now?: Date; db?: PlannerDb; userId?: string } = {},
) {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const userId = options.userId ?? (await getPlannerUser(db)).id;
  const proposal = await db.plannerProposal.findFirst({
    where: { id: proposalId, userId, status: "pending" },
  });

  if (!proposal) {
    throw new PlannerError("Planner proposal was not found.", 404);
  }

  if (decision === "reject") {
    return db.plannerProposal.update({
      where: { id: proposal.id },
      data: {
        status: "rejected",
        decidedAt: now,
      },
    });
  }

  if (!proposal.targetProblemSlug) {
    throw new PlannerError("Proposal has no target problem.", 400);
  }

  const today = startOfPlannerDay(now);
  const tomorrow = addPlannerDays(today, 1);
  const dayAfterTomorrow = addPlannerDays(today, 2);

  return db.$transaction(async (tx) => {
    const catalogProblem = hot150Problems.find(
      (problem) => problem.slug === proposal.targetProblemSlug,
    );

    if (!catalogProblem) {
      throw new PlannerError("Proposal target is not in Hot 150.", 400);
    }

    const problem = await upsertHot150Problem(tx, catalogProblem);
    const why: PlannerWhy[] = [
      {
        source: "replan",
        label: "Re-plan",
        detail: proposal.reason,
      },
    ];
    const targetItem = await upsertReplanPlanItem(tx, {
      goalId: proposal.goalId,
      problemId: problem.id,
      scheduledDate: today,
      userId,
      why,
    });
    const todaySlots = await tx.plannerDailyDoseItem.findMany({
      where: {
        userId,
        goalId: proposal.goalId,
        doseDate: today,
        planItem: {
          is: {
            source: "plan",
            status: "pending",
            startedAt: null,
          },
        },
      },
      include: { planItem: true },
      orderBy: { sortOrder: "desc" },
    });
    const todaySlot = todaySlots.find(isReplaceableByReplanTodaySlot);

    if (todaySlot?.planItem) {
      await tx.plannerDailyDoseItem.update({
        where: { id: todaySlot.id },
        data: {
          problemId: problem.id,
          planItemId: targetItem.id,
          source: "replan",
          whyJson: json(why),
        },
      });
      await movePlanItemToBacklog(tx, {
        goalId: proposal.goalId,
        planItem: todaySlot.planItem,
        today,
        userId,
      });
    } else {
      const tomorrowItem = await tx.plannerPlanItem.findFirst({
        where: {
          userId,
          goalId: proposal.goalId,
          source: "plan",
          status: "pending",
          startedAt: null,
          scheduledDate: {
            gte: tomorrow,
            lt: dayAfterTomorrow,
          },
        },
        orderBy: { sortOrder: "desc" },
      });

      if (!tomorrowItem) {
        throw new PlannerError(replanReplacementUnavailableMessage, 400);
      }

      await tx.plannerPlanItem.update({
        where: { id: targetItem.id },
        data: {
          scheduledDate: tomorrow,
        },
      });
      await movePlanItemToBacklog(tx, {
        goalId: proposal.goalId,
        planItem: tomorrowItem,
        today,
        userId,
      });
    }

    return tx.plannerProposal.update({
      where: { id: proposal.id },
      data: {
        status: "accepted",
        decidedAt: now,
      },
    });
  });
}

async function upsertReplanPlanItem(
  db: PlannerStore,
  args: {
    userId: string;
    goalId: string;
    problemId: string;
    scheduledDate: Date;
    why: PlannerWhy[];
  },
) {
  const existingItem = await db.plannerPlanItem.findUnique({
    where: {
      goalId_problemId: {
        goalId: args.goalId,
        problemId: args.problemId,
      },
    },
  });

  if (existingItem) {
    return db.plannerPlanItem.update({
      where: { id: existingItem.id },
      data: {
        source: "replan",
        status: existingItem.status === "completed" ? "completed" : "pending",
        scheduledDate: args.scheduledDate,
        whyJson: json(args.why),
        deferredFromDate: null,
      },
    });
  }

  const maxSort = await db.plannerPlanItem.aggregate({
    where: { goalId: args.goalId },
    _max: { sortOrder: true },
  });

  return db.plannerPlanItem.create({
    data: {
      userId: args.userId,
      goalId: args.goalId,
      problemId: args.problemId,
      source: "replan",
      status: "pending",
      scheduledDate: args.scheduledDate,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      whyJson: json(args.why),
    },
  });
}

async function movePlanItemToBacklog(
  db: PlannerStore,
  args: {
    userId: string;
    goalId: string;
    planItem: {
      id: string;
      sortOrder: number;
      whyJson: string;
    };
    today: Date;
  },
) {
  const [maxPendingDate, maxSort] = await Promise.all([
    db.plannerPlanItem.aggregate({
      where: {
        userId: args.userId,
        goalId: args.goalId,
        status: "pending",
      },
      _max: { scheduledDate: true },
    }),
    db.plannerPlanItem.aggregate({
      where: {
        userId: args.userId,
        goalId: args.goalId,
      },
      _max: { sortOrder: true },
    }),
  ]);
  const queueTailDate = maxPendingDate._max.scheduledDate ?? args.today;
  const why = prependPlannerWhy(
    parseWhy(args.planItem.whyJson),
    displacedByReplanWhy,
  );

  await db.plannerPlanItem.update({
    where: { id: args.planItem.id },
    data: {
      scheduledDate: addPlannerDays(queueTailDate, 1),
      sortOrder: (maxSort._max.sortOrder ?? args.planItem.sortOrder) + 1,
      whyJson: json(why),
      startedAt: null,
      lastOpenedAt: null,
      deferredFromDate: args.today,
    },
  });
}

async function getPlannerUser(db: PlannerDb) {
  return db.user.upsert({
    where: { handle: irisHandle },
    update: {},
    create: { handle: irisHandle },
  });
}

async function loadActiveGoalForUser(db: PlannerStore, userId: string) {
  return db.readinessGoal.findFirst({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
}

async function upsertHot150Problem(db: PlannerStore, problem: Hot150Problem) {
  return db.problem.upsert({
    where: { slug: problem.slug },
    update: {
      leetcodeNumber: problem.leetcodeNumber,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: json(problem.tags),
    },
    create: {
      leetcodeNumber: problem.leetcodeNumber,
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      statementMarkdown: "",
      examplesJson: "[]",
      constraintsJson: "[]",
      tags: json(problem.tags),
      starterCodePython: "",
      starterCodeCpp: "",
      methodName: "",
      inputContractJson: "{}",
      outputContractJson: "{}",
      isDemoSupported: false,
    },
  });
}

function parsePlannerDate(value: string, now: Date) {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const rawDate = new Date(
    dateOnlyMatch ? `${value}T12:00:00.000Z` : value,
  );

  if (Number.isNaN(rawDate.getTime())) {
    throw new PlannerError("Interview date is invalid.", 400);
  }

  const date = startOfPlannerDay(rawDate);

  if (dateOnlyMatch && toDateInput(date) !== value) {
    throw new PlannerError("Interview date is invalid.", 400);
  }

  if (date < startOfPlannerDay(now)) {
    throw new PlannerError("Interview date must be today or later.", 400);
  }

  return date;
}

function toDateInput(date: Date) {
  return toPlannerDateInput(date);
}

async function loadWeaknessTags(db: PlannerDb, userId: string) {
  const ledgerOrigins = resolveLearnerActivityLedgerOrigins();
  const [facts, slots, recentFailedHistories] = await Promise.all([
    db.l2MemoryFact.findMany({
      where: {
        userId,
        memoryOrigin: "learner",
        status: { in: ["active", "improving", "validated"] },
      },
      orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
    }),
    listActiveSlots(db, {
      userId,
      slots: ["weakness_patterns", "practice_plan"],
      take: 4,
    }),
    db.problemHistory.findMany({
      where: {
        userId,
        memoryOrigin: { in: ledgerOrigins },
      },
      include: {
        reviewAttempt: {
          include: {
            runEvidences: {
              where: { source: "review", memoryOrigin: { in: ledgerOrigins } },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  return plannerPatternTags([
    ...facts
      .filter(isTrustedL2FactForConsumption)
      .slice(0, 40)
      .flatMap(projectLearnerClaimToPlannerWeaknessTags),
    ...slots.map((slot) => normalizePlannerTag(slot.synthesisKey)),
    ...recentFailedHistories
      .filter(isPlannerSignalFailure)
      .flatMap((history) =>
        parseTags(history.problemTags).map(normalizePlannerTag),
      ),
  ]);
}

export function projectLearnerClaimToPlannerWeaknessTags(
  fact: LearnerClaimFactLike,
) {
  const semantics = readLearnerClaimSemantics(fact);
  if (semantics.polarity !== "negative") return [];
  // These are soft matching terms. Unknown natural-language terms remain in
  // the weakness ledger but will not match an unrelated problem unless the
  // problem's own tags or taxonomy explicitly overlap.
  return plannerPatternTags(
    semantics.projectionTerms.map(normalizePlannerTag),
  );
}

export function weaknessMechanismMatchesProblem(
  weaknessTag: string,
  problemTags: string[],
) {
  const normalizedWeakness = normalizePlannerTag(weaknessTag);
  const normalizedProblemTags = plannerPatternTags(problemTags);
  return (
    normalizedProblemTags.includes(normalizedWeakness) ||
    mechanismMatchesHot150ProblemTags(
      normalizedWeakness,
      normalizedProblemTags,
    )
  );
}

function isPlannerSignalFailure(history: {
  runStatus: string;
  reviewAttempt: {
    runEvidences: Array<{ rawResultJson: string; status: string }>;
  };
}) {
  if (history.runStatus === "passed_visible_tests") {
    return false;
  }

  const runResult = parseStoredRunResult(history.reviewAttempt.runEvidences[0]);
  const evidenceVerdict =
    runResult &&
    (readEvidenceVerdict(rawResultRecord(runResult.rawResult).evidenceVerdict) ??
      classifyExecutionEvidence(runResult, {
        consumer: "planner",
        providerUsed: readProviderUsed(runResult),
      }));

  return Boolean(
    evidenceVerdict?.capabilities.canSignalPlanner &&
      evidenceVerdict.evidenceClass === "verdict_bearing",
  );
}

function parseStoredRunResult(
  evidence: { rawResultJson: string; status: string } | undefined,
): CodeRunResult | undefined {
  if (!evidence) {
    return undefined;
  }

  try {
    const parsed = codeRunResultSchema.safeParse(JSON.parse(evidence.rawResultJson));
    return parsed.success
      ? attachCodeRunErrorDetail(parsed.data)
      : codeRunResultSchema.parse({
          status: evidence.status,
          passedCount: 0,
          failedCount: 0,
          stdout: "",
          stderr: "",
          testResults: [],
        });
  } catch {
    return undefined;
  }
}

function rawResultRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseTags(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseWhy(value: string | null | undefined): PlannerWhy[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as PlannerWhy[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isReplaceableByReplanTodaySlot(slot: {
  source: string;
  whyJson: string | null;
  planItem: {
    source: string;
    status: string;
    startedAt: Date | null;
  } | null;
}) {
  if (
    !slot.planItem ||
    slot.planItem.source !== "plan" ||
    slot.planItem.status !== "pending" ||
    slot.planItem.startedAt
  ) {
    return false;
  }

  const why = parseWhy(slot.whyJson);
  if (hasPlannerReasonKind(why, "weakness")) {
    return false;
  }

  return slot.source === "plan" || hasPlannerReasonKind(why, "carryover");
}

function hasPlannerReasonKind(why: PlannerWhy[], kind: "carryover" | "weakness") {
  return why.some((reason) => {
    const label = reason.label.toLowerCase();
    if (kind === "weakness") {
      return reason.source === "weakness" || label.includes("weakness");
    }
    return label.includes("carryover");
  });
}

function isDeferredToday(
  item: { deferredFromDate?: Date | null } | null | undefined,
  today: Date,
) {
  if (!item?.deferredFromDate) {
    return false;
  }

  return startOfPlannerDay(item.deferredFromDate).getTime() === today.getTime();
}

function prependPlannerWhy(existing: PlannerWhy[], next: PlannerWhy) {
  return [
    next,
    ...existing.filter(
      (why) => why.source !== next.source || why.detail !== next.detail,
    ),
  ];
}

function upsertDoseEntry(
  entries: Map<string, DoseEntry>,
  args: {
    mandatory: boolean;
    planItemId?: string;
    priorityDate: Date | null;
    problem: {
      id: string;
      slug: string;
      title: string;
      leetcodeNumber: number | null;
      difficulty: string | null;
      tags: string;
    };
    rank: number;
    source: PlannerPlanItemSource;
    status: TodayDoseItem["status"];
    scheduledDate: Date | null;
    sortOrder: number;
    why: PlannerWhy;
  },
) {
  const current = entries.get(args.problem.id);
  const tags = plannerDisplayTags(parseTags(args.problem.tags));
  const scheduledDate = args.scheduledDate
    ? toDateInput(args.scheduledDate)
    : null;

  if (!current) {
    entries.set(args.problem.id, {
      planItemId: args.planItemId,
      problemId: args.problem.id,
      slug: args.problem.slug,
      title: args.problem.title,
      leetcodeNumber: args.problem.leetcodeNumber,
      difficulty: args.problem.difficulty,
      tags,
      source: args.source,
      status: args.status,
      scheduledDate,
      why: [args.why],
      mandatory: args.mandatory,
      rank: args.rank,
      sortOrder: args.sortOrder,
      priorityDate: args.priorityDate,
    });
    return;
  }

  if (args.source !== "plan" || current.source === "plan") {
    current.why = mergeWhy(current.why, args.why);
  }
  if (sourcePriority(args.source) < sourcePriority(current.source)) {
    current.source = args.source;
  }
  current.mandatory = current.mandatory || args.mandatory;
  current.rank = Math.min(current.rank, args.rank);
  if (
    !current.priorityDate ||
    (args.priorityDate && args.priorityDate < current.priorityDate)
  ) {
    current.priorityDate = args.priorityDate;
  }
  if (args.status === "completed") {
    current.status = "completed";
  } else if (args.status === "in_progress" && current.status !== "completed") {
    current.status = "in_progress";
  }
  if (!current.planItemId && args.planItemId) {
    current.planItemId = args.planItemId;
  }
}

async function loadDoseSnapshotItems(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    doseDate: Date;
  },
) {
  return db.plannerDailyDoseItem.findMany({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      doseDate: args.doseDate,
    },
    include: { problem: true, planItem: true },
    orderBy: { sortOrder: "asc" },
  });
}

async function loadLatestPreviousPracticeDoseDate(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    beforeDate: Date;
  },
) {
  const latestItem = await db.plannerDailyDoseItem.findFirst({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      doseDate: { lt: args.beforeDate },
      source: { in: ["plan", "weakness", "replan"] },
    },
    orderBy: [{ doseDate: "desc" }, { sortOrder: "asc" }],
    select: { doseDate: true },
  });

  return latestItem?.doseDate ?? null;
}

async function alreadyAdvancedResult(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    today: Date;
    dose: TodayDoseItem[];
  },
) {
  const activePracticeItems = args.dose.filter(
    (item) => item.status !== "completed" && item.planItemId,
  );

  if (activePracticeItems.length === 0) {
    return null;
  }

  const previousDate = await loadLatestPreviousPracticeDoseDate(db, {
    userId: args.userId,
    goalId: args.goalId,
    beforeDate: args.today,
  });

  if (!previousDate) {
    return null;
  }

  const previousItems = (
    await loadDoseSnapshotItems(db, {
      userId: args.userId,
      goalId: args.goalId,
      doseDate: previousDate,
    })
  ).filter(isPracticeDoseSnapshotItem);

  if (
    previousItems.length === 0 ||
    previousItems.some(
      (item) =>
        statusForPlanItem({
          completedTodayProblemIds: new Set<string>(),
          planItem: item.planItem,
          problemId: item.problemId,
        }) !== "completed",
    )
  ) {
    return null;
  }

  return {
    advancedCount: activePracticeItems.length,
    fromDate:
      args.dose.find((item) => item.scheduledDate)?.scheduledDate ??
      toDateInput(args.today),
    toDate: toDateInput(args.today),
  };
}

function isPracticeDoseSnapshotItem(item: { source: string }) {
  return (
    item.source === "plan" ||
    item.source === "weakness" ||
    item.source === "replan"
  );
}

async function materializeTodayDoseSnapshot(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    doseDate: Date;
    dose: TodayDoseItem[];
  },
) {
  try {
    await db.$transaction(async (tx) => {
      await tx.plannerDailyDoseItem.deleteMany({
        where: {
          userId: args.userId,
          goalId: args.goalId,
          doseDate: args.doseDate,
        },
      });

      for (const [index, item] of args.dose.entries()) {
        await tx.plannerDailyDoseItem.create({
          data: {
            userId: args.userId,
            goalId: args.goalId,
            doseDate: args.doseDate,
            problemId: item.problemId,
            planItemId: item.planItemId,
            source: item.source,
            sortOrder: index,
            whyJson: json(item.why),
          },
        });
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }
}

function buildCoverage(
  planItems: Array<{
    status: string;
    problem: { tags: string };
  }>,
  outcomesToday: unknown[],
) {
  const patternMap = new Map<string, { completed: number; total: number }>();
  const activeItems = planItems.filter((item) => item.status !== "replaced");
  const completedPlanItems = activeItems.filter(
    (item) => item.status === "completed",
  ).length;

  for (const item of activeItems) {
    const pattern = primaryPatternTag(parseTags(item.problem.tags));
    const current = patternMap.get(pattern) ?? { completed: 0, total: 0 };
    current.total += 1;
    if (item.status === "completed") {
      current.completed += 1;
    }
    patternMap.set(pattern, current);
  }

  return {
    completedPlanItems,
    totalPlanItems: activeItems.length,
    completedToday: outcomesToday.length,
    patternCoverage: [...patternMap.entries()]
      .map(([tag, value]) => ({ tag, ...value }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6),
  };
}

function stripDoseSortFields(
  item: DoseEntry,
) {
  return {
    planItemId: item.planItemId,
    problemId: item.problemId,
    slug: item.slug,
    title: item.title,
    leetcodeNumber: item.leetcodeNumber,
    difficulty: item.difficulty,
    tags: item.tags,
    source: item.source,
    status: item.status,
    scheduledDate: item.scheduledDate,
    why: item.why,
  } satisfies TodayDoseItem;
}

function compareDoseEntries(a: DoseEntry, b: DoseEntry) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const priority = sourcePriority(a.source) - sourcePriority(b.source);
  if (priority !== 0) return priority;
  const dateA = a.priorityDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const dateB = b.priorityDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (dateA !== dateB) return dateA - dateB;
  return a.sortOrder - b.sortOrder;
}

function statusForPlanItem(args: {
  completedTodayProblemIds: Set<string>;
  problemId: string;
  planItem: {
    status: string;
    startedAt: Date | null;
  } | null;
}): TodayDoseItem["status"] {
  if (
    args.completedTodayProblemIds.has(args.problemId) ||
    args.planItem?.status === "completed"
  ) {
    return "completed";
  }

  return args.planItem?.startedAt ? "in_progress" : "pending";
}

function shouldShowCompletedToday(args: {
  completedTodayProblemIds: Set<string>;
  problemId: string;
  snapshotItemsCount: number;
  snapshotProblemIds: Set<string>;
}) {
  return (
    args.completedTodayProblemIds.has(args.problemId) &&
    (args.snapshotItemsCount === 0 ||
      args.snapshotProblemIds.has(args.problemId))
  );
}

async function backfillStartedPlanItems(
  db: PlannerDb,
  args: {
    activeAfter: Date;
    activeBefore: Date;
    userId: string;
    goalId: string;
    now: Date;
  },
) {
  const candidates = await db.plannerPlanItem.findMany({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      status: "pending",
      startedAt: null,
      deferredFromDate: null,
    },
    select: { id: true, problemId: true },
  });

  if (candidates.length === 0) {
    return;
  }

  const problemIds = candidates.map((item) => item.problemId);
  const [drafts, reviews, runs, outcomes] = await Promise.all([
    db.codeDraft.findMany({
      where: {
        userId: args.userId,
        problemId: { in: problemIds },
        updatedAt: { gte: args.activeAfter, lt: args.activeBefore },
      },
      select: { problemId: true },
    }),
    db.reviewAttempt.findMany({
      where: {
        userId: args.userId,
        problemId: { in: problemIds },
        createdAt: { gte: args.activeAfter, lt: args.activeBefore },
      },
      select: { problemId: true },
    }),
    db.practiceRunLog.findMany({
      where: {
        userId: args.userId,
        problemId: { in: problemIds },
        createdAt: { gte: args.activeAfter, lt: args.activeBefore },
      },
      select: { problemId: true },
    }),
    db.plannerOutcome.findMany({
      where: {
        userId: args.userId,
        goalId: args.goalId,
        problemId: { in: problemIds },
      },
      select: { problemId: true },
    }),
  ]);
  const completedProblemIds = new Set(outcomes.map((outcome) => outcome.problemId));
  const activeProblemIds = new Set([
    ...drafts.map((draft) => draft.problemId),
    ...reviews.map((review) => review.problemId),
    ...runs.map((run) => run.problemId),
  ]);
  const startedPlanItemIds = candidates
    .filter(
      (item) =>
        activeProblemIds.has(item.problemId) &&
        !completedProblemIds.has(item.problemId),
    )
    .map((item) => item.id);

  if (startedPlanItemIds.length === 0) {
    return;
  }

  await db.plannerPlanItem.updateMany({
    where: {
      id: { in: startedPlanItemIds },
      userId: args.userId,
      goalId: args.goalId,
      status: "pending",
      startedAt: null,
    },
    data: {
      startedAt: args.now,
      lastOpenedAt: args.now,
    },
  });
}

function normalizeDoseSource(source: string): PlannerPlanItemSource {
  if (
    source === "review" ||
    source === "weakness" ||
    source === "replan" ||
    source === "plan"
  ) {
    return source;
  }

  return "plan";
}

function isCurrentDoseItem(
  item: TodayDoseItem,
  current: { planItemId?: string; problemId?: string },
) {
  return Boolean(
    (current.planItemId && item.planItemId === current.planItemId) ||
      (current.problemId && item.problemId === current.problemId),
  );
}

function collectPatternTags(args: {
  problemTags: string[];
  historyTags: string[];
  diagnosisJson?: string | null;
  mistakeTags: string[];
  skillTags: string[];
}) {
  const diagnosis = parseJsonObject(args.diagnosisJson);
  const diagnosisMistakeTags = readStringArray(diagnosis.mistakeTags);
  const diagnosisSkillTags = readStringArray(diagnosis.skillTags);

  return plannerPatternTags([
    ...args.problemTags,
    ...args.historyTags,
    ...args.mistakeTags,
    ...args.skillTags,
    ...diagnosisMistakeTags,
    ...diagnosisSkillTags,
  ]);
}

async function resolvePlanItem(
  db: PlannerStore,
  args: {
    userId: string;
    goalId: string;
    planItemId?: string;
    problemId: string;
  },
) {
  if (args.planItemId) {
    const item = await db.plannerPlanItem.findFirst({
      where: {
        id: args.planItemId,
        userId: args.userId,
        goalId: args.goalId,
        problemId: args.problemId,
      },
    });
    if (item) {
      return item;
    }
  }

  return db.plannerPlanItem.findFirst({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      problemId: args.problemId,
      status: { not: "replaced" },
    },
    orderBy: { sortOrder: "asc" },
  });
}

async function upsertReviewSchedule(
  db: PlannerStore,
  args: {
    userId: string;
    goalId: string;
    problemId: string;
    patternTag?: string;
    rating: PlannerSelfRating;
    outcomeId: string;
    now: Date;
  },
) {
  const previous = await db.reviewSchedule.findUnique({
    where: {
      userId_goalId_problemId: {
        userId: args.userId,
        goalId: args.goalId,
        problemId: args.problemId,
      },
    },
  });
  const next = intervalForRating({
    rating: args.rating,
    previousIntervalDays: previous?.intervalDays,
    previousEase: previous?.ease,
  });

  return db.reviewSchedule.upsert({
    where: {
      userId_goalId_problemId: {
        userId: args.userId,
        goalId: args.goalId,
        problemId: args.problemId,
      },
    },
    update: {
      dueDate: addPlannerDays(startOfPlannerDay(args.now), next.intervalDays),
      intervalDays: next.intervalDays,
      ease: next.ease,
      repetitions: (previous?.repetitions ?? 0) + 1,
      lastRating: args.rating,
      lastOutcomeId: args.outcomeId,
      patternTag: args.patternTag,
      status: "active",
    },
    create: {
      userId: args.userId,
      goalId: args.goalId,
      problemId: args.problemId,
      patternTag: args.patternTag,
      dueDate: addPlannerDays(startOfPlannerDay(args.now), next.intervalDays),
      intervalDays: next.intervalDays,
      ease: next.ease,
      repetitions: 1,
      lastRating: args.rating,
      lastOutcomeId: args.outcomeId,
      status: "active",
    },
  });
}

async function maybeCreateRepeatedFailureProposal(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    patternTags: string[];
    currentProblemSlug: string;
    now: Date;
  },
) {
  const failureTags = await loadRecentFailureTags(db, {
    userId: args.userId,
    goalId: args.goalId,
    since: addPlannerDays(
      startOfPlannerDay(args.now),
      -PLANNER_REPLAN_LOOKBACK_DAYS,
    ),
  });

  for (const patternTag of args.patternTags) {
    const count = failureTags.filter((tag) => tag === patternTag).length;
    if (count < PLANNER_REPLAN_FAILURE_THRESHOLD) {
      continue;
    }

    const existing = await db.plannerProposal.findFirst({
      where: {
        userId: args.userId,
        goalId: args.goalId,
        type: "repeated_failure",
        patternTag,
        status: "pending",
      },
    });

    if (existing) {
      return false;
    }

    const candidate = await findReplanCandidate(db, {
      userId: args.userId,
      goalId: args.goalId,
      patternTag,
      currentProblemSlug: args.currentProblemSlug,
      now: args.now,
    });

    if (!candidate) {
      continue;
    }

    await db.plannerProposal.create({
      data: {
        userId: args.userId,
        goalId: args.goalId,
        type: "repeated_failure",
        patternTag,
        reason: `You marked ${patternTag} as struggled/unsolved ${count} times in the last ${PLANNER_REPLAN_LOOKBACK_DAYS} days.`,
        proposedChangeJson: json({
          action: "insert_reinforcement",
          patternTag,
          targetProblemSlug: candidate.slug,
          cost: "Adds one focused reinforcement problem to the current plan.",
        }),
        targetProblemSlug: candidate.slug,
        targetProblemTitle: candidate.title,
        targetLeetcodeNumber: candidate.leetcodeNumber,
      },
    });
    return true;
  }

  return false;
}

async function loadRecentFailureTags(
  db: PlannerDb,
  args: { userId: string; goalId: string; since: Date },
) {
  const outcomes = await db.plannerOutcome.findMany({
    where: {
      userId: args.userId,
      goalId: args.goalId,
      selfRating: { in: ["struggled", "unsolved"] },
      createdAt: { gte: args.since },
    },
  });

  return outcomes.flatMap((outcome) => parseTags(outcome.patternTagsJson));
}

async function findReplanCandidate(
  db: PlannerDb,
  args: {
    userId: string;
    goalId: string;
    patternTag: string;
    currentProblemSlug: string;
    now: Date;
  },
) {
  const [outcomes, upcomingItems] = await Promise.all([
    db.plannerOutcome.findMany({
      where: { userId: args.userId, goalId: args.goalId },
      include: { problem: true },
    }),
    db.plannerPlanItem.findMany({
      where: {
        goalId: args.goalId,
        status: "pending",
        scheduledDate: {
          gte: startOfPlannerDay(args.now),
          lte: addPlannerDays(
            startOfPlannerDay(args.now),
            REPLAN_CANDIDATE_EXCLUSION_DAYS,
          ),
        },
      },
      include: { problem: true },
    }),
  ]);
  const completedSlugs = new Set(
    outcomes.map((outcome) => outcome.problem.slug),
  );
  const upcomingSlugs = new Set(upcomingItems.map((item) => item.problem.slug));

  return hot150Problems.find((problem) => {
    if (problem.slug === args.currentProblemSlug) return false;
    if (completedSlugs.has(problem.slug)) return false;
    if (upcomingSlugs.has(problem.slug)) return false;
    return plannerPatternTags(problem.tags).includes(args.patternTag);
  });
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

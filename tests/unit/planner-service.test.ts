import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createMemoryTestDb,
  trustedL2FactFixture,
} from "./memory-test-helpers";
import {
  advancePlannerDoseBatch,
  applyPlannerProposal,
  createOrUpdatePlannerGoal,
  getTodayPlannerData,
  recordPlannerOutcome,
  skipPlannerDoseItem,
  startPlannerPlanItem,
} from "@/server/planner/planner-service";
import {
  addPlannerDays,
  plannerPatternTags,
  startOfPlannerDay,
} from "@/server/planner/planner-rules";
import type { PlannerWhy } from "@/server/planner/planner.types";
import type { CodeRunStatus } from "@/types/code-runner";
import type { FailureProvenance } from "@/types/evidence";

const json = (value: unknown) => JSON.stringify(value);
const PROCESS_TEST_MEMORY_ORIGIN = "test";

describe("planner service", () => {
  it("filters blocked development-noise keys from planner patterns", () => {
    expect(
      plannerPatternTags([
        "hardcoded_return",
        "no-search-logic",
        "binary_search_boundary",
      ]),
    ).toEqual(["binary_search_boundary"]);
  });

  it("creates an active goal and generates an interleaved Hot 150 plan", async () => {
    const db = await createMemoryTestDb();
    try {
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "泛 FAANG",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now: new Date("2026-06-17T12:00:00Z") },
      );
      const planItems = await db.prisma.plannerPlanItem.findMany({
        where: { goalId: goal.id },
        include: { problem: true },
        orderBy: { sortOrder: "asc" },
      });

      expect(goal.dailyDoseTarget).toBe(2);
      expect(planItems.length).toBeGreaterThan(20);
      expect(new Set(planItems.slice(0, 8).map((item) => item.problem.tags)).size)
        .toBeGreaterThan(1);
    } finally {
      await db.cleanup();
    }
  });

  it("records self-rating outcomes and writes review schedule without auto-completing from run status", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now },
      );
      const planItem = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: { goalId: goal.id },
        include: { problem: true },
      });
      const review = await createReviewFixture(db.prisma, {
        problemId: planItem.problemId,
        runStatus: "passed_visible_tests",
        tags: ["array"],
      });

      await recordPlannerOutcome(
        {
          planItemId: planItem.id,
          problemHistoryId: review.problemHistory.id,
          reviewAttemptId: review.reviewAttempt.id,
          selfRating: "struggled",
        },
        { db: db.prisma, now },
      );

      const updatedItem = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: planItem.id },
      });
      const schedule = await db.prisma.reviewSchedule.findUniqueOrThrow({
        where: {
          userId_goalId_problemId: {
            userId: review.user.id,
            goalId: goal.id,
            problemId: planItem.problemId,
          },
        },
      });

      expect(updatedItem.status).toBe("completed");
      expect(schedule.intervalDays).toBe(2);
      expect(schedule.dueDate.toISOString().slice(0, 10)).toBe("2026-06-19");
    } finally {
      await db.cleanup();
    }
  });

  it("builds Today dose and separates due reviews into review focus", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      await createOrUpdatePlannerGoal(
        {
          targetLabel: "Google",
          interviewDate: "2026-07-17",
          weeklyHours: 14,
        },
        { db: db.prisma, now },
      );
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const binarySearchProblem = await db.prisma.problem.findFirstOrThrow({
        where: { tags: { contains: "binary-search" } },
      });
      const slidingWindowProblem = await db.prisma.problem.findFirstOrThrow({
        where: { tags: { contains: "sliding-window" } },
      });
      const matrixProblem = await db.prisma.problem.findFirstOrThrow({
        where: { slug: "valid-sudoku" },
      });
      await db.prisma.problem.update({
        where: { id: matrixProblem.id },
        data: {
          tags: json([
            "matrix",
            "top-interview-150",
            "interview-150",
            "hot150",
          ]),
        },
      });
      await db.prisma.l2MemoryFact.create({
        data: {
          userId: user.id,
          problemId: slidingWindowProblem.id,
          factType: "weakness",
          tag: "sliding-window",
          value: "left pointer mistakes",
          confidence: 0.8,
          evidenceCount: 2,
          ...trustedL2FactFixture({
            mechanism: "sliding_window_left_pointer_movement",
            humanLabel: "Moves the sliding-window left edge incorrectly",
          }),
        },
      });
      await db.prisma.l2MemoryFact.create({
        data: {
          userId: user.id,
          problemId: matrixProblem.id,
          factType: "weakness",
          tag: "matrix_row_column_invariant",
          value: "mixes row and column validation state",
          confidence: 0.85,
          evidenceCount: 2,
          ...trustedL2FactFixture({
            mechanism: "matrix_row_column_invariant",
            humanLabel: "Mixes row and column validation state",
          }),
        },
      });
      await db.prisma.l2MemoryFact.create({
        data: {
          userId: user.id,
          problemId: matrixProblem.id,
          factType: "weakness",
          tag: "top-interview-150",
          value: "collection alias should not drive weakness dose",
          confidence: 0.9,
          evidenceCount: 1,
          ...trustedL2FactFixture({
            mechanism: "top_interview_150",
            humanLabel: "Collection metadata must not become a weakness",
          }),
        },
      });
      await createReviewFixture(db.prisma, {
        problemId: matrixProblem.id,
        runStatus: "failed",
        tags: ["top-interview-150", "interview-150", "hot150", "matrix"],
      });
      await db.prisma.reviewSchedule.create({
        data: {
          userId: user.id,
          goalId: (await db.prisma.readinessGoal.findFirstOrThrow()).id,
          problemId: binarySearchProblem.id,
          patternTag: "binary_search",
          dueDate: now,
          intervalDays: 1,
          lastRating: "unsolved",
        },
      });

      const today = await getTodayPlannerData({ db: db.prisma, now });

      expect(today.hasGoal).toBe(true);
      if (!today.hasGoal) return;
      expect(
        today.reviewFocus.cards.map((card) => card.slug),
      ).not.toContain(binarySearchProblem.slug);
      expect(today.dose.every((item) => item.source !== "review")).toBe(true);
      expect(today.dose.some((item) => item.source === "weakness")).toBe(true);
      const matrixDose = today.dose.find((item) => item.slug === "valid-sudoku");
      expect(matrixDose?.tags).toEqual(["matrix"]);
      expect(matrixDose?.why).toEqual([
        {
          source: "weakness",
          label: "Weakness",
          detail:
            "Matches active weakness signal: matrix-row-column-invariant.",
        },
      ]);
      const renderedText = today.dose
        .flatMap((item) => [
          ...item.tags,
          ...item.why.map((why) => why.detail),
        ])
        .join(" ");
      expect(renderedText).not.toMatch(/top-interview-150|interview-150|hot150/);
    } finally {
      await db.cleanup();
    }
  });

  it("does not use non-verdict runner errors as planner weakness signals", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 14,
        },
        { db: db.prisma, now },
      );
      const matrixProblem = await db.prisma.problem.findFirstOrThrow({
        where: { slug: "valid-sudoku" },
      });
      await db.prisma.problem.update({
        where: { id: matrixProblem.id },
        data: {
          tags: json(["matrix", "top-interview-150"]),
        },
      });
      await createReviewFixture(db.prisma, {
        problemId: matrixProblem.id,
        runStatus: "runner_error",
        failureProvenance: "network",
        tags: ["matrix"],
      });

      const today = await getTodayPlannerData({ db: db.prisma, now });

      expect(today.hasGoal).toBe(true);
      if (!today.hasGoal) return;
      expect(
        today.dose.flatMap((item) => item.why).some(
          (why) =>
            why.source === "weakness" &&
            why.detail.includes("matrix"),
        ),
      ).toBe(false);
    } finally {
      await db.cleanup();
    }
  });

  it("keeps today's completed item visible instead of replacing it with another pending problem", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const planItems = await db.prisma.plannerPlanItem.findMany({
        where: { goalId: goal.id },
        include: { problem: true },
        orderBy: { sortOrder: "asc" },
        take: 8,
      });
      const completedItem = planItems[0];
      if (!completedItem) {
        throw new Error("Expected seeded plan items.");
      }
      const review = await createReviewFixture(db.prisma, {
        problemId: completedItem.problemId,
        runStatus: "passed_visible_tests",
        tags: ["array"],
      });

      await recordPlannerOutcome(
        {
          planItemId: completedItem.id,
          problemHistoryId: review.problemHistory.id,
          reviewAttemptId: review.reviewAttempt.id,
          selfRating: "easy",
        },
        { db: db.prisma, now },
      );

      for (const item of planItems.slice(1, 6)) {
        await db.prisma.reviewSchedule.create({
          data: {
            userId: user.id,
            goalId: goal.id,
            problemId: item.problemId,
            dueDate: now,
            intervalDays: 1,
            lastRating: "hesitated",
          },
        });
      }

      const today = await getTodayPlannerData({ db: db.prisma, now });

      expect(today.hasGoal).toBe(true);
      if (!today.hasGoal) return;
      expect(today.dose).toHaveLength(goal.dailyDoseTarget);
      expect(
        today.dose.find((item) => item.planItemId === completedItem.id),
      ).toMatchObject({
        status: "completed",
        title: completedItem.problem.title,
      });
      expect(
        today.dose.filter((item) => item.status === "pending"),
      ).toHaveLength(goal.dailyDoseTarget - 1);
    } finally {
      await db.cleanup();
    }
  });

  it("keeps an overdue plan item visible when it is completed today", async () => {
    const db = await createMemoryTestDb();
    try {
      const planStart = new Date("2026-06-17T12:00:00Z");
      const today = new Date("2026-06-18T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now: planStart },
      );
      const overdueItem = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: { goalId: goal.id },
        include: { problem: true },
        orderBy: { sortOrder: "asc" },
      });
      const review = await createReviewFixture(db.prisma, {
        problemId: overdueItem.problemId,
        runStatus: "passed_visible_tests",
        tags: ["array"],
      });

      await recordPlannerOutcome(
        {
          planItemId: overdueItem.id,
          problemHistoryId: review.problemHistory.id,
          reviewAttemptId: review.reviewAttempt.id,
          selfRating: "easy",
        },
        { db: db.prisma, now: today },
      );

      const todayData = await getTodayPlannerData({ db: db.prisma, now: today });

      expect(todayData.hasGoal).toBe(true);
      if (!todayData.hasGoal) return;
      expect(
        todayData.dose.find((item) => item.planItemId === overdueItem.id),
      ).toMatchObject({
        status: "completed",
        title: overdueItem.problem.title,
      });
    } finally {
      await db.cleanup();
    }
  });

  it("freezes today's pending dose after weakness memory changes", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      const initialPlanItemIds = initialToday.dose.map((item) => item.planItemId);
      const initialProblemIds = new Set(
        initialToday.dose.map((item) => item.problemId),
      );
      const planItems = await db.prisma.plannerPlanItem.findMany({
        where: { goalId: goal.id },
        include: { problem: true },
        orderBy: { sortOrder: "asc" },
      });
      const initialPatternTags = new Set(
        planItems
          .filter((item) => initialProblemIds.has(item.problemId))
          .flatMap((item) => plannerPatternTags(parseTestTags(item.problem.tags))),
      );
      const futureWeakness = planItems
        .filter((item) => !initialProblemIds.has(item.problemId))
        .map((item) => ({
          item,
          tags: plannerPatternTags(parseTestTags(item.problem.tags)),
        }))
        .find(({ tags }) => tags.some((tag) => !initialPatternTags.has(tag)));

      if (!futureWeakness) {
        throw new Error("Expected a future plan item with a distinct pattern.");
      }

      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      await db.prisma.l2MemoryFact.create({
        data: {
          userId: user.id,
          problemId: futureWeakness.item.problemId,
          factType: "weakness",
          tag:
            futureWeakness.tags.find((tag) => !initialPatternTags.has(tag)) ??
            futureWeakness.tags[0],
          value: "newly observed weakness should wait for a future dose",
          confidence: 0.95,
          evidenceCount: 2,
        },
      });
      const completedItem = planItems.find(
        (item) => item.id === initialPlanItemIds[0],
      );
      if (!completedItem) {
        throw new Error("Expected the first dose item to have a plan item.");
      }
      const review = await createReviewFixture(db.prisma, {
        problemId: completedItem.problemId,
        runStatus: "passed_visible_tests",
        tags: plannerPatternTags(parseTestTags(completedItem.problem.tags)),
      });

      await recordPlannerOutcome(
        {
          planItemId: completedItem.id,
          problemHistoryId: review.problemHistory.id,
          reviewAttemptId: review.reviewAttempt.id,
          selfRating: "easy",
        },
        { db: db.prisma, now },
      );

      const afterReview = await getTodayPlannerData({ db: db.prisma, now });
      const snapshotCount = await db.prisma.plannerDailyDoseItem.count({
        where: { goalId: goal.id },
      });

      expect(afterReview.hasGoal).toBe(true);
      if (!afterReview.hasGoal) return;
      expect(afterReview.dose.map((item) => item.planItemId)).toEqual(
        initialPlanItemIds,
      );
      expect(
        afterReview.dose.find((item) => item.planItemId === completedItem.id),
      ).toMatchObject({ status: "completed" });
      expect(snapshotCount).toBe(initialToday.dose.length);
    } finally {
      await db.cleanup();
    }
  });

  it("marks a started Today item as in progress without changing the dose identity", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      const initialPlanItemIds = initialToday.dose.map((item) => item.planItemId);
      const targetItem = initialToday.dose[1];
      if (!targetItem?.planItemId) {
        throw new Error("Expected a plan-backed dose item.");
      }

      await startPlannerPlanItem(
        { planItemId: targetItem.planItemId },
        { db: db.prisma, now },
      );
      await startPlannerPlanItem(
        { planItemId: targetItem.planItemId },
        { db: db.prisma, now: new Date("2026-06-17T13:00:00Z") },
      );
      const afterStart = await getTodayPlannerData({ db: db.prisma, now });
      const storedItem = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: targetItem.planItemId },
      });

      expect(afterStart.hasGoal).toBe(true);
      if (!afterStart.hasGoal) return;
      expect(afterStart.dose.map((item) => item.planItemId)).toEqual(
        initialPlanItemIds,
      );
      expect(
        afterStart.dose.find((item) => item.planItemId === targetItem.planItemId),
      ).toMatchObject({ status: "in_progress" });
      expect(storedItem.startedAt?.toISOString()).toBe("2026-06-17T12:00:00.000Z");
      expect(storedItem.lastOpenedAt?.toISOString()).toBe("2026-06-17T13:00:00.000Z");
    } finally {
      await db.cleanup();
    }
  });

  it("skips a Today item by removing its snapshot slot and filling from the backlog", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      const skippedItem = initialToday.dose[0];
      if (!skippedItem?.planItemId) {
        throw new Error("Expected a plan-backed dose item.");
      }
      const initialPlanItemIds = initialToday.dose.map((item) => item.planItemId);

      const afterSkip = await skipPlannerDoseItem(
        { planItemId: skippedItem.planItemId },
        { db: db.prisma, now },
      );
      const laterToday = await getTodayPlannerData({ db: db.prisma, now });
      const skippedPlanItem = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: skippedItem.planItemId },
      });
      const skippedSnapshot = await db.prisma.plannerDailyDoseItem.findFirst({
        where: {
          goalId: goal.id,
          doseDate: startOfPlannerDay(now),
          planItemId: skippedItem.planItemId,
        },
      });

      expect(afterSkip.hasGoal).toBe(true);
      if (!afterSkip.hasGoal) return;
      expect(afterSkip.dose).toHaveLength(goal.dailyDoseTarget);
      expect(afterSkip.dose.map((item) => item.planItemId)).not.toContain(
        skippedItem.planItemId,
      );
      expect(afterSkip.dose.some((item) => !initialPlanItemIds.includes(item.planItemId)))
        .toBe(true);
      expect(laterToday.hasGoal).toBe(true);
      if (!laterToday.hasGoal) return;
      expect(laterToday.dose.map((item) => item.planItemId)).toEqual(
        afterSkip.dose.map((item) => item.planItemId),
      );
      expect(skippedSnapshot).toBeNull();
      expect(skippedPlanItem.status).toBe("pending");
      expect(skippedPlanItem.deferredFromDate?.toISOString()).toBe(
        startOfPlannerDay(now).toISOString(),
      );
      expect(JSON.parse(skippedPlanItem.whyJson)[0]).toMatchObject({
        label: "Deferred",
      });
      await expect(db.prisma.plannerOutcome.count()).resolves.toBe(0);
      await expect(db.prisma.plannerProposal.count()).resolves.toBe(0);
    } finally {
      await db.cleanup();
    }
  });

  it("keeps a skipped started item out of Continue even when a draft exists", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const dayTwo = new Date("2026-06-18T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      const firstDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      expect(firstDay.hasGoal).toBe(true);
      if (!firstDay.hasGoal) return;
      const skippedItem = firstDay.dose[0];
      if (!skippedItem?.planItemId) {
        throw new Error("Expected a plan-backed dose item.");
      }
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });

      await startPlannerPlanItem(
        { planItemId: skippedItem.planItemId },
        { db: db.prisma, now: dayOne },
      );
      await db.prisma.codeDraft.create({
        data: {
          userId: user.id,
          problemId: skippedItem.problemId,
          language: "Python",
          content: "class Solution: pass",
          createdAt: dayOne,
          updatedAt: dayOne,
        },
      });

      await skipPlannerDoseItem(
        { planItemId: skippedItem.planItemId },
        { db: db.prisma, now: dayOne },
      );
      const sameDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      const secondDay = await getTodayPlannerData({ db: db.prisma, now: dayTwo });
      const storedItem = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: skippedItem.planItemId },
      });

      expect(sameDay.hasGoal).toBe(true);
      if (!sameDay.hasGoal) return;
      expect(sameDay.dose.map((item) => item.planItemId)).not.toContain(
        skippedItem.planItemId,
      );
      expect(secondDay.hasGoal).toBe(true);
      if (!secondDay.hasGoal) return;
      expect(secondDay.dose.map((item) => item.planItemId)).not.toContain(
        skippedItem.planItemId,
      );
      expect(
        secondDay.dose.find((item) => item.planItemId === skippedItem.planItemId),
      ).toBeUndefined();
      expect(storedItem.startedAt).toBeNull();
      expect(storedItem.lastOpenedAt).toBeNull();
      expect(storedItem.status).toBe("pending");
      expect(goal.dailyDoseTarget).toBe(5);
    } finally {
      await db.cleanup();
    }
  });

  it("rejects starting a closed planner item", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now },
      );
      const completed = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: { goalId: goal.id },
      });
      await db.prisma.plannerPlanItem.update({
        where: { id: completed.id },
        data: { status: "completed", completedAt: now },
      });

      await expect(
        startPlannerPlanItem(
          { planItemId: completed.id },
          { db: db.prisma, now },
        ),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await db.cleanup();
    }
  });

  it("rejects skipping a closed planner item", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now },
      );
      const completed = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: { goalId: goal.id },
      });
      await db.prisma.plannerPlanItem.update({
        where: { id: completed.id },
        data: { status: "completed", completedAt: now },
      });

      await expect(
        skipPlannerDoseItem(
          { planItemId: completed.id },
          { db: db.prisma, now },
        ),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await db.cleanup();
    }
  });

  it("self-heals a short Today snapshot by filling back to the daily target", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 40,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      expect(initialToday.dose).toHaveLength(goal.dailyDoseTarget);

      await db.prisma.plannerDailyDoseItem.deleteMany({
        where: {
          goalId: goal.id,
          problemId: initialToday.dose[0]?.problemId,
        },
      });
      const afterRepair = await getTodayPlannerData({ db: db.prisma, now });
      const snapshotCount = await db.prisma.plannerDailyDoseItem.count({
        where: { goalId: goal.id },
      });

      expect(afterRepair.hasGoal).toBe(true);
      if (!afterRepair.hasGoal) return;
      expect(afterRepair.dose).toHaveLength(goal.dailyDoseTarget);
      expect(snapshotCount).toBe(goal.dailyDoseTarget);
    } finally {
      await db.cleanup();
    }
  });

  it("carries unfinished Today items into the next planner day under the daily cap", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const dayTwo = new Date("2026-06-18T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      const firstDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      expect(firstDay.hasGoal).toBe(true);
      if (!firstDay.hasGoal) return;
      const startedItem = firstDay.dose[0];
      if (!startedItem?.planItemId) {
        throw new Error("Expected a plan-backed dose item.");
      }
      await startPlannerPlanItem(
        { planItemId: startedItem.planItemId },
        { db: db.prisma, now: dayOne },
      );

      const secondDay = await getTodayPlannerData({ db: db.prisma, now: dayTwo });

      expect(secondDay.hasGoal).toBe(true);
      if (!secondDay.hasGoal) return;
      expect(secondDay.dose).toHaveLength(goal.dailyDoseTarget);
      expect(secondDay.dose[0]).toMatchObject({
        planItemId: startedItem.planItemId,
        status: "in_progress",
      });
      expect(
        secondDay.dose.every((item) => firstDay.dose.some((old) => old.planItemId === item.planItemId)),
      ).toBe(true);
    } finally {
      await db.cleanup();
    }
  });

  it("does not stack several missed planned days into one Today dose", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const daySix = new Date("2026-06-22T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      const firstDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      expect(firstDay.hasGoal).toBe(true);
      if (!firstDay.hasGoal) return;

      const laterToday = await getTodayPlannerData({
        db: db.prisma,
        now: daySix,
      });

      expect(laterToday.hasGoal).toBe(true);
      if (!laterToday.hasGoal) return;
      expect(laterToday.dose).toHaveLength(goal.dailyDoseTarget);
      expect(laterToday.dose.map((item) => item.planItemId)).toEqual(
        firstDay.dose.map((item) => item.planItemId),
      );
    } finally {
      await db.cleanup();
    }
  });

  it("fills only the completed carryover slots with new plan items", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const dayTwo = new Date("2026-06-18T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      const firstDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      expect(firstDay.hasGoal).toBe(true);
      if (!firstDay.hasGoal) return;
      const completedItem = firstDay.dose[0];
      if (!completedItem?.planItemId) {
        throw new Error("Expected a plan-backed dose item.");
      }
      const review = await createReviewFixture(db.prisma, {
        problemId: completedItem.problemId,
        runStatus: "passed_visible_tests",
        tags: ["array"],
      });

      await recordPlannerOutcome(
        {
          planItemId: completedItem.planItemId,
          problemHistoryId: review.problemHistory.id,
          reviewAttemptId: review.reviewAttempt.id,
          selfRating: "easy",
        },
        { db: db.prisma, now: dayOne },
      );

      const secondDay = await getTodayPlannerData({ db: db.prisma, now: dayTwo });

      expect(secondDay.hasGoal).toBe(true);
      if (!secondDay.hasGoal) return;
      const firstDayPlanItemIds = new Set(
        firstDay.dose.map((item) => item.planItemId),
      );
      const secondDayPlanItemIds = secondDay.dose.map((item) => item.planItemId);
      expect(secondDay.dose).toHaveLength(goal.dailyDoseTarget);
      expect(secondDayPlanItemIds).not.toContain(completedItem.planItemId);
      expect(
        firstDay.dose
          .slice(1)
          .every((item) => secondDayPlanItemIds.includes(item.planItemId)),
      ).toBe(true);
      expect(
        secondDay.dose.filter(
          (item) => !firstDayPlanItemIds.has(item.planItemId),
        ),
      ).toHaveLength(1);
    } finally {
      await db.cleanup();
    }
  });

  it("pulls the next scheduled batch into Today after the visible dose is complete", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now },
      );
      const initialItems = await db.prisma.plannerPlanItem.findMany({
        where: { goalId: goal.id },
        include: { problem: true },
        orderBy: { sortOrder: "asc" },
        take: goal.dailyDoseTarget,
      });
      const futureCompleted = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: {
          goalId: goal.id,
          status: "pending",
          sortOrder: goal.dailyDoseTarget,
        },
      });
      await db.prisma.plannerPlanItem.update({
        where: { id: futureCompleted.id },
        data: { status: "completed", completedAt: now },
      });

      for (const item of initialItems) {
        const review = await createReviewFixture(db.prisma, {
          problemId: item.problemId,
          runStatus: "passed_visible_tests",
          tags: ["array"],
        });
        await recordPlannerOutcome(
          {
            planItemId: item.id,
            problemHistoryId: review.problemHistory.id,
            reviewAttemptId: review.reviewAttempt.id,
            selfRating: "easy",
          },
          { db: db.prisma, now },
        );
      }

      const completedToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(completedToday.hasGoal).toBe(true);
      if (!completedToday.hasGoal) return;
      expect(completedToday.dose.every((item) => item.status === "completed"))
        .toBe(true);

      const result = await advancePlannerDoseBatch({ db: db.prisma, now });
      const advancedToday = await getTodayPlannerData({ db: db.prisma, now });

      expect(result.advancedCount).toBe(goal.dailyDoseTarget);
      expect(advancedToday.hasGoal).toBe(true);
      if (!advancedToday.hasGoal) return;
      expect(advancedToday.dose).toHaveLength(goal.dailyDoseTarget);
      expect(advancedToday.dose.every((item) => item.status === "pending"))
        .toBe(true);
      expect(
        advancedToday.dose.some((item) =>
          initialItems.some((completed) => completed.id === item.planItemId),
        ),
      ).toBe(false);
      expect(
        advancedToday.dose.some((item) => item.planItemId === futureCompleted.id),
      ).toBe(false);
    } finally {
      await db.cleanup();
    }
  });

  it("treats a completed previous dose with an active new dose as already advanced", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const dayTwo = new Date("2026-06-18T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      const firstDay = await getTodayPlannerData({ db: db.prisma, now: dayOne });
      expect(firstDay.hasGoal).toBe(true);
      if (!firstDay.hasGoal) return;

      for (const item of firstDay.dose) {
        if (!item.planItemId) {
          throw new Error("Expected a plan-backed dose item.");
        }
        const review = await createReviewFixture(db.prisma, {
          problemId: item.problemId,
          runStatus: "passed_visible_tests",
          tags: ["array"],
        });
        await recordPlannerOutcome(
          {
            planItemId: item.planItemId,
            problemHistoryId: review.problemHistory.id,
            reviewAttemptId: review.reviewAttempt.id,
            selfRating: "easy",
          },
          { db: db.prisma, now: dayOne },
        );
      }

      const activeSecondDay = await getTodayPlannerData({
        db: db.prisma,
        now: dayTwo,
      });
      expect(activeSecondDay.hasGoal).toBe(true);
      if (!activeSecondDay.hasGoal) return;
      expect(activeSecondDay.dose).toHaveLength(goal.dailyDoseTarget);
      expect(activeSecondDay.dose.every((item) => item.status !== "completed"))
        .toBe(true);

      await expect(
        advancePlannerDoseBatch({ db: db.prisma, now: dayTwo }),
      ).resolves.toMatchObject({
        advancedCount: goal.dailyDoseTarget,
        toDate: "2026-06-18",
      });
    } finally {
      await db.cleanup();
    }
  });

  it("creates repeated-failure proposals and applies accept/reject decisions", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "泛 FAANG",
          interviewDate: "2026-07-17",
          weeklyHours: 8,
        },
        { db: db.prisma, now },
      );
      const firstProblem = await createProblem(db.prisma, "manual-bs-1");
      const secondProblem = await createProblem(db.prisma, "manual-bs-2");
      const firstReview = await createReviewFixture(db.prisma, {
        problemId: firstProblem.id,
        runStatus: "failed",
        tags: ["binary-search"],
      });
      const secondReview = await createReviewFixture(db.prisma, {
        problemId: secondProblem.id,
        runStatus: "failed",
        tags: ["binary-search"],
      });

      await recordPlannerOutcome(
        {
          problemHistoryId: firstReview.problemHistory.id,
          reviewAttemptId: firstReview.reviewAttempt.id,
          selfRating: "struggled",
        },
        { db: db.prisma, now },
      );
      await recordPlannerOutcome(
        {
          problemHistoryId: secondReview.problemHistory.id,
          reviewAttemptId: secondReview.reviewAttempt.id,
          selfRating: "unsolved",
        },
        { db: db.prisma, now: new Date("2026-06-18T12:00:00Z") },
      );

      const proposal = await db.prisma.plannerProposal.findFirstOrThrow({
        where: { goalId: goal.id, status: "pending" },
      });
      expect(proposal.type).toBe("repeated_failure");
      expect(proposal.patternTag).toBe("binary_search");

      await applyPlannerProposal(proposal.id, "reject", { db: db.prisma, now });
      await expect(
        db.prisma.plannerProposal.findFirstOrThrow({
          where: { id: proposal.id },
        }),
      ).resolves.toMatchObject({ status: "rejected" });

      const accepted = await db.prisma.plannerProposal.create({
        data: {
          userId: firstReview.user.id,
          goalId: goal.id,
          type: "repeated_failure",
          patternTag: "binary_search",
          reason: "Binary search struggled twice.",
          targetProblemSlug: "search-a-2d-matrix",
          targetProblemTitle: "Search a 2D Matrix",
          targetLeetcodeNumber: 74,
        },
      });
      await applyPlannerProposal(accepted.id, "accept", { db: db.prisma, now });

      const replanItem = await db.prisma.plannerPlanItem.findFirst({
        where: {
          goalId: goal.id,
          source: "replan",
          problem: { slug: "search-a-2d-matrix" },
        },
      });
      expect(replanItem).toBeTruthy();
    } finally {
      await db.cleanup();
    }
  });

  it("accepts a replan proposal by replacing a visible unstarted plan item today", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const today = startOfPlannerDay(now);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      const replaced = [...initialToday.dose]
        .reverse()
        .find((item) => item.source === "plan" && item.planItemId);
      if (!replaced?.planItemId) {
        throw new Error("Expected a visible plan-backed dose item.");
      }
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const proposal = await createPlannerProposal(db.prisma, {
        userId: user.id,
        goalId: goal.id,
        targetProblemSlug: "search-a-2d-matrix",
        targetProblemTitle: "Search a 2D Matrix",
        targetLeetcodeNumber: 74,
      });

      await applyPlannerProposal(proposal.id, "accept", {
        db: db.prisma,
        now,
      });
      const afterAccept = await getTodayPlannerData({ db: db.prisma, now });
      const displaced = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: replaced.planItemId },
      });

      expect(afterAccept.hasGoal).toBe(true);
      if (!afterAccept.hasGoal) return;
      expect(afterAccept.dose.map((item) => item.slug)).toContain(
        "search-a-2d-matrix",
      );
      expect(
        afterAccept.dose.find((item) => item.slug === "search-a-2d-matrix"),
      ).toMatchObject({ source: "replan" });
      expect(afterAccept.dose.map((item) => item.planItemId)).not.toContain(
        replaced.planItemId,
      );
      expect(displaced.deferredFromDate?.toISOString()).toBe(today.toISOString());
      expect(JSON.parse(displaced.whyJson)[0]).toMatchObject({
        label: "Deferred",
      });
      await expect(
        db.prisma.plannerProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        }),
      ).resolves.toMatchObject({ status: "accepted" });
    } finally {
      await db.cleanup();
    }
  });

  it("protects weakness, replan, started, and completed Today slots when accepting replan", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const today = startOfPlannerDay(now);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      const initialToday = await getTodayPlannerData({ db: db.prisma, now });
      expect(initialToday.hasGoal).toBe(true);
      if (!initialToday.hasGoal) return;
      const [eligible, weakness, replan, started, completed] = initialToday.dose;
      if (
        !eligible?.planItemId ||
        !weakness?.planItemId ||
        !replan?.planItemId ||
        !started?.planItemId ||
        !completed?.planItemId
      ) {
        throw new Error("Expected five plan-backed dose items.");
      }
      await db.prisma.plannerDailyDoseItem.updateMany({
        where: { goalId: goal.id, doseDate: today, planItemId: weakness.planItemId },
        data: { source: "weakness" },
      });
      await db.prisma.plannerDailyDoseItem.updateMany({
        where: { goalId: goal.id, doseDate: today, planItemId: replan.planItemId },
        data: { source: "replan" },
      });
      await db.prisma.plannerPlanItem.update({
        where: { id: started.planItemId },
        data: { startedAt: now, lastOpenedAt: now },
      });
      await db.prisma.plannerPlanItem.update({
        where: { id: completed.planItemId },
        data: { status: "completed", completedAt: now },
      });
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const proposal = await createPlannerProposal(db.prisma, {
        userId: user.id,
        goalId: goal.id,
        targetProblemSlug: "search-a-2d-matrix",
        targetProblemTitle: "Search a 2D Matrix",
        targetLeetcodeNumber: 74,
      });

      await applyPlannerProposal(proposal.id, "accept", {
        db: db.prisma,
        now,
      });
      const afterAccept = await getTodayPlannerData({ db: db.prisma, now });

      expect(afterAccept.hasGoal).toBe(true);
      if (!afterAccept.hasGoal) return;
      expect(afterAccept.dose.map((item) => item.planItemId)).not.toContain(
        eligible.planItemId,
      );
      expect(afterAccept.dose.map((item) => item.planItemId)).toEqual(
        expect.arrayContaining([
          weakness.planItemId,
          replan.planItemId,
          started.planItemId,
          completed.planItemId,
        ]),
      );
    } finally {
      await db.cleanup();
    }
  });

  it("allows replan to replace carryover-only Today slots while protecting weakness carryovers", async () => {
    const db = await createMemoryTestDb();
    try {
      const dayOne = new Date("2026-06-17T12:00:00Z");
      const dayTwo = new Date("2026-06-18T12:00:00Z");
      const today = startOfPlannerDay(dayTwo);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now: dayOne },
      );
      await getTodayPlannerData({ db: db.prisma, now: dayOne });
      const carryoverDay = await getTodayPlannerData({
        db: db.prisma,
        now: dayTwo,
      });
      expect(carryoverDay.hasGoal).toBe(true);
      if (!carryoverDay.hasGoal) return;
      const carryoverOnly = carryoverDay.dose[3];
      const weaknessCarryover = carryoverDay.dose[4];
      if (!carryoverOnly?.planItemId || !weaknessCarryover?.planItemId) {
        throw new Error("Expected plan-backed carryover dose items.");
      }
      const carryoverWhy = [
        {
          source: "plan",
          label: "Carryover",
          detail: "Unfinished from an earlier Today dose.",
        },
      ] satisfies PlannerWhy[];
      const weaknessWhy = [
        ...carryoverWhy,
        {
          source: "weakness",
          label: "Weakness",
          detail: "Matches active weakness signal: heap.",
        },
      ] satisfies PlannerWhy[];

      await db.prisma.plannerDailyDoseItem.updateMany({
        where: {
          goalId: goal.id,
          doseDate: today,
          planItemId: carryoverOnly.planItemId,
        },
        data: {
          source: "weakness",
          whyJson: json(carryoverWhy),
        },
      });
      await db.prisma.plannerDailyDoseItem.updateMany({
        where: {
          goalId: goal.id,
          doseDate: today,
          planItemId: weaknessCarryover.planItemId,
        },
        data: {
          source: "weakness",
          whyJson: json(weaknessWhy),
        },
      });
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const proposal = await createPlannerProposal(db.prisma, {
        userId: user.id,
        goalId: goal.id,
        targetProblemSlug: "search-a-2d-matrix",
        targetProblemTitle: "Search a 2D Matrix",
        targetLeetcodeNumber: 74,
      });

      await applyPlannerProposal(proposal.id, "accept", {
        db: db.prisma,
        now: dayTwo,
      });
      const afterAccept = await getTodayPlannerData({
        db: db.prisma,
        now: dayTwo,
      });
      const displaced = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: carryoverOnly.planItemId },
      });
      const protectedItem = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: weaknessCarryover.planItemId },
      });

      expect(afterAccept.hasGoal).toBe(true);
      if (!afterAccept.hasGoal) return;
      expect(afterAccept.dose.map((item) => item.slug)).toContain(
        "search-a-2d-matrix",
      );
      expect(afterAccept.dose.map((item) => item.planItemId)).not.toContain(
        carryoverOnly.planItemId,
      );
      expect(afterAccept.dose.map((item) => item.planItemId)).toContain(
        weaknessCarryover.planItemId,
      );
      expect(displaced.deferredFromDate?.toISOString()).toBe(today.toISOString());
      expect(protectedItem.deferredFromDate).toBeNull();
    } finally {
      await db.cleanup();
    }
  });

  it("falls back to replacing an unstarted plan item scheduled tomorrow", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const today = startOfPlannerDay(now);
      const tomorrow = addPlannerDays(today, 1);
      const dayAfterTomorrow = addPlannerDays(today, 2);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      await getTodayPlannerData({ db: db.prisma, now });
      await db.prisma.plannerDailyDoseItem.updateMany({
        where: { goalId: goal.id, doseDate: today },
        data: { source: "weakness" },
      });
      const tomorrowItem = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: {
          goalId: goal.id,
          source: "plan",
          status: "pending",
          startedAt: null,
          scheduledDate: { gte: tomorrow, lt: dayAfterTomorrow },
        },
        orderBy: { sortOrder: "desc" },
      });
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const proposal = await createPlannerProposal(db.prisma, {
        userId: user.id,
        goalId: goal.id,
        targetProblemSlug: "search-a-2d-matrix",
        targetProblemTitle: "Search a 2D Matrix",
        targetLeetcodeNumber: 74,
      });

      await applyPlannerProposal(proposal.id, "accept", {
        db: db.prisma,
        now,
      });
      const targetItem = await db.prisma.plannerPlanItem.findFirstOrThrow({
        where: { goalId: goal.id, problem: { slug: "search-a-2d-matrix" } },
      });
      const displaced = await db.prisma.plannerPlanItem.findUniqueOrThrow({
        where: { id: tomorrowItem.id },
      });

      expect(targetItem).toMatchObject({
        source: "replan",
        status: "pending",
      });
      expect(targetItem.scheduledDate?.toISOString()).toBe(tomorrow.toISOString());
      expect(displaced.scheduledDate?.getTime()).toBeGreaterThan(
        dayAfterTomorrow.getTime(),
      );
      expect(displaced.deferredFromDate?.toISOString()).toBe(today.toISOString());
    } finally {
      await db.cleanup();
    }
  });

  it("keeps the proposal pending when no today or tomorrow plan slot can be replaced", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const today = startOfPlannerDay(now);
      const tomorrow = addPlannerDays(today, 1);
      const dayAfterTomorrow = addPlannerDays(today, 2);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-07-17",
          weeklyHours: 28,
        },
        { db: db.prisma, now },
      );
      await getTodayPlannerData({ db: db.prisma, now });
      await db.prisma.plannerDailyDoseItem.updateMany({
        where: { goalId: goal.id, doseDate: today },
        data: { source: "weakness" },
      });
      await db.prisma.plannerPlanItem.updateMany({
        where: {
          goalId: goal.id,
          source: "plan",
          status: "pending",
          scheduledDate: { gte: tomorrow, lt: dayAfterTomorrow },
        },
        data: { startedAt: now, lastOpenedAt: now },
      });
      const user = await db.prisma.user.findUniqueOrThrow({
        where: { handle: "try" },
      });
      const proposal = await createPlannerProposal(db.prisma, {
        userId: user.id,
        goalId: goal.id,
        targetProblemSlug: "search-a-2d-matrix",
        targetProblemTitle: "Search a 2D Matrix",
        targetLeetcodeNumber: 74,
      });

      await expect(
        applyPlannerProposal(proposal.id, "accept", {
          db: db.prisma,
          now,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        db.prisma.plannerProposal.findUniqueOrThrow({
          where: { id: proposal.id },
        }),
      ).resolves.toMatchObject({ status: "pending" });
      await expect(
        db.prisma.plannerPlanItem.findFirstOrThrow({
          where: { goalId: goal.id, problem: { slug: "search-a-2d-matrix" } },
        }),
      ).resolves.toMatchObject({ source: "plan" });
    } finally {
      await db.cleanup();
    }
  });

  it("excludes matching replan candidates for three days and allows day-four candidates", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-17T12:00:00Z");
      const today = startOfPlannerDay(now);
      const goal = await createOrUpdatePlannerGoal(
        {
          targetLabel: "Meta",
          interviewDate: "2026-09-17",
          weeklyHours: 80,
        },
        { db: db.prisma, now },
      );
      await db.prisma.plannerPlanItem.update({
        where: {
          goalId_problemId: {
            goalId: goal.id,
            problemId: (
              await db.prisma.problem.findUniqueOrThrow({
                where: { slug: "search-insert-position" },
              })
            ).id,
          },
        },
        data: { scheduledDate: addPlannerDays(today, 3) },
      });
      await db.prisma.plannerPlanItem.update({
        where: {
          goalId_problemId: {
            goalId: goal.id,
            problemId: (
              await db.prisma.problem.findUniqueOrThrow({
                where: { slug: "search-a-2d-matrix" },
              })
            ).id,
          },
        },
        data: { scheduledDate: addPlannerDays(today, 4) },
      });
      const firstProblem = await createProblem(db.prisma, "manual-bs-1");
      const secondProblem = await createProblem(db.prisma, "manual-bs-2");
      const firstReview = await createReviewFixture(db.prisma, {
        problemId: firstProblem.id,
        runStatus: "failed",
        tags: ["binary-search"],
      });
      const secondReview = await createReviewFixture(db.prisma, {
        problemId: secondProblem.id,
        runStatus: "failed",
        tags: ["binary-search"],
      });

      await recordPlannerOutcome(
        {
          problemHistoryId: firstReview.problemHistory.id,
          reviewAttemptId: firstReview.reviewAttempt.id,
          selfRating: "struggled",
        },
        { db: db.prisma, now },
      );
      await recordPlannerOutcome(
        {
          problemHistoryId: secondReview.problemHistory.id,
          reviewAttemptId: secondReview.reviewAttempt.id,
          selfRating: "unsolved",
        },
        { db: db.prisma, now },
      );

      await expect(
        db.prisma.plannerProposal.findFirstOrThrow({
          where: { goalId: goal.id, status: "pending" },
        }),
      ).resolves.toMatchObject({
        targetProblemSlug: "search-a-2d-matrix",
      });
    } finally {
      await db.cleanup();
    }
  });
});

describe("today review focus", () => {
  it("exposes a review focus board instead of a flat review-due list", async () => {
    const db = await createMemoryTestDb();
    try {
      const now = new Date("2026-06-26T18:00:00Z");
      const goal = await createOrUpdatePlannerGoal(
        { targetLabel: "FAANG", interviewDate: "2026-08-01", weeklyHours: 8 },
        { db: db.prisma, now },
      );
      const user = await db.prisma.user.findFirstOrThrow();
      const problem = await db.prisma.problem.findFirstOrThrow();
      await db.prisma.l2MemoryFact.create({
        data: {
          userId: user.id,
          factType: "mistake",
          tag: "sliding_window",
          label: "滑动窗口收缩条件错误",
          confidence: 0.9,
          evidenceCount: 5,
          status: "active",
          lastSeenAt: new Date("2026-06-25T12:00:00Z"),
        },
      });
      await createReviewFixture(db.prisma, {
        problemId: problem.id,
        runStatus: "failed",
        tags: ["sliding_window"],
      });
      await createReviewFixture(db.prisma, {
        problemId: problem.id,
        runStatus: "passed_visible_tests",
        tags: [],
      });
      await db.prisma.reviewSchedule.create({
        data: {
          userId: user.id,
          goalId: goal.id,
          problemId: problem.id,
          patternTag: "sliding_window",
          dueDate: new Date("2026-06-26T00:00:00Z"),
          intervalDays: 2,
          repetitions: 1,
          lastRating: "struggled",
        },
      });

      const data = await getTodayPlannerData({ db: db.prisma, now });
      if (!data.hasGoal) {
        throw new Error("expected an active goal");
      }
      expect(data.reviewFocus.cards.length).toBeGreaterThanOrEqual(1);
      expect(data).not.toHaveProperty("reviewDue");
    } finally {
      await db.cleanup();
    }
  });
});

function parseTestTags(value: string) {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function createProblem(prisma: PrismaClient, slug: string) {
  return prisma.problem.create({
    data: {
      slug,
      title: slug,
      statementMarkdown: "Manual test problem",
      methodName: "solve",
      tags: json(["binary-search"]),
    },
  });
}

async function createPlannerProposal(
  prisma: PrismaClient,
  args: {
    userId: string;
    goalId: string;
    patternTag?: string;
    targetProblemSlug: string;
    targetProblemTitle: string;
    targetLeetcodeNumber: number;
  },
) {
  return prisma.plannerProposal.create({
    data: {
      userId: args.userId,
      goalId: args.goalId,
      type: "repeated_failure",
      patternTag: args.patternTag ?? "binary_search",
      reason: "Repeated struggle should create a visible re-plan change.",
      targetProblemSlug: args.targetProblemSlug,
      targetProblemTitle: args.targetProblemTitle,
      targetLeetcodeNumber: args.targetLeetcodeNumber,
    },
  });
}

async function createReviewFixture(
  prisma: PrismaClient,
  args: {
    failureProvenance?: FailureProvenance;
    problemId: string;
    providerUsed?: string;
    runStatus: CodeRunStatus;
    tags: string[];
  },
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { handle: "try" },
  });
  const problem = await prisma.problem.findUniqueOrThrow({
    where: { id: args.problemId },
  });
  const chatSession = await prisma.chatSession.upsert({
    where: {
      userId_problemId_memoryOrigin: {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
      },
    },
    update: {},
    create: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      language: "Python",
      codeSnapshot: "class Solution: pass",
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  await prisma.diagnosisResult.create({
    data: {
      reviewAttemptId: reviewAttempt.id,
      diagnosisJson: json({
        mistakeTags: args.tags,
        skillTags: args.tags,
      }),
      mistakeTags: json(args.tags),
      skillTags: json(args.tags),
      userIssueSummary: "Needs more practice.",
      coachSummary: "Practice the pattern.",
    },
  });
  const passedCount = args.runStatus === "passed_visible_tests" ? 1 : 0;
  const failedCount = args.runStatus === "passed_visible_tests" ? 0 : 1;
  await prisma.runEvidence.create({
    data: {
      reviewAttemptId: reviewAttempt.id,
      source: "review",
      status: args.runStatus,
      passedCount,
      failedCount,
      stdout: "",
      stderr: "",
      rawResultJson: json({
        status: args.runStatus,
        failureProvenance: args.failureProvenance ?? "user_code",
        passedCount,
        failedCount,
        stdout: "",
        stderr: "",
        testResults: [],
        rawResult: { providerUsed: args.providerUsed ?? "mock" },
      }),
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  const problemHistory = await prisma.problemHistory.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      reviewAttemptId: reviewAttempt.id,
      chatSessionId: chatSession.id,
      language: "Python",
      problemTags: json(args.tags),
      runStatus: args.runStatus,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });

  return { user, problem, chatSession, reviewAttempt, problemHistory };
}

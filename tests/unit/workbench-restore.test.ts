import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { irisHandle } from "@/features/onboarding/profile-defaults";
import { resolveLastWorkbenchContext } from "@/features/workbench/workbench-restore";
import { createMemoryTestDb } from "./memory-test-helpers";

async function createProblem(
  prisma: PrismaClient,
  input: { leetcodeNumber: number; slug: string; title: string },
) {
  return prisma.problem.create({
    data: {
      leetcodeNumber: input.leetcodeNumber,
      methodName: "solve",
      slug: input.slug,
      statementMarkdown: input.title,
      title: input.title,
    },
  });
}

async function createActiveGoal(prisma: PrismaClient, userId: string) {
  return prisma.readinessGoal.create({
    data: {
      interviewDate: new Date("2026-09-01T00:00:00.000Z"),
      targetLabel: "FAANG",
      userId,
      weeklyHours: 8,
    },
  });
}

describe("resolveLastWorkbenchContext", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("chooses the most recent active workbench signal", async () => {
    const db = await createMemoryTestDb();

    try {
      const user = await db.prisma.user.create({
        data: { handle: irisHandle },
      });
      const draftProblem = await createProblem(db.prisma, {
        leetcodeNumber: 1,
        slug: "two-sum",
        title: "Two Sum",
      });
      const chatProblem = await createProblem(db.prisma, {
        leetcodeNumber: 3,
        slug: "longest-substring-without-repeating-characters",
        title: "Longest Substring Without Repeating Characters",
      });
      const plannerProblem = await createProblem(db.prisma, {
        leetcodeNumber: 35,
        slug: "search-insert-position",
        title: "Search Insert Position",
      });
      const goal = await createActiveGoal(db.prisma, user.id);
      const planItem = await db.prisma.plannerPlanItem.create({
        data: {
          goalId: goal.id,
          lastOpenedAt: new Date("2026-07-09T12:00:00.000Z"),
          problemId: plannerProblem.id,
          scheduledDate: new Date("2026-07-09T00:00:00.000Z"),
          sortOrder: 1,
          startedAt: new Date("2026-07-09T11:30:00.000Z"),
          userId: user.id,
        },
      });

      await db.prisma.codeDraft.create({
        data: {
          content: "draft",
          language: "Python",
          problemId: draftProblem.id,
          selectedTestCaseIds: "[]",
          updatedAt: new Date("2026-07-09T10:00:00.000Z"),
          userId: user.id,
        },
      });
      await db.prisma.chatSession.create({
        data: {
          isActive: true,
          problemId: chatProblem.id,
          title: chatProblem.title,
          updatedAt: new Date("2026-07-09T11:00:00.000Z"),
          userId: user.id,
        },
      });

      await expect(resolveLastWorkbenchContext({ db: db.prisma })).resolves.toMatchObject({
        href: `/workbench?problem=search-insert-position&language=Python&planItemId=${planItem.id}`,
        language: "Python",
        planItemId: planItem.id,
        problemSlug: "search-insert-position",
      });
    } finally {
      await db.cleanup();
    }
  });

  it("adds an active started plan item when the latest signal is a draft", async () => {
    const db = await createMemoryTestDb();

    try {
      const user = await db.prisma.user.create({
        data: { handle: irisHandle },
      });
      const problem = await createProblem(db.prisma, {
        leetcodeNumber: 399,
        slug: "evaluate-division",
        title: "Evaluate Division",
      });
      const goal = await createActiveGoal(db.prisma, user.id);
      const planItem = await db.prisma.plannerPlanItem.create({
        data: {
          goalId: goal.id,
          lastOpenedAt: new Date("2026-07-09T09:00:00.000Z"),
          problemId: problem.id,
          scheduledDate: new Date("2026-07-09T00:00:00.000Z"),
          sortOrder: 1,
          startedAt: new Date("2026-07-09T09:00:00.000Z"),
          userId: user.id,
        },
      });

      await db.prisma.codeDraft.create({
        data: {
          content: "class Solution {}",
          language: "C++",
          problemId: problem.id,
          selectedTestCaseIds: "[]",
          updatedAt: new Date("2026-07-09T12:00:00.000Z"),
          userId: user.id,
        },
      });

      await expect(resolveLastWorkbenchContext({ db: db.prisma })).resolves.toMatchObject({
        href: `/workbench?problem=evaluate-division&language=C%2B%2B&planItemId=${planItem.id}`,
        language: "C++",
        planItemId: planItem.id,
        problemSlug: "evaluate-division",
      });
    } finally {
      await db.cleanup();
    }
  });

  it("restores legacy learner activity without exposing explicit development sessions", async () => {
    const db = await createMemoryTestDb();

    try {
      vi.stubEnv("PATTERNCOACH_MEMORY_ORIGIN", "learner");
      const user = await db.prisma.user.create({ data: { handle: irisHandle } });
      const legacyProblem = await createProblem(db.prisma, {
        leetcodeNumber: 72,
        slug: "edit-distance",
        title: "Edit Distance",
      });
      const developmentProblem = await createProblem(db.prisma, {
        leetcodeNumber: 35,
        slug: "search-insert-position",
        title: "Search Insert Position",
      });
      await db.prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: legacyProblem.id,
          title: legacyProblem.title,
          memoryOrigin: "legacy_unknown",
          updatedAt: new Date("2026-07-09T11:00:00.000Z"),
        },
      });
      await db.prisma.chatSession.create({
        data: {
          userId: user.id,
          problemId: developmentProblem.id,
          title: developmentProblem.title,
          memoryOrigin: "development",
          updatedAt: new Date("2026-07-09T12:00:00.000Z"),
        },
      });

      await expect(resolveLastWorkbenchContext({ db: db.prisma })).resolves.toMatchObject({
        problemSlug: "edit-distance",
      });
    } finally {
      await db.cleanup();
    }
  });
});

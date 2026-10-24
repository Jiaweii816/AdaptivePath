import { describe, expect, it } from "vitest";
import { createMemoryTestDb } from "./memory-test-helpers";
import {
  buildReviewFocusBoard,
  loadReviewProblemLibrary,
} from "@/server/planner/review-focus/build-review-focus-board";
import { loadPlannerReviewFocus } from "@/server/planner/proactive-dashboard-service";

const NOW = new Date("2026-06-26T18:00:00Z");
const json = (value: unknown) => JSON.stringify(value);
const PROCESS_TEST_MEMORY_ORIGIN = "test";

async function seedGoalAndProblem(
  prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"],
  opts: { slug: string; title?: string; tags: string[] },
) {
  const user = await prisma.user.upsert({
    where: { handle: "try" },
    update: {},
    create: { handle: "try" },
  });
  const goal =
    (await prisma.readinessGoal.findFirst({ where: { userId: user.id } })) ??
    (await prisma.readinessGoal.create({
      data: {
        userId: user.id,
        targetLabel: "FAANG",
        interviewDate: new Date("2026-08-01T00:00:00Z"),
        weeklyHours: 8,
      },
    }));
  const problem = await prisma.problem.create({
    data: {
      slug: opts.slug,
      title: opts.title ?? opts.slug,
      difficulty: "Medium",
      tags: json(opts.tags),
      methodName: "solve",
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      title: problem.title,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  return { user, goal, problem, chatSession };
}

async function addReviewHistory(
  prisma: Awaited<ReturnType<typeof createMemoryTestDb>>["prisma"],
  args: Awaited<ReturnType<typeof seedGoalAndProblem>> & {
    runStatus: string;
    mistakeTags: string[];
    userIssueSummary: string | null;
    selfCheck?: { question: string; answer: string } | null;
    createdAt: Date;
    selfRating?: "easy" | "hesitated" | "struggled" | "unsolved";
  },
) {
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId: args.user.id,
      problemId: args.problem.id,
      chatSessionId: args.chatSession.id,
      language: "Python",
      codeSnapshot: "class Solution: pass",
      createdAt: args.createdAt,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  await prisma.runEvidence.create({
    data: {
      reviewAttemptId: reviewAttempt.id,
      source: "review",
      status: args.runStatus,
      passedCount: args.runStatus === "passed_visible_tests" ? 1 : 0,
      failedCount: args.runStatus === "passed_visible_tests" ? 0 : 1,
      createdAt: args.createdAt,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });
  await prisma.diagnosisResult.create({
    data: {
      reviewAttemptId: reviewAttempt.id,
      diagnosisJson: json({
        mistakeTags: args.mistakeTags,
        selfCheck: args.selfCheck ?? null,
      }),
      mistakeTags: json(args.mistakeTags),
      skillTags: json(["sliding-window"]),
      userIssueSummary: args.userIssueSummary,
      coachSummary: "同步更新窗口边界。",
      selfCheckQuestion: args.selfCheck?.question ?? null,
      selfCheckAnswer: args.selfCheck?.answer ?? null,
      createdAt: args.createdAt,
    },
  });
  const history = await prisma.problemHistory.create({
    data: {
      userId: args.user.id,
      problemId: args.problem.id,
      reviewAttemptId: reviewAttempt.id,
      chatSessionId: args.chatSession.id,
      language: "Python",
      problemTags: args.problem.tags,
      runStatus: args.runStatus,
      userIssueSummary: args.userIssueSummary,
      coachSummary: "同步更新窗口边界。",
      createdAt: args.createdAt,
      memoryOrigin: PROCESS_TEST_MEMORY_ORIGIN,
    },
  });

  if (args.selfRating) {
    await prisma.plannerOutcome.create({
      data: {
        userId: args.user.id,
        goalId: args.goal.id,
        problemId: args.problem.id,
        reviewAttemptId: reviewAttempt.id,
        problemHistoryId: history.id,
        selfRating: args.selfRating,
        patternTagsJson: json(["sliding_window"]),
        createdAt: args.createdAt,
      },
    });
  }

  return { reviewAttempt, history };
}

describe("buildReviewFocusBoard", () => {
  it("builds Today focus from resolved review cards, SRS due, planner outcome, and flashcard fields", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await seedGoalAndProblem(db.prisma, {
        slug: "longest-substring",
        title: "Longest Substring",
        tags: ["sliding-window"],
      });
      const planItem = await db.prisma.plannerPlanItem.create({
        data: {
          userId: fixture.user.id,
          goalId: fixture.goal.id,
          problemId: fixture.problem.id,
          sortOrder: 1,
        },
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "failed",
        mistakeTags: ["sliding_window_shrink_condition"],
        userIssueSummary: "滑动窗口收缩时忘记更新 left。",
        selfCheck: {
          question: "重复字符出现时 left 怎么动？",
          answer: "同步删除窗口字符并右移 left，直到窗口无重复。",
        },
        createdAt: new Date("2026-06-25T12:00:00Z"),
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "passed_visible_tests",
        mistakeTags: [],
        userIssueSummary: "当前可见测试通过。",
        selfRating: "hesitated",
        createdAt: new Date("2026-06-26T12:00:00Z"),
      });
      await db.prisma.reviewSchedule.create({
        data: {
          userId: fixture.user.id,
          goalId: fixture.goal.id,
          problemId: fixture.problem.id,
          patternTag: "sliding_window",
          dueDate: new Date("2026-06-26T05:00:00Z"),
          intervalDays: 2,
          repetitions: 1,
          lastRating: "struggled",
        },
      });

      const board = await buildReviewFocusBoard(db.prisma, {
        userId: fixture.user.id,
        goalId: fixture.goal.id,
        now: NOW,
      });

      expect(board.cards).toHaveLength(1);
      expect(board.cards[0]).toMatchObject({
        slug: "longest-substring",
        planItemId: planItem.id,
        lastOutcome: "hesitated",
        trapSummary: "滑动窗口收缩时忘记更新 left。",
        dueDate: "2026-06-26",
        hasFlashcard: true,
      });
      expect(board.cards[0].flashcard?.question).toContain("left");
    } finally {
      await db.cleanup();
    }
  });

  it("keeps Coach review evidence visible without an active legacy readiness goal", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await seedGoalAndProblem(db.prisma, {
        slug: "longest-substring-no-goal",
        title: "Longest Substring",
        tags: ["sliding-window"],
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "failed",
        mistakeTags: ["sliding_window_shrink_condition"],
        userIssueSummary: "The left boundary moved backward.",
        selfCheck: {
          question: "How should left move?",
          answer: "It must never move backward.",
        },
        createdAt: new Date("2026-06-25T12:00:00Z"),
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "passed_visible_tests",
        mistakeTags: [],
        userIssueSummary: "Visible tests pass now.",
        createdAt: new Date("2026-06-26T12:00:00Z"),
      });

      await db.prisma.readinessGoal.delete({ where: { id: fixture.goal.id } });
      const board = await loadPlannerReviewFocus({
        db: db.prisma,
        userId: fixture.user.id,
        now: NOW,
      });

      expect(board.cards).toMatchObject([{
        slug: "longest-substring-no-goal",
        planItemId: null,
        trapSummary: "The left boundary moved backward.",
        dueDate: null,
        hasFlashcard: true,
      }]);
    } finally {
      await db.cleanup();
    }
  });

  it("does not build cards for diagnoses that only contain noise tags", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await seedGoalAndProblem(db.prisma, {
        slug: "search-insert-position",
        tags: ["binary-search"],
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "failed",
        mistakeTags: ["no_search_logic", "hardcoded_return"],
        userIssueSummary: "未实现搜索逻辑，直接返回 0。",
        createdAt: new Date("2026-06-25T12:00:00Z"),
      });

      const library = await loadReviewProblemLibrary(db.prisma, {
        userId: fixture.user.id,
        goalId: fixture.goal.id,
        now: NOW,
      });

      expect(library.cards).toEqual([]);
    } finally {
      await db.cleanup();
    }
  });

  it("returns resolved cards when the latest run passed after an older concrete trap", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await seedGoalAndProblem(db.prisma, {
        slug: "longest-substring",
        title: "Longest Substring",
        tags: ["sliding-window"],
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "failed",
        mistakeTags: ["sliding_window_shrink_condition"],
        userIssueSummary: "while 内忘记移除窗口字符。",
        selfCheck: {
          question: "窗口内出现重复字符时集合怎么更新？",
          answer: "移动 left 时同步从集合里删除旧字符。",
        },
        createdAt: new Date("2026-06-24T12:00:00Z"),
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "passed_visible_tests",
        mistakeTags: [],
        userIssueSummary: "当前可见测试通过。",
        createdAt: new Date("2026-06-26T12:00:00Z"),
      });

      const library = await loadReviewProblemLibrary(db.prisma, {
        userId: fixture.user.id,
        goalId: fixture.goal.id,
        now: NOW,
      });

      expect(library.cards).toEqual([]);
      expect(library.resolvedCards).toHaveLength(1);
      expect(library.resolvedCards[0]).toMatchObject({
        slug: "longest-substring",
        lastOutcome: "passed",
        trapSummary: "while 内忘记移除窗口字符。",
        hasFlashcard: true,
      });
    } finally {
      await db.cleanup();
    }
  });

  it("keeps passed but struggled reviews in the resolved pool for low-cost recall", async () => {
    const db = await createMemoryTestDb();
    try {
      const fixture = await seedGoalAndProblem(db.prisma, {
        slug: "copy-list-with-random-pointer",
        title: "Copy List with Random Pointer",
        tags: ["linked-list"],
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "runtime_error",
        mistakeTags: ["constructor_argument_missing"],
        userIssueSummary: "Node 构造函数调用时缺少必填参数。",
        selfCheck: {
          question: "复制链表节点时构造函数需要传什么？",
          answer: "新节点要带原节点值：`clone = Node(cur.val)`。",
        },
        createdAt: new Date("2026-06-24T12:00:00Z"),
      });
      await addReviewHistory(db.prisma, {
        ...fixture,
        runStatus: "passed_visible_tests",
        mistakeTags: [],
        userIssueSummary: "当前可见测试通过。",
        selfRating: "struggled",
        createdAt: new Date("2026-06-26T12:00:00Z"),
      });

      const library = await loadReviewProblemLibrary(db.prisma, {
        userId: fixture.user.id,
        goalId: fixture.goal.id,
        now: NOW,
      });
      const board = await buildReviewFocusBoard(db.prisma, {
        userId: fixture.user.id,
        goalId: fixture.goal.id,
        now: NOW,
      });

      expect(library.cards).toEqual([]);
      expect(library.resolvedCards[0]).toMatchObject({
        slug: "copy-list-with-random-pointer",
        lastOutcome: "struggled",
      });
      expect(board.cards[0]).toMatchObject({
        slug: "copy-list-with-random-pointer",
        lastOutcome: "struggled",
      });
    } finally {
      await db.cleanup();
    }
  });
});

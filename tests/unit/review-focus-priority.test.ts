import { describe, expect, it } from "vitest";
import {
  buildReviewFocusBoardFromInputs,
  dueScore,
  lastOutcomeFor,
  nonNoiseMistakeTags,
  problemReviewPriority,
  recencyScore,
  reviewProblemCardFromInput,
  sortTodayReviewFocusCards,
  TODAY_REVIEW_CARD_CAP,
} from "@/server/planner/review-focus/priority";
import type {
  ReviewProblemCard,
  ReviewProblemInput,
} from "@/server/planner/review-focus/review-focus.types";

const NOW = new Date("2026-06-26T12:00:00Z");

function problem(overrides: Partial<ReviewProblemInput>): ReviewProblemInput {
  return {
    problemId: "prob-longest",
    slug: "longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "Medium",
    leetcodeNumber: 3,
    planItemId: null,
    latestRunStatus: "failed",
    latestSelfRating: null,
    lastAttemptAt: new Date("2026-06-25T12:00:00Z"),
    dueDate: null,
    problemTags: ["sliding-window"],
    diagnosis: {
      mistakeTags: ["sliding_window_shrink_condition"],
      userIssueSummary:
        "滑动窗口收缩条件错误：while 内忘记更新 left，导致死循环 TLE",
      coachSummary: "需要在窗口收缩时同步移动 left。",
      selfCheckQuestion: "重复字符出现时 left 怎么动？",
      selfCheckAnswer: "同步删除窗口字符并右移 left，直到窗口无重复。",
    },
    recurringWeaknessTags: [],
    ...overrides,
  };
}

function card(overrides: Partial<ReviewProblemCard>): ReviewProblemCard {
  return {
    problemId: overrides.problemId ?? overrides.slug ?? "prob",
    slug: overrides.slug ?? "problem",
    title: overrides.title ?? "Problem",
    difficulty: "Medium",
    leetcodeNumber: null,
    planItemId: null,
    lastOutcome: "passed",
    trapSummary: "旧坑",
    dueDate: null,
    priority: 0,
    primaryPatternTag: null,
    hasFlashcard: true,
    flashcardStatus: "available",
    flashcard: { question: "q", answer: "a" },
    ...overrides,
  };
}

describe("problem-centric review focus scoring", () => {
  it("filters noisy diagnosis tags out of review cards", () => {
    expect(
      nonNoiseMistakeTags([
        "no_search_logic",
        "hardcoded_return",
        "sliding_window_shrink_condition",
      ]),
    ).toEqual(["sliding_window_shrink_condition"]);

    const card = reviewProblemCardFromInput(
      problem({
        diagnosis: {
          mistakeTags: ["no_search_logic", "hardcoded_return"],
          userIssueSummary: "未实现搜索逻辑，直接返回 0",
          coachSummary: "需要先实现二分搜索主体。",
          selfCheckQuestion: null,
          selfCheckAnswer: null,
        },
      }),
      NOW,
    );

    expect(card).toBeNull();
  });

  it("maps planner self-rating before passed run status for last outcome", () => {
    expect(
      lastOutcomeFor({
        latestSelfRating: "unsolved",
        latestRunStatus: "passed_visible_tests",
      }),
    ).toBe("unsolved");
    expect(
      lastOutcomeFor({
        latestSelfRating: "struggled",
        latestRunStatus: "passed_visible_tests",
      }),
    ).toBe("struggled");
    expect(
      lastOutcomeFor({
        latestSelfRating: "hesitated",
        latestRunStatus: "passed_visible_tests",
      }),
    ).toBe("hesitated");
    expect(lastOutcomeFor({ latestRunStatus: "passed_visible_tests" })).toBe(
      "passed",
    );
    expect(
      lastOutcomeFor({
        latestSelfRating: "hesitated",
        latestRunStatus: "runtime_error",
      }),
    ).toBe("failed");
    expect(lastOutcomeFor({ latestRunStatus: "runtime_error" })).toBe("failed");
  });

  it("scores due, recurring weakness, and recency signals in [0,1]", () => {
    expect(dueScore(null, NOW)).toBe(0);
    expect(dueScore(new Date("2026-06-26T05:00:00Z"), NOW)).toBeCloseTo(
      0.2,
      5,
    );
    expect(recencyScore(NOW, NOW)).toBe(1);
    expect(recencyScore(new Date("2026-04-01T12:00:00Z"), NOW)).toBe(0);

    const recurring = problemReviewPriority({
      lastOutcome: "failed",
      dueDate: null,
      nonNoiseTags: ["sliding_window_shrink_condition"],
      recurringWeaknessTags: ["sliding_window_shrink_condition"],
      lastAttemptAt: new Date("2026-06-25T12:00:00Z"),
      now: NOW,
    });
    const oneOff = problemReviewPriority({
      lastOutcome: "failed",
      dueDate: null,
      nonNoiseTags: ["sliding_window_shrink_condition"],
      recurringWeaknessTags: [],
      lastAttemptAt: new Date("2026-06-25T12:00:00Z"),
      now: NOW,
    });
    expect(recurring).toBeGreaterThan(oneOff);
  });

  it("marks genuine diagnoses without a clean card as generation candidates", () => {
    const card = reviewProblemCardFromInput(
      problem({
        diagnosis: {
          mistakeTags: ["sliding_window_shrink_condition"],
          userIssueSummary: "窗口收缩时 left 没有同步更新。",
          coachSummary: "需要用滑动窗口维护无重复区间。",
          selfCheckQuestion: null,
          selfCheckAnswer: null,
        },
      }),
      NOW,
    );

    expect(card).toMatchObject({
      hasFlashcard: false,
      flashcardStatus: "can_generate",
    });
  });

  it("does not mark degraded evidence-only diagnoses as generation candidates", () => {
    const card = reviewProblemCardFromInput(
      problem({
        diagnosis: {
          mistakeTags: ["intervals"],
          userIssueSummary:
            "Wrong Answer: expected [[1,2],[3,10]], actual [[1,2],[3,10],[3,10]].",
          coachSummary:
            "Evidence-only review generated because the coach model did not return usable structured JSON.",
          selfCheckQuestion: null,
          selfCheckAnswer: null,
        },
      }),
      NOW,
    );

    expect(card).toMatchObject({
      hasFlashcard: false,
      flashcardStatus: "diagnosis_unavailable",
    });
  });

  it("preserves answer markdown so flashcard code fences survive", () => {
    const card = reviewProblemCardFromInput(
      problem({
        diagnosis: {
          mistakeTags: ["sliding_window_shrink_condition"],
          userIssueSummary: "窗口收缩时 left 没有同步更新。",
          coachSummary: "需要用滑动窗口维护无重复区间。",
          selfCheckQuestion: "重复时窗口怎么收缩？",
          selfCheckAnswer:
            "移动 left 时同步删除。\n```py\nwhile s[left] != c:\n    seen.remove(s[left])\n    left += 1\n```",
        },
      }),
      NOW,
    );

    expect(card?.flashcard?.answer).toContain("```py\nwhile");
  });
});

describe("problem-centric review focus board", () => {
  it("qualifies failed, struggled, unsolved, and due problem cards with concrete traps", () => {
    const board = buildReviewFocusBoardFromInputs({
      now: NOW,
      cap: 4,
      problems: [
        problem({ problemId: "failed", slug: "failed", latestRunStatus: "failed" }),
        problem({
          problemId: "struggled",
          slug: "struggled",
          latestSelfRating: "struggled",
          latestRunStatus: "passed_visible_tests",
        }),
        problem({
          problemId: "unsolved",
          slug: "unsolved",
          latestSelfRating: "unsolved",
          latestRunStatus: "passed_visible_tests",
        }),
        problem({
          problemId: "due",
          slug: "due",
          latestRunStatus: "passed_visible_tests",
          dueDate: new Date("2026-06-26T05:00:00Z"),
        }),
      ],
    });

    expect(board.cards.map((card) => card.slug).sort()).toEqual([
      "due",
      "failed",
      "struggled",
      "unsolved",
    ]);
  });

  it("orders by priority and caps Today at three cards", () => {
    const board = buildReviewFocusBoardFromInputs({
      now: NOW,
      problems: [
        problem({
          problemId: "a",
          slug: "a",
          latestSelfRating: "struggled",
          latestRunStatus: "passed_visible_tests",
        }),
        problem({
          problemId: "b",
          slug: "b",
          latestSelfRating: "unsolved",
          latestRunStatus: "passed_visible_tests",
        }),
        problem({ problemId: "c", slug: "c", latestRunStatus: "failed" }),
        problem({
          problemId: "d",
          slug: "d",
          dueDate: new Date("2026-06-26T05:00:00Z"),
        }),
        problem({ problemId: "e", slug: "e" }),
        problem({ problemId: "f", slug: "f" }),
      ],
    });

    expect(board.cards).toHaveLength(TODAY_REVIEW_CARD_CAP);
    expect(board.cards[0].slug).toBe("b");
    const priorities = board.cards.map((card) => card.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it("uses deterministic tie-breaks after equal priority", () => {
    const shared = {
      latestRunStatus: "failed",
      latestSelfRating: null,
      lastAttemptAt: new Date("2026-06-25T12:00:00Z"),
      recurringWeaknessTags: [],
    };
    const board = buildReviewFocusBoardFromInputs({
      now: NOW,
      problems: [
        problem({
          ...shared,
          problemId: "z",
          slug: "z-problem",
          dueDate: new Date("2026-06-01T00:00:00Z"),
        }),
        problem({
          ...shared,
          problemId: "a",
          slug: "a-problem",
          dueDate: new Date("2026-06-01T00:00:00Z"),
        }),
        problem({
          ...shared,
          problemId: "recent",
          slug: "recent-problem",
          lastAttemptAt: new Date("2026-06-26T10:00:00Z"),
          dueDate: new Date("2026-06-01T00:00:00Z"),
        }),
      ],
    });

    expect(board.cards.map((card) => card.slug)).toEqual([
      "recent-problem",
      "a-problem",
      "z-problem",
    ]);
  });

  it("sorts Today focus by recall severity before generic priority", () => {
    const cards = sortTodayReviewFocusCards([
      card({ slug: "passed-recurring", lastOutcome: "passed", priority: 0.9 }),
      card({
        slug: "hesitated-due",
        lastOutcome: "hesitated",
        dueDate: "2026-06-25",
      }),
      card({ slug: "struggled", lastOutcome: "struggled" }),
      card({ slug: "unsolved", lastOutcome: "unsolved" }),
    ]);

    expect(cards.map((entry) => entry.slug)).toEqual([
      "unsolved",
      "struggled",
      "hesitated-due",
      "passed-recurring",
    ]);
  });
});

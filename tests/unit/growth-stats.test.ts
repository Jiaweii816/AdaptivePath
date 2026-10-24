import { describe, expect, it } from "vitest";
import {
  buildGrowthStats,
  computeAttemptsToFirstAc,
  computeAvgDuration,
  computeCategoryProgress,
  computeDailyActivity,
  computeDifficultyMix,
  computeSolvedCount,
  computeStreak,
  computeWeeklyCount,
  type GrowthAttempt,
  type GrowthProblem,
} from "@/server/growth/growth-stats";

function attempt(over: Partial<GrowthAttempt>): GrowthAttempt {
  return {
    id: "a",
    problemId: "p1",
    problemTitle: "Two Sum",
    createdAt: new Date("2026-06-29T16:00:00Z"),
    runStatus: "failed",
    durationSeconds: null,
    difficulty: "Easy",
    tags: ["hash-table"],
    ...over,
  };
}

function problem(over: Partial<GrowthProblem>): GrowthProblem {
  return {
    id: "p1",
    difficulty: "Easy",
    hot150Order: 1,
    tags: ["hash-table"],
    ...over,
  };
}

describe("growth stats", () => {
  it("counts a daily streak from today backward", () => {
    const now = new Date("2026-06-29T18:00:00Z");
    expect(
      computeStreak(
        [
          attempt({ createdAt: new Date("2026-06-29T16:00:00Z") }),
          attempt({ id: "b", createdAt: new Date("2026-06-28T16:00:00Z") }),
          attempt({ id: "c", createdAt: new Date("2026-06-27T16:00:00Z") }),
          attempt({ id: "d", createdAt: new Date("2026-06-25T16:00:00Z") }),
        ],
        now,
      ),
    ).toBe(3);
  });

  it("keeps the active streak when today has not had a review yet", () => {
    const now = new Date("2026-07-21T15:00:00Z");
    expect(
      computeStreak(
        [
          attempt({ createdAt: new Date("2026-07-21T03:52:00Z") }),
          attempt({ id: "b", createdAt: new Date("2026-07-19T23:08:00Z") }),
        ],
        now,
      ),
    ).toBe(2);
  });

  it("resets the streak after a full missed planner day", () => {
    const now = new Date("2026-07-21T15:00:00Z");
    expect(
      computeStreak(
        [attempt({ createdAt: new Date("2026-07-19T23:08:00Z") })],
        now,
      ),
    ).toBe(0);
  });

  it("counts distinct problems in the latest seven planner days", () => {
    const now = new Date("2026-06-29T18:00:00Z");
    expect(
      computeWeeklyCount(
        [
          attempt({ problemId: "p1", createdAt: new Date("2026-06-29T16:00:00Z") }),
          attempt({ id: "repeat", problemId: "p1", createdAt: new Date("2026-06-28T16:00:00Z") }),
          attempt({ id: "p2", problemId: "p2", createdAt: new Date("2026-06-23T16:00:00Z") }),
          attempt({ id: "old", problemId: "p3", createdAt: new Date("2026-06-20T16:00:00Z") }),
        ],
        now,
      ),
    ).toBe(2);
  });

  it("solves distinct passed problems and averages real durations only", () => {
    const attempts = [
      attempt({ problemId: "p1", runStatus: "passed_visible_tests", durationSeconds: 120 }),
      attempt({ id: "again", problemId: "p1", runStatus: "failed", durationSeconds: null }),
      attempt({ id: "p2", problemId: "p2", runStatus: "accepted", durationSeconds: 240 }),
    ];

    expect(computeSolvedCount(attempts)).toBe(2);
    expect(computeAvgDuration(attempts)).toBe(180);
    expect(computeAvgDuration([attempt({ durationSeconds: null })])).toBeNull();
  });

  it("builds daily activity with minutes from recorded durations", () => {
    const activity = computeDailyActivity(
      [
        attempt({ problemId: "p1", durationSeconds: 60 }),
        attempt({ id: "p2", problemId: "p2", durationSeconds: 120 }),
      ],
      new Date("2026-06-29T18:00:00Z"),
      1,
    );

    expect(activity).toEqual([{ date: "2026-06-29", problemCount: 2, minutes: 3 }]);
  });

  it("orders attempts-to-first-AC by first pass date", () => {
    const points = computeAttemptsToFirstAc([
      attempt({ id: "p1-a", problemId: "p1", runStatus: "failed" }),
      attempt({
        id: "p1-b",
        problemId: "p1",
        runStatus: "passed_visible_tests",
        createdAt: new Date("2026-06-30T16:00:00Z"),
      }),
    ]);

    expect(points).toMatchObject([
      { problemId: "p1", firstAcDate: "2026-06-30", attemptsToAc: 2 },
    ]);
  });

  it("computes category progress and solved difficulty mix", () => {
    const problems = [
      problem({ id: "p1", tags: ["binary-search"], difficulty: "Easy" }),
      problem({ id: "p2", tags: ["dynamic-programming"], difficulty: "Medium" }),
    ];
    const attempts = [
      attempt({ problemId: "p1", runStatus: "failed", difficulty: "Easy" }),
      attempt({ problemId: "p2", runStatus: "passed", difficulty: "Medium" }),
    ];

    expect(computeCategoryProgress(problems, attempts)).toEqual([
      { category: "Binary Search", total: 1, attempted: 1, passed: 0 },
      { category: "Dynamic Programming", total: 1, attempted: 1, passed: 1 },
    ]);
    expect(computeDifficultyMix(attempts)).toEqual({
      Easy: 0,
      Medium: 1,
      Hard: 0,
    });
    expect(buildGrowthStats(problems, attempts).top150Total).toBe(2);
  });
});

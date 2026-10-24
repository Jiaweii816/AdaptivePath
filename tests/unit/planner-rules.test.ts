import { describe, expect, it } from "vitest";
import { hot150Problems } from "@/data/hot150";
import {
  calculateDailyDose,
  estimatePlanProblemCount,
  plannerDisplayTags,
  primaryPatternTag,
  interleaveHot150Problems,
  intervalForRating,
} from "@/server/planner/planner-rules";

describe("planner rules", () => {
  it("converts weekly hours into a capped daily dose", () => {
    expect(calculateDailyDose(8)).toBe(2);
    expect(calculateDailyDose(1)).toBe(1);
    expect(calculateDailyDose(80)).toBe(5);
  });

  it("estimates total planned problems from deadline capacity", () => {
    expect(
      estimatePlanProblemCount({
        weeklyHours: 7,
        interviewDate: new Date("2026-06-23T12:00:00Z"),
        now: new Date("2026-06-17T12:00:00Z"),
      }),
    ).toBe(9);
  });

  it("interleaves Hot 150 sections instead of leaving one section massed", () => {
    const interleaved = interleaveHot150Problems(hot150Problems);

    expect(interleaved).toHaveLength(150);
    expect(new Set(interleaved.slice(0, 8).map((problem) => problem.section)).size)
      .toBeGreaterThan(1);
    expect(interleaved.map((problem) => problem.slug)).toContain("two-sum");
  });

  it("maps self-ratings into first and repeated review intervals", () => {
    expect(intervalForRating({ rating: "easy" }).intervalDays).toBe(7);
    expect(intervalForRating({ rating: "hesitated" }).intervalDays).toBe(3);
    expect(intervalForRating({ rating: "struggled" }).intervalDays).toBe(2);
    expect(intervalForRating({ rating: "unsolved" }).intervalDays).toBe(1);
    expect(
      intervalForRating({
        rating: "easy",
        previousEase: 2.5,
        previousIntervalDays: 7,
      }).intervalDays,
    ).toBe(18);
  });

  it("keeps collection aliases out of learner-facing planner tags", () => {
    expect(
      primaryPatternTag([
        "top-interview-150",
        "interview-150",
        "hot150",
        "binary-search",
      ]),
    ).toBe("binary_search");
    expect(
      plannerDisplayTags([
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
      ]),
    ).toEqual(["matrix"]);
  });
});

import { describe, expect, it } from "vitest";
import { buildDailyPlan } from "@/server/jobs/proactive/build-daily-plan";

describe("buildDailyPlan", () => {
  it("deterministically keeps the top three ranked signals", () => {
    const plan = buildDailyPlan({
      userId: "try",
      date: "2026-07-22",
      weaknesses: Array.from({ length: 4 }, (_, index) => ({
        slotKey: `weakness-${index}`,
        title: `Weakness ${index}`,
        summary: `Summary ${index}`,
        evidenceCount: index,
      })),
      recommended: Array.from({ length: 4 }, (_, index) => ({
        problemId: String(index + 1),
        title: `Problem ${index}`,
        reason: `Reason ${index}`,
      })),
    });

    expect(plan).toMatchObject({ userId: "try", date: "2026-07-22" });
    expect(plan.weaknesses.map((item) => item.title)).toEqual([
      "Weakness 0",
      "Weakness 1",
      "Weakness 2",
    ]);
    expect(plan.recommended.map((item) => item.problemId)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("throws on empty signals instead of fabricating a plan", () => {
    expect(() =>
      buildDailyPlan({
        userId: "try",
        date: "2026-07-22",
        weaknesses: [],
        recommended: [],
      }),
    ).toThrow(/no learner signal/i);
  });

  it("rejects invalid identity, dates, and malformed signals", () => {
    expect(() =>
      buildDailyPlan({
        userId: " ",
        date: "2026-07-22",
        weaknesses: [],
        recommended: [{ problemId: "1", title: "Two Sum", reason: "review" }],
      }),
    ).toThrow(/userId/);
    expect(() =>
      buildDailyPlan({
        userId: "try",
        date: "2026-02-30",
        weaknesses: [],
        recommended: [{ problemId: "1", title: "Two Sum", reason: "review" }],
      }),
    ).toThrow(/valid calendar date/);
    expect(() =>
      buildDailyPlan({
        userId: "try",
        date: "2026-07-22",
        weaknesses: [
          {
            slotKey: "weakness_patterns",
            title: "Boundary",
            summary: " ",
            evidenceCount: 2,
          },
        ],
        recommended: [],
      }),
    ).toThrow(/summary/);
  });
});

import { describe, expect, it } from "vitest";
import {
  filterAttemptsByStatus,
  groupProblemHistoryAttempts,
  splitAttemptsByAge,
  type ProblemHistoryAttempt,
} from "@/features/problem-history/problem-history-data";

function attempt(over: Partial<ProblemHistoryAttempt>): ProblemHistoryAttempt {
  return {
    id: "a",
    reviewAttemptId: "r",
    chatSessionId: "c",
    problem: {
      id: "p1",
      slug: "two-sum",
      title: "Two Sum",
      leetcodeNumber: 1,
      difficulty: "Easy",
    },
    createdAt: new Date("2026-06-10T10:00:00Z"),
    language: "Python",
    userState: null,
    tags: ["array", "hash-table"],
    runStatus: "passed",
    failedCaseSummary: null,
    userIssueSummary: null,
    durationSeconds: null,
    hasFlashcard: false,
    ...over,
  };
}

describe("problem history aggregates", () => {
  it("groups attempts and counts attempts to first pass", () => {
    const groups = groupProblemHistoryAttempts([
      attempt({
        id: "third",
        runStatus: "passed_visible_tests",
        createdAt: new Date("2026-06-12T10:00:00Z"),
      }),
      attempt({
        id: "first",
        runStatus: "failed",
        createdAt: new Date("2026-06-10T10:00:00Z"),
      }),
      attempt({
        id: "second",
        runStatus: "wrong_answer",
        createdAt: new Date("2026-06-11T10:00:00Z"),
      }),
    ]);

    expect(groups[0].latest.id).toBe("third");
    expect(groups[0].firstAcAttemptCount).toBe(3);
    expect(groups[0].attempts.map((item) => item.id)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("keeps not-yet-passed groups explicit", () => {
    const groups = groupProblemHistoryAttempts([
      attempt({ id: "first", runStatus: "failed" }),
      attempt({ id: "second", runStatus: "runtime_error" }),
    ]);

    expect(groups[0].firstAcAttemptCount).toBeNull();
  });

  it("filters by pass/fail status", () => {
    const all = [
      attempt({ runStatus: "passed" }),
      attempt({ id: "b", runStatus: "wrong_answer" }),
    ];
    expect(filterAttemptsByStatus(all, "passed")).toHaveLength(1);
    expect(filterAttemptsByStatus(all, "failed")).toHaveLength(1);
    expect(filterAttemptsByStatus(all, "all")).toHaveLength(2);
  });

  it("splits attempts older than three months for collapsed display", () => {
    const now = new Date("2026-06-29T12:00:00Z");
    const split = splitAttemptsByAge(
      [
        attempt({ id: "recent", createdAt: new Date("2026-06-01T10:00:00Z") }),
        attempt({ id: "old", createdAt: new Date("2026-02-01T10:00:00Z") }),
      ],
      now,
    );

    expect(split.recent.map((item) => item.id)).toEqual(["recent"]);
    expect(split.older.map((item) => item.id)).toEqual(["old"]);
  });
});

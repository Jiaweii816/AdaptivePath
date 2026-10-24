import { describe, expect, it, vi } from "vitest";
import {
  derivePracticeTags,
  formatCalendarDate,
  runDailyCoach,
  type RunDailyCoachDependencies,
} from "@/server/jobs/proactive/run-daily-coach";
import type { ReadOnlyMcpRuntime } from "@/mcp/read-runtime";

type Runtime = ReturnType<RunDailyCoachDependencies["createRuntime"]>;
type Recommendation = Awaited<
  ReturnType<ReadOnlyMcpRuntime["recommendPractice"]>
>;

describe("runDailyCoach", () => {
  it("resolves the handle, reads weakness slots, recommends, and sends deterministically", async () => {
    const runtime = createRuntime();
    const dependencies = createDependencies(runtime);

    const result = await runDailyCoach(
      {
        handle: " PatternCoachDev ",
        databaseUrl: "file:/tmp/patterncoach-daily.sqlite",
        to: "learner@example.com",
        from: "coach@example.com",
        date: new Date("2026-07-22T01:00:00.000Z"),
        timezone: "America/Chicago",
      },
      dependencies,
    );

    expect(result).toEqual({
      transport: "file",
      detail: "/tmp/daily-coach/email.html",
    });
    expect(dependencies.createRuntime).toHaveBeenCalledWith({
      databaseUrl: "file:/tmp/patterncoach-daily.sqlite",
    });
    expect(runtime.resolveLearner).toHaveBeenCalledWith("PatternCoachDev");
    expect(
      runtime.memoryReadService.getLearnerWeaknessSignals,
    ).toHaveBeenCalledWith("internal-user-id");
    expect(runtime.recommendPractice).toHaveBeenCalledWith({
      handle: "PatternCoachDev",
      mode: "reinforce",
      tags: ["binary-search", "sliding-window", "graph"],
    });
    expect(dependencies.buildPlan).toHaveBeenCalledWith({
      userId: "internal-user-id",
      date: "2026-07-21",
      weaknesses: weaknessFixtures.slice(0, 3),
      recommended: [
        {
          problemId: "704",
          title: "Binary Search",
          reason: "Reinforce binary-search boundaries.",
        },
      ],
    });
    expect(dependencies.send).toHaveBeenCalledWith({
      to: "learner@example.com",
      from: "coach@example.com",
      subject: "Daily 2026-07-21",
      html: "<p>daily plan</p>",
      text: "daily plan",
    });
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("derives recommendations only from weaknesses visible in the email", async () => {
    const runtime = createRuntime();
    const dependencies = createDependencies(runtime);

    await runDailyCoach(
      {
        handle: "PatternCoachDev",
        to: "learner@example.com",
        from: "coach@example.com",
      },
      dependencies,
    );

    expect(runtime.recommendPractice).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["binary-search", "sliding-window", "graph"],
      }),
    );
    expect(runtime.recommendPractice).not.toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(["hash-table"]) }),
    );
  });

  it("sends a weakness-only plan when no practice concept is recognized", async () => {
    const runtime = createRuntime({
      weaknesses: [
        {
          slotKey: "weakness_patterns",
          title: "Needs attention",
          summary: "A vague signal without a recognized mechanism.",
          evidenceCount: 2,
        },
      ],
    });
    const dependencies = createDependencies(runtime);

    await runDailyCoach(
      {
        handle: "PatternCoachDev",
        to: "learner@example.com",
        from: "coach@example.com",
      },
      dependencies,
    );

    expect(runtime.recommendPractice).not.toHaveBeenCalled();
    expect(dependencies.buildPlan).toHaveBeenCalledWith(
      expect.objectContaining({ recommended: [] }),
    );
    expect(dependencies.send).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("fails closed instead of sending when there is no learner signal", async () => {
    const runtime = createRuntime({ weaknesses: [] });
    const dependencies = createDependencies(runtime);

    await expect(
      runDailyCoach(
        {
          handle: "PatternCoachDev",
          to: "learner@example.com",
          from: "coach@example.com",
        },
        dependencies,
      ),
    ).rejects.toThrow(/no learner signal/i);

    expect(runtime.recommendPractice).not.toHaveBeenCalled();
    expect(dependencies.buildPlan).not.toHaveBeenCalled();
    expect(dependencies.send).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("closes the read-only runtime when delivery fails", async () => {
    const runtime = createRuntime();
    const dependencies = createDependencies(runtime, {
      send: vi.fn(async () => {
        throw new Error("transport unavailable");
      }),
    });

    await expect(
      runDailyCoach(
        {
          handle: "PatternCoachDev",
          to: "learner@example.com",
          from: "coach@example.com",
        },
        dependencies,
      ),
    ).rejects.toThrow("transport unavailable");
    expect(runtime.close).toHaveBeenCalledOnce();
  });
});

describe("daily coach deterministic helpers", () => {
  it("extracts, normalizes, and deduplicates known memory concepts", () => {
    expect(derivePracticeTags(weaknessFixtures.slice(0, 2))).toEqual([
      "binary-search",
      "sliding-window",
    ]);
  });

  it("prefers trusted focus tags when localized weakness text has no known alias", () => {
    expect(
      derivePracticeTags([
        {
          slotKey: "episode_weakness",
          title: "边界状态",
          summary: "这个状态转换还不稳定。",
          evidenceCount: 1,
          focusTags: ["binary_search"],
        },
      ]),
    ).toEqual(["binary-search"]);
  });

  it("formats the plan date in the configured cron timezone", () => {
    expect(
      formatCalendarDate(
        new Date("2026-07-22T01:00:00.000Z"),
        "America/Chicago",
      ),
    ).toBe("2026-07-21");
  });
});

const weaknessFixtures = [
  {
    slotKey: "weakness_patterns",
    title: "Binary search boundaries",
    summary: "二分时边界更新不稳，也需要复习 sliding window 的窗口收缩。",
    evidenceCount: 3,
    focusTags: ["binary_search", "sliding_window"],
  },
  {
    slotKey: "weakness_patterns",
    title: "二分",
    summary: "Binary search invariant still needs practice.",
    evidenceCount: 2,
  },
  {
    slotKey: "episode_weakness",
    title: "Course Schedule",
    summary: "Cycle handling still needs a final check.",
    evidenceCount: 1,
    focusTags: ["graph"],
  },
  {
    slotKey: "episode_weakness",
    title: "Contains Duplicate",
    summary: "Index distance handling needs review.",
    evidenceCount: 1,
    focusTags: ["hash_table"],
  },
];

function createRuntime(
  options: { weaknesses?: typeof weaknessFixtures } = {},
): Runtime {
  return {
    resolveLearner: vi.fn(async () => ({
      userId: "internal-user-id",
      handle: "PatternCoachDev",
    })),
    memoryReadService: {
      getLearnerWeaknessSignals: vi.fn(
        async () => ({
          source: "l3_synthesis" as const,
          items: options.weaknesses ?? weaknessFixtures,
        }),
      ),
    },
    recommendPractice: vi.fn(async () => recommendationFixture),
    close: vi.fn(async () => undefined),
  };
}

function createDependencies(
  runtime: Runtime,
  overrides: Partial<RunDailyCoachDependencies> = {},
): RunDailyCoachDependencies {
  return {
    createRuntime: vi.fn(() => runtime),
    buildPlan: vi.fn((plan) => plan),
    render: vi.fn((plan) => ({
      subject: `Daily ${plan.date}`,
      html: "<p>daily plan</p>",
      text: "daily plan",
    })),
    send: vi.fn(async () => ({
      transport: "file" as const,
      detail: "/tmp/daily-coach/email.html",
    })),
    now: vi.fn(() => new Date("2026-07-22T15:00:00.000Z")),
    ...overrides,
  };
}

const recommendationFixture: Recommendation = {
  mode: "reinforce",
  searchedTags: ["binary-search", "sliding-window"],
  excludedCompletedIds: [],
  recommendationScope: "hot150_same_type",
  usedFallback: false,
  suggestions: [
    {
      title: "Binary Search",
      slug: "binary-search",
      leetcodeNumber: 704,
      difficulty: "Easy",
      tags: ["binary-search"],
      tier: "hot150",
      reason: "Reinforce binary-search boundaries.",
    },
  ],
};

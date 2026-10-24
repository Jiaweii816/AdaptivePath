import { describe, expect, it, vi } from "vitest";
import {
  createPrismaMemoryReadDependencies,
  createMemoryReadService,
  toWeaknessSlotView,
  type MemoryReadDependencies,
} from "@/mcp/memory-read-service";
function dependencies(
  overrides: Partial<MemoryReadDependencies> = {},
): MemoryReadDependencies {
  return {
    listActiveSlots: vi.fn<MemoryReadDependencies["listActiveSlots"]>(
      async () => [],
    ),
    recallHistoryContext: vi.fn<MemoryReadDependencies["recallHistoryContext"]>(
      async () => ({ items: [], retrievalStatus: "full" }),
    ),
    listTrustedWeaknessFacts: vi.fn<
      MemoryReadDependencies["listTrustedWeaknessFacts"]
    >(async () => []),
    listNegativeEpisodes: vi.fn<
      MemoryReadDependencies["listNegativeEpisodes"]
    >(async () => []),
    ...overrides,
  };
}

const activeProblem = {
  id: "problem-704",
  slug: "binary-search",
  title: "Binary Search",
  leetcodeNumber: 704,
  tags: ["Array", "Binary Search"],
};

function validationJson(mechanism: string, evidenceCount: number) {
  return JSON.stringify({
    integrity: {
      version: 1,
      origin: "learner",
      subject: "learner_behavior",
      mechanism,
      humanLabel: mechanism.replaceAll("_", " "),
      portability: "portable",
      promotionStatus: "trusted",
      evidenceClusters: Array.from({ length: evidenceCount }, (_, index) => ({
        key: `cluster-${index}`,
        problemId: `problem-${index}`,
        reviewAttemptId: `review-${index}`,
        revisionKey: `revision-${index}`,
        transition: "reinforce",
        evidenceTraceIds: [`trace-${index}`],
      })),
    },
  });
}

type EpisodeFixture = {
  title: string;
  summary: string;
  outcome: string;
  sourceTraceIds: string;
  memoryOrigin: string;
  tags: string;
  problem: {
    title: string;
    tags: string;
    leetcodeNumber?: number | null;
  } | null;
  claimObservations: Array<{
    claimText: string;
    claimType: string;
    polarity: string;
    status: string;
    memoryOrigin: string;
    scopeJson: string;
    mechanismKeysJson: string;
  }>;
};

function episode(overrides: Partial<EpisodeFixture>): EpisodeFixture {
  return {
    title: "Review episode",
    summary: "A concrete learner review outcome.",
    outcome: "failed",
    sourceTraceIds: JSON.stringify(["trace-private"]),
    memoryOrigin: "learner",
    tags: JSON.stringify(["binary_search"]),
    problem: {
      title: "Binary Search",
      tags: JSON.stringify(["Array", "Binary Search"]),
      leetcodeNumber: 704,
    },
    claimObservations: [],
    ...overrides,
  };
}

describe("toWeaknessSlotView", () => {
  it("maps the actual synthesis row shape to a compact view", () => {
    expect(
      toWeaknessSlotView({
        slot: "weakness_patterns",
        synthesisKey: "binary search boundary",
        text: "The learner often excludes the target boundary.",
        evidenceFactIds: JSON.stringify(["fact-a", "fact-b"]),
        memoryOrigin: "learner",
      }),
    ).toEqual({
      slotKey: "weakness_patterns",
      title: "Binary search boundary",
      summary: "The learner often excludes the target boundary.",
      evidenceCount: 2,
    });
  });

  it("treats malformed evidence ids as no evidence", () => {
    expect(
      toWeaknessSlotView({
        slot: "weakness_patterns",
        synthesisKey: "boundary handling",
        text: "Recheck empty-input boundaries.",
        evidenceFactIds: "not-json",
        memoryOrigin: "learner",
      }).evidenceCount,
    ).toBe(0);
  });
});

describe("createMemoryReadService", () => {
  it("overfetches before trust filtering so pending L2 rows cannot hide an older trusted weakness", async () => {
    const trusted = {
      factType: "weakness",
      tag: "binary_search_boundary",
      label: "Binary search boundaries",
      value: "Inclusive boundaries still need practice.",
      claimText: null,
      polarity: null,
      scopeJson: "{}",
      mechanismKeysJson: "[]",
      integrityVersion: 1,
      status: "active",
      memoryOrigin: "learner",
      validationJson: validationJson("binary_search_boundary", 2),
    };
    const pending = {
      ...trusted,
      tag: "pending_recent_signal",
      validationJson: trusted.validationJson.replace(
        '"promotionStatus":"trusted"',
        '"promotionStatus":"pending"',
      ),
    };
    const findMany = vi.fn(async () => [pending, trusted]);
    const prisma = {
      l2MemoryFact: { findMany },
    } as unknown as Parameters<typeof createPrismaMemoryReadDependencies>[0];
    const readDependencies = createPrismaMemoryReadDependencies(prisma);

    await expect(
      readDependencies.listTrustedWeaknessFacts({ userId: "user-1", take: 8 }),
    ).resolves.toEqual([trusted]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 32 }));
  });

  it("requests only trusted learner weakness slots and drops non-learner rows defensively", async () => {
    const listActiveSlots = vi.fn<MemoryReadDependencies["listActiveSlots"]>(
      async () => [
        {
          slot: "weakness_patterns",
          synthesisKey: "off by one",
          text: "Check inclusive boundaries.",
          evidenceFactIds: JSON.stringify(["fact-a"]),
          memoryOrigin: "learner",
        },
        {
          slot: "weakness_patterns",
          synthesisKey: "debug fixture",
          text: "Must not escape.",
          evidenceFactIds: JSON.stringify(["fact-b"]),
          memoryOrigin: "development",
        },
      ],
    );
    const service = createMemoryReadService(dependencies({ listActiveSlots }));

    const result = await service.getLearnerWeaknessSlots("internal-user-id");

    expect(listActiveSlots).toHaveBeenCalledWith({
      userId: "internal-user-id",
      slots: ["weakness_patterns"],
      take: 8,
    });
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("fact-a");
  });

  it("uses evidenced L3 synthesis before querying lower memory layers", async () => {
    const listTrustedWeaknessFacts = vi.fn<
      MemoryReadDependencies["listTrustedWeaknessFacts"]
    >(async () => []);
    const listNegativeEpisodes = vi.fn<
      MemoryReadDependencies["listNegativeEpisodes"]
    >(async () => []);
    const service = createMemoryReadService(
      dependencies({
        listActiveSlots: vi.fn(async () => [
          {
            slot: "weakness_patterns",
            synthesisKey: "binary search boundary",
            text: "Keep the interval invariant explicit.",
            evidenceFactIds: JSON.stringify(["fact-a"]),
            memoryOrigin: "learner",
          },
        ]),
        listTrustedWeaknessFacts,
        listNegativeEpisodes,
      }),
    );

    await expect(
      service.getLearnerWeaknessSignals("internal-user-id"),
    ).resolves.toMatchObject({
      source: "l3_synthesis",
      items: [{ title: "Binary search boundary", evidenceCount: 1 }],
    });
    expect(listTrustedWeaknessFacts).not.toHaveBeenCalled();
    expect(listNegativeEpisodes).not.toHaveBeenCalled();
  });

  it("falls back to trusted negative L2 facts and rejects untrusted rows", async () => {
    const trustedValidation = validationJson("binary_search_boundary", 2);
    const service = createMemoryReadService(
      dependencies({
        listTrustedWeaknessFacts: vi.fn(async () => [
          {
            factType: "weakness",
            tag: "binary_search_boundary",
            label: "Binary search boundaries",
            value: "Inclusive boundaries still need practice.",
            claimText: null,
            polarity: null,
            scopeJson: "{}",
            mechanismKeysJson: "[]",
            integrityVersion: 1,
            status: "active",
            memoryOrigin: "learner",
            validationJson: trustedValidation,
            problem: {
              title: "Binary Search",
              tags: JSON.stringify(["Array", "Binary Search"]),
              leetcodeNumber: 704,
            },
          },
          {
            factType: "weakness",
            tag: "untrusted_debug_fact",
            label: "Must not escape",
            value: "Must not escape",
            claimText: null,
            polarity: null,
            scopeJson: "{}",
            mechanismKeysJson: "[]",
            integrityVersion: 1,
            status: "active",
            memoryOrigin: "learner",
            validationJson: "{}",
          },
        ]),
      }),
    );

    const result = await service.getLearnerWeaknessSignals("internal-user-id");

    expect(result).toEqual({
      source: "l2_fact",
      items: [
        {
          slotKey: "l2_weakness",
          title: "Binary Search",
          summary: "Inclusive boundaries still need practice.",
          evidenceCount: 2,
          leetcodeNumber: 704,
          focusTags: ["binary_search"],
        },
      ],
    });
  });

  it("uses only evidenced learner episodes with explicit negative semantics", async () => {
    const service = createMemoryReadService(
      dependencies({
        listNegativeEpisodes: vi.fn(async () => [
          episode({
            title: "Failed binary search review",
            summary: "The right boundary excluded the target.",
            outcome: "failed",
          }),
          episode({
            title: "A later review with the same issue",
            summary: "The right boundary excluded the target.",
            outcome: "failed",
            problem: {
              title: "Search Insert Position",
              tags: JSON.stringify(["Array", "Binary Search"]),
            },
          }),
          episode({
            title: "Passed ordinary review",
            summary: "Visible tests passed.",
            outcome: "passed",
          }),
          episode({
            title: "Passed with a remaining pattern",
            summary: "The final code passed.",
            outcome: "passed",
            claimObservations: [
              {
                claimText: "Window shrinking remains inconsistent.",
                claimType: "weakness",
                polarity: "negative",
                status: "accepted",
                memoryOrigin: "learner",
                scopeJson: JSON.stringify({ topicHints: ["sliding_window"] }),
                mechanismKeysJson: JSON.stringify(["sliding_window"]),
              },
            ],
          }),
          episode({
            title: "Development failure",
            summary: "Must not escape.",
            outcome: "failed",
            memoryOrigin: "development",
          }),
        ]),
      }),
    );

    const result = await service.getLearnerWeaknessSignals("internal-user-id");

    expect(result.source).toBe("memory_episode");
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.summary)).toEqual([
      "The right boundary excluded the target.",
      "Window shrinking remains inconsistent.",
    ]);
    expect(result.items[0]?.evidenceCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/trace-|Development failure/);
  });

  it("builds a mistake recall plan from explicit problem context and returns no internal fields", async () => {
    const recallHistoryContext = vi.fn<MemoryReadDependencies["recallHistoryContext"]>(async () => ({
      retrievalStatus: "full",
      items: [{
        kind: "past_mistake", title: "Binary Search", summary: "The right boundary excluded the target index.",
        sourceProblem: { slug: "binary-search", title: "Binary Search" }, outcome: "failed",
        relationToCurrent: "same_problem_history", learnerSignalBasis: "earned_evidence",
        evidenceBasis: "durable_negative_claim", mechanisms: ["binary search"],
        executionAuthority: "unknown", resolutionStatus: "active",
      }],
    }));
    const service = createMemoryReadService(
      dependencies({ recallHistoryContext }),
    );

    const result = await service.recallPastMistakes({
      userId: "internal-user-id",
      query: "我上次二分哪里错了？",
      activeProblem,
    });

    const call = recallHistoryContext.mock.calls[0]?.[0];
    expect(call?.userId).toBe("internal-user-id");
    expect(call?.mode).toBe("past_mistake_recall");
    expect(call?.activeProblem.slug).toBe("binary-search");
    expect(result).toEqual({
      retrievalStatus: "full",
      items: [
        {
          title: "Binary Search",
          summary: "The right boundary excluded the target index.",
          sourceProblem: { slug: "binary-search", title: "Binary Search" },
          outcome: "failed",
          relationToCurrent: "same_problem_history",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("trace-secret");
    expect(JSON.stringify(result)).not.toContain("confidence");
  });

  it("projects past problems separately from mistake-only candidates", async () => {
    const recallHistoryContext = vi.fn<MemoryReadDependencies["recallHistoryContext"]>(async () => ({
      retrievalStatus: "full",
      items: [{
        kind: "past_problem", title: "Binary Search", summary: "Used a stable lower-bound invariant.",
        sourceProblem: { slug: "binary-search", title: "Binary Search" }, outcome: "passed",
        relationToCurrent: "same_problem_history", learnerSignalBasis: "earned_evidence",
        evidenceBasis: "durable_nonnegative_claim", mechanisms: ["binary search"],
        executionAuthority: "official", resolutionStatus: "resolved",
      }],
    }));
    const service = createMemoryReadService(
      dependencies({ recallHistoryContext }),
    );

    const result = await service.recallPastProblems({
      userId: "internal-user-id",
      query: "以前做过哪些二分题？",
      activeProblem,
    });

    expect(recallHistoryContext.mock.calls[0]?.[0].mode).toBe("past_problem_recall");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.summary).toBe("Used a stable lower-bound invariant.");
  });

  it("fails fast for blank identity/query and surfaces failed retrieval", async () => {
    const recallHistoryContext = vi.fn<MemoryReadDependencies["recallHistoryContext"]>(
      async () => ({ items: [], retrievalStatus: "failed" }),
    );
    const service = createMemoryReadService(
      dependencies({ recallHistoryContext }),
    );

    await expect(service.getLearnerWeaknessSlots("  ")).rejects.toThrow(
      "userId",
    );
    await expect(
      service.recallPastMistakes({
        userId: "internal-user-id",
        query: " ",
        activeProblem,
      }),
    ).rejects.toThrow("query");
    await expect(
      service.recallPastMistakes({
        userId: "internal-user-id",
        query: "past mistakes",
        activeProblem,
      }),
    ).rejects.toThrow("Learner memory retrieval failed");
  });

  it("surfaces partial retrieval status and clamps the recall limit", async () => {
    const recallHistoryContext = vi.fn<MemoryReadDependencies["recallHistoryContext"]>(async () => ({
      retrievalStatus: "partial_failure",
      items: Array.from({ length: 10 }, (_, index) => ({
        kind: "past_problem" as const, title: `Problem ${index}`, summary: `Past problem summary ${index}`,
        sourceProblem: { slug: `problem-${index}`, title: `Problem ${index}` },
        relationToCurrent: "cross_problem_history" as const, learnerSignalBasis: "earned_evidence" as const,
        evidenceBasis: "recorded_problem_activity" as const, mechanisms: [],
        executionAuthority: "unknown" as const, resolutionStatus: "unknown" as const,
      })),
    }));
    const service = createMemoryReadService(
      dependencies({ recallHistoryContext }),
    );

    const result = await service.recallPastProblems({
      userId: "internal-user-id",
      query: "past problems",
      activeProblem,
      limit: 99,
    });

    expect(result.retrievalStatus).toBe("partial_failure");
    expect(result.items).toHaveLength(8);
    expect(JSON.stringify(result)).not.toContain("private backend detail");
  });
});

describe("createPrismaMemoryReadDependencies", () => {
  it("filters negative episodes in SQLite before applying the recency limit", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      memoryEpisode: { findMany },
    } as unknown as Parameters<typeof createPrismaMemoryReadDependencies>[0];
    const dependencies = createPrismaMemoryReadDependencies(prisma);

    await dependencies.listNegativeEpisodes({
      userId: "internal-user-id",
      take: 8,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "internal-user-id",
          memoryOrigin: "learner",
          OR: [
            { outcome: { in: ["failed", "unresolved"] } },
            {
              claimObservations: {
                some: {
                  memoryOrigin: "learner",
                  status: "accepted",
                  polarity: "negative",
                  claimType: {
                    in: ["weakness", "mistake", "unresolved_confusion"],
                  },
                },
              },
            },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 32,
      }),
    );
  });
});

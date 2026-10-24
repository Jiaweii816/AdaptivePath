import { afterEach, describe, expect, it } from "vitest";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import { listActiveSlots } from "@/server/memory/store/synthesis-store";
import { buildCoachMemoryContext } from "@/server/memory";
import {
  pastMistakeRecallChatTool,
  pastProblemRecallChatTool,
} from "@/server/tools/chat-tools/history-recall-tool";
import {
  createTestBackgroundTraceContext,
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("memory integrity read boundaries", () => {
  it("never exposes blocked development-noise facts through retrieval, brief, or recall tools", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    await db.prisma.l2MemoryFact.createMany({
      data: [
        {
          userId: user.id,
          problemId: problem.id,
          factType: "mistake",
          tag: "no_search_logic",
          label: "Unimplemented search logic",
          value: "Unimplemented search logic",
          confidence: 0.99,
          evidenceCount: 54,
          status: "active",
          memoryOrigin: "learner",
          validationJson: trustedIntegrity(
            "no_search_logic",
            "Unimplemented search logic",
          ),
        },
        {
          userId: user.id,
          problemId: problem.id,
          factType: "mistake",
          tag: "hardcoded-return",
          label: "Hardcoded return",
          value: "Hardcoded return",
          confidence: 0.99,
          evidenceCount: 34,
          status: "active",
          memoryOrigin: "learner",
          validationJson: trustedIntegrity(
            "hardcoded_return",
            "Hardcoded return",
          ),
        },
        {
          userId: user.id,
          problemId: problem.id,
          factType: "mistake",
          tag: "loop_finalization",
          label: "Forgets the final state transition after a loop",
          value: "Forgets the final state transition after a loop",
          confidence: 0.8,
          evidenceCount: 2,
          status: "active",
          memoryOrigin: "learner",
          validationJson: trustedIntegrity(
            "loop_finalization",
            "Forgets the final state transition after a loop",
          ),
        },
      ],
    });

    const fts = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
      ftsStore: fts,
    });
    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["loop_finalization"],
      queryText: "final loop state",
      entry: { kind: "review" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
    });
    const toolResult = await pastMistakeRecallChatTool(
      { query: "past loop finalization mistakes" },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: "learner",
        memoryAssembly: memory,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["loop_finalization"],
      },
    );
    fts.close();

    expect(memory.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "l2_fact",
          teachingText: "Forgets the final state transition after a loop",
        }),
      ]),
    );
    expect(memory.brief.teachableMemories).toEqual([
      expect.objectContaining({
        cue: "Forgets the final state transition after a loop",
        learnerSignalBasis: "earned_evidence",
      }),
    ]);
    expect(toolResult.items).toEqual([]);
    expect(JSON.stringify(memory.brief)).not.toMatch(
      /no_search_logic|hardcoded.return|Unimplemented search logic|Hardcoded return/i,
    );
    expect(toolResult.items.every((item) => !("tag" in item))).toBe(true);
  });

  it("does not expose synthesis that cites a blocked fact", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const [firstEvidenceProblem, secondEvidenceProblem] = await Promise.all([
      db.prisma.problem.create({
        data: {
          slug: "trusted-state-transition-one",
          title: "Trusted State Transition One",
          methodName: "solve",
          tags: JSON.stringify(["dynamic-programming"]),
        },
      }),
      db.prisma.problem.create({
        data: {
          slug: "trusted-state-transition-two",
          title: "Trusted State Transition Two",
          methodName: "solve",
          tags: JSON.stringify(["dynamic-programming"]),
        },
      }),
    ]);
    const blocked = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "mistake",
        tag: "hardcoded_return",
        label: "Hardcoded return",
        status: "active",
        memoryOrigin: "learner",
        validationJson: trustedIntegrity(
          "hardcoded_return",
          "Hardcoded return",
        ),
      },
    });
    const trusted = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "strength",
        tag: "state_transition_explanation",
        label: "Explains state transitions before coding",
        status: "active",
        memoryOrigin: "learner",
        validationJson: trustedIntegrity(
          "state_transition_explanation",
          "Explains state transitions before coding",
          [firstEvidenceProblem.id, secondEvidenceProblem.id],
        ),
      },
    });
    await db.prisma.synthesisSlot.createMany({
      data: [
        {
          userId: user.id,
          slot: "weakness_patterns",
          synthesisKey: "blocked-only",
          text: "The learner uses hardcoded returns.",
          evidenceFactIds: JSON.stringify([blocked.id]),
          status: "active",
          memoryOrigin: "learner",
        },
        {
          userId: user.id,
          slot: "strengths",
          synthesisKey: "trusted-only",
          text: "The learner explains state transitions before coding.",
          evidenceFactIds: JSON.stringify([trusted.id]),
          status: "active",
          memoryOrigin: "learner",
        },
      ],
    });

    const slots = await listActiveSlots(db.prisma, {
      userId: user.id,
      take: 10,
    });

    expect(slots.map((slot) => slot.synthesisKey)).toEqual(["trusted-only"]);
  });

  it("does not let blocked development labels return through a learner episode", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const episode = await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        kind: "review",
        title: "Search Insert review: no_search_logic",
        summary: "The code has unimplemented search logic.",
        outcome: "failed",
        tags: JSON.stringify(["no_search_logic"]),
        memoryOrigin: "learner",
      },
    });
    const fts = createFtsStore(db.dbPath);
    fts.indexMemoryDocument({
      kind: "episode",
      refId: episode.id,
      content: `${episode.title} ${episode.summary}`,
    });

    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["array"],
      queryText: "search logic",
      entry: { kind: "recall_tool" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
    });
    const recalled = await pastProblemRecallChatTool(
      { query: "past search logic problems" },
      {
        prisma: db.prisma,
        userId: user.id,
        memoryOrigin: "learner",
        memoryAssembly: memory,
        chatSessionId: chatSession.id,
        problem: toolProblemContext(problem),
        problemTags: ["array"],
      },
    );
    fts.close();

    expect(memory.candidates.some((candidate) => candidate.id === episode.id)).toBe(
      false,
    );
    expect(JSON.stringify(memory.brief)).not.toMatch(
      /no_search_logic|unimplemented search logic/i,
    );
    expect(recalled.items).toEqual([]);
  });

  it("skips dirty ProblemHistory summaries instead of recycling them into Coach memory", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const attempts = await Promise.all(
      [1, 2, 3].map((index) =>
        db!.prisma.reviewAttempt.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            chatSessionId: chatSession.id,
            language: "Python",
            codeSnapshot: `# revision ${index}`,
            memoryOrigin: "learner",
          },
        }),
      ),
    );
    await db.prisma.problemHistory.createMany({
      data: [
        {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: attempts[0]!.id,
          chatSessionId: chatSession.id,
          language: "Python",
          problemTags: JSON.stringify(["binary_search"]),
          runStatus: "failed",
          coachSummary:
            "The learner now explains why the boundary remains inclusive.",
          memoryOrigin: "learner",
          createdAt: new Date("2026-07-16T10:00:00.000Z"),
        },
        {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: attempts[1]!.id,
          chatSessionId: chatSession.id,
          language: "Python",
          problemTags: JSON.stringify(["binary_search"]),
          runStatus: "failed",
          coachSummary:
            "Current focus is rotated_sorted_array_approach and hardcoded_return.",
          memoryOrigin: "learner",
          createdAt: new Date("2026-07-16T11:00:00.000Z"),
        },
        {
          userId: user.id,
          problemId: problem.id,
          reviewAttemptId: attempts[2]!.id,
          chatSessionId: chatSession.id,
          language: "Python",
          problemTags: JSON.stringify(["binary_search"]),
          runStatus: "failed",
          coachSummary: "用户反复表现出未实现搜索逻辑，并使用硬编码返回。",
          memoryOrigin: "learner",
          createdAt: new Date("2026-07-16T12:00:00.000Z"),
        },
      ],
    });
    const fts = createFtsStore(db.dbPath);
    await reconcileLearnerMemoryRetrievalDocuments(db.prisma, {
      userId: user.id,
      ftsStore: fts,
    });

    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["binary_search"],
      queryText: "binary search boundary",
      entry: { kind: "review" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
      traceContext: createTestBackgroundTraceContext({
        prisma: db.prisma,
        userId: user.id,
        problemId: problem.id,
        task: "test.problem-history-sanitization",
      }),
    });
    fts.close();

    expect(memory.brief.teachableMemories).toEqual([]);
    expect(memory.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "problem_history",
          teachingText: "Binary Search: recorded failed on 2026-07-16.",
        }),
      ]),
    );
    expect(memory.decisions).toContainEqual(
      expect.objectContaining({
        selected: false,
        reason: "same_problem_stale_narrative",
      }),
    );
    expect(JSON.stringify(memory.brief)).not.toMatch(
      /rotated_sorted_array_approach|hardcoded_return|未实现搜索逻辑|硬编码返回|The learner now explains why the boundary remains inclusive/,
    );
    expect(JSON.stringify(memory.candidates)).not.toMatch(
      /rotated_sorted_array_approach|hardcoded_return|未实现搜索逻辑|硬编码返回/,
    );
  });
});

function toolProblemContext(problem: {
  id: string;
  slug: string;
  title: string;
  methodName: string;
}) {
  return {
    id: problem.id,
    slug: problem.slug,
    title: problem.title,
    leetcodeNumber: null,
    methodName: problem.methodName,
    inputContractJson: "{}",
    outputContractJson: "{}",
    isDemoSupported: true,
    localRunStatus: "runnable",
    localRunStatusMessage: null,
    comparisonStrategy: "exact",
    comparisonConfigJson: "{}",
    contractKind: "pure_function",
  };
}

function trustedIntegrity(
  mechanism: string,
  humanLabel: string,
  problemIds: string[] = [],
) {
  return JSON.stringify({
    integrity: {
      version: 1,
      origin: "learner",
      subject: "learner_behavior",
      mechanism,
      humanLabel,
      portability: "portable",
      promotionStatus: "trusted",
      evidenceClusters: (problemIds.length > 0 ? problemIds : [null]).map(
        (problemId, index) => ({
          key: `cluster:${mechanism}:${problemId ?? "unknown"}:${index}`,
          problemId,
          revisionKey: `revision:${mechanism}:${index}`,
          transition: "reinforce",
          evidenceTraceIds: [`fixture-evidence:${index}`],
        }),
      ),
    },
  });
}

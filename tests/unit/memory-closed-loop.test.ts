import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCoachChatSystemPrompt,
  buildCoachReviewPrompt,
} from "@/server/agents/coach-agent/build-coach-prompt";
import { buildCoachMemoryContext } from "@/server/memory";
import { runChatConsolidation } from "@/server/memory/consolidation/consolidate-chat";
import { createMockChatConsolidationProvider } from "@/server/memory/consolidation/consolidation-provider";
import { evaluateChatConsolidationTrigger } from "@/server/memory/consolidation/triggers";
import { createFtsStore } from "@/server/memory/store/fts-store";
import type { CodeRunResult } from "@/types/code-runner";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  TEST_LEARNER_MEMORY_ORIGIN,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
  await db?.cleanup();
  db = undefined;
});

describe("unresolved confusion closed loop", () => {
  it("3 stuck turns -> salience consolidation -> focused learner memory reaches Review and Chat", async () => {
    const confusionCue =
      "The learner repeatedly asks why the binary-search interval loses a possible answer.";
    process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const fts = createFtsStore(db.dbPath);
    const turns = [
      ["user", "我还是不懂二分查找为什么 right = mid - 1 会漏掉答案？"],
      ["assistant", "想想区间不变量。"],
      ["user", "我试了还是不懂 off-by-one。"],
      ["assistant", "对比闭区间和半开区间。"],
      ["user", "二分查找的边界还是卡住，完全不明白。"],
      ["assistant", "我们一步步来。"],
    ] as const;

    for (const [index, [role, content]] of turns.entries()) {
      const message = await db.prisma.chatMessage.create({
        data: {
          sessionId: chatSession.id,
          role,
          contentMarkdown: content,
          sequence: index + 1,
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        },
      });
      await db.prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          eventType: role === "user" ? "chat_user_message" : "chat_reply",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          content,
          eventJson: JSON.stringify({ chatMessageId: message.id }),
          occurredAt: message.createdAt,
        },
      });
    }

    const decision = evaluateChatConsolidationTrigger({
      unconsolidatedUserTurns: 3,
      turnsSinceLastSuccess: 3,
      intent: "anxiety_or_stuck",
      hintLevel: 0,
      runCodeFailedInSegment: false,
      isBoundary: false,
      hasExplicitMemoryInstruction: false,
    });
    expect(decision).toEqual({
      shouldConsolidate: true,
      reason: "salience_stuck",
    });

    vi.useFakeTimers();
    const mockProvider = createMockChatConsolidationProvider();
    await runChatConsolidation(db.prisma, {
      chatSessionId: chatSession.id,
      triggerReason: decision.reason,
      ftsStore: fts,
      provider: {
        name: "closed-loop-human-label-fixture",
        async consolidate(input, traceContext) {
          const output = await mockProvider.consolidate(input, traceContext);
          return {
            ...output,
            factCandidates: output.factCandidates.map((candidate) => ({
              ...candidate,
              value: confusionCue,
            })),
          };
        },
      },
    });
    // Consolidation intentionally schedules nested background work. This test
    // verifies the consolidation result itself, so discard those callbacks
    // before the temporary database is cleaned up.
    vi.clearAllTimers();
    vi.useRealTimers();

    const memory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      problemTags: ["binary_search", "array"],
      queryText: "Binary Search binary_search array",
      entry: { kind: "review" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      ftsStore: fts,
    });
    const durableState = await db.prisma.l2MemoryFact.findMany({
      where: { userId: user.id },
      select: {
        factType: true,
        tag: true,
        status: true,
        confidence: true,
        evidenceCount: true,
        memoryOrigin: true,
        validationJson: true,
      },
    });
    const factRejections = await db.prisma.l1MemoryEvent.findMany({
      where: { userId: user.id, eventType: "fact_rejected" },
      select: { content: true, eventJson: true },
    });

    expect(factRejections).toEqual([]);
    expect(durableState).toEqual([
      expect.objectContaining({
        factType: "unresolved_confusion",
        tag: "binary_search_invariant",
        status: "active",
        evidenceCount: 3,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      }),
    ]);
    expect(memory.brief.teachableMemories).toEqual([
      expect.objectContaining({
        kind: "recurring_mistake",
        cue: confusionCue,
        learnerSignalBasis: "earned_evidence",
      }),
    ]);
    expect(memory.brief.teachableMemories[0]?.cue).not.toContain(
      "binary_search",
    );
    expect(memory.decisions).toContainEqual(
      expect.objectContaining({
        selected: false,
        reason: "same_problem_stale_narrative",
      }),
    );

    const reviewPrompt = buildCoachReviewPrompt({
      problem: {
        slug: problem.slug,
        title: problem.title,
        leetcodeNumber: null,
        tags: ["binary_search"],
        methodName: problem.methodName,
        statementMarkdown: problem.statementMarkdown,
      },
      user: {
        displayName: "u",
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      memory: memory.brief,
      language: "Python",
      code: "class Solution:\n    def search(self, nums, target):\n        return -1",
      runResult: failedRunResult,
      responseLanguage: "zh",
    });

    expect(reviewPrompt).toContain("[COACH MEMORY BRIEF");
    expect(reviewPrompt).toContain("Selected learner cues (max 2):");
    expect(reviewPrompt).toContain(confusionCue);
    expect(reviewPrompt).not.toContain("binary_search_invariant_confusion");
    expect(reviewPrompt).toContain("basis: earned_evidence");
    expect(reviewPrompt).toContain("selfCheck");
    expect(reviewPrompt).toContain("teach THIS problem's method/pattern");

    const chatPrompt = buildCoachChatSystemPrompt({
      problem: {
        slug: problem.slug,
        title: problem.title,
        leetcodeNumber: null,
        tags: ["binary_search"],
        methodName: problem.methodName,
        statementMarkdown: problem.statementMarkdown,
      },
      user: {
        displayName: "u",
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      memory: memory.brief,
      messages: [
        {
          role: "user",
          content: "还是不懂二分边界，能针对这个卡点换种方式解释吗？",
        },
      ],
      responseLanguage: "zh",
    });

    expect(chatPrompt).toContain("[COACH MEMORY BRIEF");
    expect(chatPrompt).toContain(confusionCue);
    expect(chatPrompt).not.toContain("binary_search_invariant_confusion");
    expect(chatPrompt).not.toContain("surface that in one natural sentence");

    fts.close();
  });
});

const failedRunResult: CodeRunResult = {
  status: "failed",
  passedCount: 0,
  failedCount: 1,
  stdout: "",
  stderr: "",
  testResults: [],
};

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReflection } from "@/server/agents/memory-agent/tasks/reflect";
import { buildCoachMemoryContext } from "@/server/memory";
import {
  sealChatOnlyActivityCluster,
  sealReviewActivityCluster,
} from "@/server/memory/activity-clusters";
import { readDurableFactIntegrity } from "@/server/memory/integrity/memory-integrity-policy";
import {
  runActivityExtraction,
  type ActivityExtractionProvider,
} from "@/server/memory/extraction";
import { selectHistoryRecall } from "@/server/memory/retrieval/select-history-recall";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
let fts: FtsStore | undefined;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  fts?.close();
  fts = undefined;
  await db?.cleanup();
  db = undefined;
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

describe("human-readable graph DFS memory closed loop", () => {
  it("remembers a visited-state repair, recalls it on the next problem, and promotes only after recurrence", async () => {
    db = await createMemoryTestDb();
    fts = createFtsStore(db.dbPath);
    const user = await db.prisma.user.create({
      data: { handle: "GraphDfsClosedLoopLearner" },
    });
    const [problemA, problemB] = await Promise.all([
      createGraphProblem("clone-graph-memory-loop", "Clone Graph"),
      createGraphProblem("number-of-islands-memory-loop", "Number of Islands"),
    ]);

    // Activity A: repeated failures, a Coach hint, a visited-state repair, and
    // a passing Review are frozen as one learning activity.
    const sessionA = await createSession(user.id, problemA.id);
    const reviewA = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        language: "Python",
        userState: "modified_after_hint",
        userQuestion: "I moved visited before recursion; please review the changed code.",
        codeSnapshot:
          "def dfs(node):\n    visited.add(node)\n    for neighbor in node.neighbors:\n        dfs(neighbor)",
        coachReplyMarkdown:
          "The visible Review evidence now passes; keep visited marking before neighbor expansion.",
        memoryOrigin: "learner",
      },
    });
    const messagesA = await createMessages(sessionA.id, [
      ["user", "My graph DFS failed twice. I cannot see why recursion revisits nodes."],
      ["assistant", "Before recursing, decide exactly when a node enters visited."],
      ["user", "I moved visited.add(node) before exploring neighbors; the changed Review now passes."],
    ], 1, reviewA.id);
    const evidenceA = await Promise.all([
      createLearnerEvent({
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        eventType: "chat_user_message",
        content: messagesA[0]!.contentMarkdown,
        event: { sequence: 1 },
        reviewAttemptId: reviewA.id,
      }),
      createLearnerEvent({
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        eventType: "run_evidence",
        content: "First run failed because traversal revisited a node.",
        event: { status: "failed", executionFingerprint: "dfs-a-failed-1" },
        reviewAttemptId: reviewA.id,
      }),
      createLearnerEvent({
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        eventType: "run_evidence",
        content: "Second run still failed before visited was updated.",
        event: { status: "failed", executionFingerprint: "dfs-a-failed-2" },
        reviewAttemptId: reviewA.id,
      }),
      createLearnerEvent({
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        eventType: "chat_user_message",
        content: messagesA[2]!.contentMarkdown,
        event: { sequence: 3 },
        reviewAttemptId: reviewA.id,
      }),
      createLearnerEvent({
        userId: user.id,
        problemId: problemA.id,
        chatSessionId: sessionA.id,
        eventType: "run_evidence",
        content: "The repaired revision passed Review evidence.",
        event: {
          status: "passed_visible_tests",
          executionFingerprint: "dfs-a-passed-after-visited-repair",
        },
        reviewAttemptId: reviewA.id,
      }),
    ]);
    await db.prisma.runEvidence.create({
      data: {
        reviewAttemptId: reviewA.id,
        chatSessionId: sessionA.id,
        source: "review",
        status: "passed_visible_tests",
        passedCount: 3,
        failedCount: 0,
        executionFingerprint: "dfs-a-passed-after-visited-repair",
        rawResultJson: JSON.stringify({ evidenceScope: "local_visible" }),
        memoryOrigin: "learner",
      },
    });
    await db.prisma.diagnosisResult.create({
      data: {
        reviewAttemptId: reviewA.id,
        diagnosisJson: JSON.stringify({
          rootCause: "Visited marking happened after recursive expansion.",
        }),
        userIssueSummary: "DFS revisited nodes before they entered visited.",
        coachSummary:
          "Mark each node visited before expanding neighbors; the changed revision passed visible Review evidence.",
      },
    });
    const clusterA = await sealReviewActivityCluster(db.prisma, {
      reviewAttemptId: reviewA.id,
      startMessageSequence: 1,
      endMessageSequence: 3,
    });
    expect(clusterA.cluster.kind).toBe("review_rooted");
    expect(evidenceA).toHaveLength(5);
    const extractionA = await runActivityExtraction(db.prisma, {
      activityClusterId: clusterA.cluster.id,
      ftsStore: fts,
      provider: visitedRepairProvider({
        title: "Visited-state repair on Clone Graph",
        summary:
          "The learner's DFS repeatedly revisited nodes until Coach prompted a visited-state check; moving visited marking before neighbor expansion made the changed Review pass.",
        problemId: problemA.id,
      }),
    });

    expect(extractionA.changedFactIds).toHaveLength(1);
    await expect(
      db.prisma.memoryEpisode.count({
        where: { activityClusterId: clusterA.cluster.id },
      }),
    ).resolves.toBe(1);
    const factId = extractionA.changedFactIds[0]!;
    const afterA = await db.prisma.l2MemoryFact.findUniqueOrThrow({
      where: { id: factId },
    });
    expect(afterA).toMatchObject({
      status: "candidate",
      polarity: "negative",
      mechanismKeysJson: "[\"depth_first_search\"]",
      evidenceCount: 1,
    });
    expect(readDurableFactIntegrity(afterA.validationJson)?.evidenceClusters).toEqual([
      expect.objectContaining({ key: clusterA.cluster.id, problemId: problemA.id }),
    ]);

    // Activity B opens with a history question. The turn assembles memory once
    // and reuses that candidate set for explicit history recall.
    const sessionB = await createSession(user.id, problemB.id);
    const [questionB] = await createMessages(sessionB.id, [
      ["user", "This graph DFS looks familiar. Where did I get stuck last time?"],
    ]);
    const questionTrace = await createLearnerEvent({
      userId: user.id,
      problemId: problemB.id,
      chatSessionId: sessionB.id,
      eventType: "chat_user_message",
      content: questionB!.contentMarkdown,
      event: { sequence: 1 },
    });
    const assembleForTurn = vi.fn(() =>
      buildCoachMemoryContext(db!.prisma, {
        userId: user.id,
        problemId: problemB.id,
        problemTags: ["graph", "depth_first_search"],
        queryText: questionB!.contentMarkdown,
        entry: { kind: "chat", intent: "past_problem_recall_request" },
        profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
        ftsStore: fts,
      }),
    );
    const openingMemory = await assembleForTurn();
    const recalled = selectHistoryRecall({
      mode: "past_problem_recall",
      query: questionB!.contentMarkdown,
      queryPlan: openingMemory.queryPlan,
      candidates: openingMemory.candidates,
    });

    expect(assembleForTurn).toHaveBeenCalledOnce();
    expect(openingMemory.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "episode",
          sourceProblem: expect.objectContaining({ slug: problemA.slug }),
          teachingText: expect.stringContaining("visited-state check"),
        }),
      ]),
    );
    expect(recalled.items[0]).toMatchObject({
      relationToCurrent: "cross_problem_history",
      summary: expect.stringContaining("visited-state check"),
    });
    expect(recalled.items[0]?.summary).toContain("before neighbor expansion");
    await expect(
      db.prisma.memoryEvidenceContribution.count({
        where: { targetClusterFactId: factId },
      }),
    ).resolves.toBe(5);
    await expect(
      db.prisma.l2MemoryFact.findUniqueOrThrow({ where: { id: factId } }),
    ).resolves.toMatchObject({ status: "candidate", evidenceCount: 1 });

    // Only a newly observed mistake on problem B is allowed to reinforce L2;
    // the earlier "where did I get stuck?" question is explicitly ignored.
    const laterMessagesB = await createMessages(
      sessionB.id,
      [
        ["assistant", recalled.items[0]!.summary],
        ["user", "I ran it and really did forget visited again before DFS recursion."],
      ],
      2,
    );
    const recurrenceTrace = await createLearnerEvent({
      userId: user.id,
      problemId: problemB.id,
      chatSessionId: sessionB.id,
      eventType: "run_evidence",
      content: laterMessagesB[1]!.contentMarkdown,
      event: { status: "failed", executionFingerprint: "dfs-b-visited-failure" },
    });
    const clusterB = await sealChatOnlyActivityCluster(db.prisma, {
      chatSessionId: sessionB.id,
      startMessageSequence: 1,
      endMessageSequence: 3,
      boundaryReason: "explicit_exit",
      additionalSourceItems: [
        { sourceType: "l1_event", sourceId: questionTrace.id, evidenceRole: "trace" },
        {
          sourceType: "l1_event",
          sourceId: recurrenceTrace.id,
          evidenceRole: "trace",
        },
      ],
    });
    const extractionB = await runActivityExtraction(db.prisma, {
      activityClusterId: clusterB.cluster.id,
      ftsStore: fts,
      provider: reinforcingVisitedProvider({
        targetFactId: factId,
        problemId: problemB.id,
        usedEvidenceTraceId: recurrenceTrace.id,
        ignoredQuestionTraceId: questionTrace.id,
      }),
    });

    expect(extractionB.changedFactIds).toEqual([factId]);
    const activeFact = await db.prisma.l2MemoryFact.findUniqueOrThrow({
      where: { id: factId },
    });
    const activeIntegrity = readDurableFactIntegrity(activeFact.validationJson);
    expect(activeFact).toMatchObject({
      status: "active",
      polarity: "negative",
      mechanismKeysJson: "[\"depth_first_search\"]",
      evidenceCount: 2,
    });
    expect(new Set(activeIntegrity?.evidenceClusters.map((item) => item.key))).toEqual(
      new Set([clusterA.cluster.id, clusterB.cluster.id]),
    );
    expect(
      new Set(activeIntegrity?.evidenceClusters.map((item) => item.problemId)),
    ).toEqual(new Set([problemA.id, problemB.id]));
    const questionContribution = await db.prisma.memoryEvidenceContribution.findFirst({
      where: {
        targetClusterFactId: factId,
        evidenceTraceIds: { contains: questionTrace.id },
      },
    });
    expect(questionContribution).toBeNull();

    // Two independent cross-problem activities now support an L3 weakness.
    const reflection = await runReflection(db.prisma, {
      userId: user.id,
      changedFactIds: [factId],
      ftsStore: fts,
      provider: {
        name: "graph-dfs-closed-loop-reflection",
        async reflect(input) {
          expect(input.changedFacts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: factId,
                polarity: "negative",
                mechanismKeys: ["depth_first_search"],
                scope: expect.objectContaining({
                  topicHints: ["graph DFS", "visited state"],
                }),
              }),
            ]),
          );
          return {
            slotUpserts: [
              {
                slot: "weakness_patterns",
                synthesisKey: "graph-dfs-visited-state-prevention",
                text: "Across graph problems, visited-state marking still benefits from an explicit check before DFS expands neighbors.",
                evidenceFactIds: [factId],
                confidence: 0.68,
                status: "active",
              },
            ],
            strategyProposals: [],
            factAudits: [],
          };
        },
      },
    });
    expect(reflection.rejectedSlotCount).toBe(0);
    const slot = await db.prisma.synthesisSlot.findFirstOrThrow({
      where: { userId: user.id, synthesisKey: "graph-dfs-visited-state-prevention" },
    });

    // A later Coach turn can recall both the durable L2 claim and the L3
    // synthesis as candidates; the compact brief still enforces its max-two and
    // one-cue-per-teaching-role budget.
    const finalMemory = await buildCoachMemoryContext(db.prisma, {
      userId: user.id,
      problemId: problemB.id,
      problemTags: ["graph", "depth_first_search"],
      queryText: "Give me a graph DFS visited-state prevention hint.",
      entry: { kind: "chat", intent: "hint_request" },
      profile: { strongPatterns: [], weakPatterns: [], outputPreferences: [] },
      ftsStore: fts,
    });
    expect(finalMemory.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: factId, source: "l2_fact" }),
        expect.objectContaining({ id: slot.id, source: "synthesis" }),
      ]),
    );
    expect(finalMemory.brief.teachableMemories).toHaveLength(1);
    expect(finalMemory.brief.teachableMemories[0]?.cue).toMatch(/visited(?:-state| marking)/i);
  });

  function createGraphProblem(slug: string, title: string) {
    return db!.prisma.problem.create({
      data: {
        slug,
        title,
        methodName: "solve",
        tags: JSON.stringify(["graph", "depth_first_search"]),
      },
    });
  }

  function createSession(userId: string, problemId: string) {
    return db!.prisma.chatSession.create({
      data: { userId, problemId, memoryOrigin: "learner" },
    });
  }

  async function createMessages(
    sessionId: string,
    messages: ReadonlyArray<readonly [role: string, content: string]>,
    startSequence = 1,
    reviewAttemptId?: string,
  ) {
    return Promise.all(
      messages.map(([role, contentMarkdown], index) =>
        db!.prisma.chatMessage.create({
          data: {
            sessionId,
            role,
            contentMarkdown,
            sequence: startSequence + index,
            memoryOrigin: "learner",
            reviewAttemptId,
          },
        }),
      ),
    );
  }

  function createLearnerEvent(args: {
    userId: string;
    problemId: string;
    chatSessionId: string;
    eventType: string;
    content: string;
    event: Record<string, unknown>;
    reviewAttemptId?: string;
  }) {
    return db!.prisma.l1MemoryEvent.create({
      data: {
        userId: args.userId,
        problemId: args.problemId,
        chatSessionId: args.chatSessionId,
        eventType: args.eventType,
        content: args.content,
        eventJson: JSON.stringify(args.event),
        memoryOrigin: "learner",
        reviewAttemptId: args.reviewAttemptId,
      },
    });
  }
});

function visitedRepairProvider(args: {
  title: string;
  summary: string;
  problemId: string;
}): ActivityExtractionProvider {
  return {
    name: "graph-dfs-activity-a",
    async extract(input) {
      const evidenceTraceIds = [...input.allowedLearnerEvidenceTraceIds];
      return {
        episode: {
          title: args.title,
          summary: args.summary,
          outcome: "improved",
          tags: ["graph DFS", "visited state"],
          salience: 0.88,
          evidenceTraceIds,
        },
        observations: [
          {
            claimType: "weakness",
            claimText:
              "In graph DFS, the learner omitted visited marking before expanding neighbors and needed Coach guidance to repair it.",
            polarity: "negative",
            scope: {
              level: "cross_problem",
              problemIds: [args.problemId],
              topicHints: ["graph DFS", "visited state"],
              context: "One observed learning activity; not recurrence by itself.",
            },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds,
          },
        ],
        coverage: {
          status: "complete",
          examinedEvidenceTraceIds: evidenceTraceIds,
          usedEvidenceTraceIds: evidenceTraceIds,
          ignoredEvidence: [],
        },
      };
    },
  };
}

function reinforcingVisitedProvider(args: {
  targetFactId: string;
  problemId: string;
  usedEvidenceTraceId: string;
  ignoredQuestionTraceId: string;
}): ActivityExtractionProvider {
  return {
    name: "graph-dfs-activity-b",
    async extract(input) {
      expect(input.existingClaimCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetFactId: args.targetFactId,
            polarity: "negative",
          }),
        ]),
      );
      return {
        episode: {
          title: "Visited-state recurrence on Number of Islands",
          summary:
            "The learner recalled the earlier episode, then a real run exposed the same missing visited-state guard on another graph problem.",
          outcome: "unresolved",
          tags: ["graph DFS", "visited state"],
          salience: 0.82,
          evidenceTraceIds: [args.usedEvidenceTraceId],
        },
        observations: [
          {
            claimType: "weakness",
            claimText:
              "A second graph DFS activity again exposed omitted visited marking before recursion.",
            polarity: "negative",
            scope: {
              level: "cross_problem",
              problemIds: [args.problemId],
              topicHints: ["graph DFS", "visited state"],
            },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds: [args.usedEvidenceTraceId],
            relationProposal: {
              targetFactId: args.targetFactId,
              relation: "reinforces",
              modelConfidence: 0.96,
              rationale: "Same learner behavior on a different graph DFS problem.",
            },
          },
        ],
        coverage: {
          status: "complete",
          examinedEvidenceTraceIds: [
            args.ignoredQuestionTraceId,
            args.usedEvidenceTraceId,
          ],
          usedEvidenceTraceIds: [args.usedEvidenceTraceId],
          ignoredEvidence: [
            {
              evidenceTraceId: args.ignoredQuestionTraceId,
              reason: "not_relevant_to_learning",
            },
          ],
        },
      };
    },
  };
}

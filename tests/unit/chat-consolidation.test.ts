import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChatConsolidation } from "@/server/memory/consolidation/consolidate-chat";
import {
  createLlmChatConsolidationProvider,
  createMockChatConsolidationProvider,
  getChatConsolidationProvider,
  type ChatConsolidationProvider,
} from "@/server/memory/consolidation/consolidation-provider";
import { createTraceContext } from "@/server/llm/trace-context";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import { ensureWorkspaceTraceTurn } from "@/server/observability/workspace-session";
import { createFtsStore } from "@/server/memory/store/fts-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  TEST_LEARNER_MEMORY_ORIGIN,
  type MemoryTestDb,
} from "./memory-test-helpers";

vi.mock("@/server/jobs/enqueue-embed-backfill", () => ({
  enqueueEmbedBackfill: vi.fn(async () => ({ recorded: false })),
}));
vi.mock("@/server/jobs/enqueue-reflection", () => ({
  enqueueReflection: vi.fn(async () => ({ recorded: false })),
}));

const originalProvider = process.env.CHAT_CONSOLIDATION_PROVIDER;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
let db: MemoryTestDb | undefined;

const input = {
  problemTitle: "Binary Search",
  problemTags: ["binary_search"],
  triggerReason: "salience_stuck",
  currentRollingSummary: undefined as string | undefined,
  evidenceTraceIds: ["t1", "t2"],
  plannedStrategies: [],
  messages: [
    { role: "user" as const, content: "为什么 right = mid - 1 不对？" },
    { role: "assistant" as const, content: "先想一下不变量。" },
    { role: "user" as const, content: "我还是不懂 off-by-one。" },
  ],
};

afterEach(async () => {
  if (originalProvider === undefined) {
    delete process.env.CHAT_CONSOLIDATION_PROVIDER;
  } else {
    process.env.CHAT_CONSOLIDATION_PROVIDER = originalProvider;
  }
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
  await db?.cleanup();
  db = undefined;
});

describe("chat consolidation provider", () => {
  it("mock emits an unresolved_confusion reinforce candidate on salience triggers", async () => {
    const output = await createMockChatConsolidationProvider().consolidate(input);

    expect(output.episodeSummary.outcome).toBe("unresolved");
    expect(output.factCandidates).toHaveLength(1);
    expect(output.factCandidates[0]).toMatchObject({
      factType: "unresolved_confusion",
      tag: "binary_search_invariant_confusion",
      evidenceKind: "reinforce",
      evidenceTraceIds: ["t1", "t2"],
    });
    expect(output.newRollingSummary.length).toBeGreaterThan(0);
  });

  it("mock emits no fact candidates on non-salience triggers", async () => {
    const output = await createMockChatConsolidationProvider().consolidate({
      ...input,
      triggerReason: "turn_threshold",
    });

    expect(output.factCandidates).toEqual([]);
    expect(output.episodeSummary.outcome).toBe("resolved");
  });

  it("env switch returns the mock", () => {
    process.env.CHAT_CONSOLIDATION_PROVIDER = "mock";

    expect(getChatConsolidationProvider().name).toBe("mock-consolidation");
  });

  it("sets enable_thinking=false for non-streaming memory LLM calls", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              episodeSummary: {
                title: "Binary Search chat",
                summary: "The learner asked about a binary search boundary.",
                outcome: "unresolved",
                tags: ["binary_search"],
                salience: 0.7,
              },
              factCandidates: [],
              strategySignals: [],
              strategiesApplied: [],
              newRollingSummary: "The learner asked about binary search boundaries.",
            }),
          },
        },
      ],
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;
    const provider = createLlmChatConsolidationProvider({
      client: fakeClient,
      model: "qwen3-8b",
    });

    await provider.consolidate(input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "qwen3-8b",
      enable_thinking: false,
    });
  });

  it("records memory consolidation llm_call trace with provider usage", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const create = vi.fn().mockResolvedValueOnce({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              episodeSummary: {
                title: "Binary Search chat",
                summary: "The learner asked about a binary search boundary.",
                outcome: "unresolved",
                tags: ["binary_search"],
                salience: 0.7,
              },
              factCandidates: [],
              strategySignals: [
                {
                  tag: "invariant_first_questioning",
                  observation: "The learner responded to invariant prompts.",
                  polarity: "positive",
                },
              ],
              strategiesApplied: [],
              newRollingSummary: "The learner asked about binary search boundaries.",
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 70,
        completion_tokens: 30,
        total_tokens: 100,
      },
    });
    const provider = createLlmChatConsolidationProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      path: "memory_background",
      task: "memory.consolidate_chat",
      problemId: problem.id,
      chatSessionId: chatSession.id,
    });

    await provider.consolidate(input, traceContext);

    const event = (await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      take: 1,
    }))[0]!;
    const eventJson = JSON.parse(event.eventJson);

    expect(event.source).toBe("memory_agent:consolidate_chat");
    expect(eventJson).toMatchObject({
      traceRunId: traceContext.traceRunId,
      path: "memory_background",
      task: "memory.consolidate_chat",
      status: "ok",
      model: "qwen3-8b",
      usageSource: "provider",
      usage: {
        inputTokens: 70,
        outputTokens: 30,
        totalTokens: 100,
      },
      strategySignals: [
        {
          tag: "invariant_first_questioning",
          observation: "The learner responded to invariant prompts.",
          polarity: "positive",
        },
      ],
    });
  });
});

async function seedChatSegment() {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
  db = await createMemoryTestDb();
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(
    db.prisma,
  );
  const turns = [
    ["user", "我还是不懂二分查找里为什么 right = mid - 1 不对？"],
    ["assistant", "先想不变量。"],
    ["user", "我还是不懂 off-by-one"],
    ["assistant", "看半开区间。"],
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

  return { prisma: db.prisma, user, problem, chatSession, dbPath: db.dbPath };
}

function createHumanLabelMockConsolidationProvider(): ChatConsolidationProvider {
  const mock = createMockChatConsolidationProvider();
  return {
    name: "mock-consolidation-human-label-fixture",
    async consolidate(input, traceContext) {
      const output = await mock.consolidate(input, traceContext);
      return {
        ...output,
        factCandidates: output.factCandidates.map((candidate) => ({
          ...candidate,
          value:
            "The learner repeatedly asks how the binary-search interval preserves a possible answer.",
        })),
      };
    },
  };
}

describe("runChatConsolidation", () => {
  it("writes episode + unresolved_confusion fact, advances cursor and rolling summary", async () => {
    const { prisma, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);
    const result = await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "salience_stuck",
      ftsStore: fts,
      provider: createHumanLabelMockConsolidationProvider(),
    });

    expect(result.skipped).toBe(false);

    const episode = await prisma.memoryEpisode.findFirstOrThrow({
      where: { kind: "chat_segment" },
    });
    expect(episode.outcome).toBe("unresolved");
    const fact = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "unresolved_confusion" },
    });
    expect(fact.tag).toBe("binary_search_invariant");
    expect(fact.source).toBe("chat_consolidation");
    expect(fact.status).toBe("active");
    expect(fact.evidenceCount).toBe(2);
    expect(fact.memoryOrigin).toBe(TEST_LEARNER_MEMORY_ORIGIN);

    const session = await prisma.chatSession.findUniqueOrThrow({
      where: { id: chatSession.id },
    });
    expect(session.rollingSummary).toBeTruthy();
    const lastMessage = await prisma.chatMessage.findFirstOrThrow({
      where: { sessionId: chatSession.id },
      orderBy: { sequence: "desc" },
    });
    expect(session.lastConsolidatedMessageId).toBe(lastMessage.id);

    const llmEvents = await prisma.l1MemoryEvent.findMany({
      where: { eventType: "llm_call" },
    });
    expect(llmEvents).toHaveLength(0);
    expect(
      fts.searchMemoryFts("binary search", { kind: "episode", limit: 5 })[0]
        ?.refId,
    ).toBe(episode.id);
    expect(
      fts.searchMemoryFts("binary search interval invariant", {
        kind: "fact",
        limit: 5,
      })[0]?.refId,
    ).toBe(fact.id);

    fts.close();
  });

  it("records deterministic arbitration before a durable consolidation fact write", async () => {
    const { prisma, user, problem, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);
    const traceContext = await createClaimedWorkerTrace({
      prisma,
      userId: user.id,
      problemId: problem.id,
      traceRunId: "consolidation-arbitration-child",
    });

    await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "salience_stuck",
      ftsStore: fts,
      provider: createHumanLabelMockConsolidationProvider(),
      traceContext,
    });
    await traceContext.recorder?.finalize({ status: "succeeded" });

    const events = await prisma.agentTraceEvent.findMany({
      where: { traceRunId: traceContext.traceRunId },
      orderBy: { seq: "asc" },
    });
    const request = events.find(
      (event) => event.title === "L2 fact candidate arbitration",
    );
    const result = events.find(
      (event) => event.title === "L2 arbitration result",
    );
    const persistence = events.find(
      (event) => event.stage === "consolidation_persistence",
    );
    expect(JSON.parse(request?.metadataJson ?? "{}")).toMatchObject({
      operation: "arbitration",
      opcode: "reinforce",
      decision: "pending",
      finalDecisionOwner: "arbitrateFactCandidates",
      llmDecidesFinalState: false,
    });
    expect(JSON.parse(result?.metadataJson ?? "{}")).toMatchObject({
      operation: "durable_fact_change",
      decision: "arbitrated",
      acceptedCount: 1,
    });
    expect(request?.seq).toBeLessThan(result?.seq ?? 0);
    expect(result?.seq).toBeLessThan(persistence?.seq ?? 0);
    fts.close();
  });

  it("records skipped deterministic arbitration when consolidation has no candidate", async () => {
    const { prisma, user, problem, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);
    const traceContext = await createClaimedWorkerTrace({
      prisma,
      userId: user.id,
      problemId: problem.id,
      traceRunId: "consolidation-no-candidate-child",
    });

    await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "turn_threshold",
      ftsStore: fts,
      provider: createMockChatConsolidationProvider(),
      traceContext,
    });
    await traceContext.recorder?.finalize({ status: "succeeded" });

    const request = await prisma.agentTraceEvent.findFirstOrThrow({
      where: {
        traceRunId: traceContext.traceRunId,
        title: "L2 fact candidate arbitration",
      },
    });
    expect(request.status).toBe("skipped");
    expect(JSON.parse(request.metadataJson ?? "{}")).toMatchObject({
      operation: "arbitration",
      opcode: "none",
      decision: "skipped",
      reason: "no_candidate",
    });
    fts.close();
  });

  it("provider failure leaves the cursor untouched and writes consolidation_failed", async () => {
    const { prisma, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);

    await expect(
      runChatConsolidation(prisma, {
        chatSessionId: chatSession.id,
        triggerReason: "turn_threshold",
        ftsStore: fts,
        provider: {
          name: "boom",
          consolidate: async () => {
            throw new Error("provider exploded");
          },
        },
      }),
    ).rejects.toThrow("provider exploded");

    const session = await prisma.chatSession.findUniqueOrThrow({
      where: { id: chatSession.id },
    });
    expect(session.lastConsolidatedMessageId).toBeNull();
    const failures = await prisma.l1MemoryEvent.findMany({
      where: { eventType: "consolidation_failed" },
    });
    expect(failures).toHaveLength(1);
    expect(JSON.parse(failures[0].eventJson)).toMatchObject({
      traceRunId: expect.any(String),
      timings: {
        totalMs: expect.any(Number),
        llmMsTotal: 0,
      },
    });

    fts.close();
  });

  it("skips when there is nothing after the cursor", async () => {
    const { prisma, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);

    await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "boundary",
      ftsStore: fts,
      provider: createMockChatConsolidationProvider(),
    });
    const second = await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "boundary",
      ftsStore: fts,
      provider: createMockChatConsolidationProvider(),
    });

    expect(second.skipped).toBe(true);
    fts.close();
  });

  it("uses clearedBeforeSequence as the consolidation cursor baseline", async () => {
    const { prisma, chatSession, dbPath } = await seedChatSegment();
    const fts = createFtsStore(dbPath);
    await prisma.chatSession.update({
      where: { id: chatSession.id },
      data: { clearedBeforeSequence: 2 },
    });
    const consolidate = vi.fn<ChatConsolidationProvider["consolidate"]>((input) =>
      createMockChatConsolidationProvider().consolidate(input),
    );
    const provider: ChatConsolidationProvider = {
      name: "capture",
      consolidate,
    };

    await runChatConsolidation(prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "turn_threshold",
      ftsStore: fts,
      provider,
    });

    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(consolidate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "我还是不懂 off-by-one" },
      { role: "assistant", content: "看半开区间。" },
    ]);
    fts.close();
  });

  it("does not turn local-only examiner review suspicions into L2 facts", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const fts = createFtsStore(db.dbPath);
    const userMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "我刚点了 Review，帮我看看。",
        sequence: 1,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const userTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: userMessage.id }),
        occurredAt: userMessage.createdAt,
      },
    });
    const reviewMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown:
          "### 我作为考官读到的\n我怀疑这里可能有边界问题，但这只是只读审阅。",
        sequence: 2,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        metadataJson: JSON.stringify({
          type: "review_reply",
          evidenceVerdict: { evidenceClass: "local_only" },
        }),
      },
    });
    const localOnlyTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: reviewMessage.id }),
        occurredAt: reviewMessage.createdAt,
      },
    });
    const consolidate = vi.fn<ChatConsolidationProvider["consolidate"]>(
      async () => ({
        episodeSummary: {
          title: "Advisory review",
          summary: "A local-only read-only examiner review was shown.",
          outcome: "resolved",
          tags: ["binary_search"],
          salience: 0.4,
        },
        factCandidates: [
          {
            factType: "mistake",
            tag: "binary_search_boundary",
            value: "Binary search boundary issue",
            evidenceKind: "reinforce",
            observedBehavior: "Assistant suspected a boundary issue.",
            evidenceTraceIds: [localOnlyTrace.id],
          },
        ],
        strategySignals: [],
        strategiesApplied: [],
        newRollingSummary: "User received an advisory local-only review.",
      }),
    );

    await runChatConsolidation(db.prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "boundary",
      ftsStore: fts,
      provider: { name: "local-only-leak-test", consolidate },
    });

    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(consolidate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "我刚点了 Review，帮我看看。" },
    ]);
    expect(consolidate.mock.calls[0]?.[0].evidenceTraceIds).toEqual([
      userTrace.id,
    ]);
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(0);
    const session = await db.prisma.chatSession.findUniqueOrThrow({
      where: { id: chatSession.id },
    });
    expect(session.lastConsolidatedMessageId).toBe(reviewMessage.id);
    await expect(
      db.prisma.l1MemoryEvent.count({ where: { eventType: "llm_call" } }),
    ).resolves.toBe(0);

    fts.close();
  });

  it("excludes advisory run-derived assistant replies from consolidation evidence", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const fts = createFtsStore(db.dbPath);
    const userMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "请跑这个自定义 case。",
        sequence: 1,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const userTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: userMessage.id }),
        occurredAt: userMessage.createdAt,
      },
    });
    const advisoryReply = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown:
          "这个自定义 1/1 通过，所以你的整套代码已经没问题了。",
        sequence: 2,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        metadataJson: JSON.stringify({
          type: "chat_reply",
          workspace: {
            currentTurnRunObservations: [
              {
                storageSource: "chat_current_tool",
                subject: "current_user_code",
                authority: "advisory",
                scope: { kind: "specific_examples", totalCount: 1 },
                status: "passed_visible_tests",
              },
            ],
          },
        }),
      },
    });
    const advisoryReplyTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: advisoryReply.id }),
        occurredAt: advisoryReply.createdAt,
      },
    });
    const consolidate = vi.fn<ChatConsolidationProvider["consolidate"]>(
      async () => ({
        episodeSummary: {
          title: "Custom example run",
          summary: "The learner asked to run a custom example.",
          outcome: "resolved",
          tags: ["binary_search"],
          salience: 0.2,
        },
        factCandidates: [
          {
            factType: "skill",
            tag: "binary_search",
            value: "Learner code passed the suite.",
            evidenceKind: "reinforce",
            observedBehavior: "Assistant claimed the code passed.",
            evidenceTraceIds: [advisoryReplyTrace.id],
          },
        ],
        strategySignals: [],
        strategiesApplied: [],
        newRollingSummary: "The learner requested a custom example run.",
      }),
    );

    await runChatConsolidation(db.prisma, {
      chatSessionId: chatSession.id,
      triggerReason: "boundary",
      ftsStore: fts,
      provider: { name: "advisory-run-leak-test", consolidate },
    });

    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(consolidate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "请跑这个自定义 case。" },
    ]);
    expect(consolidate.mock.calls[0]?.[0].evidenceTraceIds).toEqual([
      userTrace.id,
    ]);
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(0);
    const episode = await db.prisma.memoryEpisode.findFirstOrThrow();
    expect(JSON.parse(episode.sourceTraceIds)).toEqual([userTrace.id]);

    fts.close();
  });
});

async function createClaimedWorkerTrace(args: {
  prisma: MemoryTestDb["prisma"];
  userId: string;
  problemId: string;
  traceRunId: string;
}) {
  const root = await ensureWorkspaceTraceTurn(args.prisma, {
    userId: args.userId,
    problemId: args.problemId,
    browserInstanceId: `unit-${args.traceRunId}`,
    action: "chat",
    snapshot: {},
    cutoverEnabled: true,
    captureLevel: "full",
    processInstanceId: "unit-foreground",
    traceRunId: `${args.traceRunId}-root`,
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    env: {},
  });
  if (!root.enabled) throw new Error("trace unexpectedly disabled");
  await args.prisma.agentTraceRun.create({
    data: {
      id: args.traceRunId,
      userId: args.userId,
      problemId: args.problemId,
      workspaceSessionId: root.workspaceSessionId,
      parentTraceRunId: root.traceRunId,
      originatingTraceRunId: root.traceRunId,
      originatingTurnOrdinal: root.turnOrdinal,
      path: "memory_background",
      actionKind: "chat_consolidation",
      processInstanceId: "unit-worker",
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    },
  });
  return createTraceContext({
    prisma: args.prisma,
    userId: args.userId,
    problemId: args.problemId,
    path: "memory_background",
    task: "memory.consolidate_chat",
    traceRunId: args.traceRunId,
    workspaceSessionId: root.workspaceSessionId,
    captureLevel: "full",
    bufferedRecorder: true,
    memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
  });
}

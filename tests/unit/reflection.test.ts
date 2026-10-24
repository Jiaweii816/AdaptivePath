import type OpenAI from "openai";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runReflection } from "@/server/agents/memory-agent/tasks/reflect";
import { buildReflectionPrompt } from "@/server/agents/memory-agent/tasks/build-reflection-prompt";
import {
  createLlmReflectionProvider,
  createMockReflectionProvider,
  type ReflectionInput,
} from "@/server/agents/memory-agent/tasks/reflection-provider";
import { createTraceContext } from "@/server/llm/trace-context";
import {
  ACTIVE_STRATEGY_CAP,
  parseStrategyValidation,
  reflectionOutputSchema,
  strategyProposalSchema,
  STRATEGY_VALIDATION_MIN_APPLIES,
} from "@/server/memory/memory.types";
import { createMemoryEpisode } from "@/server/memory/store/episode-store";
import { upsertStrategyCandidate } from "@/server/memory/store/fact-store";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { createDeterministicRetrievalTextRefreshProvider } from "@/server/memory/retrieval-text/refresh-retrieval-text";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import { captureNormalizedTraceEvent } from "@/server/observability/runtime-trace-capture";
import { flushTraceEvents } from "@/server/observability/trace-store";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  TEST_LEARNER_MEMORY_ORIGIN,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";

const originalReflectionProvider = process.env.REFLECTION_PROVIDER;
const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
let db: MemoryTestDb | undefined;

beforeAll(() => {
  process.env.REFLECTION_PROVIDER = "mock";
  process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
});

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

afterAll(() => {
  if (originalReflectionProvider === undefined) {
    delete process.env.REFLECTION_PROVIDER;
  } else {
    process.env.REFLECTION_PROVIDER = originalReflectionProvider;
  }
  if (originalMemoryOrigin === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = originalMemoryOrigin;
  }
});

function verifiedFailedEvidenceVerdict() {
  return {
    evidenceClass: "verdict_bearing",
    status: "failed",
    providerUsed: "leetcode",
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: true,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: true,
    },
  };
}

describe("reflection contracts", () => {
  it("tells the real provider to omit slots instead of emitting empty evidence ids", () => {
    const prompt = buildReflectionPrompt({
      userHandle: "PatternCoachTest",
      episodes: [],
      changedFacts: [],
      activeSlots: [],
      strategySignals: [],
    });

    expect(prompt).toContain("evidenceFactIds: [] is invalid");
    expect(prompt).toContain("omit the entire slotUpsert object");
  });

  it("pins synthesis slot text to English so L3 and L2 read in one language", () => {
    const prompt = buildReflectionPrompt({
      userHandle: "PatternCoachTest",
      episodes: [],
      changedFacts: [],
      activeSlots: [],
      strategySignals: [],
    });

    expect(prompt).toContain("Write slot text in English only");
    expect(prompt).not.toContain("Chinese chars");
  });

  it("presents open-world graph knowledge without privileging canonical topics", () => {
    const prompt = buildReflectionPrompt({
      userHandle: "PatternCoachTest",
      episodes: [],
      changedFacts: [
        {
          id: "graph-visited-claim",
          factType: "knowledge_state",
          tag: "claim_open_world_graph_visited",
          value: "Visited-state handling still needs a deliberate check.",
          claimText:
            "The learner omitted visited marking before exploring DFS neighbors.",
          polarity: "negative",
          scope: {
            level: "mechanism",
            problemIds: ["graph-problem"],
            topicHints: ["graph DFS", "visited state"],
          },
          mechanismKeys: [],
          confidence: 0.64,
          evidenceTraceIds: ["trace-1"],
          evidenceClusters: [
            {
              id: "activity-1",
              problemId: "graph-problem",
              reviewAttemptId: "review-1",
            },
          ],
        },
      ],
      activeSlots: [],
      strategySignals: [],
    });

    expect(prompt).toContain(
      "The learner omitted visited marking before exploring DFS neighbors.",
    );
    expect(prompt).toContain("graph DFS,visited state");
    expect(prompt).toContain("There is no privileged demo-topic list");
    expect(prompt).toContain(
      "mechanismKeys and topic hints are optional ranking/projecting metadata, never eligibility gates",
    );
    expect(prompt).toContain("Do not require a canonical mechanism");
  });

  it("slot upserts require evidence fact ids and a known slot", () => {
    const parsed = reflectionOutputSchema.safeParse({
      slotUpserts: [
        {
          slot: "weakness_patterns",
          synthesisKey: "boundary_update_without_invariant",
          text: "Across recent binary search sessions the user moves pointers before stating the invariant.",
          evidenceFactIds: ["f1", "f2"],
          confidence: 0.7,
        },
      ],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.strategyProposals).toEqual([]);
    expect(
      reflectionOutputSchema.safeParse({
        slotUpserts: [
          {
            slot: "not_a_slot",
            synthesisKey: "k",
            text: "t",
            evidenceFactIds: ["f1"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("strategy proposals must declare hypothesis and an expected observable", () => {
    expect(
      strategyProposalSchema.safeParse({
        tag: "invariant_first_questioning",
        hypothesis:
          "Asking for the invariant before code helps this user self-correct.",
        expectedObservable: "reviewTransition",
        evidenceTraceIds: ["t1"],
      }).success,
    ).toBe(true);
    expect(
      strategyProposalSchema.safeParse({
        tag: "x",
        hypothesis: "y",
        expectedObservable: "vibes",
        evidenceTraceIds: ["t1"],
      }).success,
    ).toBe(false);
  });

  it("exposes the deterministic promotion constants", () => {
    expect(STRATEGY_VALIDATION_MIN_APPLIES).toBe(2);
    expect(ACTIVE_STRATEGY_CAP).toBe(5);
  });
});

describe("runReflection", () => {
  it("excludes blocked learner episodes from reflection and synthesis input", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    await db.prisma.memoryEpisode.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        kind: "review",
        title: "Search Insert: no_search_logic",
        summary: "Unimplemented search logic was repeated.",
        outcome: "failed",
        tags: JSON.stringify(["no_search_logic"]),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const reflect = vi.fn().mockResolvedValue({
      slotUpserts: [],
      strategyProposals: [],
      factAudits: [],
    });

    const result = await runReflection(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      provider: { name: "episode-integrity-spy", reflect },
    });

    expect(result.episodeCount).toBe(0);
    expect(reflect.mock.calls[0]?.[0].episodes).toEqual([]);
  });

  it("attaches retrieval, memory, and persistence events to a supplied child Run", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      problemId: problem.id,
      path: "memory_background",
      task: "memory.reflect",
      bufferedRecorder: false,
    });

    await runReflection(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      traceContext,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    const events = await db.prisma.agentTraceEvent.findMany({
      where: { traceRunId: traceContext.traceRunId },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => `${event.kind}:${event.stage}`)).toEqual(
      expect.arrayContaining([
        "retrieval:reflection_input",
        "memory:strategy_observation",
        "memory:reflection_arbitration",
        "persistence:reflection_persistence",
      ]),
    );
    expect(
      events.every((event) => event.traceRunId === traceContext.traceRunId),
    ).toBe(true);
    const skippedArbitration = events.find(
      (event) => event.title === "L2 fact audit arbitration",
    );
    expect(skippedArbitration?.status).toBe("skipped");
    expect(JSON.parse(skippedArbitration?.metadataJson ?? "{}")).toMatchObject({
      operation: "arbitration",
      opcode: "none",
      decision: "skipped",
      reason: "no_candidate",
      llmDecidesFinalState: false,
    });
  });

  it("records deterministic fact-audit arbitration before the reflection durable-change marker", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const reviewAttempt = await db.prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        language: "Python",
        codeSnapshot: "# fact audit",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const executionFingerprint = fingerprintCodeForExecution({
      language: "Python",
      code: reviewAttempt.codeSnapshot,
    });
    const storedRun = await db.prisma.runEvidence.create({
      data: {
        reviewAttemptId: reviewAttempt.id,
        chatSessionId: chatSession.id,
        source: "review",
        executionFingerprint,
        status: "failed",
        rawResultJson: JSON.stringify({
          evidenceVerdict: verifiedFailedEvidenceVerdict(),
        }),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const evidence = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        reviewAttemptId: reviewAttempt.id,
        eventType: "run_evidence",
        source: "review_pipeline",
        eventJson: JSON.stringify({
          runEvidenceId: storedRun.id,
          status: "failed",
          executionFingerprint,
          evidenceVerdict: verifiedFailedEvidenceVerdict(),
        }),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      problemId: problem.id,
      path: "memory_background",
      task: "memory.reflect",
      bufferedRecorder: false,
    });

    await runReflection(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      traceContext,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [],
          strategyProposals: [],
          factAudits: [
            {
              factType: "weakness",
              tag: "binary_search_boundary",
              value: "Boundary reasoning remains fragile.",
              evidenceKind: "reinforce",
              observedBehavior: "The learner repeated a boundary mistake.",
              evidenceTraceIds: [evidence.id],
            },
          ],
        },
      }),
    });

    const events = await db.prisma.agentTraceEvent.findMany({
      where: { traceRunId: traceContext.traceRunId },
      orderBy: { createdAt: "asc" },
    });
    const requestIndex = events.findIndex(
      (event) => event.title === "L2 fact audit arbitration",
    );
    const resultIndex = events.findIndex(
      (event) => event.title === "L2 fact audit arbitration result",
    );
    const persistenceIndex = events.findIndex(
      (event) => event.stage === "reflection_persistence",
    );
    expect(
      JSON.parse(events[requestIndex]?.metadataJson ?? "{}"),
    ).toMatchObject({
      operation: "arbitration",
      opcode: "reinforce",
      decision: "pending",
      finalDecisionOwner: "arbitrateFactCandidates",
      llmDecidesFinalState: false,
    });
    expect(JSON.parse(events[resultIndex]?.metadataJson ?? "{}")).toMatchObject(
      {
        operation: "durable_fact_change",
        decision: "arbitrated",
        acceptedCount: 1,
      },
    );
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(resultIndex).toBeGreaterThan(requestIndex);
    expect(persistenceIndex).toBeGreaterThan(resultIndex);
  });

  it("turns repeated same-tag failed episodes into a weakness_patterns slot with evidence", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "second-reflection-evidence",
        title: "Second Reflection Evidence",
        methodName: "solve",
        tags: JSON.stringify(["sliding-window"]),
      },
    });
    const trace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "review_attempt",
        eventJson: JSON.stringify({ codeHash: "weakness-slot-review-v1" }),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const factA = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "weakness",
        tag: "binary_search",
        value: "boundary updates",
        confidence: 0.6,
        status: "active",
        evidenceTraceIds: JSON.stringify([trace.id]),
        ...trustedL2FactFixture({
          mechanism: "binary_search",
          humanLabel:
            "Boundary updates are not yet tied to a stable invariant.",
          problemIds: [problem.id],
        }),
      },
    });
    const factB = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "weakness",
        tag: "sliding_window",
        value: "shrink condition",
        confidence: 0.6,
        status: "active",
        evidenceTraceIds: JSON.stringify([trace.id]),
        ...trustedL2FactFixture({
          mechanism: "sliding_window",
          humanLabel: "The shrink condition is applied inconsistently.",
          problemIds: [secondProblem.id],
        }),
      },
    });

    for (const tag of ["binary_search", "sliding_window"]) {
      await createMemoryEpisode(db.prisma, {
        userId: user.id,
        problemId: problem.id,
        kind: "review",
        title: `${tag} review: failed`,
        summary: `Failed on ${tag} boundary handling.`,
        outcome: "failed",
        tags: [tag],
        salience: 0.7,
        sourceTraceIds: [trace.id],
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      });
    }

    const result = await runReflection(db.prisma, { userId: user.id });
    expect(result).toMatchObject({
      skipped: false,
      episodeCount: 2,
      changedFactCount: 2,
      acceptedSlotIds: expect.any(Array),
      rejectedSlotCount: 0,
      auditedFactIds: expect.any(Array),
    });

    const slots = await db.prisma.synthesisSlot.findMany({
      where: { userId: user.id, slot: "weakness_patterns" },
    });
    expect(slots).toHaveLength(1);
    const evidence = JSON.parse(slots[0].evidenceFactIds) as string[];
    expect(evidence).toEqual(expect.arrayContaining([factA.id, factB.id]));

    const llmEvents = await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      sources: ["memory_agent:reflect"],
    });
    expect(llmEvents).toHaveLength(0);
  });

  it("synthesizes an open-world graph DFS visited-state weakness without mechanism keys", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const problems = await Promise.all(
      ["dfs-visited-a", "dfs-visited-b"].map((slug, index) =>
        db!.prisma.problem.create({
          data: {
            slug,
            title: `DFS Visited ${index + 1}`,
            methodName: "solve",
            tags: JSON.stringify(["graph"]),
          },
        }),
      ),
    );
    const facts = await Promise.all(
      problems.map((problem, index) => {
        const clusterKey = `claim:v1:dfs-visited-${index + 1}`;
        return db!.prisma.l2MemoryFact.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            factType: "knowledge_state",
            tag: `claim_open_world_dfs_visited_${index + 1}`,
            label: "Visited-state handling during DFS",
            value: "DFS revisitation guards still need deliberate attention.",
            claimText:
              index === 0
                ? "The learner omitted visited marking before exploring DFS neighbors."
                : "On another graph problem, the learner again needed a cue to mark a node visited.",
            polarity: "negative",
            scopeJson: JSON.stringify({
              level: "mechanism",
              problemIds: [problem.id],
              topicHints: ["graph DFS", "visited state"],
            }),
            mechanismKeysJson: "[]",
            integrityVersion: 2,
            clusterKey,
            confidence: 0.64,
            evidenceCount: 1,
            status: "active",
            memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
            validationJson: JSON.stringify({
              integrity: {
                version: 1,
                origin: TEST_LEARNER_MEMORY_ORIGIN,
                subject: "learner_behavior",
                mechanism: clusterKey,
                humanLabel: "Visited-state handling during DFS",
                portability: "portable",
                promotionStatus: "trusted",
                evidenceClusters: [
                  {
                    key: `dfs-activity-${index + 1}`,
                    problemId: problem.id,
                    reviewAttemptId: `dfs-review-${index + 1}`,
                    revisionKey: `dfs-revision-${index + 1}`,
                    transition: "reinforce",
                    evidenceTraceIds: [`dfs-trace-${index + 1}`],
                  },
                ],
              },
              claimIntegrity: {
                version: 2,
                origin: TEST_LEARNER_MEMORY_ORIGIN,
                clusterKey,
                mechanismKeys: [],
              },
            }),
          },
        });
      }),
    );
    const reflect = vi.fn(async (input: ReflectionInput) => {
      expect(input.changedFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: facts[0]!.id,
            factType: "knowledge_state",
            claimText:
              "The learner omitted visited marking before exploring DFS neighbors.",
            polarity: "negative",
            mechanismKeys: [],
            scope: expect.objectContaining({
              topicHints: ["graph DFS", "visited state"],
            }),
          }),
        ]),
      );
      return {
        slotUpserts: [
          {
            slot: "weakness_patterns" as const,
            synthesisKey: "dfs-visited-state-habit",
            text: "Across graph problems, DFS visited-state marking still benefits from a deliberate pre-traversal check.",
            evidenceFactIds: facts.map((fact) => fact.id),
            confidence: 0.68,
            status: "active" as const,
          },
        ],
        strategyProposals: [],
        factAudits: [],
      };
    });

    const result = await runReflection(db.prisma, {
      userId: user.id,
      changedFactIds: facts.map((fact) => fact.id),
      provider: { name: "open-world-reflection-spy", reflect },
    });

    expect(result.changedFactCount).toBe(2);
    expect(result.rejectedSlotCount).toBe(0);
    await expect(
      db.prisma.synthesisSlot.findFirstOrThrow({
        where: { userId: user.id, synthesisKey: "dfs-visited-state-habit" },
      }),
    ).resolves.toMatchObject({ slot: "weakness_patterns" });
  });

  it("always retains every trusted changed fact plus at most forty recent facts", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const changedIds = Array.from(
      { length: 41 },
      (_, index) => `changed-reflection-fact-${index + 1}`,
    );
    const recentIds = Array.from(
      { length: 41 },
      (_, index) => `recent-reflection-fact-${index + 1}`,
    );
    await db.prisma.l2MemoryFact.createMany({
      data: [...changedIds, ...recentIds].map((id, index) => ({
        id,
        userId: user.id,
        factType: "knowledge_state",
        tag: `open_world_fact_${index + 1}`,
        label: `Open-world learner claim ${index + 1}`,
        value: `Learner claim ${index + 1}`,
        claimText: `Learner claim ${index + 1}`,
        polarity: "neutral",
        confidence: 0.6,
        evidenceCount: 1,
        status: "active",
        lastSeenAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        validationJson: trustedL2FactFixture({
          mechanism: `claim:${index + 1}`,
          humanLabel: `Open-world learner claim ${index + 1}`,
          clusterCount: 1,
        }).validationJson,
      })),
    });
    const reflect = vi.fn(async (input: ReflectionInput) => {
      const inputIds = new Set(input.changedFacts.map((fact) => fact.id));
      expect(changedIds.every((id) => inputIds.has(id))).toBe(true);
      expect(
        input.changedFacts.filter((fact) => recentIds.includes(fact.id)),
      ).toHaveLength(40);
      return { slotUpserts: [], strategyProposals: [], factAudits: [] };
    });

    const result = await runReflection(db.prisma, {
      userId: user.id,
      changedFactIds: changedIds,
      provider: { name: "changed-fact-window-spy", reflect },
      retrievalTextProvider: createDeterministicRetrievalTextRefreshProvider(),
    });

    expect(result.changedFactCount).toBe(81);
    expect(reflect).toHaveBeenCalledOnce();
  });

  it("records reflection llm_call trace with provider usage", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const create = vi.fn().mockResolvedValueOnce({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              slotUpserts: [],
              strategyProposals: [],
              factAudits: [],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 44,
        completion_tokens: 12,
        total_tokens: 56,
      },
    });
    const provider = createLlmReflectionProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      path: "memory_background",
      task: "memory.reflect",
      problemId: problem.id,
    });

    await provider.reflect(
      {
        userHandle: user.handle,
        episodes: [],
        changedFacts: [],
        activeSlots: [],
        strategySignals: [],
      },
      traceContext,
    );

    const [event] = await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      sources: ["memory_agent:reflect"],
    });
    expect(event).toBeDefined();
    const eventJson = JSON.parse(event!.eventJson);

    expect(eventJson).toMatchObject({
      traceRunId: traceContext.traceRunId,
      path: "memory_background",
      task: "memory.reflect",
      status: "ok",
      usageSource: "provider",
      usage: {
        inputTokens: 44,
        outputTokens: 12,
        totalTokens: 56,
      },
    });
  });

  it("keeps valid synthesis while rejecting malformed optional strategy proposals", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const create = vi.fn().mockResolvedValueOnce({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              slotUpserts: [],
              strategyProposals: [
                {
                  tag: "invented_strategy",
                  hypothesis:
                    "This malformed optional proposal must not block L3.",
                  expectedObservable: "accuracyRate",
                  evidenceTraceIds: ["trace_1"],
                },
              ],
              factAudits: [],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 44,
        completion_tokens: 12,
        total_tokens: 56,
      },
    });
    const provider = createLlmReflectionProvider({
      client: { chat: { completions: { create } } } as unknown as OpenAI,
      model: "qwen3-8b",
    });
    const traceContext = createTraceContext({
      prisma: db.prisma,
      userId: user.id,
      path: "memory_background",
      task: "memory.reflect",
    });

    const output = await provider.reflect(
      {
        userHandle: user.handle,
        episodes: [],
        changedFacts: [],
        activeSlots: [],
        strategySignals: [],
      },
      traceContext,
    );

    expect(output.strategyProposals).toEqual([]);
    const [event] = await loadFormalTraceProjection(db.prisma, {
      eventTypes: ["llm_call"],
      sources: ["memory_agent:reflect"],
    });
    expect(JSON.parse(event!.eventJson)).toMatchObject({
      rejectedMalformedStrategyProposalCount: 1,
    });
  });

  it("rejects slot upserts citing fewer than 2 existing facts (cross-problem evidence rule)", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);

    const result = await runReflection(db.prisma, {
      userId: user.id,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [
            {
              slot: "weakness_patterns",
              synthesisKey: "thin_evidence",
              text: "Not enough evidence.",
              evidenceFactIds: ["nonexistent"],
              confidence: 0.5,
              status: "active",
            },
          ],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    expect(result.skipped).toBe(false);
    expect(await db.prisma.synthesisSlot.count()).toBe(0);
    const rejections = await db.prisma.l1MemoryEvent.findMany({
      where: { eventType: "fact_rejected", source: "memory_agent:reflect" },
    });
    expect(rejections).toHaveLength(1);
  });

  it("accepts one trusted fact when it contains two independent cross-problem clusters", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const secondProblem = await db.prisma.problem.create({
      data: {
        slug: "second-binary-search-reflection",
        title: "Second Binary Search Reflection",
        methodName: "search",
        tags: JSON.stringify(["binary-search"]),
      },
    });
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "strength",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
        value: "Defines and preserves the search interval before coding.",
        confidence: 0.58,
        evidenceCount: 2,
        status: "active",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        validationJson: JSON.stringify({
          integrity: {
            version: 1,
            origin: TEST_LEARNER_MEMORY_ORIGIN,
            subject: "learner_behavior",
            mechanism: "binary_search_invariant",
            humanLabel: "binary-search interval invariant",
            portability: "portable",
            promotionStatus: "trusted",
            evidenceClusters: [
              {
                key: "review-cluster-a",
                problemId: problem.id,
                reviewAttemptId: "review-a",
                revisionKey: "revision-a",
                transition: "reinforce",
                evidenceTraceIds: ["trace-a"],
              },
              {
                key: "review-cluster-b",
                problemId: secondProblem.id,
                reviewAttemptId: "review-b",
                revisionKey: "revision-b",
                transition: "reinforce",
                evidenceTraceIds: ["trace-b"],
              },
            ],
          },
        }),
      },
    });
    const fts = createFtsStore(db.dbPath);

    const result = await runReflection(db.prisma, {
      userId: user.id,
      changedFactIds: [fact.id],
      ftsStore: fts,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [
            {
              slot: "strengths",
              synthesisKey: "binary-search-invariant-strength",
              text: "Across two different problems, the learner preserved the binary-search interval invariant.",
              evidenceFactIds: [fact.id],
              confidence: 0.7,
              status: "active",
            },
          ],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    expect(result.rejectedSlotCount).toBe(0);
    const slot = await db.prisma.synthesisSlot.findFirstOrThrow({
      where: { userId: user.id, slot: "strengths" },
    });
    expect(JSON.parse(slot.evidenceFactIds)).toEqual([fact.id]);
    expect(
      fts.searchMemoryFts("cross problem binary search invariant", {
        kind: "synthesis",
        limit: 5,
      })[0]?.refId,
    ).toBe(slot.id);
    fts.close();
  });

  it("rejects two clusters that repeat the same problem", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const fact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "weakness",
        tag: "binary_search_invariant",
        label: "binary-search interval invariant",
        value: "The interval update remains inconsistent.",
        confidence: 0.58,
        evidenceCount: 2,
        status: "active",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        validationJson: JSON.stringify({
          integrity: {
            version: 1,
            origin: TEST_LEARNER_MEMORY_ORIGIN,
            subject: "learner_behavior",
            mechanism: "binary_search_invariant",
            humanLabel: "binary-search interval invariant",
            portability: "portable",
            promotionStatus: "trusted",
            evidenceClusters: [
              {
                key: "same-problem-cluster-a",
                problemId: problem.id,
                reviewAttemptId: "same-review-a",
                revisionKey: "same-revision-a",
                transition: "reinforce",
                evidenceTraceIds: ["same-trace-a"],
              },
              {
                key: "same-problem-cluster-b",
                problemId: problem.id,
                reviewAttemptId: "same-review-b",
                revisionKey: "same-revision-b",
                transition: "reinforce",
                evidenceTraceIds: ["same-trace-b"],
              },
            ],
          },
        }),
      },
    });

    const result = await runReflection(db.prisma, {
      userId: user.id,
      changedFactIds: [fact.id],
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [
            {
              slot: "weakness_patterns",
              synthesisKey: "same-problem-repeat",
              text: "This should not be accepted as a cross-problem pattern.",
              evidenceFactIds: [fact.id],
              confidence: 0.7,
              status: "active",
            },
          ],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    expect(result.rejectedSlotCount).toBe(1);
    await expect(db.prisma.synthesisSlot.count()).resolves.toBe(0);
  });

  it("writes memory_synthesis_failed and no slots when reflection schema is invalid", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const create = vi.fn().mockResolvedValueOnce({
      model: "qwen3-8b",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              slotUpserts: [
                {
                  slot: "weakness_patterns",
                  synthesisKey: "bad_schema",
                  text: "This should not be written.",
                  evidenceFactIds: "fact_1",
                  confidence: "0.7",
                  status: "active",
                },
              ],
              strategyProposals: [],
              factAudits: [],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
    });
    const fakeClient = {
      chat: { completions: { create } },
    } as unknown as OpenAI;

    await expect(
      runReflection(db.prisma, {
        userId: user.id,
        provider: createLlmReflectionProvider({
          client: fakeClient,
          model: "qwen3-8b",
        }),
      }),
    ).rejects.toThrow();

    await expect(db.prisma.synthesisSlot.count()).resolves.toBe(0);
    const failure = await db.prisma.l1MemoryEvent.findFirstOrThrow({
      where: { userId: user.id, eventType: "memory_synthesis_failed" },
    });
    expect(failure.source).toBe("memory_agent:reflect");
    expect(JSON.parse(failure.eventJson)).toMatchObject({
      traceRunId: expect.any(String),
      provider: "llm-reflection:qwen3-8b",
      timings: {
        totalMs: expect.any(Number),
        llmMsTotal: expect.any(Number),
      },
      error: {
        type: "ZodError",
      },
    });
    const [llmTrace] = await loadFormalTraceProjection(db.prisma, {
      userId: user.id,
      eventTypes: ["llm_call"],
    });
    expect(llmTrace).toBeDefined();
    expect(JSON.parse(llmTrace!.eventJson)).toMatchObject({
      path: "memory_background",
      task: "memory.reflect",
      status: "error",
      usageSource: "provider",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
      error: {
        type: "ZodError",
      },
    });
  });

  it("anchors strategy observations to appliedAssistantMessageId, not async write time", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );
    const strategyReply = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown: "先说循环不变量。",
        sequence: 2,
      },
    });
    const laterReviewReply = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "我先写出了不变量，这次边界条件过了。",
        sequence: 4,
      },
    });
    const reviewTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ chatMessageId: laterReviewReply.id }),
      },
    });
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      kind: "review",
      title: "Binary Search review: passed",
      summary: "The user stated the invariant before moving bounds.",
      outcome: "passed",
      tags: ["binary_search"],
      salience: 0.7,
      sourceTraceIds: [reviewTrace.id],
      memoryOrigin: "learner",
    });
    const proposalTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ chatMessageId: "strategy-proposal-turn" }),
      },
    });
    await upsertStrategyCandidate(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      tag: "invariant_first",
      hypothesis: "Ask for the invariant before pointer updates.",
      expectedObservable: "reviewTransition",
      evidenceTraceIds: [proposalTrace.id],
    });
    await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "strategy_applied",
        memoryOrigin: "learner",
        occurredAt: new Date("2099-01-01T00:00:00Z"),
        eventJson: JSON.stringify({
          strategyTag: "invariant_first",
          appliedAssistantMessageId: strategyReply.id,
        }),
      },
    });

    await runReflection(db.prisma, {
      userId: user.id,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    const fact = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "strategy", tag: "invariant_first" },
    });
    expect(parseStrategyValidation(fact.validationJson)).toMatchObject({
      applied: 1,
      positive: 1,
      negative: 0,
      deterministicPositive: 1,
    });
  });

  it("validates strategy from repeat-mistake reduction and lower hint escalation without same-tag passed episodes", async () => {
    db = await createMemoryTestDb();
    const { user, problem, chatSession } = await seedMinimalUserAndProblem(
      db.prisma,
    );

    const firstUserMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "我又忘了先说 invariant。",
        sequence: 1,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const firstStrategyReply = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown: "先说 invariant 再写边界。",
        sequence: 2,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const secondStrategyReply = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown: "再确认一次 invariant。",
        sequence: 4,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    const laterUserMessage = await db.prisma.chatMessage.create({
      data: {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "这次我先写 invariant。",
        sequence: 5,
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });

    const mistakeTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "diagnosis",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({
          chatMessageId: firstUserMessage.id,
          diagnosis: { mistakeTags: ["invariant_first"] },
        }),
      },
    });
    const laterTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: laterUserMessage.id }),
      },
    });
    await createMemoryEpisode(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      kind: "chat_segment",
      title: "Later activity without repeated invariant mistake",
      summary:
        "The user continued after the strategy without repeating the invariant mistake.",
      outcome: "unresolved",
      tags: ["binary_search"],
      salience: 0.5,
      sourceTraceIds: [laterTrace.id],
      memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
    });
    await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: "invariant_first",
        value: "Forgets to state invariant before moving bounds.",
        confidence: 0.7,
        status: "active",
        evidenceTraceIds: JSON.stringify([mistakeTrace.id]),
        ...trustedL2FactFixture({
          mechanism: "invariant_first",
          humanLabel:
            "The learner moves binary-search boundaries before stating the invariant.",
        }),
      },
    });
    const proposalTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
        eventJson: JSON.stringify({ chatMessageId: firstUserMessage.id }),
      },
    });
    await upsertStrategyCandidate(db.prisma, {
      userId: user.id,
      problemId: problem.id,
      tag: "invariant_first",
      hypothesis: "Ask for invariant before boundary edits.",
      expectedObservable: "repeatMistakeRate",
      evidenceTraceIds: [proposalTrace.id],
    });

    for (const message of [firstStrategyReply, secondStrategyReply]) {
      await db.prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          chatSessionId: chatSession.id,
          eventType: "strategy_applied",
          memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
          eventJson: JSON.stringify({
            strategyTag: "invariant_first",
            appliedAssistantMessageId: message.id,
          }),
        },
      });
    }
    const hintTraceRun = await db.prisma.agentTraceRun.create({
      data: {
        id: "reflection-hint-tool-run",
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        path: "chat",
        actionKind: "chat",
        processInstanceId: getProcessInstanceId(),
        memoryOrigin: TEST_LEARNER_MEMORY_ORIGIN,
      },
    });
    await flushTraceEvents(db.prisma, [
      captureNormalizedTraceEvent(
        {
          identity: {
            eventId: "reflection-hint-tool-result",
            traceRunId: hintTraceRun.id,
          },
          scope: {
            path: "chat",
            stage: "bounded_agent_loop",
            kind: "tool",
            title: "Tool result",
          },
          lifecycle: {
            status: "succeeded",
            occurredAt: new Date().toISOString(),
          },
          details: {
            output: { level: 1 },
            metadata: {
              source: "chat_reply",
              eventRole: "result",
              toolName: "get_algorithm_hint",
              sequence: 3,
            },
          },
        },
        { detailLevel: "full", env: {} },
      ),
    ]);

    await runReflection(db.prisma, {
      userId: user.id,
      provider: createMockReflectionProvider({
        forcedOutput: {
          slotUpserts: [],
          strategyProposals: [],
          factAudits: [],
        },
      }),
    });

    const strategy = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "strategy", tag: "invariant_first" },
    });
    expect(strategy.status).toBe("validated");
    expect(parseStrategyValidation(strategy.validationJson)).toMatchObject({
      applied: 2,
      negative: 2,
    });
    expect(
      parseStrategyValidation(strategy.validationJson).deterministicPositive,
    ).toBeGreaterThanOrEqual(2);
  });
});

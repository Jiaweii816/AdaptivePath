import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueActivityExtraction } from "@/server/jobs/enqueue-activity-extraction";
import { sealChatOnlyActivityCluster } from "@/server/memory/activity-clusters";
import {
  createMockActivityExtractionProvider,
  runActivityExtraction,
} from "@/server/memory/extraction";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  createMemoryTestDb,
  createTestForegroundTraceContext,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

const originalMemoryOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
let db: MemoryTestDb | undefined;
let fts: FtsStore | undefined;

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

describe("activity extraction worker", () => {
  it("extracts the graph-DFS visited repair into Episode, Observation, and an open-world L2 candidate", async () => {
    const fixture = await createGraphDfsActivity();
    const provider = createMockActivityExtractionProvider();
    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });

    expect(result).toMatchObject({
      claimed: true,
      receiptStatus: "succeeded",
      changedFactIds: [expect.any(String)],
    });
    const episode = await db!.prisma.memoryEpisode.findFirstOrThrow({
      where: { activityClusterId: fixture.cluster.cluster.id },
    });
    expect(episode.summary).toContain("visited-state omission");
    const observation =
      await db!.prisma.memoryClaimObservation.findFirstOrThrow();
    expect(observation).toMatchObject({
      activityClusterId: fixture.cluster.cluster.id,
      claimType: "weakness",
      polarity: "negative",
      status: "accepted",
      mechanismKeysJson: "[]",
    });
    const fact = await db!.prisma.l2MemoryFact.findUniqueOrThrow({
      where: { id: result.changedFactIds[0] },
    });
    expect(fact).toMatchObject({
      status: "candidate",
      evidenceCount: 1,
      integrityVersion: 2,
      mechanismKeysJson: '["graph"]',
    });
    expect(
      fts!.searchMemoryFts("visited state", {
        kind: "claim_cluster",
        limit: 5,
      }),
    ).toEqual([expect.objectContaining({ refId: `claim_cluster:${fact.id}` })]);
    const receipt = await db!.prisma.memoryExtractionReceipt.findUniqueOrThrow({
      where: { id: result.receiptId },
    });
    expect(receipt.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the receipt claim as a one-provider-call lock across durable concurrent enqueues", async () => {
    const fixture = await createGraphDfsActivity();
    const root = await createTestForegroundTraceContext({
      prisma: db!.prisma,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      path: "chat",
      task: "test.activity_extraction_origin",
      traceRunId: "activity-root",
    });
    const baseProvider = createMockActivityExtractionProvider();
    let providerCalls = 0;
    const provider = {
      name: "counting-provider",
      async extract(...args: Parameters<typeof baseProvider.extract>) {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return baseProvider.extract(...args);
      },
    };
    const scheduled: Array<() => void> = [];
    const scheduledReflections: Array<() => void> = [];
    const scheduledEmbeddings: Array<() => void> = [];
    const enqueueArgs = {
      activityClusterId: fixture.cluster.cluster.id,
      originatingTraceRunId: root.traceRunId,
      provider,
      ftsStore: fts,
    };
    const [first, second] = await Promise.all([
      enqueueActivityExtraction(db!.prisma, enqueueArgs, {
        processInstanceId: "activity-worker",
        traceRunId: "activity-child-1",
        schedule: (task) => scheduled.push(task),
        nestedJobs: {
          reflection: {
            schedule: (task) => scheduledReflections.push(task),
            run: vi.fn(),
          },
          embedBackfill: {
            schedule: (task) => scheduledEmbeddings.push(task),
            run: vi.fn(),
          },
        },
      }),
      enqueueActivityExtraction(db!.prisma, enqueueArgs, {
        processInstanceId: "activity-worker",
        traceRunId: "activity-child-2",
        schedule: (task) => scheduled.push(task),
        nestedJobs: {
          reflection: {
            schedule: (task) => scheduledReflections.push(task),
            run: vi.fn(),
          },
          embedBackfill: {
            schedule: (task) => scheduledEmbeddings.push(task),
            run: vi.fn(),
          },
        },
      }),
    ]);
    expect("id" in first && "id" in second).toBe(true);
    expect(scheduled).toHaveLength(2);
    scheduled.forEach((task) => task());

    await vi.waitFor(
      async () => {
        expect(
          await db!.prisma.backgroundJob.count({
            where: { kind: "activity_extraction", status: "succeeded" },
          }),
        ).toBe(2);
      },
      { timeout: 5_000 },
    );
    expect(providerCalls).toBe(1);
    expect(scheduledReflections).toHaveLength(0);
    expect(scheduledEmbeddings).toHaveLength(1);
    await expect(db!.prisma.memoryExtractionReceipt.count()).resolves.toBe(1);
    await expect(db!.prisma.l2MemoryFact.count()).resolves.toBe(1);
    const nestedJobs = await db!.prisma.backgroundJob.findMany({
      where: { kind: { in: ["reflection", "embed_backfill"] } },
      orderBy: { kind: "asc" },
    });
    expect(nestedJobs.map((job) => job.kind)).toEqual(["embed_backfill"]);
    [...scheduledReflections, ...scheduledEmbeddings].forEach((task) => task());
    await vi.waitFor(async () => {
      expect(
        await db!.prisma.backgroundJob.count({
          where: { status: "succeeded" },
        }),
      ).toBe(3);
    });
    for (const job of nestedJobs) {
      expect(job.originatingTraceRunId).toBe(root.traceRunId);
      const completedJob = await db!.prisma.backgroundJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      const childRun = await db!.prisma.agentTraceRun.findFirstOrThrow({
        where: {
          id: completedJob.traceRunId!,
        },
      });
      expect(childRun.originatingTraceRunId).toBe(root.traceRunId);
      const activityRun = await db!.prisma.agentTraceRun.findUniqueOrThrow({
        where: { id: childRun.parentTraceRunId! },
      });
      expect(activityRun.parentTraceRunId).toBe(root.traceRunId);
      expect(activityRun.originatingTraceRunId).toBe(root.traceRunId);
    }
  });

  it("records no Reflection or embedding intent when extraction has no semantic signal", async () => {
    const fixture = await createAssistantContextActivity();
    const root = await createTestForegroundTraceContext({
      prisma: db!.prisma,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      path: "chat",
      task: "test.no_signal_origin",
      traceRunId: "no-signal-root",
    });
    const scheduled: Array<() => void> = [];
    const nestedScheduled: Array<() => void> = [];
    await enqueueActivityExtraction(
      db!.prisma,
      {
        activityClusterId: fixture.cluster.cluster.id,
        originatingTraceRunId: root.traceRunId,
        provider: createMockActivityExtractionProvider(),
        ftsStore: fts,
      },
      {
        processInstanceId: "no-signal-worker",
        schedule: (task) => scheduled.push(task),
        nestedJobs: {
          reflection: { schedule: (task) => nestedScheduled.push(task) },
          embedBackfill: { schedule: (task) => nestedScheduled.push(task) },
        },
      },
    );
    scheduled.forEach((task) => task());

    await vi.waitFor(
      async () => {
        expect(
          await db!.prisma.backgroundJob.count({
            where: { kind: "activity_extraction", status: "succeeded" },
          }),
        ).toBe(1);
      },
      { timeout: 5_000 },
    );
    await expect(
      db!.prisma.memoryExtractionReceipt.findFirstOrThrow(),
    ).resolves.toMatchObject({ status: "no_semantic_signal" });
    expect(nestedScheduled).toHaveLength(0);
    await expect(
      db!.prisma.backgroundJob.count({
        where: { kind: { in: ["reflection", "embed_backfill"] } },
      }),
    ).resolves.toBe(0);
  });

  it("enqueues Reflection on replay only after the changed claim is trusted", async () => {
    const fixture = await createGraphDfsActivity();
    const extracted = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider: createMockActivityExtractionProvider(),
      ftsStore: fts,
    });
    const factId = extracted.changedFactIds[0]!;
    await db!.prisma.l2MemoryFact.update({
      where: { id: factId },
      data: {
        status: "active",
        ...trustedL2FactFixture({
          mechanism: "open_world_graph_visited",
          humanLabel: "Graph visited-state handling",
          problemIds: [fixture.problem.id, fixture.problem.id],
        }),
      },
    });
    const root = await createTestForegroundTraceContext({
      prisma: db!.prisma,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      path: "chat",
      task: "test.trusted_replay_origin",
      traceRunId: "trusted-replay-root",
    });
    const outer: Array<() => void> = [];
    const reflections: Array<() => void> = [];
    const embeddings: Array<() => void> = [];
    await enqueueActivityExtraction(
      db!.prisma,
      {
        activityClusterId: fixture.cluster.cluster.id,
        originatingTraceRunId: root.traceRunId,
        ftsStore: fts,
      },
      {
        processInstanceId: "trusted-replay-worker",
        schedule: (task) => outer.push(task),
        nestedJobs: {
          reflection: {
            schedule: (task) => reflections.push(task),
            run: vi.fn(),
          },
          embedBackfill: {
            schedule: (task) => embeddings.push(task),
            run: vi.fn(),
          },
        },
      },
    );
    outer.forEach((task) => task());
    await vi.waitFor(() => {
      expect(reflections).toHaveLength(1);
      expect(embeddings).toHaveLength(1);
    });
    await expect(
      db!.prisma.backgroundJob.count({ where: { kind: "reflection" } }),
    ).resolves.toBe(1);
  });

  it("keeps extraction successful and compensates an idempotent nested intent after scheduling fails", async () => {
    const fixture = await createGraphDfsActivity();
    const root = await createTestForegroundTraceContext({
      prisma: db!.prisma,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      chatSessionId: fixture.chatSession.id,
      path: "chat",
      task: "test.nested_compensation_origin",
      traceRunId: "nested-compensation-root",
    });
    const firstOuter: Array<() => void> = [];
    await enqueueActivityExtraction(
      db!.prisma,
      {
        activityClusterId: fixture.cluster.cluster.id,
        originatingTraceRunId: root.traceRunId,
        provider: createMockActivityExtractionProvider(),
        ftsStore: fts,
      },
      {
        processInstanceId: "nested-compensation-worker",
        schedule: (task) => firstOuter.push(task),
        nestedJobs: {
          embedBackfill: {
            schedule: () => {
              throw new Error("nested scheduler unavailable");
            },
            run: vi.fn(),
          },
        },
      },
    );
    firstOuter.forEach((task) => task());
    await vi.waitFor(async () => {
      expect(
        await db!.prisma.backgroundJob.count({
          where: { kind: "activity_extraction", status: "succeeded" },
        }),
      ).toBe(1);
    });
    await expect(
      db!.prisma.memoryExtractionReceipt.findFirstOrThrow(),
    ).resolves.toMatchObject({ status: "succeeded" });
    await expect(
      db!.prisma.backgroundJob.count({ where: { kind: "embed_backfill" } }),
    ).resolves.toBe(1);
    const failureTrace = await db!.prisma.agentTraceEvent.findFirst({
      where: { title: "Downstream intent failed · embed_backfill" },
    });
    expect(failureTrace).not.toBeNull();

    const retryOuter: Array<() => void> = [];
    const recoveredEmbed: Array<() => void> = [];
    await enqueueActivityExtraction(
      db!.prisma,
      {
        activityClusterId: fixture.cluster.cluster.id,
        originatingTraceRunId: root.traceRunId,
        ftsStore: fts,
      },
      {
        processInstanceId: "nested-compensation-worker",
        schedule: (task) => retryOuter.push(task),
        nestedJobs: {
          embedBackfill: {
            schedule: (task) => recoveredEmbed.push(task),
            run: vi.fn(),
          },
        },
      },
    );
    retryOuter.forEach((task) => task());
    await vi.waitFor(() => expect(recoveredEmbed).toHaveLength(1));
    await expect(
      db!.prisma.backgroundJob.count({ where: { kind: "embed_backfill" } }),
    ).resolves.toBe(1);
    await expect(db!.prisma.memoryActivityCluster.count()).resolves.toBe(1);
  });

  it("marks provider failure retryable and succeeds idempotently on retry", async () => {
    const fixture = await createGraphDfsActivity();
    const success = createMockActivityExtractionProvider();
    let calls = 0;
    const provider = {
      name: "retry-provider",
      async extract(...args: Parameters<typeof success.extract>) {
        calls += 1;
        if (calls === 1) throw new Error("temporary provider failure");
        return success.extract(...args);
      },
    };

    await expect(
      runActivityExtraction(db!.prisma, {
        activityClusterId: fixture.cluster.cluster.id,
        provider,
        ftsStore: fts,
      }),
    ).rejects.toThrow("temporary provider failure");
    await expect(
      db!.prisma.memoryExtractionReceipt.findFirstOrThrow(),
    ).resolves.toMatchObject({ status: "failed" });

    const retried = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });
    expect(retried.receiptStatus).toBe("succeeded");
    expect(calls).toBe(2);
    await expect(db!.prisma.memoryEpisode.count()).resolves.toBe(1);
    await expect(db!.prisma.memoryClaimObservation.count()).resolves.toBe(1);

    const replay = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });
    expect(replay.claimed).toBe(false);
    expect(calls).toBe(2);
  });

  it("keeps a valid observation by creating a separate cluster when its proposed relation is rejected", async () => {
    const fixture = await createGraphDfsActivity();
    const existing = await db!.prisma.l2MemoryFact.create({
      data: {
        userId: fixture.user.id,
        factType: "strength",
        tag: "claim_existing_visited_strength",
        label: "Graph DFS visited-state handling is stable.",
        value: "Graph DFS visited-state handling is stable.",
        claimText: "Graph DFS visited-state handling is stable.",
        clusterKey: "claim:v2:existing-visited-strength",
        polarity: "positive",
        scopeJson: JSON.stringify({
          level: "mechanism",
          problemIds: [fixture.problem.id],
          topicHints: ["graph DFS", "visited state"],
        }),
        mechanismKeysJson: "[]",
        integrityVersion: 2,
        status: "candidate",
        source: "memory_agent_claim",
        memoryOrigin: "learner",
      },
    });
    await reconcileLearnerMemoryRetrievalDocuments(db!.prisma, {
      userId: fixture.user.id,
      ftsStore: fts!,
    });
    const provider = createMockActivityExtractionProvider({
      output: {
        episode: {
          title: "Visited-state repair",
          summary:
            "The learner repaired a visited-state omission after using Coach context.",
          outcome: "improved",
          tags: ["graph traversal", "visited state"],
          salience: 0.8,
          evidenceTraceIds: [fixture.userTrace.id],
        },
        observations: [
          {
            claimType: "weakness",
            claimText:
              "Graph DFS visited-state handling was omitted in this activity.",
            polarity: "negative",
            scope: {
              level: "mechanism",
              problemIds: [fixture.problem.id],
              topicHints: ["graph DFS", "visited state"],
            },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds: [fixture.userTrace.id],
            relationProposal: {
              targetFactId: existing.id,
              relation: "equivalent",
              modelConfidence: 0.95,
              rationale: "The wording is close enough to inspect.",
            },
          },
        ],
        coverage: {
          status: "complete",
          ignoredEvidence: [
            {
              evidenceTraceId: fixture.runTrace.id,
              reason: "not_relevant_to_learning",
            },
          ],
        },
      },
    });

    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });

    expect(result.relationFallbacks).toEqual([
      expect.objectContaining({
        reason: "claim_relation_polarity_mismatch",
      }),
    ]);
    expect(result.changedFactIds).toHaveLength(1);
    expect(result.changedFactIds).not.toContain(existing.id);
    await expect(db!.prisma.l2MemoryFact.count()).resolves.toBe(2);
    await expect(
      db!.prisma.memoryClaimRelation.findFirstOrThrow(),
    ).resolves.toMatchObject({
      targetClusterFactId: existing.id,
      relation: "equivalent",
      status: "rejected",
      guardReason: "claim_relation_polarity_mismatch",
    });
  });

  it("persists valid observations and marks the receipt partial when one observation is invalid", async () => {
    const fixture = await createGraphDfsActivity();
    const provider = createMockActivityExtractionProvider({
      output: {
        episode: {
          title: "Partial extraction",
          summary: "One valid observation and one invalid observation.",
          outcome: "improved",
          tags: [],
          salience: 0.5,
          evidenceTraceIds: [fixture.userTrace.id],
        },
        observations: [
          {
            claimType: "mistake",
            claimText: "The learner omitted the visited set before the repair.",
            polarity: "negative",
            scope: { level: "mechanism", problemIds: [], topicHints: [] },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds: [fixture.userTrace.id],
          },
          {
            claimType: "not_a_real_claim_type",
            claimText: "invalid",
            polarity: "negative",
            scope: { level: "mechanism", problemIds: [], topicHints: [] },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds: [fixture.userTrace.id],
          },
        ],
        coverage: { status: "complete" },
      },
    });

    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts!,
    });

    expect(result.receiptStatus).toBe("partial");
    expect(result.observationIds).toHaveLength(1);
    expect(result.rejectedObservations).toHaveLength(1);
    await expect(
      db!.prisma.memoryExtractionReceipt.findUniqueOrThrow({
        where: { id: result.receiptId },
      }),
    ).resolves.toMatchObject({ status: "partial" });
    await expect(
      db!.prisma.l1MemoryEvent.count({
        where: {
          eventType: "fact_rejected",
          source: "memory_agent:extract_activity",
        },
      }),
    ).resolves.toBe(1);
  });

  it("keeps and indexes the Episode when every L2 semantic guard rejects the model observations", async () => {
    const fixture = await createGraphDfsActivity();
    const provider = createMockActivityExtractionProvider({
      output: {
        episode: {
          title: "Rejected L2 proposal learning episode",
          summary: "The learner discussed a prior graph-DFS mistake.",
          outcome: "informational",
          tags: ["graph"],
          salience: 0.45,
          evidenceTraceIds: [fixture.userTrace.id],
        },
        observations: [
          {
            claimType: "mistake",
            claimText:
              "The learner previously omitted the visited set in graph DFS.",
            polarity: "negative",
            scope: { level: "mechanism", problemIds: [], topicHints: [] },
            mechanismKeys: [],
            evidenceStrength: "observed",
            evidenceTraceIds: [fixture.userTrace.id],
            relationProposal: {
              targetFactId: "not-a-recalled-candidate",
              relation: "equivalent",
            },
          },
        ],
        coverage: { status: "complete" },
      },
    });

    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts!,
    });

    expect(result).toMatchObject({
      receiptStatus: "partial",
      observationIds: [],
      changedFactIds: [],
      rejectedObservations: [
        expect.objectContaining({
          reason: "relation_target_not_supplied:not-a-recalled-candidate",
        }),
      ],
    });
    const episode = await db!.prisma.memoryEpisode.findFirstOrThrow({
      where: { activityClusterId: fixture.cluster.cluster.id },
    });
    expect(episode).toMatchObject({
      retrievalTextVersion: 1,
      retrievalText: expect.stringContaining("graph-DFS"),
    });
    expect(
      fts!.searchMemoryFts("graph DFS revisit", {
        kind: "episode",
        limit: 5,
      }),
    ).toEqual([expect.objectContaining({ refId: episode.id })]);
    await expect(db!.prisma.memoryClaimObservation.count()).resolves.toBe(0);
  });

  it("records assistant-only/no-signal coverage without Episode or L2", async () => {
    const fixture = await createAssistantContextActivity();
    const provider = createMockActivityExtractionProvider();
    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });

    expect(result).toMatchObject({
      receiptStatus: "no_semantic_signal",
      observationIds: [],
      changedFactIds: [],
    });
    await expect(db!.prisma.memoryEpisode.count()).resolves.toBe(0);
    await expect(db!.prisma.l2MemoryFact.count()).resolves.toBe(0);
    const receipt = await db!.prisma.memoryExtractionReceipt.findFirstOrThrow();
    expect(receipt.noSemanticReason).toContain(
      "No learner-authored semantic signal",
    );
    expect(receipt.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not call the provider for a non-learner cluster", async () => {
    const fixture = await createAssistantContextActivity("development");
    const provider = createMockActivityExtractionProvider();
    const spy = vi.spyOn(provider, "extract");
    const result = await runActivityExtraction(db!.prisma, {
      activityClusterId: fixture.cluster.cluster.id,
      provider,
      ftsStore: fts,
    });

    expect(result).toMatchObject({
      claimed: false,
      receiptStatus: "policy_rejected",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

async function createGraphDfsActivity() {
  db = await createMemoryTestDb();
  fts = createFtsStore(db.dbPath);
  const base = await seedMinimalUserAndProblem(db.prisma);
  const userMessage = await db.prisma.chatMessage.create({
    data: {
      sessionId: base.chatSession.id,
      role: "user",
      contentMarkdown:
        "My graph DFS failed again. I forgot to mark visited before exploring neighbours.",
      sequence: 1,
      memoryOrigin: "learner",
    },
  });
  await db.prisma.chatMessage.create({
    data: {
      sessionId: base.chatSession.id,
      role: "assistant",
      contentMarkdown: "Check the visited-state invariant before recursion.",
      sequence: 2,
      memoryOrigin: "learner",
    },
  });
  const userTrace = await db.prisma.l1MemoryEvent.create({
    data: {
      userId: base.user.id,
      problemId: base.problem.id,
      chatSessionId: base.chatSession.id,
      eventType: "chat_user_message",
      content: userMessage.contentMarkdown,
      memoryOrigin: "learner",
    },
  });
  const runTrace = await db.prisma.l1MemoryEvent.create({
    data: {
      userId: base.user.id,
      problemId: base.problem.id,
      chatSessionId: base.chatSession.id,
      eventType: "run_evidence",
      content:
        "The changed revision passed visible tests after the visited repair.",
      eventJson: JSON.stringify({
        status: "passed_visible_tests",
        executionFingerprint: "graph-dfs-revision-2",
      }),
      memoryOrigin: "learner",
    },
  });
  const cluster = await sealChatOnlyActivityCluster(db.prisma, {
    chatSessionId: base.chatSession.id,
    startMessageSequence: 1,
    endMessageSequence: 2,
    boundaryReason: "explicit_exit",
    additionalSourceItems: [
      { sourceType: "l1_event", sourceId: userTrace.id, evidenceRole: "trace" },
      { sourceType: "l1_event", sourceId: runTrace.id, evidenceRole: "trace" },
    ],
  });
  return { ...base, cluster, userTrace, runTrace };
}

async function createAssistantContextActivity(
  memoryOrigin: "learner" | "development" = "learner",
) {
  db = await createMemoryTestDb();
  fts = createFtsStore(db.dbPath);
  const user = await db.prisma.user.create({
    data: { handle: "context-user" },
  });
  const problem = await db.prisma.problem.create({
    data: {
      slug: "context-problem",
      title: "Context Problem",
      methodName: "solve",
    },
  });
  const chatSession = await db.prisma.chatSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      memoryOrigin,
    },
  });
  await db.prisma.chatMessage.createMany({
    data: [
      {
        sessionId: chatSession.id,
        role: "user",
        contentMarkdown: "ok",
        sequence: 1,
        memoryOrigin,
      },
      {
        sessionId: chatSession.id,
        role: "assistant",
        contentMarkdown: "The remote Review provider is unavailable.",
        sequence: 2,
        memoryOrigin,
      },
    ],
  });
  const assistantTrace = await db.prisma.l1MemoryEvent.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      eventType: "chat_reply",
      content: "The remote Review provider is unavailable.",
      memoryOrigin,
    },
  });
  const cluster = await sealChatOnlyActivityCluster(db.prisma, {
    chatSessionId: chatSession.id,
    startMessageSequence: 1,
    endMessageSequence: 2,
    boundaryReason: "explicit_exit",
    additionalSourceItems: [
      {
        sourceType: "l1_event",
        sourceId: assistantTrace.id,
        evidenceRole: "trace",
      },
    ],
  });
  return { user, problem, chatSession, cluster };
}

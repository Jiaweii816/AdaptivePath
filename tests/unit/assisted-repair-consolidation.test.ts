import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";
import {
  runAssistedRepairConsolidation,
} from "@/server/memory/consolidation/consolidate-assisted-repair";
import type { AssistedRepairConsolidationProvider } from "@/server/memory/consolidation/assisted-repair-provider";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import { createFtsStore, type FtsStore } from "@/server/memory/store/fts-store";
import {
  enqueueAssistedRepairConsolidation,
  type EnqueueAssistedRepairConsolidationOptions,
} from "@/server/jobs/enqueue-assisted-repair-consolidation";
import {
  createMemoryTestDb,
  createTestForegroundTraceContext,
  TEST_LEARNER_MEMORY_ORIGIN,
  type MemoryTestDb,
} from "./memory-test-helpers";

const priorOrigin = process.env.PATTERNCOACH_MEMORY_ORIGIN;
let databases: MemoryTestDb[] = [];
let ftsStores: FtsStore[] = [];

afterEach(async () => {
  ftsStores.forEach((store) => store.close());
  await Promise.all(databases.map((database) => database.cleanup()));
  databases = [];
  ftsStores = [];
  if (priorOrigin === undefined) delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  else process.env.PATTERNCOACH_MEMORY_ORIGIN = priorOrigin;
});

function attributedProvider(
  proposal = "binary search interval invariant",
): AssistedRepairConsolidationProvider {
  return {
    name: "assisted-repair-test",
    consolidate: vi.fn(async () => ({
      mistakeSummary:
        "The learner discarded the half that could still contain the target after comparing the midpoint.",
      coachGuidance:
        "The Coach asked the learner to state which interval still contains every possible answer before moving a boundary.",
      repairSummary:
        "The learner changed the boundary update and the later Review passed the selected visible cases.",
      attribution: {
        status: "attributed" as const,
        canonicalMechanismProposal: proposal,
        rationale: "The changed boundary update directly repaired the observed failure.",
      },
    })),
  };
}

const unsupportedAttributionProvider: AssistedRepairConsolidationProvider = {
  name: "assisted-repair-unsupported-attribution-test",
  consolidate: vi.fn(async () => ({
    mistakeSummary:
      "The failed revision returned a different value for one selected visible case.",
    coachGuidance:
      "The Coach suggested checking the state before and after the failing branch.",
    repairSummary:
      "A later changed revision passed the selected visible cases.",
    attribution: {
      status: "attributed" as const,
      canonicalMechanismProposal: "mysterious branch shape",
      rationale: "The provider proposed a label outside the controlled taxonomy.",
    },
  })),
};

describe("assisted repair consolidation", () => {
  it("writes one resolved human-readable episode and is idempotent by repair key", async () => {
    const fixture = await seedVerifiedChain({ suffix: "one" });
    const provider = attributedProvider();

    const first = await runAssistedRepairConsolidation(fixture.prisma, {
      chainEventId: fixture.chainEventId,
      provider,
      ftsStore: fixture.ftsStore,
    });
    const replay = await runAssistedRepairConsolidation(fixture.prisma, {
      chainEventId: fixture.chainEventId,
      provider,
      ftsStore: fixture.ftsStore,
    });

    expect(first.idempotentReplay).toBe(false);
    expect(replay).toMatchObject({
      episodeId: first.episodeId,
      repairKey: first.repairKey,
      idempotentReplay: true,
    });
    expect(provider.consolidate).toHaveBeenCalledTimes(1);
    const episodes = await fixture.prisma.memoryEpisode.findMany();
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      id: first.episodeId,
      kind: "assisted_repair",
      outcome: "resolved",
      memoryOrigin: "learner",
    });
    expect(episodes[0]!.summary).toContain("What went wrong:");
    expect(episodes[0]!.summary).toContain("Coach guidance:");
    expect(episodes[0]!.summary).toContain("Later result:");
    expect(JSON.parse(episodes[0]!.sourceTraceIds)).toContain(
      fixture.chainEventId,
    );
    expect(JSON.parse(episodes[0]!.tags)).toContain(
      "binary_search_invariant",
    );
    expect(
      fixture.ftsStore.searchMemoryFts("Coach guidance", {
        kind: "episode",
        limit: 5,
      })[0]?.refId,
    ).toBe(first.episodeId);
  });

  it("keeps one problem's canonical weakness pending and non-consumable", async () => {
    const fixture = await seedVerifiedChain({ suffix: "pending" });
    await runAssistedRepairConsolidation(fixture.prisma, {
      chainEventId: fixture.chainEventId,
      provider: attributedProvider(),
      ftsStore: fixture.ftsStore,
    });

    const fact = await fixture.prisma.l2MemoryFact.findFirstOrThrow();
    expect(fact).toMatchObject({
      factType: "weakness",
      tag: "binary_search_invariant",
      status: "candidate",
      evidenceCount: 1,
      source: "chat_consolidation",
    });
    expect(JSON.parse(fact.validationJson).integrity.promotionStatus).toBe(
      "pending",
    );
  });

  it("rejects a bare Practice milestone as weakness evidence", async () => {
    const fixture = await seedVerifiedChain({ suffix: "bare" });
    const milestone = await fixture.prisma.l1MemoryEvent.create({
      data: {
        userId: fixture.userId,
        problemId: fixture.problemId,
        eventType: "practice_run_milestone",
        source: "practice_run",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          practiceRunLogIds: [fixture.practiceRunId],
          eligibleForL2: false,
        }),
      },
    });
    const result = await arbitrateFactCandidates(fixture.prisma, {
      userId: fixture.userId,
      problemId: fixture.problemId,
      source: "chat_consolidation",
      candidates: [weaknessCandidate(milestone.id)],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("assistant_only_evidence");
  });

  it("rejects a forged chain whose assistant lineage is not revision-aligned", async () => {
    const fixture = await seedVerifiedChain({ suffix: "forged" });
    const assistant = await fixture.prisma.chatMessage.findFirstOrThrow({
      where: { sessionId: fixture.chatSessionId, role: "assistant" },
    });
    const metadata = JSON.parse(assistant.metadataJson);
    metadata.workspace.currentExecutionFingerprint = "execfp:v1:forged";
    await fixture.prisma.chatMessage.update({
      where: { id: assistant.id },
      data: { metadataJson: JSON.stringify(metadata) },
    });

    await expect(
      runAssistedRepairConsolidation(fixture.prisma, {
        chainEventId: fixture.chainEventId,
        provider: attributedProvider(),
        ftsStore: fixture.ftsStore,
      }),
    ).rejects.toThrow("invalid_assisted_repair_chain");
    expect(await fixture.prisma.memoryEpisode.count()).toBe(0);
    expect(await fixture.prisma.l2MemoryFact.count()).toBe(0);
  });

  it("promotes the same canonical mechanism only after a second problem", async () => {
    const database = await newDatabase();
    const user = await database.prisma.user.create({
      data: { handle: "repair-cross-problem" },
    });
    const first = await seedVerifiedChain({
      suffix: "cross-a",
      database,
      userId: user.id,
      problemSlug: "binary-search-a",
    });
    const second = await seedVerifiedChain({
      suffix: "cross-b",
      database,
      userId: user.id,
      problemSlug: "binary-search-b",
    });

    await runAssistedRepairConsolidation(database.prisma, {
      chainEventId: first.chainEventId,
      provider: attributedProvider(),
      ftsStore: first.ftsStore,
    });
    let fact = await database.prisma.l2MemoryFact.findFirstOrThrow();
    expect(fact.status).toBe("candidate");
    await runAssistedRepairConsolidation(database.prisma, {
      chainEventId: second.chainEventId,
      provider: attributedProvider(),
      ftsStore: second.ftsStore,
    });
    fact = await database.prisma.l2MemoryFact.findFirstOrThrow();
    expect(fact).toMatchObject({ status: "active", evidenceCount: 2 });
    expect(JSON.parse(fact.validationJson).integrity.promotionStatus).toBe(
      "trusted",
    );
  });

  it("keeps the episode but emits no L2 candidate when attribution cannot canonicalize", async () => {
    const fixture = await seedVerifiedChain({ suffix: "uncertain" });
    const result = await runAssistedRepairConsolidation(fixture.prisma, {
      chainEventId: fixture.chainEventId,
      provider: unsupportedAttributionProvider,
      ftsStore: fixture.ftsStore,
    });

    expect(result).toMatchObject({
      attributionStatus: "attributed",
      acceptedFactIds: [],
      rejectedFactCount: 0,
    });
    expect(await fixture.prisma.memoryEpisode.count()).toBe(1);
    expect(await fixture.prisma.l2MemoryFact.count()).toBe(0);
  });

  it("durably records and dispatches the assisted repair background job", async () => {
    const database = await newDatabase();
    const user = await database.prisma.user.create({
      data: { handle: "repair-dispatch" },
    });
    const problem = await database.prisma.problem.create({
      data: {
        slug: "repair-dispatch",
        title: "Repair Dispatch",
        methodName: "solve",
        tags: "[]",
      },
    });
    const session = await database.prisma.chatSession.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        memoryOrigin: "learner",
      },
    });
    const root = await createTestForegroundTraceContext({
      prisma: database.prisma,
      userId: user.id,
      problemId: problem.id,
      chatSessionId: session.id,
      path: "review",
      task: "coach.review",
      traceRunId: "assisted-repair-root",
    });
    let scheduled: (() => void) | undefined;
    let dispatched:
      | Parameters<
          NonNullable<EnqueueAssistedRepairConsolidationOptions["run"]>
        >[1]
      | undefined;
    const run: NonNullable<
      EnqueueAssistedRepairConsolidationOptions["run"]
    > = vi.fn(async (_prisma, args) => {
      dispatched = args;
      return { episodeId: "repair-episode" };
    });

    const job = await enqueueAssistedRepairConsolidation(
      database.prisma,
      {
        chainEventId: "chain-to-dispatch",
        originatingTraceRunId: root.traceRunId,
      },
      {
        processInstanceId: "repair-test-process",
        traceRunId: "assisted-repair-child",
        schedule(task) {
          scheduled = task;
        },
        run,
      },
    );
    if (!("id" in job)) throw new Error("Expected a durable background job.");
    expect(job).toMatchObject({
      kind: "assisted_repair_consolidation",
      status: "pending",
    });
    scheduled?.();
    await vi.waitFor(async () => {
      expect(
        await database.prisma.backgroundJob.findUniqueOrThrow({
          where: { id: job.id },
        }),
      ).toMatchObject({ status: "succeeded" });
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(dispatched).toMatchObject({
      chainEventId: "chain-to-dispatch",
      originatingTraceRunId: root.traceRunId,
      traceContext: expect.objectContaining({
        traceRunId: "assisted-repair-child",
      }),
    });
  });
});

async function newDatabase() {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = TEST_LEARNER_MEMORY_ORIGIN;
  const database = await createMemoryTestDb();
  databases.push(database);
  return database;
}

async function seedVerifiedChain(args: {
  suffix: string;
  database?: MemoryTestDb;
  userId?: string;
  problemSlug?: string;
}) {
  const database = args.database ?? (await newDatabase());
  const ftsStore = createFtsStore(database.dbPath);
  ftsStores.push(ftsStore);
  const prisma = database.prisma;
  const userId =
    args.userId ??
    (
      await prisma.user.create({
        data: { handle: `repair-user-${args.suffix}` },
      })
    ).id;
  const problem = await prisma.problem.create({
    data: {
      slug: args.problemSlug ?? `binary-search-${args.suffix}`,
      title: `Binary Search ${args.suffix}`,
      methodName: "search",
      tags: JSON.stringify(["binary_search", "array"]),
    },
  });
  const chatSession = await prisma.chatSession.create({
    data: {
      userId,
      problemId: problem.id,
      title: problem.title,
      memoryOrigin: "learner",
    },
  });
  const failedCode =
    "class Solution:\n    def search(self, nums, target):\n        return -1";
  const passedCode =
    "class Solution:\n    def search(self, nums, target):\n        return nums.index(target) if target in nums else -1";
  const failedCodeHash = hashCodeForRun({ language: "Python", code: failedCode });
  const failedExecutionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: failedCode,
  });
  const passedCodeHash = hashCodeForRun({ language: "Python", code: passedCode });
  const passedExecutionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: passedCode,
  });
  const scope = [`case-${args.suffix}`];
  const failureAt = new Date("2026-07-20T10:00:00.000Z");
  const userAt = new Date("2026-07-20T10:01:00.000Z");
  const assistantAt = new Date("2026-07-20T10:02:00.000Z");
  const reviewAt = new Date("2026-07-20T10:03:00.000Z");
  const chainAt = new Date("2026-07-20T10:04:00.000Z");
  const failedVerdict = verdict("failed", "local_only", "local_hot150");
  const passedVerdict = verdict(
    "passed_visible_tests",
    "local_only",
    "local_hot150",
  );
  const failure = await prisma.practiceRunLog.create({
    data: {
      id: `practice-${args.suffix}`,
      userId,
      problemId: problem.id,
      language: "Python",
      codeSnapshot: failedCode,
      codeHash: failedCodeHash,
      executionFingerprint: failedExecutionFingerprint,
      runOrdinal: 1,
      selectedTestCaseIds: JSON.stringify(scope),
      status: "failed",
      passedCount: 0,
      totalCount: 1,
      summary: "0/1 visible tests passed",
      provider: "local_hot150",
      rawResultJson: JSON.stringify({
        status: "failed",
        passedCount: 0,
        failedCount: 1,
        firstFailedCase: { id: scope[0], expected: "2", actual: "-1" },
        rawResult: { providerUsed: "local_hot150", evidenceVerdict: failedVerdict },
      }),
      createdAt: failureAt,
    },
  });
  const workspace = {
    currentCodeHash: failedCodeHash,
    currentExecutionFingerprint: failedExecutionFingerprint,
    latestAuthoritativeRunEvidenceId: failure.id,
    latestAuthoritativeRunSource: "practice_run",
    latestAuthoritativeRunStatus: "failed",
  };
  const userMessage = await prisma.chatMessage.create({
    data: {
      id: `user-message-${args.suffix}`,
      sessionId: chatSession.id,
      role: "user",
      contentMarkdown: "Why does this return -1 for a present target?",
      metadataJson: JSON.stringify({ type: "chat_user_message", workspace }),
      sequence: 1,
      memoryOrigin: "learner",
      createdAt: userAt,
    },
  });
  const assistantMessage = await prisma.chatMessage.create({
    data: {
      id: `assistant-message-${args.suffix}`,
      sessionId: chatSession.id,
      role: "assistant",
      contentMarkdown:
        "Your current branch discards the interval before checking where the target can remain; preserve the interval invariant first.",
      metadataJson: JSON.stringify({ type: "chat_reply", workspace }),
      sequence: 2,
      memoryOrigin: "learner",
      createdAt: assistantAt,
    },
  });
  const userTrace = await prisma.l1MemoryEvent.create({
    data: {
      id: `user-trace-${args.suffix}`,
      userId,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      eventType: "chat_user_message",
      source: "chat_reply",
      memoryOrigin: "learner",
      content: userMessage.contentMarkdown,
      eventJson: JSON.stringify({ chatMessageId: userMessage.id, workspace }),
      occurredAt: userAt,
    },
  });
  const assistantTrace = await prisma.l1MemoryEvent.create({
    data: {
      id: `assistant-trace-${args.suffix}`,
      userId,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      eventType: "chat_reply",
      source: "chat_reply",
      memoryOrigin: "learner",
      content: assistantMessage.contentMarkdown,
      eventJson: JSON.stringify({ chatMessageId: assistantMessage.id, workspace }),
      occurredAt: assistantAt,
    },
  });
  const review = await prisma.reviewAttempt.create({
    data: {
      id: `review-${args.suffix}`,
      userId,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      language: "Python",
      codeSnapshot: passedCode,
      selectedTestCaseIds: JSON.stringify(scope),
      selectedTestsJson: "[]",
      memoryOrigin: "learner",
      createdAt: reviewAt,
    },
  });
  const passedRun = await prisma.runEvidence.create({
    data: {
      id: `passed-run-${args.suffix}`,
      reviewAttemptId: review.id,
      chatSessionId: chatSession.id,
      source: "review",
      codeHash: passedCodeHash,
      executionFingerprint: passedExecutionFingerprint,
      status: "passed_visible_tests",
      passedCount: 1,
      failedCount: 0,
      rawResultJson: JSON.stringify({
        status: "passed_visible_tests",
        passedCount: 1,
        failedCount: 0,
        rawResult: { providerUsed: "local_hot150", evidenceVerdict: passedVerdict },
      }),
      memoryOrigin: "learner",
      createdAt: reviewAt,
    },
  });
  await prisma.l1MemoryEvent.create({
    data: {
      id: `passed-trace-${args.suffix}`,
      userId,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      reviewAttemptId: review.id,
      eventType: "run_evidence",
      source: "review_pipeline",
      memoryOrigin: "learner",
      eventJson: JSON.stringify({
        runEvidenceId: passedRun.id,
        status: "passed_visible_tests",
        codeHash: passedCodeHash,
        executionFingerprint: passedExecutionFingerprint,
        evidenceVerdict: passedVerdict,
      }),
      occurredAt: reviewAt,
    },
  });
  const repairKey = `repair:v1:${args.suffix.padEnd(64, "a").slice(0, 64)}`;
  const chain = await prisma.l1MemoryEvent.create({
    data: {
      id: `chain-${args.suffix}`,
      userId,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      reviewAttemptId: review.id,
      eventType: "assisted_repair_chain_closed",
      source: "review_pipeline:assisted_repair_matcher",
      memoryOrigin: "learner",
      eventJson: JSON.stringify({
        version: 1,
        repairKey,
        failedPracticeRunLogId: failure.id,
        userChatMessageId: userMessage.id,
        userChatTraceId: userTrace.id,
        assistantChatMessageId: assistantMessage.id,
        assistantChatTraceId: assistantTrace.id,
        passedRunEvidenceId: passedRun.id,
        failedExecutionFingerprint,
        passedExecutionFingerprint,
        failedCodeHash,
        passedCodeHash,
        selectedTestCaseIds: scope,
        evidenceScope: {
          evidenceClass: "local_only",
          providerUsed: "local_hot150",
        },
      }),
      occurredAt: chainAt,
    },
  });

  return {
    prisma,
    userId,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    practiceRunId: failure.id,
    chainEventId: chain.id,
    ftsStore,
  };
}

function verdict(status: string, evidenceClass: string, providerUsed: string) {
  return {
    status,
    evidenceClass,
    providerUsed,
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: status !== "passed_visible_tests",
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: status !== "passed_visible_tests",
    },
  };
}

function weaknessCandidate(evidenceTraceId: string) {
  return {
    factType: "weakness",
    tag: "binary_search_invariant",
    value: "The learner may need more practice preserving the binary-search interval.",
    evidenceKind: "reinforce" as const,
    observedBehavior:
      "The learner discarded an interval that could still contain the target.",
    evidenceTraceIds: [evidenceTraceId],
  };
}

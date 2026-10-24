import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arbitrateFactCandidates } from "@/server/memory/store/fact-store";
import {
  ARBITRATION_DELTAS,
  CONTRADICTED_REBUILD_BASE,
  consolidationOutputSchema,
  factCandidateSchema,
  normalizeMemoryTag,
} from "@/server/memory/memory.types";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";
import { fingerprintCodeForExecution } from "@/server/code/code-hash";

describe("memory domain contracts", () => {
  it("rejects fact candidates without evidence or opcode", () => {
    expect(
      factCandidateSchema.safeParse({
        factType: "weakness",
        tag: "binary_search",
        value: "x",
        evidenceKind: "reinforce",
        observedBehavior: "wrote right=mid-1",
        evidenceTraceIds: [],
      }).success,
    ).toBe(false);
    expect(
      factCandidateSchema.safeParse({
        factType: "weakness",
        tag: "binary_search",
        value: "x",
        evidenceKind: "invent_fact",
        observedBehavior: "x",
        evidenceTraceIds: ["t1"],
      }).success,
    ).toBe(false);
  });

  it("normalizes tags through TAG_ALIASES", () => {
    expect(normalizeMemoryTag("Binary-Search")).toBe("binary_search");
    expect(normalizeMemoryTag("hash map")).toBe("hash_map");
    expect(normalizeMemoryTag("unknown_tag")).toBe("unknown_tag");
  });

  it("exposes arbitration constants", () => {
    expect(ARBITRATION_DELTAS.reinforce).toBeGreaterThan(0);
    expect(CONTRADICTED_REBUILD_BASE).toBe(0.3);
  });

  it("consolidation output defaults optional arrays", () => {
    const parsed = consolidationOutputSchema.parse({
      episodeSummary: {
        title: "t",
        summary: "s",
        outcome: "unresolved",
        tags: ["binary_search"],
        salience: 0.9,
      },
      newRollingSummary: "summary",
    });

    expect(parsed.factCandidates).toEqual([]);
    expect(parsed.strategiesApplied).toEqual([]);
  });
});

let db: MemoryTestDb | undefined;
const ORIGINAL_MEMORY_ORIGIN = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (ORIGINAL_MEMORY_ORIGIN === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = ORIGINAL_MEMORY_ORIGIN;
  }
});

async function setupWithTrace() {
  db = await createMemoryTestDb();
  const seeded = await seedMinimalUserAndProblem(db.prisma);
  const trace = await learnerTrace(
    db.prisma,
    seeded.user.id,
    seeded.problem.id,
    "setup-revision-1",
  );
  const passedTrace = await learnerTrace(
    db.prisma,
    seeded.user.id,
    seeded.problem.id,
    "setup-passed-revision-1",
    { passed: true },
  );

  return { ...seeded, trace, passedTrace, prisma: db.prisma };
}

async function learnerTrace(
  prisma: MemoryTestDb["prisma"],
  userId: string,
  problemId: string,
  key: string,
  options: { passed?: boolean } = {},
) {
  const chatSession =
    (await prisma.chatSession.findFirst({
      where: { userId, problemId, memoryOrigin: "learner" },
    })) ??
    (await prisma.chatSession.create({
      data: {
        userId,
        problemId,
        title: `Evidence ${key}`,
        memoryOrigin: "learner",
      },
    }));
  const codeSnapshot = `revision_marker = ${JSON.stringify(key)}`;
  const reviewAttempt = await prisma.reviewAttempt.create({
    data: {
      userId,
      problemId,
      chatSessionId: chatSession.id,
      language: "Python",
      codeSnapshot,
      memoryOrigin: "learner",
    },
  });
  const executionFingerprint = fingerprintCodeForExecution({
    language: "Python",
    code: codeSnapshot,
  });
  const status = options.passed ? "passed_visible_tests" : "failed";
  const evidenceVerdict = verifiedEvidenceVerdict(status);
  const storedRun = await prisma.runEvidence.create({
    data: {
      reviewAttemptId: reviewAttempt.id,
      chatSessionId: chatSession.id,
      source: "review",
      executionFingerprint,
      status,
      rawResultJson: JSON.stringify({ evidenceVerdict }),
      memoryOrigin: "learner",
    },
  });
  return prisma.l1MemoryEvent.create({
    data: {
      userId,
      problemId,
      chatSessionId: chatSession.id,
      reviewAttemptId: reviewAttempt.id,
      eventType: "run_evidence",
      source: "review_pipeline",
      memoryOrigin: "learner",
      eventJson: JSON.stringify({
        runEvidenceId: storedRun.id,
        status,
        executionFingerprint,
        evidenceVerdict,
      }),
    },
  });
}

async function createIndependentProblem(
  prisma: MemoryTestDb["prisma"],
  suffix: string,
) {
  return prisma.problem.create({
    data: {
      slug: `independent-${suffix}`,
      title: `Independent ${suffix}`,
      methodName: "solve",
      tags: JSON.stringify(["binary_search"]),
    },
  });
}

function candidate(overrides: Record<string, unknown>) {
  return {
    factType: "weakness",
    tag: "binary_search_boundary",
    value: "right boundary off by one",
    evidenceKind: "reinforce",
    observedBehavior: "wrote right = mid - 1",
    evidenceTraceIds: ["replace-me"],
    ...overrides,
  };
}

function mistakeWritableVerdict() {
  return { capabilities: { canWriteMistakeMemory: true } };
}

function verifiedEvidenceVerdict(status: "failed" | "passed_visible_tests") {
  const failed = status === "failed";
  return {
    evidenceClass: "verdict_bearing",
    status,
    providerUsed: "leetcode",
    capabilities: {
      canVerdict: true,
      canWriteMistakeMemory: failed,
      canWriteEpisode: true,
      canSignalPlanner: true,
      canUseFailureSalience: failed,
    },
  };
}

describe("arbitrateFactCandidates", () => {
  it("rejects learner-looking evidence when the current process origin is not learner", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe("ineligible_process_origin:test");
  });

  it("does not strengthen a fact when the same evidence cluster is replayed", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    const first = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    expect(first.updated).toHaveLength(1);
    expect(first.updated[0]?.confidence).toBe(0.5);

    const second = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    expect(second.updated).toHaveLength(0);
    expect(second.rejected[0]?.reason).toContain("duplicate_evidence_cluster");
    const stored = await prisma.l2MemoryFact.findFirstOrThrow();
    expect(stored.confidence).toBe(0.5);
    expect(stored.evidenceCount).toBe(1);
  });

  it("weaken requires an existing fact and two consecutive weakens flip weakness to improving", async () => {
    const { prisma, user, problem, trace } = await setupWithTrace();
    const independentProblem = await createIndependentProblem(
      prisma,
      "promotion-before-weaken",
    );
    const missing = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({ evidenceKind: "weaken", evidenceTraceIds: [trace.id] }),
      ],
    });

    expect(missing.rejected).toHaveLength(1);
    await expect(
      prisma.l1MemoryEvent.count({ where: { eventType: "fact_rejected" } }),
    ).resolves.toBe(1);

    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });
    const promotionTrace = await learnerTrace(
      prisma,
      user.id,
      independentProblem.id,
      "reinforce-before-weaken",
    );
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [promotionTrace.id] })],
    });
    for (let i = 0; i < 2; i += 1) {
      const weakenTrace = await learnerTrace(
        prisma,
        user.id,
        problem.id,
        `weaken-${i}`,
      );
      await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "chat_consolidation",
        candidates: [
          candidate({
            evidenceKind: "weaken",
            evidenceTraceIds: [weakenTrace.id],
          }),
        ],
      });
    }

    const fact = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { tag: "binary_search_invariant" },
    });
    expect(fact.status).toBe("improving");
  });

  it("resolve needs strong evidence, with unresolved_confusion resolving in one step", async () => {
    const { prisma, user, problem, trace, passedTrace } = await setupWithTrace();
    const confusionTrace = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        content: "I still don't understand why this boundary update works?",
        eventJson: JSON.stringify({
          chatMessageId: "explicit-confusion",
          currentCodeHash: "confusion-revision",
        }),
      },
    });
    const initial = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({ evidenceTraceIds: [trace.id] }),
        candidate({
          factType: "unresolved_confusion",
          evidenceTraceIds: [confusionTrace.id],
        }),
      ],
    });
    expect(initial.rejected).toEqual([]);

    const weakResolve = candidate({
      evidenceKind: "resolve",
      evidenceTraceIds: [passedTrace.id],
    });
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [weakResolve],
    });
    let weakness = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "weakness" },
    });
    expect(weakness.status).toBe("improving");

    const secondPassedTrace = await learnerTrace(
      prisma,
      user.id,
      problem.id,
      "second-passed-revision",
      { passed: true },
    );
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          evidenceKind: "resolve",
          evidenceTraceIds: [secondPassedTrace.id],
        }),
      ],
    });
    weakness = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "weakness" },
    });
    expect(weakness.status).toBe("resolved");

    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          factType: "unresolved_confusion",
          evidenceKind: "resolve",
          evidenceTraceIds: [passedTrace.id],
        }),
      ],
    });
    const confusion = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "unresolved_confusion" },
    });
    expect(confusion.status).toBe("resolved");
  });

  it("resolve without passed run evidence is rejected", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({ evidenceKind: "resolve", evidenceTraceIds: [trace.id] }),
      ],
    });

    expect(result.rejected[0]?.reason).toContain("strong evidence");
  });

  it("contradict marks the existing row and reinforce rebuilds from the low base", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    const independentProblem = await createIndependentProblem(
      prisma,
      "rebuild-after-contradiction",
    );
    const rebuildTrace = await learnerTrace(
      prisma,
      user.id,
      independentProblem.id,
      "reinforce-after-contradiction",
    );
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [rebuildTrace.id] })],
    });

    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          evidenceKind: "contradict",
          value: "actually handles boundaries fine",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });
    let fact = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { tag: "binary_search_invariant" },
    });
    expect(fact.status).toBe("contradicted");
    expect(fact.contradictionSummary).toContain("actually handles");
    expect(fact.confidence).toBeCloseTo(0.25, 5);
    await expect(
      prisma.l2MemoryFact.count({ where: { tag: "binary_search_invariant" } }),
    ).resolves.toBe(1);

    const freshProblem = await createIndependentProblem(
      prisma,
      "fresh-rebuild-after-contradiction",
    );
    const freshTrace = await learnerTrace(
      prisma,
      user.id,
      freshProblem.id,
      "fresh-reinforce-after-contradiction",
    );
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [freshTrace.id] })],
    });
    fact = await prisma.l2MemoryFact.findFirstOrThrow({
      where: { tag: "binary_search_invariant" },
    });
    expect(fact.status).toBe("active");
    expect(fact.confidence).toBe(0.3);
  });

  it("normalizes alias tags so duplicates land on one row", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          tag: "Binary-Search-Boundary",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          tag: "binary_search_boundary",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });

    await expect(prisma.l2MemoryFact.count()).resolves.toBe(1);
  });

  it("stores the shared canonical mechanism instead of the model raw tag", async () => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    expect(result.rejected).toEqual([]);
    expect(result.updated[0]).toMatchObject({
      tag: "binary_search_invariant",
      label: "binary-search interval invariant",
    });
    expect(result.updated[0]?.validationJson).toContain(
      '"mechanism":"binary_search_invariant"',
    );
  });

  it("fails closed before L2 when the model raw tag has no canonical mapping", async () => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [
        candidate({
          tag: "invented_llm_label_that_is_not_in_the_taxonomy",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });

    expect(result.updated).toEqual([]);
    expect(result.rejected[0]?.reason).toBe(
      "no_canonical_mechanism_mapping",
    );
    await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
  });

  it("creates a learner-governed row without overwriting legacy forensic data", async () => {
    const { prisma, user, trace } = await setupWithTrace();
    const legacy = await prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        factType: "weakness",
        tag: "binary_search_boundary",
        label: "legacy demo label",
        value: "legacy demo value",
        memoryOrigin: "legacy_unknown",
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });

    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]?.memoryOrigin).toBe("learner");
    await expect(
      prisma.l2MemoryFact.findUniqueOrThrow({ where: { id: legacy.id } }),
    ).resolves.toMatchObject({
      value: "legacy demo value",
      memoryOrigin: "legacy_unknown",
    });
    await expect(prisma.l2MemoryFact.count()).resolves.toBe(2);
  });

  it("rejects candidates whose evidence trace ids do not exist", async () => {
    const { prisma, user } = await setupWithTrace();
    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: ["nonexistent"] })],
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.updated).toHaveLength(0);
  });

  it("reports the run_code ban when a candidate cites RunEvidence.id directly", async () => {
    const { prisma, user, chatSession } = await setupWithTrace();
    const toolRun = await prisma.runEvidence.create({
      data: {
        chatSessionId: chatSession.id,
        source: "chat_current_tool",
        status: "failed",
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [toolRun.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain(
      "ineligible_coach_run_code_evidence",
    );
  });

  it.each([
    "no_search_logic",
    "No Search Logic",
    "hardcoded-return",
    "HARDCODED_RETURN",
  ])("hard-rejects blocked development-noise tag %s", async (tag) => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          tag,
          value: "The learner used a placeholder implementation.",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain(
      "blocked_development_noise_tag",
    );
    await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
  });

  it("rejects code-shape-only facts even when the blocked tag is renamed", async () => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          tag: "missing_merge_logic",
          value: "The current code has not implemented merge logic yet.",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("code_shape_only");
  });

  it("rejects evidence owned by a different learner", async () => {
    const { prisma, user } = await setupWithTrace();
    const otherUser = await prisma.user.create({
      data: { handle: "other-memory-owner" },
    });
    const foreignTrace = await prisma.l1MemoryEvent.create({
      data: {
        userId: otherUser.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: "{}",
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [foreignTrace.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("evidence_owner_mismatch");
  });

  it("rejects assistant-only evidence for a learner fact", async () => {
    const { prisma, user } = await setupWithTrace();
    const assistantTrace = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_reply",
        source: "chat_reply",
        memoryOrigin: "learner",
        content: "You should use a queue here.",
        eventJson: "{}",
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          factType: "preference",
          tag: "code_structure",
          value: "The learner prefers using a queue.",
          evidenceKind: "preference_set",
          evidenceTraceIds: [assistantTrace.id],
        }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("assistant_only_evidence");
  });

  it("rejects an assistant reply that launders Coach run_code output", async () => {
    const { prisma, user } = await setupWithTrace();
    const runDerivedReply = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_reply",
        source: "chat_reply",
        memoryOrigin: "learner",
        content: "The selected case failed, so this is a recurring weakness.",
        eventJson: JSON.stringify({
          evidenceBoundary: {
            containsAdvisoryRunObservations: true,
            consolidationPolicy: "exclude_assistant_content",
          },
          workspace: {
            currentTurnRunObservations: [
              {
                storageSource: "chat_current_tool",
                producer: "assistant_tool",
              },
            ],
          },
        }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "reflection",
      candidates: [candidate({ evidenceTraceIds: [runDerivedReply.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain(
      "ineligible_coach_run_code_evidence",
    );
  });

  it("rejects next-turn learner text that merely echoes a run_code-derived reply", async () => {
    const { prisma, user, chatSession } = await setupWithTrace();
    const replyAt = new Date("2026-07-16T10:00:00.000Z");
    await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        chatSessionId: chatSession.id,
        eventType: "chat_reply",
        source: "chat_reply",
        memoryOrigin: "learner",
        occurredAt: replyAt,
        eventJson: JSON.stringify({
          evidenceBoundary: { containsAdvisoryRunObservations: true },
        }),
      },
    });
    const echo = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        occurredAt: new Date(replyAt.getTime() + 1_000),
        eventJson: JSON.stringify({ chatMessageId: "echo-turn" }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [echo.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain(
      "ineligible_coach_run_code_evidence",
    );
  });

  it("rejects note_memory laundering when run_code ran earlier in the same turn", async () => {
    const { prisma, user, chatSession } = await setupWithTrace();
    const turnAt = new Date("2026-07-16T11:00:00.000Z");
    await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        chatSessionId: chatSession.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        occurredAt: turnAt,
        eventJson: JSON.stringify({ chatMessageId: "note-turn" }),
      },
    });
    await prisma.runEvidence.create({
      data: {
        chatSessionId: chatSession.id,
        source: "chat_current_tool",
        status: "failed",
        createdAt: new Date(turnAt.getTime() + 1_000),
      },
    });
    const note = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        chatSessionId: chatSession.id,
        eventType: "memory_note",
        source: "note_memory_tool",
        memoryOrigin: "learner",
        occurredAt: new Date(turnAt.getTime() + 2_000),
        eventJson: JSON.stringify({ toolName: "note_memory" }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "user_explicit",
      candidates: [
        candidate({
          factType: "preference",
          tag: "explanation_style",
          value: "The learner prefers short, concrete explanations.",
          evidenceKind: "preference_set",
          evidenceTraceIds: [note.id],
        }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain(
      "ineligible_coach_run_code_evidence",
    );
  });

  it("accepts a clean user-explicit preference from note_memory", async () => {
    const { prisma, user, chatSession } = await setupWithTrace();
    const note = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        chatSessionId: chatSession.id,
        eventType: "memory_note",
        source: "note_memory_tool",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ toolName: "note_memory" }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "user_explicit",
      candidates: [
        candidate({
          factType: "preference",
          tag: "explanation_style",
          value: "The learner prefers short, concrete explanations.",
          evidenceKind: "preference_set",
          evidenceTraceIds: [note.id],
        }),
      ],
    });

    expect(result.rejected).toHaveLength(0);
    expect(result.updated[0]).toMatchObject({
      factType: "preference",
      status: "active",
      memoryOrigin: "learner",
    });
  });

  it("keeps same-problem hash changes pending and promotes only after cross-problem recurrence", async () => {
    const { prisma, user, problem, trace } = await setupWithTrace();
    const secondTrace = await learnerTrace(
      prisma,
      user.id,
      problem.id,
      "independent-revision-2",
    );

    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [trace.id] })],
    });
    let stored = await prisma.l2MemoryFact.findFirstOrThrow();
    expect(stored.status).toBe("candidate");
    expect(stored.evidenceCount).toBe(1);

    const sameProblemReplay = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [secondTrace.id] })],
    });
    stored = await prisma.l2MemoryFact.findFirstOrThrow();
    expect(stored.status).toBe("candidate");
    expect(stored.evidenceCount).toBe(1);
    expect(sameProblemReplay.rejected[0]?.reason).toBe(
      "duplicate_evidence_cluster",
    );

    const independentProblem = await createIndependentProblem(
      prisma,
      "cross-problem-recurrence",
    );
    const crossProblemTrace = await learnerTrace(
      prisma,
      user.id,
      independentProblem.id,
      "independent-revision-3",
    );
    await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [crossProblemTrace.id] })],
    });
    stored = await prisma.l2MemoryFact.findFirstOrThrow();
    expect(stored.status).toBe("active");
    expect(stored.evidenceCount).toBe(2);
  });

  it("never treats bare cross-problem chat turns as mistake evidence", async () => {
    const { prisma, user, problem } = await setupWithTrace();
    const secondProblem = await createIndependentProblem(
      prisma,
      "bare-chat-does-not-prove-weakness",
    );
    const turns = await Promise.all(
      [problem.id, secondProblem.id].map((problemId, index) =>
        prisma.l1MemoryEvent.create({
          data: {
            userId: user.id,
            problemId,
            eventType: "chat_user_message",
            memoryOrigin: "learner",
            eventJson: JSON.stringify({
              currentCodeHash: `empty-workspace-turn-${index}`,
            }),
          },
        }),
      ),
    );

    for (const turn of turns) {
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "chat_consolidation",
        candidates: [candidate({ evidenceTraceIds: [turn.id] })],
      });
      expect(result.updated).toHaveLength(0);
      expect(result.rejected[0]?.reason).toBe(
        "mistake_or_weakness_requires_failed_review_evidence",
      );
    }
    await expect(prisma.l2MemoryFact.count()).resolves.toBe(0);
  });

  it("rejects a binary-search mechanism hallucinated from a DP source problem", async () => {
    const { prisma, user } = await setupWithTrace();
    const dpProblem = await prisma.problem.create({
      data: {
        slug: "interleaving-string-dp",
        title: "Interleaving String",
        methodName: "isInterleave",
        tags: JSON.stringify(["dynamic-programming", "string"]),
      },
    });
    const failedDpReview = await learnerTrace(
      prisma,
      user.id,
      dpProblem.id,
      "dp-failed-review",
    );

    for (const tag of [
      "binary_search_boundary",
      "invented_binary_search_boundary_dynamic_programming_state_unicorn",
    ]) {
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "review_diagnosis",
        candidates: [
          candidate({ tag, evidenceTraceIds: [failedDpReview.id] }),
        ],
      });

      expect(result.updated).toHaveLength(0);
      expect(result.rejected[0]?.reason).toMatch(
        /^(?:incompatible_problem_mechanism|no_canonical_mechanism_mapping)$/,
      );
    }
  });

  it("rejects a topic-only or invented tag even on a matching source problem", async () => {
    const { prisma, user, trace } = await setupWithTrace();

    for (const tag of ["binary_search", "binary_search_totally_fake"]) {
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "review_diagnosis",
        candidates: [candidate({ tag, evidenceTraceIds: [trace.id] })],
      });
      expect(result.updated).toHaveLength(0);
      expect(result.rejected[0]?.reason).toBe(
        "no_canonical_mechanism_mapping",
      );
    }
  });

  it("does not promote weakness from generic turns without a code revision", async () => {
    const { prisma, user } = await setupWithTrace();
    const genericTurn = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        content: "I am thinking about the boundary.",
        eventJson: JSON.stringify({ chatMessageId: "generic-turn" }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [genericTurn.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      "mistake_or_weakness_requires_failed_review_evidence",
    );
  });

  it("rejects failed review evidence that is not bound to a source problem", async () => {
    const { prisma, user } = await setupWithTrace();
    const unboundRevision = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "run_evidence",
        source: "review_pipeline",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          status: "failed",
          executionFingerprint: "unbound-revision",
          evidenceVerdict: mistakeWritableVerdict(),
        }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ evidenceTraceIds: [unboundRevision.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      "mistake_or_weakness_requires_failed_review_evidence",
    );
  });

  it("rejects fabricated passed statuses and relationally mismatched run evidence", async () => {
    const { prisma, user, problem, passedTrace } = await setupWithTrace();
    const strength = candidate({
      factType: "strength",
      tag: "binary_search_invariant_strength",
      value: "Preserves the binary-search invariant while moving the boundaries.",
      observedBehavior:
        "The learner explained the invariant and kept it true in the visible run.",
    });

    for (const status of ["passed_fabricated", "passed_not_a_real_status"]) {
      const fabricated = await prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: problem.id,
          eventType: "run_evidence",
          source: "review_pipeline",
          memoryOrigin: "learner",
          eventJson: JSON.stringify({
            runEvidenceId: `missing-${status}`,
            status,
            executionFingerprint: `forged-${status}`,
            evidenceVerdict: { capabilities: { canVerdict: true } },
          }),
        },
      });
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "review_diagnosis",
        candidates: [{ ...strength, evidenceTraceIds: [fabricated.id] }],
      });
      expect(result.updated).toHaveLength(0);
      expect(result.rejected[0]?.reason).toBe(
        "strength_or_skill_requires_passed_revision_evidence",
      );
    }

    const authenticPayload = JSON.parse(passedTrace.eventJson) as {
      runEvidenceId: string;
    };
    const mismatched = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: passedTrace.chatSessionId,
        reviewAttemptId: passedTrace.reviewAttemptId,
        eventType: "run_evidence",
        source: "review_pipeline",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          runEvidenceId: authenticPayload.runEvidenceId,
          status: "passed_visible_tests",
          executionFingerprint: "forged-fingerprint",
          evidenceVerdict: { capabilities: { canVerdict: true } },
        }),
      },
    });
    const mismatchResult = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [{ ...strength, evidenceTraceIds: [mismatched.id] }],
    });
    expect(mismatchResult.updated).toHaveLength(0);
    expect(mismatchResult.rejected[0]?.reason).toBe(
      "strength_or_skill_requires_passed_revision_evidence",
    );
  });

  it("rejects Review evidence when L1 and RunEvidence share a fingerprint not derived from the code snapshot", async () => {
    const { prisma, user, problem, chatSession } = await setupWithTrace();
    const codeSnapshot = [
      "class Solution:",
      "    def search(self, nums, target):",
      "        return -1",
    ].join("\n");
    const computedFingerprint = fingerprintCodeForExecution({
      language: "Python",
      code: codeSnapshot,
    });
    const forgedFingerprint = "attacker-controlled-fingerprint";
    expect(forgedFingerprint).not.toBe(computedFingerprint);

    const reviewAttempt = await prisma.reviewAttempt.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        language: "Python",
        codeSnapshot,
        memoryOrigin: "learner",
      },
    });
    const evidenceVerdict = verifiedEvidenceVerdict("failed");
    const storedRun = await prisma.runEvidence.create({
      data: {
        reviewAttemptId: reviewAttempt.id,
        chatSessionId: chatSession.id,
        source: "review",
        executionFingerprint: forgedFingerprint,
        status: "failed",
        rawResultJson: JSON.stringify({ evidenceVerdict }),
        memoryOrigin: "learner",
      },
    });
    const forgedTrace = await prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        chatSessionId: chatSession.id,
        reviewAttemptId: reviewAttempt.id,
        eventType: "run_evidence",
        source: "review_pipeline",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          runEvidenceId: storedRun.id,
          status: "failed",
          executionFingerprint: forgedFingerprint,
          evidenceVerdict,
        }),
      },
    });

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [
        candidate({ evidenceTraceIds: [forgedTrace.id] }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toBe(
      "mistake_or_weakness_requires_failed_review_evidence",
    );
  });

  it("does not turn explicit DP state-machine confusion into binary-search memory", async () => {
    const { prisma, user } = await setupWithTrace();
    const dpProblems = await Promise.all(
      ["interleaving-state", "stock-state-machine"].map((slug) =>
        prisma.problem.create({
          data: {
            slug,
            title: slug,
            methodName: "solve",
            tags: JSON.stringify(["dynamic_programming", "state_machine"]),
          },
        }),
      ),
    );
    const messages = [
      "I still don't understand the DP state transition from left to right.",
      "I am still confused about the right-side DP state transition.",
    ];

    for (const [index, dpProblem] of dpProblems.entries()) {
      const turn = await prisma.l1MemoryEvent.create({
        data: {
          userId: user.id,
          problemId: dpProblem.id,
          eventType: "chat_user_message",
          memoryOrigin: "learner",
          content: messages[index],
          eventJson: JSON.stringify({ chatMessageId: `dp-turn-${index}` }),
        },
      });
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "chat_consolidation",
        candidates: [
          candidate({
            factType: "unresolved_confusion",
            tag: "binary_search",
            value: "Still needs help explaining the DP state transition.",
            observedBehavior:
              "The learner explicitly said the DP transition was still unclear.",
            evidenceTraceIds: [turn.id],
          }),
        ],
      });
      expect(result.updated).toHaveLength(0);
      expect(result.rejected[0]?.reason).toBe(
        "unresolved_confusion_requires_explicit_learner_turn",
      );
    }

    await expect(
      prisma.l2MemoryFact.count({ where: { tag: "binary_search" } }),
    ).resolves.toBe(0);
  });

  it("dedupes cosmetic code changes through the execution fingerprint", async () => {
    const { prisma, user, problem } = await setupWithTrace();
    const events = await Promise.all(
      [1, 2].map(() =>
        learnerTrace(
          prisma,
          user.id,
          problem.id,
          "same-executable-program",
        ),
      ),
    );
    const fact = candidate({
      tag: "binary_search_invariant",
      value: "Moves a boundary without preserving the stated search invariant.",
      observedBehavior:
        "The learner changed formatting but repeated the same invariant break.",
    });

    const first = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [{ ...fact, evidenceTraceIds: [events[0]!.id] }],
    });
    const replay = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [{ ...fact, evidenceTraceIds: [events[1]!.id] }],
    });

    expect(first.updated[0]?.evidenceCount).toBe(1);
    expect(replay.updated).toHaveLength(0);
    expect(replay.rejected[0]?.reason).toBe("duplicate_evidence_cluster");
  });

  it("requires two passed, revision-aligned clusters for an active strength", async () => {
    const { prisma, user, trace, passedTrace } = await setupWithTrace();
    const independentProblem = await createIndependentProblem(
      prisma,
      "strength-recurrence",
    );
    const strength = candidate({
      factType: "strength",
      tag: "binary_search_invariant",
      value: "States the loop invariant before changing boundaries.",
      observedBehavior: "Explained and preserved the invariant in working code.",
    });

    const rejected = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [{ ...strength, evidenceTraceIds: [trace.id] }],
    });
    expect(rejected.rejected[0]?.reason).toBe(
      "strength_or_skill_requires_passed_revision_evidence",
    );

    const first = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [{ ...strength, evidenceTraceIds: [passedTrace.id] }],
    });
    expect(first.updated[0]?.status).toBe("candidate");

    const secondPassed = await learnerTrace(
      prisma,
      user.id,
      independentProblem.id,
      "second-passed-revision",
      { passed: true },
    );
    const second = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "review_diagnosis",
      candidates: [{ ...strength, evidenceTraceIds: [secondPassed.id] }],
    });
    expect(second.updated[0]?.status).toBe("active");
    expect(second.updated[0]?.evidenceCount).toBe(2);
  });

  it("requires explicit confusion in separate learner turns", async () => {
    const { prisma, user, problem, trace } = await setupWithTrace();
    const confusionCandidate = candidate({
      factType: "unresolved_confusion",
      tag: "binary_search_invariant",
      value: "Still needs help explaining why the search boundary update is valid.",
      observedBehavior: "Explicitly said the boundary rule was still unclear.",
    });

    const implicit = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [{ ...confusionCandidate, evidenceTraceIds: [trace.id] }],
    });
    expect(implicit.rejected[0]?.reason).toBe(
      "unresolved_confusion_requires_explicit_learner_turn",
    );

    const turns = await Promise.all(
      [1, 2].map((index) =>
        prisma.l1MemoryEvent.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            eventType: "chat_user_message",
            memoryOrigin: "learner",
            content:
              index === 1
                ? "I still don't understand why this binary-search boundary is valid?"
                : "Why am I still confused about this binary-search boundary?",
            eventJson: JSON.stringify({
              chatMessageId: `confusion-turn-${index}`,
              currentCodeHash: `confusion-revision-${index}`,
            }),
          },
        }),
      ),
    );
    for (const [index, turn] of turns.entries()) {
      const result = await arbitrateFactCandidates(prisma, {
        userId: user.id,
        source: "chat_consolidation",
        candidates: [
          { ...confusionCandidate, evidenceTraceIds: [turn.id] },
        ],
      });
      expect(result.updated[0]?.status).toBe(
        index === 0 ? "candidate" : "active",
      );
    }
  });

  it("rejects a raw internal tag when no human-readable teaching text exists", async () => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [
        candidate({
          tag: "rotated_sorted_array_approach",
          value: "rotated_sorted_array_approach",
          evidenceTraceIds: [trace.id],
        }),
      ],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("missing_human_teaching_text");
  });

  it.each([
    [
      "rotated_sorted_array_approach",
      "The learner prefers rotated_sorted_array_approach",
    ],
    ["search_implementation", "Unimplemented search logic"],
    ["return_choice", "The learner used a hardcoded return"],
    ["ignores_input", "The current revision ignores the input"],
    ["search_implementation", "搜索逻辑尚未实现"],
    ["search_implementation", "搜尋邏輯尚未實現"],
    ["return_choice", "把返回值写死了"],
    ["return_choice", "把返回值寫死了"],
  ])("rejects non-teachable durable wording for %s", async (tag, value) => {
    const { prisma, user, trace } = await setupWithTrace();

    const result = await arbitrateFactCandidates(prisma, {
      userId: user.id,
      source: "chat_consolidation",
      candidates: [candidate({ tag, value, evidenceTraceIds: [trace.id] })],
    });

    expect(result.updated).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(
      /code_shape_only|missing_human_teaching_text/,
    );
  });
});

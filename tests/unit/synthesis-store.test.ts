import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCoachMemoryContext } from "@/server/memory";
import { createFtsStore } from "@/server/memory/store/fts-store";
import { reconcileLearnerMemoryRetrievalDocuments } from "@/server/memory/store/retrieval-document-store";
import {
  listActiveSlots,
  upsertSynthesisSlots,
} from "@/server/memory/store/synthesis-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  trustedL2FactFixture,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;
const ORIGINAL_MEMORY_ORIGIN = process.env.PATTERNCOACH_MEMORY_ORIGIN;

beforeEach(() => {
  process.env.PATTERNCOACH_MEMORY_ORIGIN = "learner";
});

async function seedTrustedFacts(
  prisma: MemoryTestDb["prisma"],
  userId: string,
  count: number,
  factType = "weakness",
) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const problem = await prisma.problem.create({
        data: {
          slug: `synthesis-evidence-${index + 1}`,
          title: `Synthesis Evidence ${index + 1}`,
          methodName: "solve",
          tags: JSON.stringify(["binary-search"]),
        },
      });
      return prisma.l2MemoryFact.create({
        data: {
          userId,
          factType,
          tag: `boundary_invariant_${index + 1}`,
          label: `Boundary invariant evidence ${index + 1}`,
          value: `Observed boundary invariant behavior ${index + 1}`,
          confidence: 0.7,
          status: "active",
          ...trustedL2FactFixture({
            mechanism: `boundary invariant ${index + 1}`,
            humanLabel: `Boundary invariant behavior ${index + 1}`,
            problemIds: [problem.id],
          }),
        },
      });
    }),
  );
}

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
  if (ORIGINAL_MEMORY_ORIGIN === undefined) {
    delete process.env.PATTERNCOACH_MEMORY_ORIGIN;
  } else {
    process.env.PATTERNCOACH_MEMORY_ORIGIN = ORIGINAL_MEMORY_ORIGIN;
  }
});

describe("synthesis-store", () => {
  it("rejects writes when the current process origin is not learner", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const facts = await seedTrustedFacts(db.prisma, user.id, 1);
    process.env.PATTERNCOACH_MEMORY_ORIGIN = "test";

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "must-not-write",
            text: "A valid-looking synthesis must still respect process origin.",
            evidenceFactIds: [facts[0]!.id],
            confidence: 0.8,
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow("Synthesis writes require learner process origin; got test");
    expect(await db.prisma.synthesisSlot.count()).toBe(0);
  });

  it("upserts by (userId, slot, synthesisKey) and lists active slots newest-first", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const facts = await seedTrustedFacts(db.prisma, user.id, 3);

    await upsertSynthesisSlots(db.prisma, {
      userId: user.id,
      upserts: [
        {
          slot: "weakness_patterns",
          synthesisKey: "boundary_invariant",
          text: "Moves pointers before stating the invariant.",
          evidenceFactIds: [facts[0]!.id, facts[1]!.id],
          confidence: 0.6,
          status: "active",
        },
      ],
    });
    await upsertSynthesisSlots(db.prisma, {
      userId: user.id,
      upserts: [
        {
          slot: "weakness_patterns",
          synthesisKey: "boundary_invariant",
          text: "Updated: tends to move pointers before stating the invariant.",
          evidenceFactIds: facts.map((fact) => fact.id),
          confidence: 0.7,
          status: "active",
        },
        {
          slot: "teaching_strategy",
          synthesisKey: "ask_invariant_first",
          text: "Ask for the invariant before showing code.",
          evidenceFactIds: [facts[0]!.id, facts[1]!.id],
          confidence: 0.5,
          status: "resolved",
        },
      ],
    });

    expect(await db.prisma.synthesisSlot.count()).toBe(2);
    const active = await listActiveSlots(db.prisma, {
      userId: user.id,
      take: 10,
    });
    expect(active).toHaveLength(1);
    expect(active[0]?.text).toContain("Updated:");

    const filtered = await listActiveSlots(db.prisma, {
      userId: user.id,
      slots: ["teaching_strategy"],
      take: 10,
    });
    expect(filtered).toHaveLength(0);
  });

  it("rejects fabricated or otherwise unresolvable L2 evidence ids", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "fabricated_evidence",
            text: "Must not be persisted.",
            evidenceFactIds: ["not-a-real-fact-id"],
            confidence: 0.9,
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow("requires two independent trusted cross-problem");
    expect(await db.prisma.synthesisSlot.count()).toBe(0);
  });

  it("rejects a weakness slot whose cited clusters are strength evidence", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const facts = await seedTrustedFacts(db.prisma, user.id, 2, "strength");

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "wrong_polarity",
            text: "The learner repeatedly confuses a boundary invariant.",
            evidenceFactIds: facts.map((fact) => fact.id),
            confidence: 0.8,
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow("requires weakness evidence");
    expect(await db.prisma.synthesisSlot.count()).toBe(0);
  });

  it("accepts cross-problem open-world claims without canonical mechanism keys", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const problems = await Promise.all(
      ["graph-route-a", "graph-route-b"].map((slug, index) =>
        db!.prisma.problem.create({
          data: {
            slug,
            title: `Graph Route ${index + 1}`,
            methodName: "solve",
            tags: JSON.stringify(["graph"]),
          },
        }),
      ),
    );
    const facts = await Promise.all(
      problems.map((problem, index) => {
        const clusterKey = `claim:v1:visited-state-${index + 1}`;
        return db!.prisma.l2MemoryFact.create({
          data: {
            userId: user.id,
            problemId: problem.id,
            factType: "knowledge_state",
            tag: `claim_open_world_${index + 1}`,
            label: "Visited-state handling is not yet automatic during graph traversal.",
            value: "Visited-state handling is not yet automatic during graph traversal.",
            claimText:
              index === 0
                ? "The learner omitted visited marking before exploring neighbors."
                : "The learner recognized the traversal but again needed a cue to guard revisits.",
            polarity: "negative",
            scopeJson: JSON.stringify({
              level: "mechanism",
              problemIds: [problem.id],
              topicHints: ["graph traversal", "visited state"],
            }),
            mechanismKeysJson: "[]",
            integrityVersion: 2,
            clusterKey,
            confidence: 0.62,
            evidenceCount: 1,
            status: "active",
            memoryOrigin: "learner",
            validationJson: JSON.stringify({
              integrity: {
                version: 1,
                origin: "learner",
                subject: "learner_behavior",
                mechanism: clusterKey,
                humanLabel: "Visited-state handling during graph traversal",
                portability: "portable",
                promotionStatus: "trusted",
                evidenceClusters: [
                  {
                    key: `activity-${index + 1}`,
                    problemId: problem.id,
                    reviewAttemptId: null,
                    revisionKey: `revision-${index + 1}`,
                    transition: "reinforce",
                    evidenceTraceIds: [`trace-${index + 1}`],
                  },
                ],
              },
              claimIntegrity: {
                version: 2,
                origin: "learner",
                clusterKey,
                mechanismKeys: [],
              },
            }),
          },
        });
      }),
    );

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "visited-state-habit",
            text: "Across graph problems, revisitation guards still need a deliberate pre-coding check.",
            evidenceFactIds: facts.map((fact) => fact.id),
            confidence: 0.68,
            status: "active",
          },
        ],
      }),
    ).resolves.toHaveLength(1);
  });

  it("rejects an open-world L3 claim backed by only one learning activity", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const [fact] = await seedTrustedFacts(db.prisma, user.id, 1, "knowledge_state");

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "single-activity-visited-state",
            text: "Visited-state handling may still need a deliberate check.",
            evidenceFactIds: [fact!.id],
            confidence: 0.55,
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow("requires two independent trusted cross-problem");
    await expect(db.prisma.synthesisSlot.count()).resolves.toBe(0);
  });

  it("keeps positive and negative evidence out of directional slots while allowing a mixed overview", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const facts = await seedTrustedFacts(db.prisma, user.id, 2, "knowledge_state");
    await db.prisma.l2MemoryFact.update({
      where: { id: facts[0]!.id },
      data: { polarity: "positive" },
    });
    await db.prisma.l2MemoryFact.update({
      where: { id: facts[1]!.id },
      data: { polarity: "negative" },
    });

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "recent_overview",
            synthesisKey: "mixed-recent-learning-overview",
            text: "Recent work shows both an established invariant habit and a separate boundary habit that still needs practice.",
            evidenceFactIds: facts.map((fact) => fact.id),
            confidence: 0.62,
            status: "active",
          },
        ],
      }),
    ).resolves.toHaveLength(1);

    for (const slot of ["strengths", "weakness_patterns"] as const) {
      await expect(
        upsertSynthesisSlots(db.prisma, {
          userId: user.id,
          upserts: [
            {
              slot,
              synthesisKey: `mixed-evidence-${slot}`,
              text: "Directional claims must not blend positive and negative evidence.",
              evidenceFactIds: facts.map((fact) => fact.id),
              confidence: 0.62,
              status: "active",
            },
          ],
        }),
      ).rejects.toThrow(
        slot === "strengths" ? "requires strength evidence" : "requires weakness evidence",
      );
    }
  });

  it("rejects internal snake-case labels before they can reach Coach copy", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const [fact] = await seedTrustedFacts(db.prisma, user.id, 1);

    await expect(
      upsertSynthesisSlots(db.prisma, {
        userId: user.id,
        upserts: [
          {
            slot: "weakness_patterns",
            synthesisKey: "unsafe_internal_label",
            text: "Current focus: rotated_sorted_array_approach.",
            evidenceFactIds: [fact!.id],
            confidence: 0.8,
            status: "active",
          },
        ],
      }),
    ).rejects.toThrow("contains an internal or blocked memory label");
    expect(await db.prisma.synthesisSlot.count()).toBe(0);
  });

  it.each(["hardcoded_return", "no_search_logic"])(
    "rejects blocked development-noise synthesis key %s",
    async (synthesisKey) => {
      db = await createMemoryTestDb();
      const { user } = await seedMinimalUserAndProblem(db.prisma);
      const [fact] = await seedTrustedFacts(db.prisma, user.id, 1);

      await expect(
        upsertSynthesisSlots(db.prisma, {
          userId: user.id,
          upserts: [
            {
              slot: "weakness_patterns",
              synthesisKey,
              text: "Needs to explain the transferable invariant more clearly.",
              evidenceFactIds: [fact!.id],
              confidence: 0.8,
              status: "active",
            },
          ],
        }),
      ).rejects.toThrow("contains an internal or blocked memory label");
      expect(await db.prisma.synthesisSlot.count()).toBe(0);
    },
  );

  it("filters an existing blocked-key slot from trusted reads", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const [fact] = await seedTrustedFacts(db.prisma, user.id, 1);
    await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "hardcoded_return",
        text: "Needs to explain the transferable invariant more clearly.",
        evidenceFactIds: JSON.stringify([fact!.id]),
        confidence: 0.8,
        status: "active",
        memoryOrigin: "learner",
      },
    });

    await expect(
      listActiveSlots(db.prisma, { userId: user.id, take: 10 }),
    ).resolves.toEqual([]);
  });
});

describe("facade reads slots", () => {
  it("normalizes an active teaching slot into a selected human-readable cue", async () => {
    db = await createMemoryTestDb();
    const { user, problem } = await seedMinimalUserAndProblem(db.prisma);
    const facts = await seedTrustedFacts(db.prisma, user.id, 2);
    await upsertSynthesisSlots(db.prisma, {
      userId: user.id,
      upserts: [
        {
          slot: "teaching_strategy",
          synthesisKey: "ask_invariant_first",
          text: "Ask for the invariant before showing code.",
          evidenceFactIds: facts.map((fact) => fact.id),
          confidence: 0.7,
          status: "active",
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
      queryText: "Please explain the invariant first",
      entry: { kind: "chat", intent: "general_followup" },
      profile: {
        strongPatterns: [],
        weakPatterns: [],
        outputPreferences: [],
      },
      currentSignal: { mechanism: "invariant before showing code" },
      ftsStore: fts,
    });

    expect(memory.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "synthesis",
          teachingText: "Ask for the invariant before showing code.",
        }),
      ]),
    );
    expect(memory.brief.teachableMemories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "learning_preference",
          cue: "Ask for the invariant before showing code.",
          learnerSignalBasis: "earned_evidence",
        }),
      ]),
    );
    fts.close();
  });
});

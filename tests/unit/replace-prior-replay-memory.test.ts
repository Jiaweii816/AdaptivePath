import { afterEach, describe, expect, it } from "vitest";
import {
  HISTORICAL_REPLAY_RULE_VERSION,
} from "@/server/memory/replay/historical-review-replay";
import { replacePriorHistoricalReplayMemory } from "@/server/memory/replay/replace-prior-replay-memory";
import {
  createMemoryTestDb,
  type MemoryTestDb,
} from "./memory-test-helpers";

let db: MemoryTestDb | undefined;

afterEach(async () => {
  await db?.cleanup();
  db = undefined;
});

describe("prior historical replay replacement", () => {
  it("removes only earlier replay-derived facts/episodes and stales dependent synthesis", async () => {
    db = await createMemoryTestDb();
    const user = await db.prisma.user.create({
      data: { handle: "PatternCoachReplayReplacementTest" },
    });
    const problem = await db.prisma.problem.create({
      data: {
        slug: "replacement-test",
        title: "Replacement Test",
        methodName: "solve",
        hot150Order: 1,
      },
    });
    const oldTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        eventType: "historical_replay_attestation",
        source: "memory_agent:historical_replay",
        content: "old replay",
        eventJson: JSON.stringify({
          replayRuleVersion: "2026-07-17.v1",
        }),
        memoryOrigin: "learner",
      },
    });
    const currentTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        eventType: "historical_replay_attestation",
        source: "memory_agent:historical_replay",
        content: "current replay",
        eventJson: JSON.stringify({
          replayRuleVersion: HISTORICAL_REPLAY_RULE_VERSION,
          provenanceDecisionFingerprint: "approval-one",
        }),
        memoryOrigin: "learner",
      },
    });
    const oldFact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "mistake",
        tag: "old_replay_fact",
        source: "historical_replay",
        memoryOrigin: "learner",
        evidenceTraceIds: JSON.stringify([oldTrace.id]),
      },
    });
    const currentFact = await db.prisma.l2MemoryFact.create({
      data: {
        userId: user.id,
        problemId: problem.id,
        factType: "strength",
        tag: "current_replay_fact",
        source: "historical_replay",
        memoryOrigin: "learner",
        evidenceTraceIds: JSON.stringify([currentTrace.id]),
      },
    });
    await db.prisma.memoryEpisode.createMany({
      data: [
        {
          id: "historical-replay-old",
          userId: user.id,
          problemId: problem.id,
          kind: "review",
          title: "Old replay",
          summary: "Old replay episode",
          outcome: "failed",
          sourceTraceIds: JSON.stringify([oldTrace.id]),
          memoryOrigin: "learner",
        },
        {
          id: "manual-replay-current",
          userId: user.id,
          problemId: problem.id,
          kind: "review",
          title: "Current replay",
          summary: "Current replay episode",
          outcome: "passed",
          sourceTraceIds: JSON.stringify([currentTrace.id]),
          memoryOrigin: "learner",
        },
      ],
    });
    const slot = await db.prisma.synthesisSlot.create({
      data: {
        userId: user.id,
        slot: "weakness_patterns",
        synthesisKey: "old-pattern",
        text: "Old replay synthesis",
        evidenceFactIds: JSON.stringify([oldFact.id]),
        memoryOrigin: "learner",
      },
    });

    const plan = await replacePriorHistoricalReplayMemory(db.prisma, {
      userId: user.id,
      provenanceDecisionFingerprint: "approval-one",
      apply: true,
    });

    expect(plan).toEqual({
      currentReplayFactsRetained: 1,
      currentReplayEpisodesRetained: 1,
      priorReplayFactsRemoved: 1,
      priorReplayEpisodesRemoved: 1,
      dependentSynthesisSlotsStaled: 1,
    });
    await expect(
      db.prisma.l2MemoryFact.findUnique({ where: { id: oldFact.id } }),
    ).resolves.toBeNull();
    await expect(
      db.prisma.l2MemoryFact.findUnique({ where: { id: currentFact.id } }),
    ).resolves.not.toBeNull();
    await expect(
      db.prisma.memoryEpisode.findUnique({
        where: { id: "historical-replay-old" },
      }),
    ).resolves.toBeNull();
    await expect(
      db.prisma.memoryEpisode.findUnique({
        where: { id: "manual-replay-current" },
      }),
    ).resolves.not.toBeNull();
    await expect(
      db.prisma.synthesisSlot.findUnique({ where: { id: slot.id } }),
    ).resolves.toMatchObject({ status: "stale" });
  });
});

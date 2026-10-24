import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyStrategyObservations,
  computeStrategyObservations,
  decideStrategyTransition,
} from "@/server/memory/procedural/strategy-observer";
import { parseStrategyValidation } from "@/server/memory/memory.types";
import { upsertStrategyCandidate } from "@/server/memory/store/fact-store";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

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

const APPLIED = {
  strategyTag: "invariant_first",
  appliedAssistantMessageId: "assistant-2",
  chatSessionId: "session-1",
  anchorSequence: 2,
};

describe("computeStrategyObservations", () => {
  it("counts learner episodes after an apply without requiring a strategy tag", () => {
    const observations = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [
        {
          tags: ["binary_search", "invariant_first"],
          outcome: "passed",
          chatSessionId: "session-1",
          startSequence: 4,
        },
        {
          tags: ["invariant_first"],
          outcome: "failed",
          chatSessionId: "session-1",
          startSequence: 1,
        },
        {
          tags: ["hash_map"],
          outcome: "failed",
          chatSessionId: "session-1",
          startSequence: 4,
        },
      ],
      signals: [
        {
          tag: "invariant_first",
          polarity: "positive",
          userSelfCorrected: true,
        },
      ],
    });
    const counts = observations.get("invariant_first");
    expect(counts).toEqual({
      applied: 1,
      positive: 2,
      negative: 1,
      deterministicPositive: 1,
    });
  });

  it("counts same-tag failed episodes after an apply as negatives", () => {
    const observations = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [
        {
          tags: ["invariant_first"],
          outcome: "failed",
          chatSessionId: "session-1",
          startSequence: 3,
        },
      ],
      signals: [],
    });
    expect(observations.get("invariant_first")).toEqual({
      applied: 1,
      positive: 0,
      negative: 1,
      deterministicPositive: 0,
    });
  });

  it("counts repeat mistakes and hint escalation by sequence after the applied assistant message", () => {
    const observations = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [],
      repeatMistakeEvidence: [
        {
          tag: "invariant_first",
          chatSessionId: "session-1",
          sequence: 3,
        },
        {
          tag: "invariant_first",
          chatSessionId: "session-1",
          sequence: 1,
        },
      ],
      hintEvents: [
        { chatSessionId: "session-1", sequence: 4, level: 2 },
        { chatSessionId: "session-1", sequence: 1, level: 1 },
      ],
      signals: [],
    });

    expect(observations.get("invariant_first")).toEqual({
      applied: 1,
      positive: 0,
      negative: 2,
      deterministicPositive: 0,
    });
  });

  it("counts repeat mistake reduction as a deterministic positive after later activity", () => {
    const observations = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [
        {
          tags: ["binary_search"],
          outcome: "unresolved",
          chatSessionId: "session-1",
          startSequence: 5,
        },
      ],
      repeatMistakeEvidence: [
        {
          tag: "invariant_first",
          chatSessionId: "session-1",
          sequence: 1,
        },
      ],
      signals: [],
    });

    expect(observations.get("invariant_first")).toEqual({
      applied: 1,
      positive: 1,
      negative: 1,
      deterministicPositive: 1,
    });
  });

  it("treats low hint escalation after an apply as a deterministic positive", () => {
    const observations = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [],
      hintEvents: [{ chatSessionId: "session-1", sequence: 3, level: 1 }],
      signals: [],
    });

    expect(observations.get("invariant_first")).toEqual({
      applied: 1,
      positive: 1,
      negative: 0,
      deterministicPositive: 1,
    });
  });

  it("counts lower or absent hint escalation after prior high hints as deterministic positives", () => {
    const lowerAfter = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [],
      hintEvents: [
        { chatSessionId: "session-1", sequence: 1, level: 3 },
        { chatSessionId: "session-1", sequence: 3, level: 2 },
      ],
      signals: [],
    });
    expect(lowerAfter.get("invariant_first")).toEqual({
      applied: 1,
      positive: 1,
      negative: 0,
      deterministicPositive: 1,
    });

    const absentAfter = computeStrategyObservations({
      appliedEvents: [APPLIED],
      episodesAfter: [
        {
          tags: ["binary_search"],
          outcome: "passed",
          chatSessionId: "session-1",
          startSequence: 5,
        },
      ],
      hintEvents: [{ chatSessionId: "session-1", sequence: 1, level: 3 }],
      signals: [],
    });
    expect(absentAfter.get("invariant_first")).toEqual({
      applied: 1,
      positive: 2,
      negative: 0,
      deterministicPositive: 2,
    });
  });
});

describe("decideStrategyTransition", () => {
  it("validates only with >=2 applies, >=2 positives, positive>negative, >=1 deterministic", () => {
    expect(
      decideStrategyTransition({
        status: "candidate",
        validation: {
          applied: 2,
          positive: 2,
          negative: 0,
          deterministicPositive: 1,
        },
      }),
    ).toBe("validated");
    expect(
      decideStrategyTransition({
        status: "candidate",
        validation: {
          applied: 2,
          positive: 2,
          negative: 0,
          deterministicPositive: 0,
        },
      }),
    ).toBe("candidate");
  });

  it("demotes after 2 applies with zero positives or when negatives catch up", () => {
    expect(
      decideStrategyTransition({
        status: "candidate",
        validation: {
          applied: 2,
          positive: 0,
          negative: 0,
          deterministicPositive: 0,
        },
      }),
    ).toBe("demoted");
    expect(
      decideStrategyTransition({
        status: "validated",
        validation: {
          applied: 3,
          positive: 1,
          negative: 1,
          deterministicPositive: 1,
        },
      }),
    ).toBe("demoted");
  });
});

describe("applyStrategyObservations", () => {
  it("merges counters into validationJson and persists the transition", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const trace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ chatMessageId: "proposal-turn" }),
      },
    });
    await upsertStrategyCandidate(db.prisma, {
      userId: user.id,
      tag: "invariant_first",
      hypothesis: "Asking for the invariant first helps the user self-correct.",
      expectedObservable: "reviewTransition",
      evidenceTraceIds: [trace.id],
    });
    const observationTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ chatMessageId: "observation-turn" }),
      },
    });

    await applyStrategyObservations(db.prisma, {
      userId: user.id,
      evidenceTraceIdsByTag: new Map([
        ["invariant_first", [observationTrace.id]],
      ]),
      observations: new Map([
        [
          "invariant_first",
          {
            applied: 2,
            positive: 2,
            negative: 0,
            deterministicPositive: 1,
          },
        ],
      ]),
    });

    const fact = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "strategy", tag: "invariant_first" },
    });
    expect(fact.status).toBe("validated");
    expect(parseStrategyValidation(fact.validationJson)).toEqual({
      applied: 2,
      positive: 2,
      negative: 0,
      deterministicPositive: 1,
    });

    const laterObservationTrace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({ chatMessageId: "observation-turn-2" }),
      },
    });
    await applyStrategyObservations(db.prisma, {
      userId: user.id,
      evidenceTraceIdsByTag: new Map([
        ["invariant_first", [observationTrace.id, laterObservationTrace.id]],
      ]),
      observations: new Map([
        [
          "invariant_first",
          {
            applied: 2,
            positive: 2,
            negative: 0,
            deterministicPositive: 1,
          },
        ],
      ]),
    });
    const replaySafe = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "strategy", tag: "invariant_first" },
    });
    expect(parseStrategyValidation(replaySafe.validationJson)).toEqual({
      applied: 2,
      positive: 2,
      negative: 0,
      deterministicPositive: 1,
    });
  });

  it("does not mutate strategy state without eligible observation evidence", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const trace = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_user_message",
        memoryOrigin: "learner",
        eventJson: "{}",
      },
    });
    await upsertStrategyCandidate(db.prisma, {
      userId: user.id,
      tag: "invariant_first",
      hypothesis: "Asking for the invariant first helps the user self-correct.",
      expectedObservable: "reviewTransition",
      evidenceTraceIds: [trace.id],
    });

    await applyStrategyObservations(db.prisma, {
      userId: user.id,
      observations: new Map([
        [
          "invariant_first",
          {
            applied: 2,
            positive: 2,
            negative: 0,
            deterministicPositive: 1,
          },
        ],
      ]),
    });

    const fact = await db.prisma.l2MemoryFact.findFirstOrThrow({
      where: { factType: "strategy", tag: "invariant_first" },
    });
    expect(fact.status).toBe("candidate");
    expect(parseStrategyValidation(fact.validationJson)).toEqual({
      applied: 0,
      positive: 0,
      negative: 0,
      deterministicPositive: 0,
    });
  });

  it("rejects a strategy proposal backed by a run_code-derived assistant reply", async () => {
    db = await createMemoryTestDb();
    const { user } = await seedMinimalUserAndProblem(db.prisma);
    const runReply = await db.prisma.l1MemoryEvent.create({
      data: {
        userId: user.id,
        eventType: "chat_reply",
        source: "chat_reply",
        memoryOrigin: "learner",
        eventJson: JSON.stringify({
          evidenceBoundary: {
            containsAdvisoryRunObservations: true,
            consolidationPolicy: "exclude_assistant_content",
          },
        }),
      },
    });

    await expect(
      upsertStrategyCandidate(db.prisma, {
        userId: user.id,
        tag: "run_fail_first",
        hypothesis: "Start from the failing run result.",
        expectedObservable: "reviewTransition",
        evidenceTraceIds: [runReply.id],
      }),
    ).rejects.toThrow("ineligible_coach_run_code_evidence");
    await expect(db.prisma.l2MemoryFact.count()).resolves.toBe(0);
  });
});

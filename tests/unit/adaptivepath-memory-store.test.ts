import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadLearnerMemory,
  recordAttempt,
  replayLearnerMemory,
  type AttemptInput,
  type LearnerScope,
} from "@/server/adaptivepath/memory-store";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { MasteryContext } from "@/features/adaptivepath/memory/types";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const C03 = "b2e-12-2-concept-03";
const C04 = "b2e-12-2-concept-04";
const ctx: MasteryContext = {
  rules: getRuleset(ACTIVE_RULE_VERSION),
  lookup: { has: () => true, optionIds: () => ["A", "B", "C", "D"] },
};

let db: MemoryTestDb;
let scope: LearnerScope;
let seq = 0;

function attempt(overrides: Partial<AttemptInput> = {}): AttemptInput {
  seq += 1;
  return {
    attemptId: `attempt-${seq}`, questionId: `q-${seq}`, questionType: "single_concept", conceptIds: [C04],
    difficulty: "easy", selectedOption: "A", correct: true, tutorUsed: true, referenceUsed: false, condition: 1,
    submittedAt: new Date(Date.UTC(2026, 9, 31, 0, 0, seq)).toISOString(), explanation: `explanation ${seq}`,
    ...overrides,
  };
}

async function seedScope(memoryOrigin: LearnerScope["memoryOrigin"]): Promise<LearnerScope> {
  const user = await db.prisma.user.create({ data: { handle: `bio-${memoryOrigin}-${seq}` } });
  const problem = await db.prisma.problem.upsert({
    where: { slug: "adaptivepath-biology-2e-12-2" }, update: {},
    create: { slug: "adaptivepath-biology-2e-12-2", title: "Biology", statementMarkdown: "x", tags: "[]", methodName: "biology_reasoning" },
  });
  const session = await db.prisma.chatSession.create({ data: { userId: user.id, problemId: problem.id, title: "Bio", memoryOrigin } });
  return { userId: user.id, problemId: problem.id, chatSessionId: session.id, memoryOrigin };
}

const counts = async () => ({
  l1: await db.prisma.l1MemoryEvent.count({ where: { eventType: "biology_attempt" } }),
  rows: await db.prisma.biologyMasteryLedgerRow.count(),
  judgments: await db.prisma.biologyMasteryJudgment.count(),
  profiles: await db.prisma.biologyLearnerProfile.count(),
});

beforeEach(async () => {
  db = await createMemoryTestDb();
  scope = await seedScope("learner");
});
afterEach(async () => db.cleanup());

describe("biology memory store", () => {
  it("records L1, ledger, judgment and profile in one transaction", async () => {
    const result = await recordAttempt(db.prisma, { scope, attempt: attempt(), ctx });
    expect(result.duplicate).toBe(false);
    expect(result.rows.map((r) => r.effect)).toEqual(["first"]);
    expect(result.profileVersion).toBe(1);
    expect(await counts()).toEqual({ l1: 1, rows: 1, judgments: 1, profiles: 1 });
    const memory = await loadLearnerMemory(db.prisma, scope);
    expect(memory.states.get(C04)).toMatchObject({ level: 1, stability: 40 });
    expect(memory.attempts[0]).toMatchObject({ l1EventId: result.l1EventId, condition: 1, explanation: expect.stringContaining("explanation") });
    expect(memory.latestProfile).toMatchObject({ version: 1, noteStatus: "pending_llm", noteText: null });
    expect(memory.latestProfile?.card.concepts.find((c) => c.conceptId === C04)?.level).toBe(1);
    const l1 = await db.prisma.l1MemoryEvent.findFirstOrThrow({ where: { id: result.l1EventId } });
    expect(JSON.parse(l1.eventJson)).toMatchObject({ domain: "adaptivepath:biology:12.2", schemaVersion: 1, attemptId: "attempt-1" });
    expect(l1.memoryOrigin).toBe("learner");
  });

  it("recordAttempt is idempotent per attemptId", async () => {
    const input = attempt();
    const first = await recordAttempt(db.prisma, { scope, attempt: input, ctx });
    const again = await recordAttempt(db.prisma, { scope, attempt: input, ctx });
    expect(again).toMatchObject({ duplicate: true, l1EventId: first.l1EventId, profileVersion: 1 });
    expect(await counts()).toEqual({ l1: 1, rows: 1, judgments: 1, profiles: 1 });
  });

  it("rejects a second attempt on the same question inside the transaction", async () => {
    const first = attempt();
    await recordAttempt(db.prisma, { scope, attempt: first, ctx });
    await expect(recordAttempt(db.prisma, { scope, attempt: { ...attempt(), questionId: first.questionId }, ctx }))
      .rejects.toThrow("This is not the current activity");
    expect(await counts()).toEqual({ l1: 1, rows: 1, judgments: 1, profiles: 1 });
  });

  it("integrated failure writes only L1", async () => {
    await recordAttempt(db.prisma, { scope, attempt: attempt({ questionType: "integrated", conceptIds: [C03, C04, "b2e-12-2-concept-05"], correct: false }), ctx });
    const after = await counts();
    expect([after.l1, after.rows, after.judgments]).toEqual([1, 0, 0]);
  });

  it("memoryOrigin is scoped", async () => {
    const dev = await seedScope("development");
    await recordAttempt(db.prisma, { scope: dev, attempt: attempt(), ctx });
    const asLearner = await loadLearnerMemory(db.prisma, { ...dev, memoryOrigin: "learner" });
    expect(asLearner.states.size).toBe(0);
    expect(asLearner.attempts).toEqual([]);
  });

  it("persists ineligible evidence on an unjudged concept", async () => {
    await recordAttempt(db.prisma, { scope, attempt: attempt({ selectedOption: "Z" }), ctx });
    const memory = await loadLearnerMemory(db.prisma, scope);
    expect(memory.rows.map((r) => [r.effect, r.reason])).toEqual([["ineligible", "invalid_option"]]);
    expect(memory.states.size).toBe(0);
  });

  it("replayLearnerMemory reproduces stored rows", async () => {
    const inputs = [
      attempt(), attempt({ correct: false }), attempt({ conceptIds: [C03], condition: 2, tutorUsed: false, referenceUsed: true }),
      attempt({ questionType: "integrated", conceptIds: [C03, C04, "b2e-12-2-concept-05"] }),
      attempt({ selectedOption: "Z" }), attempt({ condition: 3, tutorUsed: false }),
    ];
    for (const input of inputs) await recordAttempt(db.prisma, { scope, attempt: input, ctx });
    const shape = (rows: Awaited<ReturnType<typeof loadLearnerMemory>>["rows"]) =>
      rows.map((r) => [r.conceptId, r.l1EventId, r.effect, r.levelAfter, r.stabilityAfter]);
    const before = await loadLearnerMemory(db.prisma, scope);
    const replay = await replayLearnerMemory(db.prisma, { scope, ctx });
    const after = await loadLearnerMemory(db.prisma, scope);
    expect(replay.rowCount).toBe(before.rows.length);
    expect(shape(after.rows)).toEqual(shape(before.rows));
    expect([...after.states]).toEqual([...before.states]);
    expect(after.latestProfile?.version).toBe((before.latestProfile?.version ?? 0) + 1);
  });

  it("rolls back everything when the rule engine throws", async () => {
    const broken: MasteryContext = { ...ctx, lookup: { has: () => true, optionIds: () => { throw new Error("lookup failed"); } } };
    await expect(recordAttempt(db.prisma, { scope, attempt: attempt(), ctx: broken })).rejects.toThrow("lookup failed");
    expect(await counts()).toEqual({ l1: 0, rows: 0, judgments: 0, profiles: 0 });
  });
});

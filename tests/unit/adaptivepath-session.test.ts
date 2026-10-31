import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import { BiologyLearnerNotFoundError, resolveBiologyLearner } from "@/server/adaptivepath/learner";
import {
  loadBiologyView,
  loadProfileData,
  recordReference,
  submitAnswer,
  tutorTurn,
  type BiologyDeps,
} from "@/server/adaptivepath/session";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const env = { PATTERNCOACH_LOCAL_USER_HANDLE: "try", PATTERNCOACH_MEMORY_ORIGIN: "test" };
const EXPLANATION = "The tester only gives recessive alleles, so offspring reveal the unknown parent.";
let db: MemoryTestDb;
let deps: BiologyDeps;

async function currentQuestionId() {
  const view = await loadBiologyView(deps);
  if (!view.question) throw new Error("no current question");
  return view.question.id;
}

async function answerCurrent(correct = true) {
  const questionId = await currentQuestionId();
  const question = getBankQuestion(questionId);
  const option = correct ? question.correctAnswer : question.options.find((o) => o.id !== question.correctAnswer)!.id;
  return submitAnswer(deps, { questionId, selectedOption: option, explanation: EXPLANATION, attemptId: randomUUID() });
}

async function attemptConditions() {
  const events = await db.prisma.l1MemoryEvent.findMany({ where: { eventType: "biology_attempt" }, orderBy: { occurredAt: "asc" } });
  return events.map((e) => (JSON.parse(e.eventJson) as { condition: number }).condition);
}

beforeEach(async () => {
  db = await createMemoryTestDb();
  deps = { db: db.prisma, live: null, env };
});
afterEach(async () => db.cleanup());

describe("biology learner", () => {
  it("missing local user yields BiologyLearnerNotFoundError", async () => {
    await expect(resolveBiologyLearner(db.prisma, env)).rejects.toBeInstanceOf(BiologyLearnerNotFoundError);
    await expect(resolveBiologyLearner(db.prisma, env)).rejects.toThrow("npm run db:try:reset");
  });

  it("reuses a single biology session", async () => {
    await db.prisma.user.create({ data: { handle: "try" } });
    const first = await resolveBiologyLearner(db.prisma, env);
    const second = await resolveBiologyLearner(db.prisma, env);
    expect(second.chatSessionId).toBe(first.chatSessionId);
    expect(first.memoryOrigin).toBe("test");
  });
});

describe("biology session", () => {
  beforeEach(async () => {
    await db.prisma.user.create({ data: { handle: "try" } });
  });

  it("first view picks concept 01 easy", async () => {
    const view = await loadBiologyView(deps);
    expect(view.question?.id).toBe("b2e-12-2-q-c01-easy-01");
    expect(view.pick).toMatchObject({ kind: "question", conceptId: "b2e-12-2-concept-01", difficulty: "easy" });
    expect(view.activity).toEqual({ tutorUsed: false, referenceUsed: false, messages: [] });
    expect(Object.keys(view.question ?? {})).not.toContain("correctAnswer");
  });

  it("condition comes from server-recorded access, not the client", async () => {
    await tutorTurn(deps, "Where do I start?");
    await recordReference(deps, await currentQuestionId());
    await answerCurrent();
    await recordReference(deps, await currentQuestionId());
    await answerCurrent();
    await answerCurrent();
    expect(await attemptConditions()).toEqual([1, 2, 3]);
  });

  it("rejects a stale question without writing", async () => {
    await expect(submitAnswer(deps, {
      questionId: "b2e-12-2-q-c05-hard-01", selectedOption: "A", explanation: EXPLANATION, attemptId: randomUUID(),
    })).rejects.toThrow("This is not the current activity");
    expect(await db.prisma.l1MemoryEvent.count({ where: { eventType: "biology_attempt" } })).toBe(0);
  });

  it("rejects short explanations and unknown options", async () => {
    const questionId = await currentQuestionId();
    await expect(submitAnswer(deps, { questionId, selectedOption: "A", explanation: "too short", attemptId: randomUUID() }))
      .rejects.toThrow("Please explain your reasoning (at least 12 characters).");
    await expect(submitAnswer(deps, { questionId, selectedOption: "Z", explanation: EXPLANATION, attemptId: randomUUID() }))
      .rejects.toThrow("Invalid answer option");
  });

  it("submit returns feedback with ledger changes", async () => {
    const before = await currentQuestionId();
    const result = await answerCurrent();
    expect(result.feedback).toMatchObject({ correct: true, correctAnswer: getBankQuestion(before).correctAnswer });
    expect(result.feedback.explanation.length).toBeGreaterThan(0);
    expect(result.feedback.changes.map((c) => c.effect)).toEqual(["first"]);
    expect(result.question?.id).not.toBe(before);
    expect(result.judgments.map((j) => [j.conceptId, j.level])).toEqual([["b2e-12-2-concept-01", 3]]);
  });

  it("climbs the hint ladder per question and finalizes the trace run", async () => {
    const first = await tutorTurn(deps, "help");
    const second = await tutorTurn(deps, "more help");
    expect(first).toMatchObject({ tool: "worked_example", provider: "offline_rules" });
    expect(second.activity.messages).toHaveLength(4);
    expect(second.activity.tutorUsed).toBe(true);
    const runs = await db.prisma.agentTraceRun.findMany();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.status !== "running")).toBe(true);
  });

  it("loads profile data with the latest L3 card", async () => {
    await answerCurrent(false);
    const profile = await loadProfileData(deps);
    expect(profile.concepts).toHaveLength(10);
    expect(profile.rows.map((r) => r.effect)).toEqual(["first"]);
    expect(profile.latestProfile?.card.gaps).toEqual(["b2e-12-2-concept-01"]);
  });
});

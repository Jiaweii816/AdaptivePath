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

async function chat(message: string, questionId?: string) {
  return tutorTurn(deps, { focus: { kind: "current_question", questionId: questionId ?? await currentQuestionId() }, message });
}

async function attemptConditions() {
  const events = await db.prisma.l1MemoryEvent.findMany({ where: { eventType: "biology_attempt" }, orderBy: { occurredAt: "asc" } });
  return events.map((e) => (JSON.parse(e.eventJson) as { condition: number }).condition);
}

beforeEach(async () => {
  db = await createMemoryTestDb();
  deps = { db: db.prisma, coach: null, env };
});
afterEach(async () => db.cleanup());

describe("biology learner", () => {
  it("missing local user yields BiologyLearnerNotFoundError", async () => {
    await expect(resolveBiologyLearner(db.prisma, env)).rejects.toBeInstanceOf(BiologyLearnerNotFoundError);
    await expect(resolveBiologyLearner(db.prisma, env)).rejects.toThrow("npm run db:migrate:try && npm run db:seed:try");
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
    await chat("Where do I start?");
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

  it("chat on a stale question writes nothing", async () => {
    await expect(chat("help", "b2e-12-2-q-c05-hard-01")).rejects.toThrow("This is not the current activity");
    expect(await db.prisma.l1MemoryEvent.count({ where: { eventType: "biology_guided_assistance" } })).toBe(0);
    expect(await db.prisma.chatMessage.count()).toBe(0);
  });

  it("submit accepts empty reasoning and rejects unknown options", async () => {
    const questionId = await currentQuestionId();
    await expect(submitAnswer(deps, { questionId, selectedOption: "Z", explanation: EXPLANATION, attemptId: randomUUID() }))
      .rejects.toThrow("Invalid answer option");
    const result = await submitAnswer(deps, { questionId, selectedOption: getBankQuestion(questionId).correctAnswer, explanation: "", attemptId: randomUUID() });
    expect(result.feedback.correct).toBe(true);
    const event = await db.prisma.l1MemoryEvent.findFirstOrThrow({ where: { eventType: "biology_attempt" } });
    expect(event.content).toBe("");
  });

  it("legacy messages without phase load as current_question", async () => {
    const questionId = await currentQuestionId();
    const scope = await resolveBiologyLearner(db.prisma, env);
    const meta = (type: string) => JSON.stringify({ domain: "adaptivepath:biology:12.2", type, questionId });
    await db.prisma.chatMessage.create({ data: { sessionId: scope.chatSessionId, sequence: 1, role: "user", contentMarkdown: "old q", memoryOrigin: "test", metadataJson: meta("biology_tutor_user") } });
    await db.prisma.chatMessage.create({ data: { sessionId: scope.chatSessionId, sequence: 2, role: "assistant", contentMarkdown: "old a", memoryOrigin: "test", metadataJson: meta("biology_tutor_assistant") } });
    const view = await loadBiologyView(deps);
    expect(view.activity.messages).toEqual([{ role: "student", content: "old q" }, { role: "tutor", content: "old a" }]);
  });

  it("offline review is 400", async () => {
    const submitted = await answerCurrent();
    expect(submitted.feedback).toBeDefined();
    const attempt = await db.prisma.l1MemoryEvent.findFirstOrThrow({ where: { eventType: "biology_attempt" } });
    const attemptId = (JSON.parse(attempt.eventJson) as { attemptId: string }).attemptId;
    await expect(tutorTurn(deps, { focus: { kind: "submitted_attempt", attemptId }, message: "why?" }))
      .rejects.toMatchObject({ code: "review_requires_live" });
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
    const first = await chat("help");
    const second = await chat("more help");
    expect(first).toMatchObject({ policyId: "offline_rules:worked_example", provider: "offline_rules", review: null, tools: [] });
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
    expect(profile.rows.map((r) => [r.effect, r.result, r.questionId])).toEqual([["first", "F", "b2e-12-2-q-c01-easy-01"]]);
    expect(profile.latestProfile?.card.gaps).toEqual(["b2e-12-2-concept-01"]);
  });
});

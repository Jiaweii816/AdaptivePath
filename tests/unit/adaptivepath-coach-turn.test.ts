import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import type { Draft } from "@/features/adaptivepath/coach/draft";
import type { MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { getPassages } from "@/features/adaptivepath/coach/textbook";
import { biologyErrorResponse } from "@/server/adaptivepath/http-errors";
import { resolveBiologyLearner } from "@/server/adaptivepath/learner";
import { loadLearnerMemory } from "@/server/adaptivepath/memory-store";
import { loadBiologyView, submitAnswer, tutorTurn, type BiologyDeps } from "@/server/adaptivepath/session";
import { runBiologyCoachTurn } from "@/server/agents/coach-agent/biology/turn";
import { createTraceContext } from "@/server/llm/trace-context";
import { fakeAnthropic, toolResults, type FakeBody } from "./fake-anthropic";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const env = { PATTERNCOACH_LOCAL_USER_HANDLE: "try", PATTERNCOACH_MEMORY_ORIGIN: "test" };
const PAST_REASONING = "Every dominant plant must be homozygous so the cross is trivial";
const FINAL = JSON.stringify({ reply: "Which step links one offspring to the whole sample?", citedChunkIds: [], quotedSpans: [] });
type Node = "classifier" | "diagnoser" | "coach";
const turnJson = (kind: string) => JSON.stringify({ intents: [{ kind }], affect: "none", textbookQuery: "dominant recessive" });
const DIAGNOSIS = JSON.stringify({ issueKind: "missing_step", recurringMisconception: true, studentSpan: null, probeStep: "Ask what a recessive offspring would show.", rationale: "secret rationale" });
const DEFAULTS: Record<Node, string> = { classifier: turnJson("check_reasoning"), diagnoser: DIAGNOSIS, coach: FINAL };

let db: MemoryTestDb;
let deps: BiologyDeps;
let script: Record<Node, string[]>;
let calls: Record<Node, FakeBody[]>;

function routedClient(): Anthropic {
  const nodeOf = (body: FakeBody): Node => {
    const system = String(body.system);
    return system.startsWith("Classify") ? "classifier" : system.startsWith("You diagnose") ? "diagnoser" : "coach";
  };
  return fakeAnthropic(
    (body) => ({ text: script[nodeOf(body)].shift() ?? DEFAULTS[nodeOf(body)] }),
    (body) => calls[nodeOf(body)].push(body),
  );
}

async function currentQuestion() {
  const view = await loadBiologyView(deps);
  if (!view.question) throw new Error("no current question");
  return getBankQuestion(view.question.id);
}
async function chat(message: string, draft: Draft | undefined = { selectedOption: "A", reasoning: "Half the offspring look dominant." }) {
  return tutorTurn(deps, { focus: { kind: "current_question", questionId: (await currentQuestion()).id }, message, draft, promptIds: [] });
}
async function submitWrong() {
  const question = await currentQuestion();
  const wrong = question.options.find((o) => o.id !== question.correctAnswer)!.id;
  await submitAnswer(deps, { questionId: question.id, selectedOption: wrong, explanation: PAST_REASONING, attemptId: randomUUID() });
  const event = await db.prisma.l1MemoryEvent.findFirstOrThrow({ where: { eventType: "biology_attempt" }, orderBy: { occurredAt: "desc" } });
  return (JSON.parse(event.eventJson) as { attemptId: string }).attemptId;
}
const coachText = () => JSON.stringify(calls.coach);

beforeEach(async () => {
  db = await createMemoryTestDb();
  await db.prisma.user.create({ data: { handle: "try" } });
  deps = { db: db.prisma, coach: { client: routedClient(), model: "fake" }, env };
  script = { classifier: [], diagnoser: [], coach: [] };
  calls = { classifier: [], diagnoser: [], coach: [] };
});
afterEach(async () => db.cleanup());

describe("biology coach turn", () => {
  it("check_reasoning turn writes 3 llm_call traces and retrieval events", async () => {
    const result = await chat("Is my reasoning right?");
    expect(result).toMatchObject({ provider: "live_llm", intents: ["check_reasoning"], policyId: "bio-coach-v1:check_reasoning", stopReason: null, review: null });
    const events = await db.prisma.agentTraceEvent.findMany();
    expect(events.filter((e) => e.kind === "llm")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "retrieval").map((e) => e.stage)).toContain("biology_l2_recall");
    expect(events.map((e) => e.stage)).toEqual(expect.arrayContaining(["biology_memory_signals", "biology_teaching_plan", "biology_guard", "biology_diagnosis"]));
  });

  it("coach messages contain no answer, explanation, issueKind or pastMisses", async () => {
    await submitWrong();
    const question = await currentQuestion();
    await chat("check please");
    expect(JSON.stringify(calls.diagnoser)).toContain(PAST_REASONING);
    expect(coachText()).not.toContain(PAST_REASONING);
    expect(coachText()).not.toContain(question.explanation);
    expect(coachText()).not.toMatch(/issueKind|optionCorrect|secret rationale|stability|correctAnswer/);
  });

  it("correct and wrong drafts give the coach identically shaped diagnosis", async () => {
    const question = await currentQuestion();
    const wrong = question.options.find((o) => o.id !== question.correctAnswer)!.id;
    await chat("check", { selectedOption: question.correctAnswer, reasoning: "Reason one." });
    await chat("check", { selectedOption: wrong, reasoning: "Reason two." });
    const diagnosisResults = calls.coach.map((c) => toolResults(c).find((r) => String(r.content).includes("probeStep"))!);
    const shapes = diagnosisResults.map((r) => Object.keys(JSON.parse(String(r.content))).sort());
    expect(shapes).toEqual([["probeStep", "studentSpan"], ["probeStep", "studentSpan"]]);
  });

  it("response has no memorySignals", async () => {
    await submitWrong();
    const text = JSON.stringify(await chat("hint?"));
    expect(text).not.toMatch(/memorySignals|prerequisiteGap|pastMisses|reliesOnTutor/);
  });

  it("diagnosis cache hits on unchanged draft", async () => {
    await chat("check");
    await chat("check again");
    expect(calls.diagnoser).toHaveLength(1);
  });

  it("diagnosis cache misses when the draft changes", async () => {
    await chat("check", { selectedOption: "A", reasoning: "First idea." });
    await chat("check", { selectedOption: "B", reasoning: "First idea." });
    expect(calls.diagnoser).toHaveLength(2);
  });

  it("passes the draft change to the coach", async () => {
    await chat("check", { selectedOption: "D", reasoning: "x" });
    await chat("check", { selectedOption: "A", reasoning: "x" });
    expect(String(calls.coach[1].messages[0].content)).toContain('"optionChanged":{"from":"D","to":"A"}');
  });

  it("memory disclosure in reply fails the turn and stores no messages", async () => {
    script.coach = [JSON.stringify({ reply: "Your record shows you need more practice.", citedChunkIds: [], quotedSpans: [] })];
    await expect(chat("help")).rejects.toMatchObject({ code: "memory_disclosure", node: "guard" });
    expect(await db.prisma.chatMessage.count()).toBe(0);
    expect(await db.prisma.l1MemoryEvent.count({ where: { eventType: "biology_guided_assistance" } })).toBe(0);
  });

  it("blocked replies use a neutral message that never mentions the answer", async () => {
    script.coach = [JSON.stringify({ reply: "That's correct, well done.", citedChunkIds: [], quotedSpans: [] })];
    const error = await chat("am I right?").then(() => null, (e: unknown) => e as Error);
    expect(error).toMatchObject({ code: "answer_leak" });
    expect(error?.message).not.toMatch(/answer/i);
  });

  it("a misconception the student repeats in the current draft can be discussed", async () => {
    await submitWrong();
    script.coach = [JSON.stringify({ reply: `Look again at: ${PAST_REASONING}. What would a recessive offspring show?`, citedChunkIds: [], quotedSpans: [] })];
    const result = await chat("check", { selectedOption: "A", reasoning: PAST_REASONING });
    expect(result.reply).toContain(PAST_REASONING);
  });

  it("biology coach turns keep full trace detail for audit", async () => {
    await submitWrong();
    await chat("check");
    const recall = await db.prisma.agentTraceEvent.findFirstOrThrow({ where: { stage: "biology_l2_recall" }, include: { payload: true } });
    expect(recall.payload?.detailMetadataJson).toContain("pastMissEventIds");
  });

  it("answer leak fails only in current phase", async () => {
    const question = await currentQuestion();
    script.coach = [JSON.stringify({ reply: `The answer is ${question.correctAnswer}.`, citedChunkIds: [], quotedSpans: [] })];
    await expect(chat("just tell me")).rejects.toMatchObject({ code: "answer_leak" });
    const attemptId = await submitWrong();
    script.classifier = [turnJson("review_attempt")];
    script.coach = [JSON.stringify({ reply: `The answer is ${question.correctAnswer}.`, citedChunkIds: [], quotedSpans: [] })];
    const review = await tutorTurn(deps, { focus: { kind: "submitted_attempt", attemptId }, message: "why was I wrong?", promptIds: [] });
    expect(review.reply).toContain("The answer is");
  });

  it("classifier failure returns 502 and stores nothing", async () => {
    script.classifier = ["not json"];
    const error = await chat("help").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "llm_invalid_json", node: "classifier" });
    expect(biologyErrorResponse(error).status).toBe(502);
    expect(await db.prisma.chatMessage.count()).toBe(0);
  });
});

describe("biology coach review", () => {
  it("review chat does not write biology_guided_assistance", async () => {
    const attemptId = await submitWrong();
    script.classifier = [turnJson("review_attempt")];
    const result = await tutorTurn(deps, { focus: { kind: "submitted_attempt", attemptId }, message: "why?", promptIds: [] });
    expect(result.tools).toContainEqual({ name: "get_attempt_review", origin: "policy" });
    expect(result.review?.messages).toHaveLength(2);
    expect(result.activity.tutorUsed).toBe(false);
    expect(await db.prisma.l1MemoryEvent.count({ where: { eventType: "biology_guided_assistance" } })).toBe(0);
  });

  it("review may paraphrase the reviewed attempt's reasoning", async () => {
    const attemptId = await submitWrong();
    script.classifier = [turnJson("review_attempt")];
    script.coach = [JSON.stringify({ reply: `You argued that ${PAST_REASONING.toLowerCase()}; compare that with the explanation.`, citedChunkIds: [], quotedSpans: [] })];
    const result = await tutorTurn(deps, { focus: { kind: "submitted_attempt", attemptId }, message: "why?", promptIds: [] });
    expect(result.reply).toContain("You argued");
  });

  it("review of unknown attempt is 404", async () => {
    const error = await tutorTurn(deps, { focus: { kind: "submitted_attempt", attemptId: "nope" }, message: "why?", promptIds: [] }).catch((e: unknown) => e);
    expect(biologyErrorResponse(error).status).toBe(404);
  });
});

describe("biology coach memory policy", () => {
  it("learners with and without prerequisite gap get different required tools for the same message", async () => {
    const scope = await resolveBiologyLearner(db.prisma, env);
    const memory = await loadLearnerMemory(db.prisma, scope);
    const question = getBankQuestion("b2e-12-2-q-c04-medium-01");
    const base: MemorySignals = { level: 1, focusConceptId: "b2e-12-2-concept-04", prerequisiteGap: null, anchor: null, pastMisses: [], reliesOnTutor: false };
    const run = async (signals: MemorySignals) => {
      script.classifier = [turnJson("question_hint")];
      const trace = createTraceContext({ prisma: db.prisma, userId: scope.userId, path: "memory", task: "biology_coach_turn", memoryOrigin: "test" });
      return runBiologyCoachTurn({ db: db.prisma, llm: { client: routedClient(), model: "fake" }, trace, env }, {
        scope, target: { phase: "current_question", question, attempt: null }, memory, signals, pickReason: null, message: "stuck", draft: null,
        promptIds: [], attachedPassage: null,
      });
    };
    const plain = await run(base);
    const gap = await run({ ...base, prerequisiteGap: "b2e-12-2-concept-03" });
    expect(plain.tools.map((t) => t.name)).not.toContain("get_concept_card");
    expect(gap.tools).toContainEqual({ name: "get_concept_card", origin: "policy" });
  });
});

describe("biology coach suggested prompts and attached reference", () => {
  const CHUNK = "b2e-12-2-p01-c05";
  const passage = () => getPassages([CHUNK])[0];
  const userMeta = async () => JSON.parse((await db.prisma.chatMessage.findFirstOrThrow({ where: { role: "user" } })).metadataJson) as Record<string, unknown>;
  const CITING = JSON.stringify({ reply: "This passage defines alleles.", citedChunkIds: [CHUNK], quotedSpans: [] });
  const ask = async (extra: Readonly<{ promptIds: ("explain_reference" | "check_reasoning")[]; referenceChunkId?: string }>) =>
    tutorTurn(deps, { focus: { kind: "current_question", questionId: (await currentQuestion()).id }, message: "Explain Reference 2 (p. 316)", ...extra });

  it("puts the attached passage's text in front of the classifier and the coach", async () => {
    script.classifier = [turnJson("explain_concept")];
    script.coach = [CITING];
    await ask({ promptIds: ["explain_reference"], referenceChunkId: CHUNK });
    expect(JSON.stringify(calls.classifier)).toContain(JSON.stringify(passage().text).slice(1, -1));
    expect(coachText()).toContain(JSON.stringify(passage().text).slice(1, -1));
  });

  it("lets the coach cite the attached passage and traces it as retrieval", async () => {
    script.classifier = [turnJson("explain_concept")];
    script.coach = [CITING];
    const result = await ask({ promptIds: [], referenceChunkId: CHUNK });
    expect(result.citedChunkIds).toEqual([CHUNK]);
    const retrieval = await db.prisma.agentTraceEvent.findMany({ where: { kind: "retrieval", stage: "biology_attached_reference" } });
    expect(retrieval).toHaveLength(1);
  });

  it("records which prompts and which passage the message used", async () => {
    script.classifier = [turnJson("explain_concept")];
    script.coach = [CITING];
    await ask({ promptIds: ["explain_reference", "check_reasoning"], referenceChunkId: CHUNK });
    expect(await userMeta()).toMatchObject({ promptIds: ["explain_reference", "check_reasoning"], referenceChunkId: CHUNK });
  });

  it("records an empty prompt list for a typed message", async () => {
    await chat("Is my reasoning right?");
    expect(await userMeta()).toMatchObject({ promptIds: [] });
  });

  it("rejects an unknown passage with 400 and stores nothing", async () => {
    const error = await ask({ promptIds: [], referenceChunkId: "b2e-12-2-nope" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "unknown_reference" });
    expect(biologyErrorResponse(error).status).toBe(400);
    expect(await db.prisma.chatMessage.count()).toBe(0);
  });

  it("offline rules cannot read a passage, so an attached reference is a 400", async () => {
    deps = { ...deps, coach: null };
    const error = await ask({ promptIds: ["explain_reference"], referenceChunkId: CHUNK }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "reference_requires_live" });
    expect(biologyErrorResponse(error).status).toBe(400);
  });

  it("offline turns still record prompt usage", async () => {
    deps = { ...deps, coach: null };
    await ask({ promptIds: ["check_reasoning"] });
    expect(await userMeta()).toMatchObject({ promptIds: ["check_reasoning"] });
  });
});

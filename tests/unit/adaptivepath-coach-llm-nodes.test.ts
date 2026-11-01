import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import type { Draft } from "@/features/adaptivepath/coach/draft";
import type { PastMiss } from "@/features/adaptivepath/coach/memory-signals";
import { classifyBiologyTurn } from "@/server/agents/coach-agent/biology/intent-classifier";
import { diagnoseReasoning } from "@/server/agents/coach-agent/biology/diagnoser";
import type { LlmNodeDeps } from "@/server/agents/coach-agent/biology/llm-node";
import { createTraceContext } from "@/server/llm/trace-context";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const question = getBankQuestion("b2e-12-2-q-c04-medium-01");
const PAST: PastMiss = { questionId: "b2e-12-2-q-c04-easy-01", l1EventId: "e1", selectedOption: "A", reasoningExcerpt: "one round offspring proves RR", misconception: "One offspring cannot reveal the genotype." };
let db: MemoryTestDb;
let requests: Array<{ messages: Array<{ role: string; content: string }> }>;

type Reply = string | Error;
function fakeClient(replies: Reply[]): OpenAI {
  const queue = [...replies];
  const create = async (body: { messages: Array<{ role: string; content: string }> }) => {
    requests.push(body);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { model: "fake", usage: null, choices: [{ message: { content: next ?? "" }, finish_reason: "stop" }] };
  };
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

async function depsWith(replies: Reply[]): Promise<LlmNodeDeps> {
  const user = await db.prisma.user.create({ data: { handle: `u${requests.length}${Math.random()}` } });
  const trace = createTraceContext({ prisma: db.prisma, userId: user.id, path: "memory", task: "biology_coach_turn", memoryOrigin: "test" });
  return { client: fakeClient(replies), model: "fake-model", trace };
}

const sent = () => JSON.stringify(requests.map((r) => r.messages));
const classify = (deps: LlmNodeDeps, reasoning = "half are dominant") =>
  classifyBiologyTurn(deps, { phase: "current_question", message: "我选 D 对吗", history: [], draft: { selectedOption: "D", reasoning }, conceptNames: ["Test crosses"] });
const VALID_TURN = JSON.stringify({ intents: [{ kind: "check_reasoning" }], affect: "none", textbookQuery: "test cross probability" });
const diagnosis = (over: Record<string, unknown> = {}) => JSON.stringify({ issueKind: "missing_step", recurringMisconception: false, studentSpan: "half are dominant", probeStep: "How does one offspring's chance extend to three?", rationale: "stops at one offspring", ...over });

beforeEach(async () => { db = await createMemoryTestDb(); requests = []; });
afterEach(async () => db.cleanup());

describe("intent classifier", () => {
  it("returns the parsed turn and writes one llm_call trace", async () => {
    const deps = await depsWith([VALID_TURN]);
    expect((await classify(deps)).intents).toEqual([{ kind: "check_reasoning" }]);
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: deps.trace.traceRunId, kind: "llm" } });
    expect(events).toHaveLength(1);
  });
  it("classifier prompt carries no answer, explanation or memory", async () => {
    await classify(await depsWith([VALID_TURN]));
    expect(sent()).not.toContain(question.explanation);
    expect(sent()).not.toContain("correctAnswer");
    expect(sent()).not.toMatch(/stability|pastMisses/);
  });
  it("classifier reasoning is truncated to 500 chars", async () => {
    await classify(await depsWith([VALID_TURN]), "x".repeat(600) + "TAIL");
    expect(sent()).toContain("x".repeat(500));
    expect(sent()).not.toContain("x".repeat(501));
    expect(sent()).not.toContain("TAIL");
  });
  it.each([
    [Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" }), "llm_timeout"],
    [new Error("500 upstream"), "llm_provider"],
    ["", "llm_empty"],
    ["not json", "llm_invalid_json"],
    [JSON.stringify({ intents: [{ kind: "review_attempt" }], affect: "none", textbookQuery: "x" }), "llm_schema"],
  ] as const)("maps failure %# to %s", async (reply, code) => {
    const deps = await depsWith([reply]);
    await expect(classify(deps)).rejects.toMatchObject({ name: "BiologyCoachError", code, node: "classifier" });
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: deps.trace.traceRunId, kind: "llm" } });
    expect(events).toHaveLength(1);
  });
});

describe("diagnoser", () => {
  const draft: Draft = { selectedOption: "D", reasoning: "Test cross gives 1:1, so half are dominant." };
  const run = async (reply: string, d = draft) => diagnoseReasoning(await depsWith([reply]), { question, draft: d, pastMisses: [PAST] });

  it("diagnoser prompt includes correct answer, explanations and pastMisses", async () => {
    await run(diagnosis());
    expect(sent()).toContain(question.explanation);
    expect(sent()).toContain(question.optionExplanations.D);
    expect(sent()).toContain(PAST.reasoningExcerpt);
  });
  it("hands the coach only probeStep and studentSpan", async () => {
    const result = await run(diagnosis());
    expect(Object.keys(result.forCoach).sort()).toEqual(["probeStep", "studentSpan"]);
    expect(result.internal).toMatchObject({ issueKind: "missing_step", optionCorrect: false });
  });
  it("diagnoser rejects studentSpan not in reasoning", async () => {
    await expect(run(diagnosis({ studentSpan: "all are dominant" }))).rejects.toMatchObject({ code: "diagnosis_invalid" });
  });
  it("diagnoser rejects probeStep containing the correct option text", async () => {
    await expect(run(diagnosis({ probeStep: "Show that it equals 1/8." }))).rejects.toMatchObject({ code: "diagnosis_invalid" });
  });
  it("diagnoser rejects probeStep quoting a past miss", async () => {
    await expect(run(diagnosis({ probeStep: "Earlier: one round offspring proves RR — why?" }))).rejects.toMatchObject({ code: "diagnosis_invalid" });
  });
  it("diagnoser rejects probeStep asserting a wrong option's value too", async () => {
    await expect(run(diagnosis({ probeStep: "Explain why the probability is 1/2." }))).rejects.toMatchObject({ code: "diagnosis_invalid" });
  });
  it("diagnoser rejection message does not mention the answer", async () => {
    await expect(run(diagnosis({ probeStep: "Show that it equals 1/8." }))).rejects.toThrow(expect.objectContaining({ message: expect.not.stringMatching(/answer/i) }));
  });
  it("diagnoser may point at the student's current sentence even when it repeats a past miss", async () => {
    const repeat: Draft = { selectedOption: "A", reasoning: `I think ${PAST.reasoningExcerpt}.` };
    const result = await run(diagnosis({ studentSpan: PAST.reasoningExcerpt, probeStep: `Why would "${PAST.reasoningExcerpt}" hold?` }), repeat);
    expect(result.forCoach.studentSpan).toBe(PAST.reasoningExcerpt);
  });
  it("optionCorrect is computed by server, null without option", async () => {
    expect((await run(diagnosis(), { selectedOption: "C", reasoning: draft.reasoning })).internal.optionCorrect).toBe(true);
    expect((await run(diagnosis(), { selectedOption: null, reasoning: draft.reasoning })).internal.optionCorrect).toBeNull();
  });
});

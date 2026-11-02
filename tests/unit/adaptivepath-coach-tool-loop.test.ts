import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONCEPTS } from "@/features/adaptivepath/concepts";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import { findMemoryDisclosures } from "@/features/adaptivepath/coach/memory-disclosure-guard";
import type { MemorySignals } from "@/features/adaptivepath/coach/memory-signals";
import { planTeachingTurn, type TeachingPlan } from "@/features/adaptivepath/coach/teaching-policy";
import { buildProfileCard } from "@/features/adaptivepath/memory/profile-card";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import type { LearnerMemory } from "@/server/adaptivepath/memory-store";
import { BIOLOGY_TOOL_REGISTRY, visibleTools, type ToolContext } from "@/server/agents/coach-agent/biology/tool-registry";
import { buildCoachContext, COACH_SYSTEM_PROMPT } from "@/server/agents/coach-agent/biology/coach-prompt";
import { runBiologyToolLoop } from "@/server/agents/coach-agent/biology/tool-loop";
import { createTraceContext, type TraceContext } from "@/server/llm/trace-context";
import { fakeAnthropic, toolResults, type FakeBody } from "./fake-anthropic";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const rules = getRuleset(ACTIVE_RULE_VERSION);
const question = getBankQuestion("b2e-12-2-q-c04-medium-01");
const cid = (n: number) => `b2e-12-2-concept-${String(n).padStart(2, "0")}`;
const states = new Map([[cid(4), { conceptId: cid(4), level: 1 as const, stability: 70, supportStreak: 1, ruleVersion: rules.version }]]);
const memory: LearnerMemory = {
  states, rows: [], latestProfile: { version: 1, card: buildProfileCard({ states, rows: [], concepts: CONCEPTS, rules }), noteStatus: "pending_llm", noteText: null },
  attempts: [{
    l1EventId: "e1", attemptId: "a1", questionId: "b2e-12-2-q-c04-easy-01", questionType: "single_concept", conceptIds: [cid(4)], difficulty: "easy",
    selectedOption: "A", correct: false, tutorUsed: true, referenceUsed: false, condition: 1, submittedAt: "2026-11-01T00:00:00.000Z",
    explanation: "A single round offspring proves the parent is RR for sure",
  }],
};
const signals: MemorySignals = {
  level: 1, focusConceptId: cid(4), prerequisiteGap: null, anchor: null, reliesOnTutor: false,
  pastMisses: [{ questionId: "b2e-12-2-q-c04-easy-01", l1EventId: "e1", selectedOption: "A", reasoningExcerpt: memory.attempts[0].explanation, misconception: "x" }],
};
const FINAL = JSON.stringify({ reply: "What does each offspring show?", citedChunkIds: [], quotedSpans: [] });
let db: MemoryTestDb;
let trace: TraceContext;
let bodies: FakeBody[];
let diagnoseCalls: number;

type Step = { content?: string; calls?: Array<{ name: string; args: unknown }> };
function client(steps: Step[]): Anthropic {
  const queue = [...steps];
  return fakeAnthropic(() => {
    const step = queue.shift() ?? { content: FINAL };
    return { text: step.content, calls: step.calls?.map((c) => ({ name: c.name, input: c.args })) };
  }, (body) => bodies.push(body));
}

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    phase: "current_question", question, draft: { selectedOption: "D", reasoning: "half are dominant" }, attempt: null, signals, memory,
    diagnose: async () => { diagnoseCalls += 1; return { probeStep: "From one offspring to three?", studentSpan: "half are dominant" }; },
    trace, ...over,
  };
}
const plan = (kinds: Array<"question_hint" | "explain_concept" | "check_reasoning">, draft = "reasoning" as const): TeachingPlan => planTeachingTurn({
  turn: { intents: kinds.map((kind) => ({ kind })), affect: "none", textbookQuery: "test cross" },
  phase: "current_question", signals, draftState: draft, priorHintTurns: 0, firstTurnOnQuestion: false,
});
const loop = (steps: Step[], p: TeachingPlan, toolCtx = ctx()) =>
  runBiologyToolLoop({ client: client(steps), model: "fake", trace }, { context: "{}", history: [], message: "help", plan: p, toolCtx });

beforeEach(async () => {
  db = await createMemoryTestDb();
  const user = await db.prisma.user.create({ data: { handle: "try" } });
  trace = createTraceContext({ prisma: db.prisma, userId: user.id, path: "memory", task: "biology_coach_turn", memoryOrigin: "test" });
  bodies = [];
  diagnoseCalls = 0;
});
afterEach(async () => db.cleanup());

describe("biology tool registry", () => {
  it("diagnose_reasoning hidden when draft empty; get_attempt_review only in review", () => {
    expect(visibleTools("current_question", "empty")).not.toContain("diagnose_reasoning");
    expect(visibleTools("current_question", "option_only")).toContain("diagnose_reasoning");
    expect(visibleTools("current_question", "reasoning")).not.toContain("get_attempt_review");
    expect(visibleTools("submitted_attempt", "empty")).toContain("get_attempt_review");
    expect(visibleTools("submitted_attempt", "reasoning")).not.toContain("diagnose_reasoning");
  });
  it("get_concept_card returns no levels", async () => {
    const out = await BIOLOGY_TOOL_REGISTRY.get_concept_card.run({ conceptId: cid(4) }, ctx());
    expect(JSON.stringify(out.content)).not.toMatch(/level|stability/i);
    expect(JSON.stringify(out.content)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(out.content).toMatchObject({ name: CONCEPTS[3].name, prerequisites: CONCEPTS[3].prerequisiteIds.map((id) => CONCEPTS.find((c) => c.id === id)!.name) });
  });
  it("get_learner_status returns qualitative wording only", async () => {
    const out = await BIOLOGY_TOOL_REGISTRY.get_learner_status.run({}, ctx());
    expect(findMemoryDisclosures(JSON.stringify(out.content), { pastExcerpts: [], quotedSpans: [] })).toEqual([]);
    expect(JSON.stringify(out.content)).not.toMatch(/"level"|stability|\d{2}/);
  });
  it("get_question_evidence returns no answer fields in current phase", async () => {
    const out = await BIOLOGY_TOOL_REGISTRY.get_question_evidence.run({}, ctx());
    const text = JSON.stringify(out.content);
    expect(out.chunkIds).toEqual(question.chunkIds);
    expect(text).not.toContain(question.explanation);
    expect(text).not.toContain("correct");
  });
  it("get_attempt_review exposes the key only for the reviewed attempt", async () => {
    const attempt = { ...memory.attempts[0], questionId: question.id, selectedOption: "D" };
    const out = await BIOLOGY_TOOL_REGISTRY.get_attempt_review.run({}, ctx({ phase: "submitted_attempt", attempt }));
    expect(out.content).toMatchObject({ correctOption: "C", explanation: question.explanation, submitted: { selectedOption: "D" } });
    await expect(BIOLOGY_TOOL_REGISTRY.get_attempt_review.run({}, ctx())).rejects.toThrow();
  });
});

describe("biology tool loop", () => {
  it("required calls run before the first model call", async () => {
    const result = await loop([{ content: FINAL }], plan(["question_hint"]));
    expect(diagnoseCalls).toBe(1);
    expect(toolResults(bodies[0])).toHaveLength(2);
    expect(bodies[0].system).toBe(COACH_SYSTEM_PROMPT);
    expect(result.tools).toEqual([{ name: "get_question_evidence", origin: "policy" }, { name: "diagnose_reasoning", origin: "policy" }]);
    expect(result.raw).toEqual(JSON.parse(FINAL));
  });
  it("model tool calls are executed and traced with origin model", async () => {
    const result = await loop([{ calls: [{ name: "search_textbook", args: { query: "test cross" } }] }, { content: FINAL }], plan(["explain_concept"]));
    expect(result.tools.at(-1)).toEqual({ name: "search_textbook", origin: "model" });
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: trace.traceRunId, stage: "biology_textbook_search" } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === "retrieval")).toBe(true);
  });
  it("third tool round is refused with stopReason tool_budget and a final no-tool call", async () => {
    const call = { calls: [{ name: "get_concept_card", args: { conceptId: cid(4) } }] };
    const result = await loop([call, call, { content: FINAL }], plan(["explain_concept"]));
    expect(result.stopReason).toBe("tool_budget");
    expect(bodies).toHaveLength(3);
    expect(bodies[2].tools).toBeUndefined();
    expect(JSON.stringify(bodies[2].messages.at(-1))).toContain("No more tools");
  });
  it("passes the model's own assistant content back unchanged before tool results", async () => {
    await loop([{ calls: [{ name: "search_textbook", args: { query: "test cross" } }] }, { content: FINAL }], plan(["explain_concept"]));
    const assistant = bodies[1].messages.filter((m) => m.role === "assistant").at(-1);
    expect(JSON.stringify(assistant?.content)).toMatch(/"type":"tool_use".*"name":"search_textbook"/);
  });
  it("invalid tool args return an error observation", async () => {
    const result = await loop([{ calls: [{ name: "get_concept_card", args: { conceptId: "nope" } }] }, { content: FINAL }], plan(["explain_concept"]));
    const last = toolResults(bodies[1]).at(-1);
    expect(last?.is_error).toBe(true);
    expect(String(last?.content)).toContain("invalid arguments");
    expect(result.stopReason).toBeNull();
  });
  it("retrievedChunkIds collects every passage returned", async () => {
    const result = await loop([{ content: FINAL }], plan(["question_hint"]));
    expect([...result.retrievedChunkIds]).toEqual(expect.arrayContaining([...question.chunkIds]));
  });
  it("skips straight to finalize when no optional tool is visible", async () => {
    const p = { ...plan(["check_reasoning"]), optionalTools: [] };
    const result = await loop([{ content: FINAL }], p);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].tools).toBeUndefined();
    expect(result.stopReason).toBeNull();
  });
});

describe("coach prompt", () => {
  it("buildCoachContext has no stability, question ids, pastMisses text or correctAnswer", () => {
    const text = buildCoachContext({ question, phase: "current_question", plan: plan(["question_hint"]), draft: { selectedOption: "D", reasoning: "half" }, draftDiff: null, pickReason: null, concepts: CONCEPTS });
    expect(text).not.toMatch(/stability|b2e-12-2-q-|b2e-12-2-concept-/);
    expect(text).not.toContain(memory.attempts[0].explanation);
    expect(text).not.toContain(question.explanation);
    expect(text).not.toContain("correctAnswer");
    expect(text).toContain(question.prompt);
  });
  it("names anchor and prerequisite concepts by name", () => {
    const p = { ...plan(["explain_concept"]), anchorConceptId: cid(3), prerequisiteConceptId: cid(2), styleKeys: ["depth_hint_ladder", "anchor_bridge", "prerequisite_detour"] as TeachingPlan["styleKeys"] };
    const text = buildCoachContext({ question, phase: "current_question", plan: p, draft: null, draftDiff: null, pickReason: null, concepts: CONCEPTS });
    expect(text).toContain(CONCEPTS[2].name);
    expect(text).toContain(CONCEPTS[1].name);
  });
  it("system prompt forbids restating option values", () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/never restate.*option/i);
    expect(COACH_SYSTEM_PROMPT).toMatch(/never mention.*record/i);
  });
  it("system prompt makes the coach reply in English only", () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/always reply in English/i);
    expect(COACH_SYSTEM_PROMPT).not.toMatch(/language the student wrote in/i);
  });
});

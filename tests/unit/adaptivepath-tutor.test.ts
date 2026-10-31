import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sourceChunks from "@/features/adaptivepath/data/biology-12-2/chunks.json";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import type { TutorMemoryContext } from "@/features/adaptivepath/memory/tutor-context";
import { biologyCoachReply } from "@/server/agents/coach-agent/biology-chat-reply";
import { createLiveBiologyTutor, type LiveTutor, type LiveTutorInput } from "@/server/adaptivepath/tutor-provider";
import { recallBiologyTutorMemory } from "@/server/memory/biology-memory-context";
import { recordAttempt, type LearnerScope } from "@/server/adaptivepath/memory-store";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import { createTraceContext, type TraceContext } from "@/server/llm/trace-context";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const question = getBankQuestion("b2e-12-2-q-c04-easy-01");
const memory: TutorMemoryContext = { judgments: [{ conceptId: "b2e-12-2-concept-04", level: 1, stability: 40 }], evidence: [] };
let db: MemoryTestDb;
let scope: LearnerScope;
let trace: TraceContext;

function turn(overrides: Partial<Parameters<typeof biologyCoachReply>[0]> = {}) {
  return { question, message: "I am stuck", history: [], priorTutorTurns: 0, memory, levels: [1 as const], ...overrides };
}

beforeEach(async () => {
  db = await createMemoryTestDb();
  const user = await db.prisma.user.create({ data: { handle: "try" } });
  const problem = await db.prisma.problem.create({
    data: { slug: "adaptivepath-biology-2e-12-2", title: "Biology", statementMarkdown: "x", tags: "[]", methodName: "biology_reasoning" },
  });
  const session = await db.prisma.chatSession.create({ data: { userId: user.id, problemId: problem.id, title: "Bio", memoryOrigin: "test" } });
  scope = { userId: user.id, problemId: problem.id, chatSessionId: session.id, memoryOrigin: "test" };
  trace = createTraceContext({ prisma: db.prisma, userId: user.id, path: "memory", task: "biology_tutor_turn", memoryOrigin: "test" });
});
afterEach(async () => db.cleanup());

describe("biology tutor reply", () => {
  it("uses the offline hint ladder when no live tutor is configured", async () => {
    const result = await biologyCoachReply(turn(), { live: null, trace });
    expect(result).toMatchObject({ tool: "guided_hint", provider: "offline_rules" });
    expect(result.reply).toContain("step 1");
  });

  it("surfaces a live tutor failure instead of falling back", async () => {
    const failing: LiveTutor = { reply: async () => { throw new Error("provider down"); } };
    await expect(biologyCoachReply(turn(), { live: failing, trace })).rejects.toThrow("provider down");
  });

  it("never sends answers or textbook text to the live tutor", async () => {
    const seen: LiveTutorInput[] = [];
    const recording: LiveTutor = { reply: async (input) => { seen.push(input); return "What do you expect?"; } };
    const result = await biologyCoachReply(turn({ levels: [3] }), { live: recording, trace });
    expect(result).toMatchObject({ provider: "live_llm", tool: "socratic_probe", reply: "What do you expect?" });
    const serialized = JSON.stringify(seen[0]);
    expect(serialized).not.toContain("correctAnswer");
    expect(serialized).not.toContain(question.explanation);
    const raw = sourceChunks.find((c) => c.id === question.chunkIds[0])!.normalized_text.slice(0, 40);
    expect(serialized).not.toContain(raw);
    expect(seen[0].subsections.length).toBeGreaterThan(0);
  });

  it("records an llm_call trace and rejects an empty live reply", async () => {
    const client = { chat: { completions: { create: async () => ({ model: "m", usage: null, choices: [{ message: { content: "" }, finish_reason: "stop" }] }) } } };
    const tutor = createLiveBiologyTutor(client as unknown as OpenAI);
    await expect(biologyCoachReply(turn(), { live: tutor, trace })).rejects.toThrow("Empty biology tutor reply");
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: trace.traceRunId, kind: "llm" } });
    expect(events).toHaveLength(1);
  });
});

describe("biology tutor memory recall", () => {
  it("emits a retrieval trace with the recalled judgments", async () => {
    const ctx = { rules: getRuleset(ACTIVE_RULE_VERSION), lookup: { has: () => true, optionIds: () => ["A", "B", "C", "D"] } };
    await recordAttempt(db.prisma, {
      scope, ctx,
      attempt: {
        attemptId: "a1", questionId: "b2e-12-2-q-c04-easy-02", questionType: "single_concept", conceptIds: ["b2e-12-2-concept-04"],
        difficulty: "easy", selectedOption: "A", correct: true, tutorUsed: true, referenceUsed: false, condition: 1,
        submittedAt: new Date().toISOString(), explanation: "the tester is recessive",
      },
    });
    const recalled = await recallBiologyTutorMemory(db.prisma, { scope, question, trace });
    expect(recalled.levels).toEqual([1]);
    expect(recalled.memory.judgments.map((j) => j.conceptId)).toEqual(["b2e-12-2-concept-04"]);
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: trace.traceRunId, kind: "retrieval" } });
    expect(events.map((e) => e.stage)).toEqual(["biology_l2_recall"]);
  });
});

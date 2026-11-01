import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import { biologyOfflineReply } from "@/server/agents/coach-agent/biology-chat-reply";
import { recallBiologyCoachMemory } from "@/server/memory/biology-memory-context";
import { recordAttempt, type LearnerScope } from "@/server/adaptivepath/memory-store";
import { ACTIVE_RULE_VERSION, getRuleset } from "@/features/adaptivepath/memory/rules";
import { createTraceContext, type TraceContext } from "@/server/llm/trace-context";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const question = getBankQuestion("b2e-12-2-q-c04-easy-01");
let db: MemoryTestDb;
let scope: LearnerScope;
let trace: TraceContext;

beforeEach(async () => {
  db = await createMemoryTestDb();
  const user = await db.prisma.user.create({ data: { handle: "try" } });
  const problem = await db.prisma.problem.create({
    data: { slug: "adaptivepath-biology-2e-12-2", title: "Biology", statementMarkdown: "x", tags: "[]", methodName: "biology_reasoning" },
  });
  const session = await db.prisma.chatSession.create({ data: { userId: user.id, problemId: problem.id, title: "Bio", memoryOrigin: "test" } });
  scope = { userId: user.id, problemId: problem.id, chatSessionId: session.id, memoryOrigin: "test" };
  trace = createTraceContext({ prisma: db.prisma, userId: user.id, path: "memory", task: "biology_coach_turn", memoryOrigin: "test", captureLevel: "full" });
});
afterEach(async () => db.cleanup());

describe("biology offline tutor", () => {
  it("uses the offline hint ladder for a level-1 concept", () => {
    const result = biologyOfflineReply({ question, priorTutorTurns: 0, levels: [1] });
    expect(result).toMatchObject({ tool: "guided_hint", provider: "offline_rules" });
    expect(result.reply).toContain("step 1");
  });

  it("uses a worked example for an unjudged concept", () => {
    expect(biologyOfflineReply({ question, priorTutorTurns: 0, levels: [null] }).tool).toBe("worked_example");
  });
});

describe("biology coach memory recall", () => {
  it("derives signals and emits a retrieval trace with the recalled ids", async () => {
    const ctx = { rules: getRuleset(ACTIVE_RULE_VERSION), lookup: { has: () => true, optionIds: () => ["A", "B", "C", "D"] } };
    await recordAttempt(db.prisma, {
      scope, ctx,
      attempt: {
        attemptId: "a1", questionId: "b2e-12-2-q-c04-easy-02", questionType: "single_concept", conceptIds: ["b2e-12-2-concept-04"],
        difficulty: "easy", selectedOption: "A", correct: false, tutorUsed: true, referenceUsed: false, condition: 1,
        submittedAt: new Date().toISOString(), explanation: "the tester is recessive",
      },
    });
    const recalled = await recallBiologyCoachMemory(db.prisma, { scope, question, trace });
    expect(recalled.signals).toMatchObject({ level: 0, focusConceptId: "b2e-12-2-concept-04" });
    expect(recalled.signals.pastMisses).toHaveLength(1);
    expect(recalled.memory.states.get("b2e-12-2-concept-04")?.level).toBe(0);
    const events = await db.prisma.agentTraceEvent.findMany({ where: { traceRunId: trace.traceRunId, kind: "retrieval" }, include: { payload: true } });
    expect(events.map((e) => e.stage)).toEqual(["biology_l2_recall"]);
    expect(events[0].payload?.detailMetadataJson).toContain(recalled.signals.pastMisses[0].l1EventId);
  });
});

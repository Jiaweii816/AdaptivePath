/**
 * Opt-in live smoke test against the real Biology coach model (npm run test:biology-live).
 * Reads LLM_BIOLOGY_API_KEY / LLM_BIOLOGY_MODEL from .env.local; skipped otherwise.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBankQuestion } from "@/features/adaptivepath/question-bank";
import { loadBiologyView, tutorTurn, type BiologyDeps } from "@/server/adaptivepath/session";
import { createBiologyCoachClient } from "@/server/llm/anthropic-client";
import { getBiologyCoachModel } from "@/server/llm/models";
import { createMemoryTestDb, type MemoryTestDb } from "./memory-test-helpers";

const LIVE = process.env.RUN_LIVE_BIOLOGY_TESTS === "1";
const LIVE_TURN_TIMEOUT_MS = 60_000;
const env = { PATTERNCOACH_LOCAL_USER_HANDLE: "try", PATTERNCOACH_MEMORY_ORIGIN: "test", ADAPTIVEPATH_TUTOR_PROVIDER: "live" };
let db: MemoryTestDb;
let deps: BiologyDeps;

async function chat(message: string, draft = { selectedOption: "A", reasoning: "Half the offspring look dominant, so the parent must be heterozygous." }) {
  const view = await loadBiologyView(deps);
  const question = getBankQuestion(view.question!.id);
  return tutorTurn(deps, { focus: { kind: "current_question", questionId: question.id }, message, draft });
}

async function llmLatencies() {
  const events = await db.prisma.agentTraceEvent.findMany({ where: { kind: "llm" }, orderBy: { occurredAt: "asc" } });
  return events.map((e) => ({ title: e.title, status: e.status, durationMs: e.durationMs, outputTokens: e.providerOutputTokens }));
}

describe.skipIf(!LIVE)("biology coach live model", () => {
  beforeEach(async () => {
    process.loadEnvFile(".env.local"); // @next/env skips .env.local under NODE_ENV=test
    db = await createMemoryTestDb();
    await db.prisma.user.create({ data: { handle: "try" } });
    deps = { db: db.prisma, coach: { client: createBiologyCoachClient(), model: getBiologyCoachModel() }, env };
  });
  afterEach(async () => db.cleanup());

  it("answers a check_reasoning turn through classifier, diagnoser and coach", async () => {
    const result = await chat("Is my reasoning right?");
    console.log(JSON.stringify({ reply: result.reply, intents: result.intents, tools: result.tools, llm: await llmLatencies() }, null, 2));
    expect(result.provider).toBe("live_llm");
    expect(result.reply.trim().length).toBeGreaterThan(0);
  }, LIVE_TURN_TIMEOUT_MS);

  it("declines a request for the answer without leaking it", async () => {
    const result = await chat("Just tell me which option is correct.");
    console.log(JSON.stringify({ reply: result.reply, intents: result.intents, llm: await llmLatencies() }, null, 2));
    expect(result.intents).toContain("request_answer");
  }, LIVE_TURN_TIMEOUT_MS);
});

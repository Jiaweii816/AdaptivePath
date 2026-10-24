import { afterEach, describe, expect, it } from "vitest";
import {
  appendLlmCallTrace,
  createTraceContext,
  startTraceStep,
} from "@/server/llm/trace-context";
import { appendL1TraceEvent } from "@/server/memory/l1-trace/append-trace";
import { l1MemoryEventTypeSchema, type L1MemoryEventType } from "@/types/memory";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((database) => database.cleanup())));

describe("Phase 3 telemetry writer cutover", () => {
  it("writes a foreground LLM event into its allocated root Run without creating a second Run", async () => {
    const fixture = await createFixture();
    const context = createTraceContext({
      prisma: fixture.prisma,
      userId: fixture.user.id,
      problemId: fixture.problem.id,
      path: "review",
      task: "review.diagnose_and_reply",
      traceRunId: fixture.run.id,
      workspaceSessionId: fixture.session.id,
      turnOrdinal: 1,
      captureLevel: "full",
    });

    await appendLlmCallTrace({
      traceContext: context,
      step: startTraceStep(context, { spanKind: "llm" }),
      model: "deepseek-chat",
      responseModel: "deepseek-chat",
      latencyMs: 12,
      status: "ok",
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
        prompt_tokens_details: { cached_tokens: 25 },
        completion_tokens_details: { reasoning_tokens: 10 },
      },
      prompt: [
        { role: "system", content: "Coach policy", estimatedTokens: 3 },
        { role: "user", content: "Review this code", estimatedTokens: 4 },
      ],
      estimatedTokens: 7,
      input: { temperature: 0.2 },
      rawOutput: {
        content: "raw coach output",
        reasoning_content: "private reasoning must not persist",
      },
      parsedOutput: { diagnosis: { primaryIssue: "boundary" } },
      visibleOutput: "guarded visible reply",
    });
    await context.recorder?.finalize({ status: "succeeded" });

    expect(await fixture.prisma.agentTraceRun.count()).toBe(1);
    const event = await fixture.prisma.agentTraceEvent.findFirstOrThrow({
      where: { kind: "llm" },
      include: { payload: true },
    });
    expect(event).toMatchObject({
      traceRunId: fixture.run.id,
      workspaceSessionId: fixture.session.id,
      kind: "llm",
      providerInputTokens: 100,
      providerOutputTokens: 40,
      providerTotalTokens: 140,
      providerCachedTokens: 25,
      providerReasoningTokens: 10,
      estimatedTokens: 7,
      pricingStatus: "partial",
    });
    expect(event.estimatedCostUsd).not.toBeNull();
    expect(event.pricingVersion).toMatch(/2026-07-12/);
    expect(JSON.parse(event.payload?.promptJson ?? "[]")).toEqual([
      { role: "system", content: "Coach policy", estimatedTokens: 3 },
      { role: "user", content: "Review this code", estimatedTokens: 4 },
    ]);
    const outputJson = event.payload?.outputJson ?? "";
    expect(outputJson).toContain("raw coach output");
    expect(outputJson).toContain("guarded visible reply");
    expect(outputJson).toContain("primaryIssue");
    expect(outputJson).not.toContain("private reasoning must not persist");
    expect(outputJson).toContain("reasoning text not captured");
    expect(event.stepIndex).toBe(1);
    expect(
      await fixture.prisma.agentTraceEvent.findMany({
        where: { stage: "resource_sample" },
        select: { stepIndex: true },
      }),
    ).toEqual([{ stepIndex: null }]);
    expect(await fixture.prisma.l1MemoryEvent.count()).toBe(0);
  });

  it("lazily creates and terminalizes an unscoped Mock Interview Run without reasoning text", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
    const context = createTraceContext({
      prisma: database.prisma,
      userId: user.id,
      problemId: problem.id,
      path: "mock_interview",
      task: "mock_interview.respond",
      captureLevel: "full",
    });

    await appendLlmCallTrace({
      traceContext: context,
      step: startTraceStep(context, { spanKind: "llm" }),
      model: "deepseek-chat",
      latencyMs: 5,
      status: "ok",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      extraEventJson: { reasoningContent: "private chain of thought", reasoningTokens: 3 },
    });

    const run = await database.prisma.agentTraceRun.findUniqueOrThrow({ where: { id: context.traceRunId } });
    const event = await database.prisma.agentTraceEvent.findFirstOrThrow({
      where: { traceRunId: context.traceRunId },
      include: { payload: true },
    });
    expect(run).toMatchObject({
      workspaceSessionId: null,
      path: "mock_interview",
      status: "succeeded",
      traceCompleteness: "complete",
    });
    expect(event.seq).toBeNull();
    expect(event.payload?.detailMetadataJson).not.toContain("private chain of thought");
    expect(event.payload?.detailMetadataJson).toContain("reasoning text not captured");
  });

  it("keeps semantic L1 writes and rejects every telemetry-only family", async () => {
    const database = await createMemoryTestDb();
    databases.push(database);
    const { user } = await seedMinimalUserAndProblem(database.prisma);
    await appendL1TraceEvent(database.prisma, {
      userId: user.id,
      eventType: "chat_reply",
      content: "semantic reply",
    });
    expect(await database.prisma.l1MemoryEvent.count()).toBe(1);

    for (const eventType of [
      "llm_call",
      "tool_call",
      "tool_result",
      "retrieval_trace",
      "reply_safety_replaced",
    ]) {
      expect(l1MemoryEventTypeSchema.safeParse(eventType).success).toBe(false);
      await expect(appendL1TraceEvent(database.prisma, {
        userId: user.id,
        eventType: eventType as unknown as L1MemoryEventType,
      })).rejects.toThrow(/AgentTraceEvent/);
    }
    expect(await database.prisma.l1MemoryEvent.count()).toBe(1);
  });
});

async function createFixture() {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem } = await seedMinimalUserAndProblem(database.prisma);
  const session = await database.prisma.problemWorkspaceSession.create({
    data: {
      userId: user.id,
      problemId: problem.id,
      browserInstanceId: "writer-tab",
      activeIdentityKey: `${user.id}:${problem.id}:writer-tab`,
      startTrigger: "review",
      captureLevel: "full",
    },
  });
  const run = await database.prisma.agentTraceRun.create({
    data: {
      id: "writer-root-run",
      userId: user.id,
      problemId: problem.id,
      workspaceSessionId: session.id,
      turnOrdinal: 1,
      path: "review",
      processInstanceId: "writer-test-process",
    },
  });
  return { prisma: database.prisma, user, problem, session, run };
}

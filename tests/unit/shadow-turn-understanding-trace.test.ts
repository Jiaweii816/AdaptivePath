import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { buildChatTurnPlan } from "@/server/agents/coach-agent/chat-intent-policy";
import { captureShadowTurnUnderstandingBestEffort } from "@/server/agents/coach-agent/turn-understanding/shadow-trace";
import { parseTurnUnderstanding } from "@/server/agents/coach-agent/turn-understanding/parse-turn-understanding";
import { resolveRequestedActions } from "@/server/tools/chat-tools/requested-actions";
import {
  createMemoryTestDb,
  createTestForegroundTraceContext,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

const databases: MemoryTestDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.cleanup()));
});

describe("shadow turn-understanding trace", () => {
  it("persists the full bounded structure through TraceRecorder", async () => {
    const fixture = await createFixture(true);
    const message =
      "Run it again, then save this problem to my mistake book, but use Java and don't show full code";
    const legacyPlan = buildChatTurnPlan(message);
    const requestedActions = resolveRequestedActions(message);

    await captureShadowTurnUnderstandingBestEffort(fixture.traceContext, {
      understanding: parseTurnUnderstanding(
        message,
        legacyPlan,
        requestedActions,
      ),
      legacyPlan,
      requestedActions,
      provenance: "llm_validated",
      classifierActuallyCalled: true,
    });
    await fixture.traceContext.recorder?.finalize({ status: "succeeded" });

    const event = await fixture.database.prisma.agentTraceEvent.findFirstOrThrow({
      where: {
        traceRunId: fixture.traceContext.traceRunId,
        stage: "shadow_turn_understanding",
      },
      include: { payload: true },
    });
    const output = JSON.parse(event.payload?.outputJson ?? "{}") as Record<
      string,
      unknown
    >;
    const metadata = JSON.parse(event.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;

    expect(event).toMatchObject({
      kind: "guard",
      status: "succeeded",
      title: "Consumed structured turn understanding with legacy comparison",
    });
    expect(output).toMatchObject({
      route: "llm",
      resolution: {
        provenance: "llm_validated",
        classifierActuallyCalled: true,
      },
      unsupportedScope: { languageMention: "Java" },
      legacySnapshot: { primaryIntent: "run_case_request" },
      bounds: { maxItems: 32 },
    });
    expect(output).toHaveProperty("clauses");
    expect(output).toHaveProperty("operations");
    expect(output).toHaveProperty("modifiers");
    expect(output).toHaveProperty("discourseMarkers");
    expect(output).toHaveProperty("negationSignals");
    expect(output).toHaveProperty("learnerStateSignals");
    expect(output).toHaveProperty("ambiguity");
    expect(output).toHaveProperty("requestedActions");
    expect(metadata).toMatchObject({
      parserVersion: "intent-p1-shadow-v1",
      route: "llm",
      legacyIntent: "run_case_request",
      hasDiscourse: true,
      hasNegation: true,
      unsupportedLanguage: "Java",
      provenance: "llm_validated",
      classifierActuallyCalled: true,
      classifierAttempted: true,
      deterministic: false,
      role: "consumed_with_legacy_comparison",
    });
    expect(metadata.operationSignature).toContain("execute:current_user_code");
    expect(metadata.sideEffectSignature).toContain("execute:current_user_code");
    expect(metadata.requestedActionSignature).toContain(
      "save_mistake_book_entry:granted",
    );
  });

  it("retains query-safe scalar signatures in summary capture", async () => {
    const fixture = await createFixture(false);
    fixture.traceContext.captureLevel = "summary";
    const message = "Why is this bug still happening?";
    const legacyPlan = buildChatTurnPlan(message);

    await captureShadowTurnUnderstandingBestEffort(fixture.traceContext, {
      understanding: parseTurnUnderstanding(message, legacyPlan, []),
      legacyPlan,
      requestedActions: [],
    });

    const event = await fixture.database.prisma.agentTraceEvent.findFirstOrThrow({
      where: {
        traceRunId: fixture.traceContext.traceRunId,
        stage: "shadow_turn_understanding",
      },
      include: { payload: true },
    });
    const metadata = JSON.parse(event.metadataJson ?? "{}") as Record<
      string,
      unknown
    >;
    const output = JSON.parse(event.payload?.outputJson ?? "{}") as Record<
      string,
      unknown
    >;

    expect(event.payloadState).toBe("summary_only");
    expect(metadata).toMatchObject({
      parserVersion: "intent-p1-shadow-v1",
      route: "llm",
      hasDiscourse: true,
      deterministic: true,
      role: "consumed_with_legacy_comparison",
      clauseCount: 1,
      operationCount: 1,
      codeDisclosure: "guided",
      affect: "none",
      deliveryMode: "direct",
      requestedArtifact: "explanation",
      blocksSideEffect: false,
      unresolvedOperationCount: 0,
      discourseKindSignature: "continuation_marker",
    });
    expect(metadata.operationSignature).toContain("diagnose:current_user_code");
    expect(output).toMatchObject({ capture: "summary_only", valueType: "object" });
  });
});

async function createFixture(bufferedRecorder: boolean) {
  const database = await createMemoryTestDb();
  databases.push(database);
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(
    database.prisma,
  );
  const traceContext = await createTestForegroundTraceContext({
    prisma: database.prisma,
    userId: user.id,
    problemId: problem.id,
    chatSessionId: chatSession.id,
    path: "chat",
    task: "shadow-turn-understanding-test",
    traceRunId: `shadow-turn-${randomUUID()}`,
    bufferedRecorder,
  });
  return { database, traceContext };
}

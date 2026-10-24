import { afterEach, describe, expect, it } from "vitest";
import {
  captureNormalizedTraceEvent,
  type PreCaptureTraceEvent,
} from "@/server/observability/runtime-trace-capture";
import { loadFormalTraceProjection } from "@/server/observability/formal-trace-projection";
import { flushTraceEvents } from "@/server/observability/trace-store";
import {
  buildAgentObservabilityReport,
  loadAgentObservabilityRows,
} from "@/server/observability/agent-observability";
import { getProcessInstanceId } from "@/server/observability/process-instance";
import {
  createMemoryTestDb,
  seedMinimalUserAndProblem,
  type MemoryTestDb,
} from "./memory-test-helpers";

let database: MemoryTestDb | undefined;

afterEach(async () => {
  await database?.cleanup();
  database = undefined;
});

describe("formal trace projection", () => {
  it("joins semantic L1 replies with new-store tool telemetry and ignores old L1 telemetry", async () => {
    const fixture = await createFixture();
    await fixture.prisma.l1MemoryEvent.createMany({
      data: [
        {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          chatSessionId: fixture.chatSession.id,
          eventType: "chat_reply",
          source: "chat_reply",
          content: "The projected tool result passed.",
          eventJson: JSON.stringify({
            traceRunId: fixture.chatRun.id,
            timings: { totalMs: 30, llmMsTotal: 20, toolMsTotal: 5 },
          }),
        },
        {
          userId: fixture.user.id,
          problemId: fixture.problem.id,
          chatSessionId: fixture.chatSession.id,
          eventType: "tool_call",
          source: "legacy-decoy",
          eventJson: JSON.stringify({
            traceRunId: "must-not-be-read",
            toolCallId: "old-call",
            toolName: "old_tool",
          }),
        },
      ],
    });
    await flushTraceEvents(fixture.prisma, [
      traceEvent({
        eventId: "new-tool-call",
        traceRunId: fixture.chatRun.id,
        kind: "tool",
        title: "Tool call",
        status: "started",
        input: { language: "Python", tests: [{ label: "abba" }] },
        metadata: {
          source: "chat_reply",
          eventRole: "call",
          toolCallId: "call-1",
          toolName: "run_code",
          sequence: 1,
        },
      }),
      traceEvent({
        eventId: "new-tool-result",
        traceRunId: fixture.chatRun.id,
        kind: "tool",
        title: "Tool result",
        status: "succeeded",
        output: {
          result: {
            status: "passed_visible_tests",
            passedCount: 1,
            failedCount: 0,
          },
        },
        metadata: {
          source: "chat_reply",
          eventRole: "result",
          toolCallId: "call-1",
          toolName: "run_code",
          sequence: 1,
          latencyMs: 5,
          approxResultTokens: 12,
        },
      }),
    ]);

    const rows = await loadFormalTraceProjection(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      eventTypes: ["chat_reply", "tool_call", "tool_result"],
    });

    expect(rows.map((row) => [row.store, row.eventType])).toEqual([
      ["agent_trace", "tool_call"],
      ["agent_trace", "tool_result"],
      ["semantic_l1", "chat_reply"],
    ]);
    expect(rows.map((row) => row.eventJson).join("\n")).not.toContain("old-call");
    expect(JSON.parse(rows[0].eventJson)).toMatchObject({
      traceRunId: fixture.chatRun.id,
      toolCallId: "call-1",
      toolName: "run_code",
      arguments: { language: "Python" },
      sequence: 1,
    });
    expect(JSON.parse(rows[1].eventJson)).toMatchObject({
      toolCallId: "call-1",
      result: { result: { status: "passed_visible_tests" } },
    });
  });

  it("keeps unscoped Mock Interview LLM telemetry visible to agent observability", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      traceEvent({
        eventId: "mock-llm",
        traceRunId: fixture.mockRun.id,
        kind: "llm",
        title: "Interviewer LLM call",
        status: "succeeded",
        metadata: {
          source: "mock_interview:start",
          task: "mock_interview.start",
        },
        metrics: {
          providerInputTokens: 10,
          providerOutputTokens: 4,
          providerTotalTokens: 14,
          usageSource: "provider",
          pricingStatus: "unpriced",
        },
      }),
    ]);

    const rows = await loadAgentObservabilityRows(fixture.prisma);
    const report = buildAgentObservabilityReport({
      rows,
      dbPath: database!.dbPath,
      explicitDb: true,
      generatedAt: new Date("2026-07-12T18:00:00.000Z"),
    });

    expect(rows.find((row) => row.eventType === "llm_call")).toMatchObject({
      chatSessionId: null,
      eventType: "llm_call",
    });
    expect(
      report.llmCalls.find(
        (group) =>
          group.path === "mock_interview" &&
          group.task === "mock_interview.start",
      )?.count,
    ).toBe(1);
  });

  it("does not project new retrieval and guard stages as legacy telemetry decoys", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      traceEvent({
        eventId: "focused-memory",
        traceRunId: fixture.chatRun.id,
        kind: "retrieval",
        title: "Focused memory retrieval",
        status: "succeeded",
        metadata: { source: "retrieve_memory" },
      }),
      traceEvent({
        eventId: "handbook-decoy",
        traceRunId: fixture.chatRun.id,
        kind: "retrieval",
        title: "Knowledge Handbook lookup",
        status: "succeeded",
        metadata: { source: "chat_reply:handbook_lookup" },
      }),
      traceEvent({
        eventId: "replacement",
        traceRunId: fixture.chatRun.id,
        kind: "guard",
        title: "Reply safety replacement · verdict",
        status: "succeeded",
        input: { originalReply: "unsafe claim" },
        output: { replacement: "evidence-scoped reply" },
        metadata: { source: "chat_reply", eventRole: "replacement" },
      }),
      traceEvent({
        eventId: "policy-decoy",
        traceRunId: fixture.chatRun.id,
        kind: "guard",
        title: "Intent and policy",
        status: "succeeded",
        metadata: { source: "chat_reply", eventRole: "policy" },
      }),
    ]);

    const rows = await loadFormalTraceProjection(fixture.prisma, {
      eventTypes: ["retrieval_trace", "reply_safety_replaced"],
    });

    expect(rows.map((row) => [row.eventType, row.eventId])).toEqual([
      ["retrieval_trace", "focused-memory"],
      ["reply_safety_replaced", "replacement"],
    ]);
    expect(JSON.parse(rows[1].eventJson)).toMatchObject({
      originalReply: "unsafe claim",
      replacement: "evidence-scoped reply",
    });
  });

  it("uses trace causal order when telemetry shares a millisecond", async () => {
    const fixture = await createFixture();
    await flushTraceEvents(fixture.prisma, [
      traceEvent({
        eventId: "same-tick-tool-result",
        traceRunId: fixture.chatRun.id,
        kind: "tool",
        title: "Tool result",
        status: "succeeded",
        stepIndex: 2,
        metadata: { source: "chat_reply", eventRole: "result" },
      }),
      traceEvent({
        eventId: "same-tick-llm-after-tool",
        traceRunId: fixture.chatRun.id,
        kind: "llm",
        title: "LLM · chat.tool_loop.turn",
        status: "succeeded",
        stepIndex: 3,
      }),
      traceEvent({
        eventId: "same-tick-tool-call",
        traceRunId: fixture.chatRun.id,
        kind: "tool",
        title: "Tool call",
        status: "started",
        stepIndex: 2,
        metadata: { source: "chat_reply", eventRole: "call" },
      }),
      traceEvent({
        eventId: "same-tick-llm-before-tool",
        traceRunId: fixture.chatRun.id,
        kind: "llm",
        title: "LLM · chat.tool_loop.turn",
        status: "succeeded",
        stepIndex: 1,
      }),
    ]);

    const rows = await loadFormalTraceProjection(fixture.prisma, {
      chatSessionId: fixture.chatSession.id,
      order: "asc",
    });

    expect(rows.map((row) => row.eventId)).toEqual([
      "same-tick-llm-before-tool",
      "same-tick-tool-call",
      "same-tick-tool-result",
      "same-tick-llm-after-tool",
    ]);
  });
});

async function createFixture() {
  database = await createMemoryTestDb();
  const { user, problem, chatSession } = await seedMinimalUserAndProblem(
    database.prisma,
  );
  const chatRun = await database.prisma.agentTraceRun.create({
    data: {
      id: "formal-chat-run",
      userId: user.id,
      problemId: problem.id,
      chatSessionId: chatSession.id,
      path: "chat",
      actionKind: "chat",
      processInstanceId: getProcessInstanceId(),
    },
  });
  const mockRun = await database.prisma.agentTraceRun.create({
    data: {
      id: "formal-mock-run",
      userId: user.id,
      problemId: problem.id,
      path: "mock_interview",
      actionKind: "mock_interview",
      processInstanceId: getProcessInstanceId(),
    },
  });
  return { prisma: database.prisma, user, problem, chatSession, chatRun, mockRun };
}

function traceEvent(args: {
  eventId: string;
  traceRunId: string;
  stepIndex?: number;
  kind: "tool" | "llm" | "retrieval" | "guard";
  title: string;
  status: "started" | "succeeded";
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: PreCaptureTraceEvent["metrics"];
}) {
  return captureNormalizedTraceEvent(
    {
      identity: {
        eventId: args.eventId,
        traceRunId: args.traceRunId,
        stepIndex: args.stepIndex ?? 1,
      },
      scope: {
        path: args.kind === "llm" ? "mock_interview" : "chat",
        stage: args.kind === "llm" ? "interviewer" : "bounded_agent_loop",
        kind: args.kind,
        title: args.title,
      },
      lifecycle: {
        status: args.status,
        occurredAt: "2026-07-12T12:00:00.000Z",
        durationMs: 5,
      },
      details: {
        input: args.input,
        output: args.output,
        metadata: args.metadata,
      },
      metrics: args.metrics,
    },
    { detailLevel: "full", env: {} },
  );
}

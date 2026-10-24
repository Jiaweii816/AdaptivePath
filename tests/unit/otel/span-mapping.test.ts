import { describe, expect, it } from "vitest";
import { mapRowsToSpans } from "@/observability/otel/span-mapping";
import type { AgentObservabilityTraceRow } from "@/server/observability/agent-observability";

function row(input: {
  id: string;
  eventType: string;
  at: string;
  json?: unknown;
  rawJson?: string;
}): AgentObservabilityTraceRow {
  return {
    id: input.id,
    userId: "user-1",
    problemId: null,
    chatSessionId: null,
    reviewAttemptId: null,
    eventType: input.eventType,
    eventJson: input.rawJson ?? JSON.stringify(input.json ?? {}),
    content: null,
    source: null,
    occurredAt: new Date(input.at),
    createdAt: new Date(input.at),
  };
}

describe("mapRowsToSpans", () => {
  it("maps an LLM call with the installed OTel GenAI semantic attributes", () => {
    const [span] = mapRowsToSpans([
      row({
        id: "event-1",
        eventType: "llm_call",
        at: "2026-07-21T00:00:00Z",
        json: {
          traceRunId: "trace-run-1",
          path: "chat",
          task: "chat.reply",
          pricingProvider: "legacy-provider-label",
          model: "deepseek-chat",
          status: "ok",
          latencyMs: 1_200,
          usage: { inputTokens: 800, outputTokens: 200 },
        },
      }),
    ]);

    expect(span.kind).toBe("llm");
    expect(span.name).toBe("chat deepseek-chat");
    expect(span.endMs - span.startMs).toBe(1_200);
    expect(span.endMs).toBe(Date.parse("2026-07-21T00:00:00Z"));
    expect(span.attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "deepseek",
      "gen_ai.request.model": "deepseek-chat",
      "gen_ai.usage.input_tokens": 800,
      "gen_ai.usage.output_tokens": 200,
      "patterncoach.task": "chat.reply",
    });
    expect(span.attributes).not.toHaveProperty("gen_ai.system");
  });

  it("emits one tool span and takes its duration from the correlated result", () => {
    const spans = mapRowsToSpans([
      row({
        id: "result-1",
        eventType: "tool_result",
        at: "2026-07-21T00:00:02Z",
        json: {
          traceRunId: "trace-run-1",
          stepId: "trace-run-1:2",
          toolName: "run_current_code",
          status: "ok",
          latencyMs: 50,
        },
      }),
      row({
        id: "call-1",
        eventType: "tool_call",
        at: "2026-07-21T00:00:01Z",
        json: {
          traceRunId: "trace-run-1",
          stepId: "trace-run-1:2",
          toolName: "run_current_code",
        },
      }),
    ]);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      kind: "tool",
      name: "execute_tool run_current_code",
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "run_current_code",
        "patterncoach.status": "ok",
      },
    });
    expect(spans[0].endMs - spans[0].startMs).toBe(50);
  });

  it("uses legal stable IDs and groups equal traceRunIds regardless of input order", () => {
    const first = row({
      id: "not-hex-event-a",
      eventType: "llm_call",
      at: "2026-07-21T00:00:02Z",
      json: { traceRunId: "not-a-hex-trace", model: "deepseek-chat" },
    });
    const second = row({
      id: "not-hex-event-b",
      eventType: "tool_call",
      at: "2026-07-21T00:00:01Z",
      json: { traceRunId: "not-a-hex-trace", toolName: "past_problem_recall" },
    });

    const forward = mapRowsToSpans([first, second]);
    const reversed = mapRowsToSpans([second, first]);

    expect(forward).toEqual(reversed);
    expect(new Set(forward.map((span) => span.traceId)).size).toBe(1);
    expect(new Set(forward.map((span) => span.spanId)).size).toBe(2);
    for (const span of forward) {
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/u);
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/u);
      expect(span.traceId).not.toMatch(/^0+$/u);
      expect(span.spanId).not.toMatch(/^0+$/u);
    }
  });

  it("maps path rows and preserves a real zero-duration span", () => {
    const [span] = mapRowsToSpans([
      row({
        id: "path-1",
        eventType: "chat_reply",
        at: "2026-07-21T00:00:00Z",
        json: { traceRunId: "trace-run-1", timings: { totalMs: 0 } },
      }),
    ]);

    expect(span).toMatchObject({ kind: "path", name: "chat turn" });
    expect(span.endMs).toBe(span.startMs);
  });

  it("does not throw on malformed JSON, negative latency, or unsupported rows", () => {
    const spans = mapRowsToSpans([
      row({
        id: "bad-json",
        eventType: "llm_call",
        at: "2026-07-21T00:00:00Z",
        rawJson: "{not json",
      }),
      row({
        id: "negative-latency",
        eventType: "tool_call",
        at: "2026-07-21T00:00:01Z",
        json: { traceRunId: "trace-run-2", toolName: "x", latencyMs: -10 },
      }),
      row({
        id: "ignored",
        eventType: "diagnosis",
        at: "2026-07-21T00:00:02Z",
        json: { traceRunId: "trace-run-2" },
      }),
    ]);

    expect(spans).toHaveLength(2);
    expect(spans[0].endMs).toBe(spans[0].startMs);
    expect(spans[1].endMs).toBe(spans[1].startMs);
    expect(spans[0].traceId).not.toBe(spans[1].traceId);
  });
});

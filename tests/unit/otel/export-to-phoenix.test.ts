import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-node";
import { SpanStatusCode } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import {
  exportSpans,
  resolvePhoenixTraceEndpoint,
} from "@/observability/otel/export-to-phoenix";
import type { GenAiSpan } from "@/observability/otel/span-mapping";

describe("resolvePhoenixTraceEndpoint", () => {
  it("adds the OTLP HTTP trace path to the Phoenix base URL", () => {
    expect(resolvePhoenixTraceEndpoint("http://localhost:6006")).toBe(
      "http://localhost:6006/v1/traces",
    );
  });

  it("does not duplicate an existing trace path", () => {
    expect(
      resolvePhoenixTraceEndpoint("http://localhost:6006/v1/traces"),
    ).toBe("http://localhost:6006/v1/traces");
  });
});

describe("exportSpans", () => {
  it("sends mapped spans through a real processor in one trace waterfall", async () => {
    const exporter = new CapturingSpanExporter();
    const traceId = "0123456789abcdef0123456789abcdef";
    const spans: GenAiSpan[] = [
      {
        traceId,
        spanId: "1111111111111111",
        name: "llm chat_reply",
        startMs: 1_000,
        endMs: 1_050,
        kind: "llm",
        attributes: {
          "gen_ai.operation.name": "chat_reply",
          "gen_ai.request.model": "deepseek-chat",
        },
      },
      {
        traceId,
        spanId: "2222222222222222",
        name: "tool past_mistake_recall",
        startMs: 1_010,
        endMs: 1_020,
        kind: "tool",
        attributes: {
          "gen_ai.tool.name": "past_mistake_recall",
          "patterncoach.status": "error",
        },
      },
    ];

    // Production defaults to BatchSpanProcessor; forceFlush in exportSpans
    // makes this deterministic without replacing the processor with a mock.
    await exportSpans(spans, { exporter });

    expect(exporter.finished).toHaveLength(3);
    const root = exporter.finished.find(
      (span) => span.name === "patterncoach replay",
    );
    const children = exporter.finished.filter((span) => span !== root);
    expect(root?.spanContext().traceId).toBe(traceId);
    expect(children.every((span) => span.spanContext().traceId === traceId)).toBe(
      true,
    );
    expect(children.map((span) => span.spanContext().spanId)).toEqual([
      "1111111111111111",
      "2222222222222222",
    ]);
    expect(
      children.every(
        (span) =>
          span.parentSpanContext?.spanId === root?.spanContext().spanId,
      ),
    ).toBe(true);
    expect(
      children.find((span) => span.name.startsWith("llm"))?.attributes[
        "openinference.span.kind"
      ],
    ).toBe("LLM");
    expect(root?.resource.attributes["openinference.project.name"]).toBe(
      "patterncoach",
    );
    expect(children.find((span) => span.name.startsWith("tool"))?.status.code).toBe(
      SpanStatusCode.ERROR,
    );
    expect(root?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("keeps trace and span IDs deterministic across repeated multi-trace replay", async () => {
    const spans: GenAiSpan[] = [
      {
        traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        spanId: "1111111111111111",
        name: "chat model-a",
        startMs: 1_000,
        endMs: 1_010,
        kind: "llm",
        attributes: {},
      },
      {
        traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        spanId: "2222222222222222",
        name: "execute_tool tool-b",
        startMs: 2_000,
        endMs: 2_020,
        kind: "tool",
        attributes: {},
      },
    ];
    const first = new CapturingSpanExporter();
    const second = new CapturingSpanExporter();

    await exportSpans(spans, { exporter: first, processor: "simple" });
    await exportSpans(spans, { exporter: second, processor: "simple" });

    const identities = (exporter: CapturingSpanExporter) =>
      exporter.finished.map((span) => ({
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentId: span.parentSpanContext?.spanId,
      }));

    expect(identities(first)).toEqual(identities(second));
    expect(new Set(first.finished.map((span) => span.spanContext().traceId))).toEqual(
      new Set(spans.map((span) => span.traceId)),
    );
  });
});

class CapturingSpanExporter implements SpanExporter {
  readonly finished: ReadableSpan[] = [];

  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: 0 | 1; error?: Error }) => void,
  ) {
    this.finished.push(...spans);
    resultCallback({ code: 0 });
  }

  async forceFlush() {}

  async shutdown() {}
}

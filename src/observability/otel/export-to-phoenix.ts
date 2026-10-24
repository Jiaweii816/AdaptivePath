import { createHash } from "node:crypto";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  BasicTracerProvider,
  RandomIdGenerator,
  SimpleSpanProcessor,
  type IdGenerator,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";
import type { GenAiSpan } from "./span-mapping";

const DEFAULT_PHOENIX_ENDPOINT = "http://localhost:6006";
const DEFAULT_PROJECT_NAME = "patterncoach";

type ExportSpansOptions = {
  endpoint?: string;
  exporter?: SpanExporter;
  processor?: "batch" | "simple";
  projectName?: string;
};

/**
 * OTEL_EXPORTER_OTLP_ENDPOINT is a base URL. The OTLP/HTTP trace exporter needs
 * the signal path; tolerate callers already supplying the complete trace URL.
 */
export function resolvePhoenixTraceEndpoint(
  endpoint?: string,
): string {
  const signalEndpoint =
    endpoint === undefined
      ? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      : undefined;
  const selected =
    endpoint ??
    signalEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    DEFAULT_PHOENIX_ENDPOINT;
  const url = new URL(selected);
  const path = url.pathname.replace(/\/+$/, "");
  // OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is already a signal-specific URL;
  // explicit CLI/options endpoints and OTEL_EXPORTER_OTLP_ENDPOINT are bases.
  if (!signalEndpoint && !path.endsWith("/v1/traces")) {
    url.pathname = `${path}/v1/traces`;
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Replay persisted PatternCoach events through a real OTel span processor.
 * Each mapped traceRunId becomes one trace with a small replay root so Phoenix
 * can render the mapped LLM/tool/path spans as a coherent waterfall.
 */
export async function exportSpans(
  spans: GenAiSpan[],
  options: ExportSpansOptions = {},
): Promise<void> {
  if (spans.length === 0) return;

  const groups = groupByTraceId(spans);
  const exporter =
    options.exporter ??
    new OTLPTraceExporter({
      url: resolvePhoenixTraceEndpoint(options.endpoint),
    });
  const processor =
    options.processor === "simple"
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter);
  const provider = new BasicTracerProvider({
    idGenerator: new ReplayIdGenerator(
      [...groups.keys()],
      [...groups].flatMap(([traceId, traceSpans]) => [
        stableSpanId(`root:${traceId}`),
        ...traceSpans.map((span) => normalizeSpanId(span.spanId)),
      ]),
    ),
    resource: resourceFromAttributes({
      "service.name": DEFAULT_PROJECT_NAME,
      "openinference.project.name":
        options.projectName ?? DEFAULT_PROJECT_NAME,
    }),
    spanProcessors: [processor],
  });
  const tracer = provider.getTracer("patterncoach-replay", "0.1.0");

  try {
    for (const [traceId, traceSpans] of groups) {
      const startMs = Math.min(...traceSpans.map((span) => span.startMs));
      const endMs = Math.max(...traceSpans.map((span) => span.endMs));
      const root = tracer.startSpan(
        "patterncoach replay",
        {
          attributes: {
            "openinference.span.kind": "CHAIN",
            "patterncoach.replay.original_trace_id": traceId,
          },
          kind: SpanKind.INTERNAL,
          startTime: startMs,
        },
        ROOT_CONTEXT,
      );
      const rootContext = trace.setSpan(ROOT_CONTEXT, root);

      for (const mapped of traceSpans) {
        const span = tracer.startSpan(
          mapped.name,
          {
            attributes: {
              ...mapped.attributes,
              "openinference.span.kind": toOpenInferenceSpanKind(mapped.kind),
              "patterncoach.replay.original_span_id": mapped.spanId,
            },
            kind: SpanKind.INTERNAL,
            startTime: mapped.startMs,
          },
          rootContext,
        );
        if (isErrorStatus(mapped.attributes["patterncoach.status"])) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          root.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end(mapped.endMs);
      }

      root.end(endMs);
    }

    await provider.forceFlush();
  } finally {
    await provider.shutdown();
  }
}

function groupByTraceId(spans: GenAiSpan[]) {
  const grouped = new Map<string, GenAiSpan[]>();
  for (const span of spans) {
    const traceId = normalizeTraceId(span.traceId);
    const current = grouped.get(traceId) ?? [];
    current.push(span);
    grouped.set(traceId, current);
  }
  return grouped;
}

function normalizeTraceId(value: string) {
  const normalized = value.toLowerCase();
  if (/^[0-9a-f]{32}$/.test(normalized) && !/^0+$/.test(normalized)) {
    return normalized;
  }
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function normalizeSpanId(value: string) {
  const normalized = value.toLowerCase();
  if (/^[0-9a-f]{16}$/.test(normalized) && !/^0+$/.test(normalized)) {
    return normalized;
  }
  return stableSpanId(value);
}

function stableSpanId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function toOpenInferenceSpanKind(kind: GenAiSpan["kind"]) {
  if (kind === "llm") return "LLM";
  if (kind === "tool") return "TOOL";
  return "CHAIN";
}

function isErrorStatus(value: string | number | undefined) {
  return (
    typeof value === "string" &&
    ["error", "failed", "failure"].includes(value.toLowerCase())
  );
}

class ReplayIdGenerator implements IdGenerator {
  private readonly random = new RandomIdGenerator();

  constructor(
    private readonly traceIds: string[],
    private readonly spanIds: string[],
  ) {}

  generateTraceId(): string {
    return this.traceIds.shift() ?? this.random.generateTraceId();
  }

  generateSpanId(): string {
    return this.spanIds.shift() ?? this.random.generateSpanId();
  }
}

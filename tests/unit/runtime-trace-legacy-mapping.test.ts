import { describe, expect, it } from "vitest";
import fixture from "../fixtures/runtime-trace/legacy-l1-v1.json";
import {
  LEGACY_TELEMETRY_EVENT_TYPES,
  isLegacyTelemetryEventType,
  mapLegacyL1TelemetryEvent,
} from "@/server/observability/runtime-trace-legacy-mapping";
import { normalizedTraceEventSchema } from "@/server/observability/runtime-trace-contract";

describe("runtime trace deterministic legacy mapping", () => {
  it("owns exactly the five telemetry-only L1 families", () => {
    expect(LEGACY_TELEMETRY_EVENT_TYPES).toEqual([
      "llm_call", "tool_call", "tool_result", "retrieval_trace", "reply_safety_replaced",
    ]);
  });

  it("maps the frozen table and leaves semantic rows in L1", () => {
    const mapped = fixture.rows
      .filter((row) => isLegacyTelemetryEventType(row.eventType))
      .map((row) => mapLegacyL1TelemetryEvent(row));

    expect(mapped).toHaveLength(9);
    for (const event of mapped) {
      expect(normalizedTraceEventSchema.safeParse(event).success).toBe(true);
      expect(event.identity.workspaceSessionId).toBeUndefined();
    }

    expect(mapped.slice(0, 8).map((event) => ({
      eventId: event.identity.eventId,
      traceRunId: event.identity.traceRunId,
      path: event.scope.path,
      stage: event.scope.stage,
      kind: event.scope.kind,
      title: event.scope.title,
      status: event.lifecycle.status,
    }))).toEqual([
      { eventId: "legacy:l1:l1-llm-normal", traceRunId: "run-normal", path: "review", stage: "legacy_llm", kind: "llm", title: "Legacy LLM call", status: "succeeded" },
      { eventId: "legacy:l1:l1-tool-missing-run", traceRunId: "legacy:run:l1-tool-missing-run", path: "chat", stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool call", status: "started" },
      { eventId: "legacy:l1:l1-tool-result-error", traceRunId: "run-chat", path: "chat", stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool result", status: "failed" },
      { eventId: "legacy:l1:l1-tool-result-reused", traceRunId: "run-chat", path: "chat", stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool result", status: "succeeded" },
      { eventId: "legacy:l1:l1-tool-result-denied", traceRunId: "run-chat", path: "chat", stage: "legacy_tool_loop", kind: "tool", title: "Legacy tool result", status: "skipped" },
      { eventId: "legacy:l1:l1-retrieval-degraded", traceRunId: "run-review-2", path: "review", stage: "legacy_context_memory", kind: "retrieval", title: "Legacy memory retrieval", status: "degraded" },
      { eventId: "legacy:l1:l1-guard", traceRunId: "run-chat", path: "chat", stage: "legacy_guard", kind: "guard", title: "Legacy reply safety guard", status: "succeeded" },
      { eventId: "legacy:l1:l1-mock-llm", traceRunId: "run-mock", path: "mock_interview", stage: "legacy_llm", kind: "llm", title: "Legacy LLM call", status: "failed" },
    ]);

    expect(fixture.rows.filter((row) => !isLegacyTelemetryEventType(row.eventType)).map((row) => row.eventType)).toEqual([
      "chat_reply", "mock_interview_turn",
    ]);
  });

  it.each([
    ["none", "succeeded"],
    ["", "succeeded"],
    ["fts_only", "succeeded"],
    ["lexical_only", "succeeded"],
    ["embed_error", "degraded"],
  ] as const)("maps production retrieval degradation %j to %s", (degraded, status) => {
    const row = fixture.rows.find((candidate) => candidate.id === "l1-retrieval-degraded");
    expect(mapLegacyL1TelemetryEvent({
      ...row!,
      id: `retrieval-${degraded || "empty"}`,
      eventJson: { ...row!.eventJson, degraded },
    }).lifecycle.status).toBe(status);
  });

  it("preserves implicit successful tool results and marks synthesized run ids unavailable", () => {
    const mapped = mapLegacyL1TelemetryEvent({
      id: "implicit-tool-success",
      eventType: "tool_result",
      eventJson: {
        toolName: "run_code",
        result: { ok: true },
      },
      source: "chat_reply",
      occurredAt: "2026-07-12T00:00:00.000Z",
    });

    expect(mapped.lifecycle.status).toBe("succeeded");
    expect(mapped.identity.traceRunId).toBe("legacy:run:implicit-tool-success");
    expect(mapped.capture.unavailableFields).toContain("traceRunId");
  });

  it("is idempotent for replayed ids and detects conflicting content by digest", () => {
    const duplicateRows = fixture.rows.filter((row) => row.id === "l1-tool-missing-run");
    const first = mapLegacyL1TelemetryEvent(duplicateRows[0]);
    const replay = mapLegacyL1TelemetryEvent(duplicateRows[1]);
    const conflict = mapLegacyL1TelemetryEvent({
      ...duplicateRows[1],
      eventJson: {
        ...duplicateRows[1].eventJson,
        toolName: "past_problem_recall",
      },
    });

    expect(replay.identity).toEqual(first.identity);
    expect(conflict.identity.eventId).toBe(first.identity.eventId);
    expect(conflict.identity.eventDigest).not.toBe(first.identity.eventDigest);
  });

  it("redacts and truncates legacy payloads before computing their digest", () => {
    const mapped = mapLegacyL1TelemetryEvent({
      id: "legacy-private-llm",
      eventType: "llm_call",
      source: "review:diagnose",
      occurredAt: "2026-07-12T12:00:00.000Z",
      eventJson: {
        traceRunId: "run-private",
        path: "review",
        status: "ok",
        apiKey: "must-not-be-persisted",
        reasoning_content: "private chain of thought",
        reasoningTokens: 17,
        cachedTokens: 8,
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
        },
      },
    });

    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toContain("must-not-be-persisted");
    expect(serialized).not.toContain("private chain of thought");
    expect(mapped.capture).toMatchObject({
      detailLevel: "full",
      payloadState: "captured",
    });
    expect(mapped.capture.redactedFields).toEqual(
      expect.arrayContaining([
        "$.details.metadata.apiKey",
        "$.details.metadata.reasoning_content",
      ]),
    );
    expect(mapped.metrics).toMatchObject({
      providerCachedTokens: 8,
      providerReasoningTokens: 17,
      usageSource: "provider",
    });
    expect(mapped.capture.unavailableFields).not.toContain(
      "providerCachedTokens",
    );
    expect(mapped.capture.unavailableFields).not.toContain(
      "providerReasoningTokens",
    );
  });

  it("separates legacy tool and guard payloads from query metadata", () => {
    const tool = mapLegacyL1TelemetryEvent(
      fixture.rows.find((row) => row.id === "l1-tool-missing-run")!,
    );
    const guard = mapLegacyL1TelemetryEvent(
      fixture.rows.find((row) => row.id === "l1-guard")!,
    );

    expect(tool.details?.input).toEqual({ tests: ["visible-1"] });
    expect(tool.details?.metadata).not.toHaveProperty("arguments");
    expect(guard.details?.output).toEqual({
      originalReply: "unsafe",
      replacement: "safe",
    });
  });

  it("does not accept semantic or unknown event families", () => {
    const semanticRow = fixture.rows.find((row) => row.eventType === "chat_reply");
    expect(() => mapLegacyL1TelemetryEvent(semanticRow!)).toThrow(/telemetry-only/);
    expect(() => mapLegacyL1TelemetryEvent({ ...fixture.rows[0], eventType: "unknown" })).toThrow(/telemetry-only/);
  });
});

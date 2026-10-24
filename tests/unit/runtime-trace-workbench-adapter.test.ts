import { describe, expect, it } from "vitest";

import {
  filterRuntimeTraceEventsForDisplay,
  toRuntimeTraceTimelineEvents,
} from "@/features/runtime-trace/runtime-trace-workbench-adapter";
import type { RuntimeTraceEvent } from "@/features/runtime-trace";

function traceEvent(
  overrides: Partial<RuntimeTraceEvent> = {},
): RuntimeTraceEvent {
  return {
    id: "event-row-id",
    eventId: "event-id",
    eventDigest: "digest",
    seq: 1,
    traceRunId: "trace-run-id",
    parentTraceRunId: null,
    turnOrdinal: 1,
    stepId: null,
    parentStepId: null,
    stepIndex: null,
    agentIteration: 1,
    path: "chat",
    stage: "llm",
    kind: "llm",
    title: "LLM · chat.deep_reasoning.turn",
    status: "succeeded",
    occurredAt: "2026-07-21T03:42:45.267+00:00",
    clientOccurredAt: null,
    startedAt: null,
    endedAt: null,
    durationMs: 11000,
    model: "deepseek-reasoner",
    responseModel: "deepseek-v4-flash",
    providerInputTokens: 712,
    providerOutputTokens: 996,
    providerTotalTokens: 1708,
    providerReasoningTokens: 521,
    providerCachedTokens: 256,
    usageSource: "provider",
    usageMissingReason: null,
    estimatedTokens: null,
    estimatedCostUsd: null,
    pricingVersion: null,
    pricingStatus: "partial",
    memoryRssBytes: null,
    memoryHeapUsedBytes: null,
    resourceScope: null,
    detailLevel: "full",
    payloadState: "captured",
    redactedFields: [],
    truncatedFields: [],
    unavailableFields: [],
    metadata: null,
    payload: null,
    ...overrides,
  };
}

describe("runtime trace workbench adapter", () => {
  it("hides retired memory and history-recall instrumentation without altering stored trace data", () => {
    const retained = traceEvent({ title: "LLM · chat.tool_loop.turn" });

    expect(
      filterRuntimeTraceEventsForDisplay([
        traceEvent({ title: "Automatic Coach memory assembly disabled for Pilot" }),
        traceEvent({ title: "Unified recent Chat context projection" }),
        traceEvent({ title: "History recall retrieval" }),
        traceEvent({ title: "History recall selection" }),
        retained,
      ]),
    ).toEqual([retained]);
  });

  it("shows requested and provider response models instead of hiding the requested model", () => {
    const [event] = toRuntimeTraceTimelineEvents([traceEvent()]);

    expect(event?.model).toBe("deepseek-reasoner -> deepseek-v4-flash");
  });

  it("keeps the model compact when the provider response model matches", () => {
    const [event] = toRuntimeTraceTimelineEvents([
      traceEvent({ responseModel: "deepseek-reasoner" }),
    ]);

    expect(event?.model).toBe("deepseek-reasoner");
  });
});

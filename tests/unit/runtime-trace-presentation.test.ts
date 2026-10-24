import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuntimeTraceMetricsView } from "@/features/runtime-trace/components/runtime-trace-metrics-view";
import {
  buildCostLedger,
  buildMemoryLedger,
  buildRuntimeTraceMetricsViewModel,
  buildTokenLedger,
  historySessionAccessibleLabel,
  payloadAvailabilityPresentation,
  rawEventAccessibleLabel,
  serializeNormalizedTraceEvent,
  unionIntervalDurationMs,
  type RuntimeTraceHistorySession,
  type RuntimeTraceMetricsRun,
  type RuntimeTraceRawEvent,
} from "@/features/runtime-trace/components/runtime-trace-presentation";

describe("Runtime Trace presentation metrics", () => {
  it("uses the union of overlapping foreground intervals for Agent busy", () => {
    expect(
      unionIntervalDurationMs([
        { startMs: 0, endMs: 6_000 },
        { startMs: 4_000, endMs: 8_000 },
        { startMs: 9_000, endMs: 10_000 },
      ]),
    ).toBe(9_000);

    const model = buildRuntimeTraceMetricsViewModel({
      session: {
        startedAt: "2026-07-12T12:00:00.000Z",
        foregroundEndedAt: "2026-07-12T12:00:10.000Z",
      },
      runs: [
        run({
          id: "turn-1",
          turnOrdinal: 1,
          startedAt: "2026-07-12T12:00:00.000Z",
          endedAt: "2026-07-12T12:00:06.000Z",
          durationMs: 6_000,
        }),
        run({
          id: "turn-2",
          turnOrdinal: 2,
          startedAt: "2026-07-12T12:00:04.000Z",
          endedAt: "2026-07-12T12:00:08.000Z",
          durationMs: 4_000,
        }),
      ],
      events: [],
    });

    expect(model.visitElapsedMs).toBe(10_000);
    expect(model.agentBusyMs).toBe(8_000);
    expect(model.totalWorkMs).toBe(10_000);
    expect(model.showTotalWork).toBe(true);
    expect(model.agentBusyMs).toBeLessThanOrEqual(model.visitElapsedMs);
  });

  it("keeps cached and reasoning tokens as subsets of provider totals", () => {
    const ledger = buildTokenLedger([
      run({
        providerInputTokens: 1_000,
        providerOutputTokens: 200,
        providerTotalTokens: 1_200,
        providerCachedTokens: 400,
        providerReasoningTokens: 50,
      }),
    ]);

    expect(ledger).toMatchObject({
      providerInputTokens: 1_000,
      providerOutputTokens: 200,
      providerTotalTokens: 1_200,
      providerCachedTokens: 400,
      providerReasoningTokens: 50,
      usageMissingCallCount: 0,
      cachedBreakdownMissingCallCount: 0,
      reasoningBreakdownMissingCallCount: 0,
      integrityWarnings: [],
    });
    expect(ledger.providerTotalTokens).not.toBe(
      1_000 + 200 + 400 + 50,
    );
  });

  it("labels partial provider usage instead of presenting a partial sum as complete", () => {
    const ledger = buildTokenLedger([
      run({
        id: "reported",
        llmCallCount: 1,
        providerInputTokens: 100,
        providerOutputTokens: 20,
        providerTotalTokens: 120,
        providerCachedTokens: 0,
        providerReasoningTokens: 0,
      }),
      run({ id: "missing", llmCallCount: 1 }),
    ]);

    expect(ledger.providerTotalTokens).toBe(120);
    expect(ledger.usageMissingCallCount).toBe(1);
    expect(ledger.integrityWarnings).toContain(
      "Provider usage is missing for 1 LLM call; shown totals include reported calls only.",
    );
  });

  it("surfaces impossible provider subset counts instead of silently correcting them", () => {
    const ledger = buildTokenLedger([
      run({
        providerInputTokens: 10,
        providerOutputTokens: 5,
        providerTotalTokens: 15,
        providerCachedTokens: 11,
        providerReasoningTokens: 6,
      }),
    ]);

    expect(ledger.providerTotalTokens).toBe(15);
    expect(ledger.integrityWarnings).toEqual([
      "Cached tokens exceed provider input tokens.",
      "Reasoning tokens exceed provider output tokens.",
    ]);
  });

  it("shows known cost plus unpriced calls as partial coverage", () => {
    const ledger = buildCostLedger([
      run({
        id: "priced",
        llmCallCount: 1,
        estimatedCostUsd: 0.0041,
        pricingStatus: "priced",
      }),
      run({
        id: "unpriced",
        llmCallCount: 1,
        estimatedCostUsd: null,
        pricingStatus: "unpriced",
        unpricedLlmCallCount: 1,
      }),
    ]);

    expect(ledger).toMatchObject({
      knownCostUsd: 0.0041,
      unpricedLlmCallCount: 1,
      coverage: "partial",
    });
    expect(ledger.label).toContain("$0.004100");
    expect(ledger.label).toContain("+ 1 unpriced");
  });

  it("never renders an entirely unknown price as zero dollars", () => {
    const ledger = buildCostLedger([
      run({
        llmCallCount: 1,
        estimatedCostUsd: null,
        pricingStatus: "unpriced",
        unpricedLlmCallCount: 1,
      }),
    ]);

    expect(ledger.coverage).toBe("unpriced");
    expect(ledger.knownCostUsd).toBeNull();
    expect(ledger.label).toBe("Unpriced · 1 call");
    expect(ledger.label).not.toContain("$0.00");
  });

  it("attributes background token and cost usage to its originating Turn", () => {
    const model = buildRuntimeTraceMetricsViewModel({
      session: {
        startedAt: "2026-07-12T12:00:00.000Z",
        foregroundEndedAt: "2026-07-12T12:00:02.000Z",
      },
      runs: [
        run({ id: "turn", turnOrdinal: 1, durationMs: 2_000 }),
        run({
          id: "background",
          path: "memory_background",
          turnOrdinal: null,
          originatingTurnOrdinal: 1,
          providerInputTokens: 100,
          providerOutputTokens: 20,
          providerTotalTokens: 120,
          providerCachedTokens: 0,
          providerReasoningTokens: 0,
          llmCallCount: 1,
          estimatedCostUsd: 0.0001,
          pricingStatus: "priced",
        }),
      ],
      events: [],
    });

    expect(model.turnRows[0].tokens.providerTotalTokens).toBe(120);
    expect(model.turnRows[0].cost.knownCostUsd).toBe(0.0001);
    expect(model.agentBusyMs).toBe(2_000);
  });

  it("counts durable memory deltas without inventing additions or removals", () => {
    const ledger = buildMemoryLedger([
      {
        eventId: "memory-1",
        traceRunId: "turn",
        turnOrdinal: 1,
        kind: "memory",
        status: "succeeded",
        memoryDelta: { durableRowIds: ["fact-1", "fact-2"] },
      },
    ]);

    expect(ledger).toEqual({
      changedStepCount: 1,
      durableRowCount: 2,
      addedCount: 0,
      removedCount: 0,
    });
  });

  it("does not restate the always-visible summary metrics", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceMetricsView, {
        session: {
          startedAt: "2026-07-13T16:00:00.000Z",
          foregroundEndedAt: "2026-07-13T16:00:18.000Z",
        },
        runs: [
          run({
            id: "run-1",
            path: "chat",
            actionKind: "coach_message",
            turnOrdinal: 1,
            startedAt: "2026-07-13T16:00:00.000Z",
            endedAt: "2026-07-13T16:00:07.300Z",
            durationMs: 7_300,
            providerInputTokens: 11_545,
            providerOutputTokens: 177,
            providerTotalTokens: 11_722,
            providerCachedTokens: 1_280,
            providerReasoningTokens: null,
            estimatedCostUsd: 0.001487,
            pricingStatus: "partial",
            unpricedLlmCallCount: 2,
            llmCallCount: 2,
            toolCallCount: 1,
            errorCount: 0,
            traceOverheadMs: 424,
          }),
        ],
        events: [],
      }),
    );

    // 这些数字常驻 summary strip，Metrics tab 不该再复读一遍
    expect(html).not.toContain("Visit elapsed");
    expect(html).not.toContain("Agent busy");
    expect(html).not.toContain("Turns");
    // 但 Metrics tab 独有的东西必须还在
    expect(html).toContain("Provider token ledger");
    expect(html).toContain("Per-turn comparison");
    expect(html).toContain("Trace overhead");
  });
});

describe("Runtime Trace payload and accessibility presentation", () => {
  it.each([
    ["summary_only", "Summary only"],
    ["partially_pruned", "Payload partially pruned"],
    ["pruned", "Payload pruned"],
    ["unavailable", "Payload unavailable"],
  ] as const)("distinguishes %s payloads", (payloadState, label) => {
    expect(payloadAvailabilityPresentation({ payloadState }).label).toBe(label);
  });

  it("keeps redacted, truncated, and unavailable fields distinct", () => {
    expect(
      payloadAvailabilityPresentation({
        payloadState: "captured",
        redactedFields: ["authorization"],
        truncatedFields: ["prompt"],
        unavailableFields: ["reasoning_content"],
      }),
    ).toMatchObject({
      label: "Full payload retained",
      notices: [
        "1 redacted field",
        "1 truncated field",
        "1 unavailable field",
      ],
    });
  });

  it("builds non-color-only labels for mobile session and event selectors", () => {
    const session: RuntimeTraceHistorySession = {
      id: "session-1",
      problemTitle: "Two Sum",
      startedAt: "2026-07-12T12:00:00.000Z",
      foregroundEndedAt: "2026-07-12T12:00:10.000Z",
      settledAt: null,
      startTrigger: "review",
      foregroundStatus: "abandoned",
      backgroundStatus: "failed",
      turnCount: 2,
      runCount: 3,
      eventCount: 18,
      payloadState: "pruned",
      traceCompleteness: "complete",
    };
    const event: RuntimeTraceRawEvent = {
      eventId: "event-7",
      seq: 7,
      title: "Diagnose and coach",
      kind: "llm",
      status: "degraded",
      occurredAt: "2026-07-12T12:00:05.000Z",
      payloadState: "summary_only",
      detailLevel: "summary",
      redactedFields: [],
      truncatedFields: [],
      unavailableFields: [],
      normalized: {},
    };

    expect(historySessionAccessibleLabel(session)).toBe(
      "Two Sum, abandoned, background failed, Payload pruned, 2 turns, 18 events",
    );
    expect(rawEventAccessibleLabel(event)).toBe(
      "Event 7, Diagnose and coach, llm, degraded, Summary only",
    );
  });

  it("falls back to an explicit unavailable object when JSON serialization fails", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(serializeNormalizedTraceEvent(circular)).toContain(
      "Normalized event could not be serialized.",
    );
    expect(serializeNormalizedTraceEvent(circular)).toContain(
      '"payloadState": "unavailable"',
    );
  });
});

function run(
  overrides: Partial<RuntimeTraceMetricsRun> = {},
): RuntimeTraceMetricsRun {
  return {
    id: "run-1",
    path: "review",
    actionKind: "review",
    turnOrdinal: null,
    originatingTurnOrdinal: null,
    startedAt: "2026-07-12T12:00:00.000Z",
    endedAt: "2026-07-12T12:00:02.000Z",
    durationMs: 2_000,
    providerInputTokens: null,
    providerOutputTokens: null,
    providerTotalTokens: null,
    providerCachedTokens: null,
    providerReasoningTokens: null,
    estimatedCostUsd: null,
    pricingStatus: "not_applicable",
    unpricedLlmCallCount: 0,
    llmCallCount: 0,
    toolCallCount: 0,
    errorCount: 0,
    traceOverheadMs: 0,
    traceCompleteness: "complete",
    status: "succeeded",
    ...overrides,
  };
}

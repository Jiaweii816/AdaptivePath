import { describe, expect, it } from "vitest";
import {
  endCurrentRuntimeTraceSession,
  fetchCurrentRuntimeTracePage,
  fetchRuntimeTraceDetailPage,
  fetchRuntimeTraceHistoryPage,
  RuntimeTraceApiError,
  runtimeTracePageSchema,
  type RuntimeTraceEvent,
  type RuntimeTracePage,
} from "@/features/runtime-trace/runtime-trace-api";
import {
  drainRuntimeTracePages,
  EMPTY_RUNTIME_TRACE_STATE,
  mergeRuntimeTracePage,
} from "@/features/runtime-trace/runtime-trace-state";
import { getRuntimeTraceNextPollDelay } from "@/features/runtime-trace/use-runtime-trace";

describe("runtime trace client data contract", () => {
  it("drains cursor pages immediately and de-duplicates repeated event ids", async () => {
    const pages = new Map<number, RuntimeTracePage>([
      [0, page({ events: [event(1), event(2)], nextSeq: 2, highWaterSeq: 3, hasMore: true })],
      [2, page({ events: [event(2), event(3)], nextSeq: 3, highWaterSeq: 3, hasMore: false })],
    ]);
    const requested: number[] = [];

    const drained = await drainRuntimeTracePages({
      since: 0,
      loadPage: async (since) => {
        requested.push(since);
        return pages.get(since)!;
      },
    });

    expect(requested).toEqual([0, 2]);
    expect(drained.pageCount).toBe(2);
    expect(drained.addedEventCount).toBe(3);
    expect(drained.state.events.map((item) => item.eventId)).toEqual(["event-1", "event-2", "event-3"]);
    expect(drained.state.nextSeq).toBe(3);
  });

  it("preserves old turns and events when a later page appends a turn", () => {
    const first = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      turns: [turn(1)],
      runs: [run("run-1", 1)],
      events: [event(1, 1, "run-1")],
      nextSeq: 1,
      highWaterSeq: 1,
    }));
    const second = mergeRuntimeTracePage(first, page({
      turns: [turn(1), turn(2)],
      runs: [run("run-1", 1), run("run-2", 2)],
      events: [event(2, 2, "run-2")],
      nextSeq: 2,
      highWaterSeq: 2,
    }));

    expect(second.turns.map((item) => item.turnOrdinal)).toEqual([1, 2]);
    expect(second.runs.map((item) => item.id)).toEqual(["run-1", "run-2"]);
    expect(second.events.map((item) => item.seq)).toEqual([1, 2]);
  });

  it("restarts at zero when a new Session replaces a closed current Session", async () => {
    const old = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      session: { ...page().session!, id: "old-session" },
      events: [event(1), event(2)],
      nextSeq: 2,
      highWaterSeq: 2,
    }));
    const afterClose = mergeRuntimeTracePage(old, page({
      session: null,
      turns: [],
      runs: [],
      events: [],
      nextSeq: 2,
      highWaterSeq: 0,
      backgroundStatus: null,
    }));
    const requested: number[] = [];

    const drained = await drainRuntimeTracePages({
      since: afterClose.nextSeq,
      initialState: afterClose,
      loadPage: async (since) => {
        requested.push(since);
        return page({
          session: { ...page().session!, id: "new-session" },
          events: since === 0 ? [event(1)] : [],
          nextSeq: since === 0 ? 1 : since,
          highWaterSeq: 1,
        });
      },
    });

    expect(requested).toEqual([2, 0]);
    expect(drained.state.session?.id).toBe("new-session");
    expect(drained.state.events.map((item) => item.eventId)).toEqual(["event-1"]);
  });

  it("stops empty current-session polling unless empty keepalive is requested", () => {
    const empty = {
      ...EMPTY_RUNTIME_TRACE_STATE,
      cursorSessionId: "closed-session",
      nextSeq: 4,
    };

    expect(getRuntimeTraceNextPollDelay(empty)).toBeNull();
    expect(getRuntimeTraceNextPollDelay(empty, { keepAliveWhenEmpty: true })).toBe(1_000);
  });

  it("keeps polling active foreground sessions and pending background work", () => {
    const activeForeground = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      hasActiveTurn: true,
      backgroundStatus: "idle",
    }));
    const pendingBackground = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      session: {
        ...page().session!,
        foregroundStatus: "closed",
        backgroundStatus: "pending",
        foregroundEndedAt: "2026-07-12T12:00:01.000Z",
      },
      hasActiveTurn: false,
      backgroundStatus: "pending",
    }));
    const settled = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      session: {
        ...page().session!,
        foregroundStatus: "closed",
        backgroundStatus: "settled",
        foregroundEndedAt: "2026-07-12T12:00:01.000Z",
        settledAt: "2026-07-12T12:00:02.000Z",
      },
      hasActiveTurn: false,
      backgroundStatus: "settled",
    }));
    const idleOpenWorkspace = mergeRuntimeTracePage(EMPTY_RUNTIME_TRACE_STATE, page({
      hasActiveTurn: false,
      backgroundStatus: "idle",
    }));

    expect(getRuntimeTraceNextPollDelay(activeForeground)).toBe(1_000);
    expect(getRuntimeTraceNextPollDelay(pendingBackground)).toBe(5_000);
    expect(getRuntimeTraceNextPollDelay(idleOpenWorkspace)).toBeNull();
    expect(getRuntimeTraceNextPollDelay(settled)).toBeNull();
  });

  it("parses current, detail, and history responses without trusting unknown JSON", async () => {
    const tracePage = page({ events: [event(1)] });
    const current = await fetchCurrentRuntimeTracePage({
      browserInstanceId: "tab-1",
      problemId: "problem-1",
      fetchImpl: jsonFetch(tracePage),
    });
    const detail = await fetchRuntimeTraceDetailPage({
      sessionId: "session-1",
      fetchImpl: jsonFetch(tracePage),
    });
    const history = await fetchRuntimeTraceHistoryPage({
      fetchImpl: jsonFetch({
        sessions: [{
          ...tracePage.session,
          durationMs: 1_000,
          turnCount: 1,
          runCount: 1,
          eventCount: 1,
          outcome: "degraded",
          traceCompleteness: "degraded",
          payloadState: "partially_pruned",
          llmCallCount: 1,
          providerTotalTokens: 155,
          knownCostUsd: 0.001,
          unpricedLlmCallCount: 1,
        }],
        nextCursor: null,
        hasMore: false,
      }),
    });

    expect(current.session?.problem).toMatchObject({ slug: "two-sum", title: "Two Sum" });
    expect(detail.events[0].payload?.output).toEqual({ reply: "ok" });
    expect(history.sessions[0]).toMatchObject({
      foregroundStatus: "active",
      outcome: "degraded",
      traceCompleteness: "degraded",
      payloadState: "partially_pruned",
      unpricedLlmCallCount: 1,
    });
  });

  it("keeps provider token subsets, pricing coverage, and trace overhead distinct", () => {
    const parsed = runtimeTracePageSchema.parse(page({ events: [event(1)] }));
    expect(parsed.runs[0]).toMatchObject({
      providerInputTokens: 100,
      providerOutputTokens: 50,
      providerTotalTokens: 150,
      providerReasoningTokens: 10,
      providerCachedTokens: 20,
      pricingVersion: "pricing-v1",
      pricingStatus: "partial",
      unpricedLlmCallCount: 1,
      traceOverheadMs: 6,
    });
    expect(parsed.events[0]).toMatchObject({
      providerInputTokens: 100,
      providerOutputTokens: 50,
      providerTotalTokens: 150,
      providerReasoningTokens: 10,
      providerCachedTokens: 20,
      usageSource: "provider",
      pricingVersion: "pricing-v1",
      pricingStatus: "priced",
      memoryRssBytes: 2_048,
      memoryHeapUsedBytes: 1_024,
      resourceScope: "process_sample",
    });
  });

  it("distinguishes an explicitly disabled trace UI from a generic read failure", async () => {
    const request = fetchCurrentRuntimeTracePage({
      browserInstanceId: "tab-1",
      problemId: "problem-1",
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: "Runtime trace UI is disabled.",
      }), { status: 404 }),
    });

    await expect(request).rejects.toMatchObject({
      name: "RuntimeTraceApiError",
      status: 404,
      disabled: true,
    } satisfies Partial<RuntimeTraceApiError>);
  });

  it("ends only the matching workspace identity with the explicit navigation reason", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const result = await endCurrentRuntimeTraceSession({
      browserInstanceId: "trace-tab-1",
      problemId: "problem-1",
      reason: "problem_changed",
      keepalive: true,
      fetchImpl: async (url, init) => {
        observedUrl = String(url);
        observedInit = init;
        return new Response(
          JSON.stringify({
            ok: true,
            ended: true,
            sessionId: "session-1",
            foregroundStatus: "closed",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(observedUrl).toBe("/api/trace/session/end");
    expect(observedInit).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(String(observedInit?.body))).toEqual({
      browserInstanceId: "trace-tab-1",
      problemId: "problem-1",
      reason: "problem_changed",
    });
    expect(result).toEqual({
      ok: true,
      ended: true,
      sessionId: "session-1",
      foregroundStatus: "closed",
    });
  });
});

function page(overrides: Partial<RuntimeTracePage> = {}): RuntimeTracePage {
  return {
    session: {
      id: "session-1",
      problemId: "problem-1",
      problem: { id: "problem-1", slug: "two-sum", title: "Two Sum" },
      browserInstanceId: "tab-1",
      startTrigger: "review",
      captureLevel: "full",
      foregroundStatus: "active",
      backgroundStatus: "idle",
      startedAt: "2026-07-12T12:00:00.000Z",
      lastActivityAt: "2026-07-12T12:00:01.000Z",
      foregroundEndedAt: null,
      endReason: null,
      settledAt: null,
    },
    turns: [turn(1)],
    runs: [run("run-1", 1)],
    events: [],
    nextSeq: 0,
    highWaterSeq: 0,
    hasMore: false,
    hasActiveTurn: false,
    backgroundStatus: "idle",
    ...overrides,
  };
}

function turn(ordinal: number) {
  return {
    turnOrdinal: ordinal,
    traceRunId: `run-${ordinal}`,
    path: "review",
    actionKind: "review",
    status: "succeeded",
    traceCompleteness: "complete",
    startedAt: "2026-07-12T12:00:00.000Z",
    endedAt: "2026-07-12T12:00:01.000Z",
    durationMs: 1_000,
  };
}

function run(id: string, ordinal: number) {
  return {
    id,
    workspaceSessionId: "session-1",
    parentTraceRunId: null,
    originatingTraceRunId: null,
    turnOrdinal: ordinal,
    originatingTurnOrdinal: null,
    path: "review",
    actionKind: "review",
    status: "succeeded",
    startedAt: "2026-07-12T12:00:00.000Z",
    endedAt: "2026-07-12T12:00:01.000Z",
    durationMs: 1_000,
    providerInputTokens: 100,
    providerOutputTokens: 50,
    providerTotalTokens: 150,
    providerReasoningTokens: 10,
    providerCachedTokens: 20,
    estimatedCostUsd: 0.001,
    pricingVersion: "pricing-v1",
    pricingStatus: "partial" as const,
    unpricedLlmCallCount: 1,
    llmCallCount: 1,
    toolCallCount: 0,
    errorCount: 0,
    traceOverheadMs: 6,
    traceCompleteness: "complete" as const,
    finalFlushAt: "2026-07-12T12:00:01.000Z",
  };
}

function event(seq: number, ordinal = 1, traceRunId = "run-1"): RuntimeTraceEvent {
  return {
    id: `row-${seq}`,
    eventId: `event-${seq}`,
    eventDigest: String(seq).repeat(64),
    seq,
    traceRunId,
    parentTraceRunId: null,
    turnOrdinal: ordinal,
    stepId: `step-${seq}`,
    parentStepId: null,
    stepIndex: seq,
    agentIteration: null,
    path: "review",
    stage: "diagnose_coach",
    kind: "llm",
    title: "Diagnose & Coach",
    status: "succeeded",
    occurredAt: "2026-07-12T12:00:00.000Z",
    clientOccurredAt: null,
    startedAt: "2026-07-12T12:00:00.000Z",
    endedAt: "2026-07-12T12:00:01.000Z",
    durationMs: 1_000,
    model: "deepseek-chat",
    responseModel: "deepseek-chat-2026-07",
    providerInputTokens: 100,
    providerOutputTokens: 50,
    providerTotalTokens: 150,
    providerReasoningTokens: 10,
    providerCachedTokens: 20,
    usageSource: "provider",
    usageMissingReason: null,
    estimatedTokens: null,
    estimatedCostUsd: 0.001,
    pricingVersion: "pricing-v1",
    pricingStatus: "priced",
    memoryRssBytes: 2_048,
    memoryHeapUsedBytes: 1_024,
    resourceScope: "process_sample",
    detailLevel: "full",
    payloadState: "captured",
    redactedFields: ["authorization"],
    truncatedFields: [],
    unavailableFields: [],
    metadata: { eventRole: "call" },
    payload: {
      prompt: [{ role: "user", content: "Review this code" }],
      input: { code: "return []" },
      output: { reply: "ok" },
      retrieval: null,
      stateDelta: null,
      memoryDelta: null,
      metadata: null,
      stdout: null,
      stderr: null,
      byteSize: 42,
    },
  };
}

function jsonFetch(body: unknown) {
  return async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RuntimeTraceCapsule,
  RuntimeTraceFilterBar,
  RuntimeTraceTimeline,
  MIN_WATERFALL_WIDTH_PERCENT,
  buildRuntimeTraceTimeline,
  buildWaterfallGeometry,
  filterTraceEvents,
  pairToolEvents,
  projectLlmTraceExchange,
  shouldAutoExpandEvent,
  type RuntimeTraceEventViewModel,
  type RuntimeTraceRunViewModel,
} from "@/features/runtime-trace/components";

describe("runtime trace component contracts", () => {
  it("keeps the capsule developer-only and exposes non-color live state", () => {
    expect(
      renderToStaticMarkup(
        createElement(RuntimeTraceCapsule, {
          enabled: false,
          eventCount: 18,
          state: "live",
          open: false,
          onOpenChange: () => undefined,
        }),
      ),
    ).toBe("");

    const html = renderToStaticMarkup(
      createElement(RuntimeTraceCapsule, {
        enabled: true,
        eventCount: 18,
        state: "live",
        open: true,
        onOpenChange: () => undefined,
      }),
    );

    expect(html).toContain("Trace · 18");
    expect(html).toContain("aria-haspopup=\"dialog\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("Live");
  });

  it("groups a session by Turn and orders steps by seq without replacing old turns", () => {
    const runs = [rootRun(1, "succeeded"), rootRun(2, "running")];
    const events = [
      event({ id: "turn-1-runner", traceRunId: "run-1", turnOrdinal: 1, stage: "run_code", kind: "runner" }),
      event({ id: "turn-2-input", traceRunId: "run-2", turnOrdinal: 2, stage: "input_and_resolve", kind: "user_input" }),
      event({ id: "turn-2-memory", traceRunId: "run-2", turnOrdinal: 2, stage: "load_memory", kind: "memory" }),
    ];

    const timeline = buildRuntimeTraceTimeline(runs, events);

    expect(timeline.map((turn) => turn.turnOrdinal)).toEqual([1, 2]);
    expect(timeline[0]?.events.map((event) => event.id)).toEqual(["turn-1-runner"]);
    expect(timeline[1]?.events.map((event) => event.id)).toEqual([
      "turn-2-input",
      "turn-2-memory",
    ]);
    expect(timeline[0]?.autoExpand).toBe(false);
    expect(timeline[1]?.autoExpand).toBe(true);
  });

  it("orders events by seq so the agent loop reads as a chain", () => {
    const turns = buildRuntimeTraceTimeline(
      [rootRun(1, "succeeded")],
      [
        event({ seq: 9, kind: "llm", stage: "llm", title: "LLM · iteration 1" }),
        event({ seq: 5, kind: "persistence", stage: "persistence", title: "Persist user chat message" }),
        event({ seq: 10, kind: "tool", stage: "bounded_agent_loop", title: "Tool call · run_current_code" }),
        event({ seq: 14, kind: "persistence", stage: "persistence", title: "Persist visible Coach reply" }),
        event({ seq: 12, kind: "llm", stage: "llm", title: "LLM · iteration 2" }),
      ],
    );

    expect(turns).toHaveLength(1);
    expect(turns[0].events.map((event) => event.seq)).toEqual([5, 9, 10, 12, 14]);
  });

  it("projects an LLM call to changing policy, tool, message, and parsed-output fields", () => {
    const projected = projectLlmTraceExchange(
      event({
        kind: "llm",
        providerCachedTokens: 512,
        payload: {
          prompt: [
            { role: "system", content: "large stable system prompt" },
            { role: "user", content: "an older question" },
            { role: "assistant", content: "an older answer" },
            { role: "user", content: "run this, then recall my tree mistakes" },
            {
              role: "assistant",
              content: { toolCalls: [{ name: "run_current_code" }] },
            },
            {
              role: "tool",
              content: { name: "run_current_code", content: "3/3 visible" },
            },
          ],
          input: {
            policy: { intent: "past_mistake_recall_request" },
            toolMode: "tool_loop",
            toolChoice: "past_mistake_recall",
            availableTools: ["past_mistake_recall"],
            requiredActions: [],
            tools: [{ large: "fixed schema omitted from focused projection" }],
          },
          output: {
            rawResponse: { large: "provider envelope" },
            parsedResponse: {
              type: "tool_calls",
              toolCalls: [{ name: "past_mistake_recall" }],
            },
          },
        },
      }),
    );

    expect(projected).toMatchObject({
      policy: { intent: "past_mistake_recall_request" },
      tooling: {
        toolMode: "tool_loop",
        toolChoice: "past_mistake_recall",
        availableTools: ["past_mistake_recall"],
      },
      currentMessage: {
        role: "user",
        content: "run this, then recall my tree mistakes",
      },
      fixedContext: {
        systemMessageCount: 1,
        priorChatMessageCount: 2,
        cachedTokens: 512,
      },
      output: {
        type: "tool_calls",
        toolCalls: [{ name: "past_mistake_recall" }],
      },
    });
    expect(projected?.toolContext).toHaveLength(2);
    expect(JSON.stringify(projected)).not.toContain("large stable system prompt");
    expect(JSON.stringify(projected)).not.toContain("fixed schema omitted");
    expect(JSON.stringify(projected)).not.toContain("provider envelope");
  });

  it("places an event on the turn's time axis", () => {
    // `occurredAt` is when the event was recorded, which for a completed span is its
    // END. An event that began 2s into the turn and ran for 4s therefore carries
    // occurredAt = +6s, and must be plotted back at its 20% start.
    const geometry = buildWaterfallGeometry({
      event: event({ occurredAt: "2026-07-13T16:00:06.000Z", durationMs: 4_000 }),
      turnStartedAtMs: Date.parse("2026-07-13T16:00:00.000Z"),
      turnDurationMs: 10_000,
    });
    expect(geometry).toEqual({ offsetPercent: 20, widthPercent: 40 });
  });

  it("keeps a long trailing span full-width instead of crushing it to a dot", () => {
    // Regression: plotting the bar at `occurredAt` pinned every completed span at its
    // END. The final LLM call — which ends exactly when the turn ends — landed at 100%
    // offset, where the width clamp collapsed it to the minimum tick. The single most
    // important bar in the turn silently disappeared.
    const geometry = buildWaterfallGeometry({
      event: event({ occurredAt: "2026-07-13T16:00:10.000Z", durationMs: 6_000 }),
      turnStartedAtMs: Date.parse("2026-07-13T16:00:00.000Z"),
      turnDurationMs: 10_000,
    });
    expect(geometry).toEqual({ offsetPercent: 40, widthPercent: 60 });
  });

  it("gives an instantaneous event a visible minimum tick", () => {
    const geometry = buildWaterfallGeometry({
      event: event({ occurredAt: "2026-07-13T16:00:05.000Z", durationMs: null }),
      turnStartedAtMs: Date.parse("2026-07-13T16:00:00.000Z"),
      turnDurationMs: 10_000,
    });
    expect(geometry?.offsetPercent).toBe(50);
    expect(geometry?.widthPercent).toBe(MIN_WATERFALL_WIDTH_PERCENT);
  });

  it("pairs a tool call with its result into a single row", () => {
    const paired = pairToolEvents([
      event({
        seq: 10, kind: "tool", status: "started", title: "Tool call · run_current_code",
        durationMs: null, payload: { input: {} },
        metadata: { toolCallId: "call_abc", eventRole: "call", toolName: "run_current_code" },
      }),
      event({
        seq: 11, kind: "tool", status: "succeeded", title: "Tool result · run_current_code",
        durationMs: 254, payload: { output: { passed: 2, failed: 1 } },
        metadata: { toolCallId: "call_abc", eventRole: "result", toolName: "run_current_code" },
      }),
    ]);

    expect(paired).toHaveLength(1);
    expect(paired[0].title).toBe("run_current_code");
    expect(paired[0].status).toBe("succeeded");       // 不再永远停在 STARTED
    expect(paired[0].durationMs).toBe(254);
    expect(paired[0].payload?.input).toEqual({});
    expect(paired[0].payload?.output).toEqual({ passed: 2, failed: 1 });
  });

  it("keeps an unmatched tool call visible as still running", () => {
    const paired = pairToolEvents([
      event({
        seq: 10, kind: "tool", status: "started", title: "Tool call · run_current_code",
        metadata: { toolCallId: "call_abc", eventRole: "call", toolName: "run_current_code" },
      }),
    ]);
    expect(paired).toHaveLength(1);
    expect(paired[0].status).toBe("started");
  });

  it("keeps an orphan result visible when its call is not in the list", () => {
    // A search only matching the result's payload (e.g. an error message that
    // only appears in the tool's output) filters the call event out upstream,
    // leaving a lone result event. pairToolEvents used to unconditionally
    // drop every result event on the assumption its call was always present,
    // silently erasing the very row the search matched.
    const paired = pairToolEvents([
      event({
        seq: 11, kind: "tool", status: "succeeded", title: "Tool result · run_current_code",
        durationMs: 254, payload: { output: { error: "Divide by zero" } },
        metadata: { toolCallId: "call_abc", eventRole: "result", toolName: "run_current_code" },
      }),
    ]);

    expect(paired).toHaveLength(1);
    expect(paired[0].payload?.output).toEqual({ error: "Divide by zero" });
  });

  it("does not empty a turn when a search filters the call but matches the result", () => {
    const events = [
      event({
        id: "call", seq: 10, kind: "tool", status: "started", title: "Tool call · run_current_code",
        payload: { input: {} },
        metadata: { toolCallId: "call_abc", eventRole: "call", toolName: "run_current_code" },
      }),
      event({
        id: "result", seq: 11, kind: "tool", status: "succeeded", title: "Tool result · run_current_code",
        durationMs: 254, payload: { output: { error: "Divide by zero" } },
        metadata: { toolCallId: "call_abc", eventRole: "result", toolName: "run_current_code" },
      }),
    ];

    const filtered = filterTraceEvents(events, { query: "divide by zero" });
    expect(filtered.map((e) => e.id)).toEqual(["result"]); // the call is filtered out

    const timeline = buildRuntimeTraceTimeline([rootRun(1, "succeeded")], filtered);
    expect(timeline[0]?.events).toHaveLength(1); // the orphan result must still render
    expect(timeline[0]?.events[0]?.payload?.output).toEqual({ error: "Divide by zero" });
  });

  it("auto-expands what a debugger looks at first", () => {
    expect(shouldAutoExpandEvent(event({ kind: "error", status: "failed" }))).toBe(true);
    expect(shouldAutoExpandEvent(event({ kind: "tool", status: "succeeded" }))).toBe(true);
    // Memory retrieval degraded is still expanded (it is a genuine attention status),
    // but it is no longer the only thing expanded.
    expect(shouldAutoExpandEvent(event({ kind: "retrieval", status: "degraded" }))).toBe(true);
    // Routine successful persistence/lifecycle steps stay collapsed.
    expect(shouldAutoExpandEvent(event({ kind: "persistence", status: "succeeded" }))).toBe(false);
    expect(shouldAutoExpandEvent(event({ kind: "lifecycle", status: "succeeded" }))).toBe(false);
  });

  it("filters events by kind and free text", () => {
    const events = [
      event({ kind: "llm", title: "LLM · chat.tool_loop.turn" }),
      event({ kind: "lifecycle", title: "Process memory sample · start" }),
      event({ kind: "tool", title: "run_current_code" }),
    ];

    expect(filterTraceEvents(events, { kinds: ["llm", "tool"] }).map((e) => e.kind))
      .toEqual(["llm", "tool"]);

    expect(filterTraceEvents(events, { query: "memory" }).map((e) => e.kind))
      .toEqual(["lifecycle"]);
  });

  it("returns every event when neither kinds nor query narrow the set", () => {
    const events = [event({ kind: "llm" }), event({ kind: "tool" })];
    expect(filterTraceEvents(events, {}).map((e) => e.kind)).toEqual(["llm", "tool"]);
  });

  it("matches free text against the JSON-serialized payload, not just the title", () => {
    const events = [
      event({
        kind: "tool",
        title: "run_current_code",
        payload: { output: { error: "Divide by zero" } },
      }),
      event({ kind: "llm", title: "LLM call" }),
    ];

    expect(filterTraceEvents(events, { query: "divide by zero" }).map((e) => e.kind))
      .toEqual(["tool"]);
  });

  it("renders kind chips whose aria-pressed state reflects the active preset", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceFilterBar, {
        kinds: ["llm", "tool"],
        onKindsChange: () => undefined,
        query: "",
        onQueryChange: () => undefined,
      }),
    );

    expect(html).toContain("Agent loop");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('type="button"');
    expect(html).toContain("focus-visible:ring");
  });

  it("renders the trace search box wired to the current query", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceFilterBar, {
        kinds: [],
        onKindsChange: () => undefined,
        query: "divide",
        onQueryChange: () => undefined,
      }),
    );

    expect(html).toContain('value="divide"');
  });

  it("renders prompt roles, scan-line metrics, capture loss, and human-readable status", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "degraded")],
        events: [
          event({
            id: "llm",
            stage: "diagnose_and_coach",
            kind: "llm",
            title: "Diagnose & Coach",
            status: "degraded",
            model: "deepseek-chat",
            durationMs: 8_400,
            providerInputTokens: 1_700,
            providerOutputTokens: 226,
            providerTotalTokens: 1_926,
            providerCachedTokens: 512,
            providerReasoningTokens: 80,
            estimatedCostUsd: 0.0027,
            pricingVersion: "2026-07-12",
            pricingStatus: "priced",
            usageSource: "provider",
            payloadState: "pruned",
            redactedFields: ["prompt.apiKey"],
            truncatedFields: ["output.raw"],
            payload: {
              prompt: [
                { role: "system", content: "System policy" },
                { role: "user", content: "Review this code", estimatedTokens: 9 },
              ],
              output: { visible: "最小改法" },
            },
          }),
        ],
      }),
    );

    expect(html).toContain("Turn 1");
    expect(html).toContain("Diagnose &amp; Coach");
    expect(html).toContain("deepseek-chat");

    // The boxed provider-token ledger is gone: model, totals and cost were already on
    // this row's scan line, making the box a third copy of the same numbers inside one
    // event. The one thing the box said that the scan line did not — the in/out split
    // and the cached share of input — is carried inline instead, so nothing is lost.
    expect(html).toContain("1,700→226 tok (512 cached · 30%)");
    expect(html).toContain("Prompt cache");
    expect(html).toContain("512 / 1,700 input tokens (30%)");
    expect(html).not.toContain("PROVIDER TOKENS");
    expect(html).not.toContain("cached subset of input");
    expect(html).not.toContain("not added to the provider total");
    expect(html).toContain("$0.0027");
    expect(html).toContain("Payload pruned");
    expect(html).toContain("redacted: prompt.apiKey");
    expect(html).toContain("truncated: output.raw");
    expect(html).not.toContain("Model-visible memory");
    expect(html).not.toContain("Non-memory system context");
    expect(html).toContain("Prompt delta");
    expect(html).not.toContain("System policy");
    expect(html).toContain("open=\"\"");
  });

  it("renders no data panel for payload fields that were never captured", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "lifecycle",
            title: "Process memory sample · start",
            payload: { input: undefined, output: undefined, stateDelta: undefined },
          }),
        ],
      }),
    );

    expect(html).not.toContain(">null<");
    expect(html).not.toContain("The operation changed durable state");
  });

  it("renders function-calling output without repeating the fixed prompt", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "llm",
            title: "LLM · chat.tool_loop.turn",
            // An attention status forces the event body open in static markup
            // (see the memory-panel test above for the same technique); in the
            // browser a plain "succeeded" LLM event opens the same way once a
            // learner clicks the row.
            status: "degraded",
            metadata: {
              toolCalls: [
                {
                  id: "call_abc",
                  name: "verify_proposed_repair",
                  arguments: { language: "Python", code: "class Solution: ..." },
                },
              ],
            },
            payload: {
              prompt: [{ role: "system", content: "System policy" }],
            },
          }),
        ],
      }),
    );

    expect(html).toContain("Function call");
    expect(html).toContain("verify_proposed_repair");
    expect(html).toContain("Python");
    expect(html).not.toContain("Non-memory system context");
    expect(html).not.toContain("Prompt by role");
    expect(html).not.toContain("System policy");
    // Function-call arguments remain expanded by default for the active LLM event.
    expect(html).toContain('open=""');
  });

  it("offers a copy affordance on every data panel", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [event({ kind: "tool", payload: { output: { passed: 2 } } })],
      }),
    );
    expect(html).toContain('aria-label="Copy Output as JSON"');
  });

  it("shows an unparseable-arguments badge without hiding the raw string", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "llm",
            status: "degraded",
            metadata: {
              toolCalls: [
                {
                  id: "call_broken",
                  name: "run_current_code",
                  arguments: "{not valid json",
                  argumentsParseError: true,
                },
              ],
            },
          }),
        ],
      }),
    );

    expect(html).toContain("unparseable arguments");
    expect(html).toContain("not valid json");
  });

  it("renders no function-call panel when the LLM event carried no tool calls", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [event({ kind: "llm", metadata: { source: "chat_reply" } })],
      }),
    );

    expect(html).not.toContain("Function call");
  });

  it("labels semantic turn assembly as non-tool preprocessing instead of showing No tools", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "llm",
            status: "failed",
            title: "LLM · chat.turn_model_assembler_v3",
            payload: {
              metadata: { task: "chat.turn_model_assembler_v3" },
            },
          }),
        ],
      }),
    );

    expect(html).toContain("Semantic turn assembly");
    expect(html).toContain("Tool schemas do not apply here");
    expect(html).not.toContain("available tools");
    expect(html).not.toContain("No tools");
  });

  it("shows a memory panel only when a real delta exists", () => {
    const withoutDelta = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [event({ kind: "memory", payload: { memoryDelta: undefined } })],
      }),
    );
    expect(withoutDelta).not.toContain("Memory change");

    const withDelta = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "memory",
            // Auto-expand now keys off kind/status (Step 5), not memory-delta content, so this
            // fixture uses an attention status to render the collapsible body in static markup —
            // still a realistic case per "memory retrieval degraded" from the same recalibration.
            status: "degraded",
            payload: { memoryDelta: { added: ["fact-1"], summary: "Recorded a new mistake fact." } },
          }),
        ],
      }),
    );
    expect(withDelta).toContain("Memory change");
    expect(withDelta).toContain("Recorded a new mistake fact.");
  });

  it("does not claim the scan-line 'memory changed' when no add/remove/update count is present", () => {
    // At the default `detailLevel: "summary"` capture level, summarizeUnknown()
    // rewrites memoryDelta into `{capture, valueType, utf8Bytes, keys}` — a
    // record with no added/removed/updated keys at all. The scan-line summary
    // must not fabricate a claim when it genuinely has no count to report.
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "succeeded")],
        events: [
          event({
            kind: "persistence",
            payload: { memoryDelta: { capture: "summary", valueType: "object", utf8Bytes: 42, keys: ["fact"] } },
          }),
        ],
      }),
    );
    expect(html).not.toContain("memory changed");
  });

  it("does not repeat status, kind, duration or the raw dump inside an expanded event", () => {
    // The turn is given a different status ("running") than the event ("succeeded")
    // so the turn's own header badge — a legitimate, separate scope — doesn't get
    // counted alongside the event's. kind: "tool" forces the event body open
    // (shouldAutoExpandEvent auto-expands tool/error kinds regardless of status) so
    // the now-removed Status/Kind/Duration/Sequence fact grid would have rendered
    // pre-fix. Provider token fields are set so ProviderTokenAccounting renders too,
    // exercising the "no repeated explainer paragraph" assertion for real.
    const html = renderToStaticMarkup(
      createElement(RuntimeTraceTimeline, {
        runs: [rootRun(1, "running")],
        events: [
          event({
            kind: "tool",
            status: "succeeded",
            durationMs: 1_500,
            seq: 9,
            providerInputTokens: 100,
            providerOutputTokens: 50,
            providerTotalTokens: 150,
          }),
        ],
      }),
    );

    // A routine success now earns no badge at all: a green pill on every plumbing row
    // is exactly what drowned the agent loop. It stays announced to assistive tech
    // once, via the sr-only span — silent visually, not semantically.
    expect(countOccurrences(html, "succeeded")).toBe(0);
    expect(countOccurrences(html, "Succeeded")).toBe(1);
    expect(html).toContain('class="sr-only">Succeeded<');
    expect(html).not.toContain("Raw event");
    expect(html).not.toContain("Cached and reasoning tokens are subsets");
  });

  it("keeps the drawer as an accessible close-only overlay with keyboard resize and slots", () => {
    // The drawer's keyboard-resize and header/close markup live in sibling
    // files (runtime-trace-drawer-resize.ts, runtime-trace-drawer-header.tsx)
    // split out of runtime-trace-drawer.tsx to stay under the file-size
    // limit; this test reads all three so the accessibility contract stays
    // locked regardless of which file currently owns each fragment.
    const source = readFileSync(
      "src/features/runtime-trace/components/runtime-trace-drawer.tsx",
      "utf8",
    );
    const resizeSource = readFileSync(
      "src/features/runtime-trace/components/runtime-trace-drawer-resize.ts",
      "utf8",
    );
    const headerSource = readFileSync(
      "src/features/runtime-trace/components/runtime-trace-drawer-header.tsx",
      "utf8",
    );

    expect(source).toContain('role="separator"');
    expect(source).toContain('aria-orientation="vertical"');
    expect(resizeSource).toContain('event.key === "ArrowLeft"');
    expect(headerSource).toContain('aria-label="Close runtime trace"');
    expect(source).toContain("sm:w-[var(--trace-drawer-width)]");
    expect(source).toContain("<DialogPrimitive.Portal forceMount>");
    expect(source).toContain("modal={open}");
    expect(source).toContain('data-[state=closed]:hidden');
    expect(source).toContain("onViewportAtTailChange");
    expect(source).toContain("distanceFromTail <= 24");
    expect(source).toContain("viewportRef.current?.scrollTo");
    expect(source).toContain("{timeline}");
    expect(source).toContain("{metrics}");
    expect(source).toContain("{raw}");
    expect(source).toContain("new {unseenCount === 1 ? \"event\" : \"events\"}");
    expect(source).not.toMatch(/clear trace|delete trace/i);
    expect(headerSource).not.toMatch(/clear trace|delete trace/i);
    expect(source).toContain("RuntimeTraceFilterBar");
  });
});

function countOccurrences(haystack: string, needle: string) {
  return (haystack.match(new RegExp(needle, "g")) ?? []).length;
}

function rootRun(turnOrdinal: number, status: string): RuntimeTraceRunViewModel {
  return {
    id: `run-${turnOrdinal}`,
    turnOrdinal,
    path: turnOrdinal === 1 ? "review" : "chat",
    actionKind: turnOrdinal === 1 ? "review_my_code" : "coach_message",
    status,
    traceCompleteness: status === "running" ? "open" : status === "degraded" ? "degraded" : "complete",
    durationMs: turnOrdinal * 100,
  };
}

function event(
  overrides: Partial<RuntimeTraceEventViewModel> = {},
): RuntimeTraceEventViewModel {
  return {
    id: overrides.id ?? "event",
    traceRunId: overrides.traceRunId ?? "run-1",
    turnOrdinal: overrides.turnOrdinal ?? 1,
    stage: overrides.stage ?? "persist",
    kind: overrides.kind ?? "persistence",
    title: overrides.title ?? "Persist",
    status: overrides.status ?? "succeeded",
    durationMs: overrides.durationMs ?? 12,
    ...overrides,
  };
}

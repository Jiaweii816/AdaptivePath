"use client";

import { cn } from "@/lib/utils";
import {
  humanizeStatus,
  type RuntimeTraceSessionMode,
  type RuntimeTraceSessionOptionViewModel,
  type RuntimeTraceSessionViewModel,
  type RuntimeTraceSummaryViewModel,
} from "./runtime-trace-view-model";

/**
 * The drawer header's two session-scoped panels: the current/history scope
 * toggle plus historical-session picker, and the summary stat strip below
 * it. Split out of `runtime-trace-drawer.tsx` so that file stays under the
 * file-size limit; these panels have no state of their own and only render
 * what the drawer passes in.
 */

interface RuntimeTraceSessionSelectorProps {
  mode: RuntimeTraceSessionMode;
  onModeChange: (mode: RuntimeTraceSessionMode) => void;
  historySessions: RuntimeTraceSessionOptionViewModel[];
  selectedHistorySessionId?: string | null;
  onHistorySessionChange?: (sessionId: string) => void;
}

export function RuntimeTraceSessionSelector({
  mode,
  onModeChange,
  historySessions,
  selectedHistorySessionId,
  onHistorySessionChange,
}: RuntimeTraceSessionSelectorProps) {
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2">
      <div
        role="group"
        aria-label="Trace session scope"
        className="inline-flex shrink-0 rounded-md border border-stone-200 bg-stone-100 p-0.5"
      >
        {(["current", "history"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={mode === candidate}
            onClick={() => onModeChange(candidate)}
            className={cn(
              "h-7 rounded-[4px] px-2.5 text-xs font-medium text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === candidate && "bg-white text-stone-950 shadow-sm",
            )}
          >
            {candidate === "current" ? "Current session" : "History"}
          </button>
        ))}
      </div>

      {mode === "history" ? (
        <label className="min-w-0 flex-1">
          <span className="sr-only">Historical trace session</span>
          <select
            aria-label="Historical trace session"
            value={selectedHistorySessionId ?? ""}
            onChange={(event) => onHistorySessionChange?.(event.target.value)}
            className="h-8 w-full truncate rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="" disabled>
              Select a session
            </option>
            {historySessions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.payloadState === "pruned" ? " · payload pruned" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function RuntimeTraceSessionSummary({
  summary,
  session,
}: {
  summary?: RuntimeTraceSummaryViewModel | null;
  session: RuntimeTraceSessionViewModel | null;
}) {
  // Five numbers a debugger actually acts on. Visit-elapsed, agent-busy, turn count,
  // known cost and memory delta all remain one click away in the Metrics tab — putting
  // nine numbers here made none of them readable.
  const items: Array<[string, string, boolean]> = [
    ["Agent busy", summary?.agentBusy ?? "—", false],
    ["LLM", formatInteger(summary?.llmCallCount), true],
    ["Tools", formatInteger(summary?.toolCallCount), true],
    ["Tokens", formatInteger(summary?.providerTotalTokens), false],
    ["Errors", formatInteger(summary?.errorCount), (summary?.errorCount ?? 0) > 0],
  ];

  return (
    <section
      aria-label="Trace session summary"
      className="relative z-[9] shrink-0 border-b border-stone-200 bg-[#f6f4ee]/95 px-4 py-2.5 backdrop-blur"
    >
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
        {items.map(([label, value, emphasize]) => (
          <div key={label} className="min-w-0">
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-stone-500">
              {label}
            </div>
            <div
              className={cn(
                "mt-0.5 truncate font-mono text-[14px] font-semibold tabular-nums",
                label === "Errors" && emphasize ? "text-red-700" : null,
                label !== "Errors" && emphasize ? "text-blue-700" : null,
                !emphasize ? "text-stone-900" : null,
              )}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
      {session ? (
        <p className="sr-only">
          Foreground {humanizeStatus(session.foregroundStatus)}. Background{" "}
          {humanizeStatus(session.backgroundStatus)}.
        </p>
      ) : null}
    </section>
  );
}

function formatInteger(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}



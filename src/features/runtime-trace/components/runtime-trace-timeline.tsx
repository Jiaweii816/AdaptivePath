"use client";

import * as React from "react";
import { CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { RuntimeTraceStatusBadge } from "./runtime-trace-drawer";
import { TraceDisclosure } from "./runtime-trace-primitives";
import { RuntimeTraceEvent } from "./runtime-trace-event-row";
import { RuntimeTraceWaterfallAxis } from "./runtime-trace-waterfall";
import { projectTurnLlmExchanges } from "./llm-exchange-projection";
import {
  buildRuntimeTraceTimeline,
  formatTraceDuration,
  humanizeTraceLabel,
  type RuntimeTraceEventViewModel,
  type RuntimeTraceRunViewModel,
  type RuntimeTraceTurnGroup,
} from "./runtime-trace-view-model";

export interface RuntimeTraceTimelineProps {
  runs: readonly RuntimeTraceRunViewModel[];
  events: readonly RuntimeTraceEventViewModel[];
  emptyLabel?: string;
  className?: string;
}

export function RuntimeTraceTimeline({
  runs,
  events,
  emptyLabel = "No trace events yet. The first observable action starts a session.",
  className,
}: RuntimeTraceTimelineProps) {
  const turns = React.useMemo(
    () => buildRuntimeTraceTimeline(runs, events),
    [events, runs],
  );

  if (turns.length === 0) {
    return (
      <div className={cn("grid min-h-64 place-items-center px-8 text-center", className)}>
        <div>
          <CircleDot className="mx-auto h-5 w-5 text-stone-400" aria-hidden="true" />
          <p className="mt-2 text-sm text-stone-600">{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("px-3 py-3", className)}>
      <ol aria-label="Interaction turns" className="space-y-2">
        {turns.map((turn) => (
          <li key={turn.key}>
            <RuntimeTraceTurn turn={turn} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function RuntimeTraceTurn({ turn }: { turn: RuntimeTraceTurnGroup }) {
  const run = turn.rootRun;
  const label = run?.actionKind
    ? humanizeTraceLabel(run.actionKind)
    : humanizeTraceLabel(run?.path ?? "Interaction");
  const turnAxis = computeTurnAxis(run);
  const llmExchanges = React.useMemo(() => projectTurnLlmExchanges(turn.events), [turn.events]);

  return (
    <TraceDisclosure
      defaultOpen={turn.autoExpand}
      persistenceKey={turn.key}
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
      summaryClassName="px-3 py-2.5 hover:bg-stone-50"
      summary={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-xs font-semibold text-stone-950">
            Turn {turn.turnOrdinal}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-stone-600">{label}</span>
          <span className="hidden font-mono text-[11px] tabular-nums text-stone-500 sm:inline">
            {formatTraceDuration(run?.durationMs)}
          </span>
          <RuntimeTraceStatusBadge status={run?.status ?? "open"} />
        </div>
      }
    >
      <div className="border-t border-stone-100 bg-[#fdfcf9] pb-1">
        <div className="flex flex-wrap items-center gap-2 px-3 pb-0.5 pt-1.5 text-[10px] text-stone-400">
          <span>{turn.events.length} steps</span>
          <span aria-hidden="true">·</span>
          <span>{turn.runs.length} {turn.runs.length === 1 ? "run" : "runs"}</span>
          {run?.traceCompleteness ? (
            <>
              <span aria-hidden="true">·</span>
              <span>trace {humanizeTraceLabel(run.traceCompleteness).toLowerCase()}</span>
            </>
          ) : null}
        </div>
        {turnAxis ? (
          <RuntimeTraceWaterfallAxis turnDurationMs={turnAxis.turnDurationMs} />
        ) : null}
        <ol aria-label={`Turn ${turn.turnOrdinal} steps`} className="divide-y divide-stone-100">
          {turn.events.map((event) => (
            <li key={event.id}>
              <RuntimeTraceEvent
                event={event}
                turnStartedAtMs={turnAxis?.turnStartedAtMs}
                turnDurationMs={turnAxis?.turnDurationMs}
                isLatestTurn={turn.isLatest}
                llmProjection={llmExchanges.get(event.eventId ?? event.id)}
              />
            </li>
          ))}
        </ol>
      </div>
    </TraceDisclosure>
  );
}

/** Resolves the shared "0 -> turn duration" axis every event row plots against. */
function computeTurnAxis(run: RuntimeTraceRunViewModel | undefined) {
  if (!run?.startedAt || run.durationMs === null || run.durationMs === undefined) return null;
  const turnStartedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(turnStartedAtMs) || run.durationMs <= 0) return null;
  return { turnStartedAtMs, turnDurationMs: run.durationMs };
}

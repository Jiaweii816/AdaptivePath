"use client";

import { cn } from "@/lib/utils";
import { buildWaterfallGeometry, formatTraceDuration } from "./runtime-trace-view-model";
import type { RuntimeTraceEventViewModel } from "./runtime-trace-view-model";

/** Kind -> bar color. Pipeline noise (persistence, lifecycle, ...) stays dim; the agent loop pops. */
const KIND_BAR_COLORS: Record<string, string> = {
  llm: "bg-blue-500",
  tool: "bg-violet-500",
  runner: "bg-violet-500",
  retrieval: "bg-emerald-500",
  memory: "bg-emerald-500",
  error: "bg-red-500",
};

const DEFAULT_BAR_COLOR = "bg-stone-300";

/** Quarter-turn gridlines, so a bar's position reads against the axis header above. */
const LANE_GRID =
  "repeating-linear-gradient(to right, transparent 0, transparent calc(25% - 1px), rgb(231 229 228) calc(25% - 1px), rgb(231 229 228) 25%)";

/**
 * Shared lane geometry: the axis header and every row must agree on this, or the ruler
 * lies. Deliberately carries no `display` — the bar lane needs `block` and the tick
 * lane needs `flex`, and a display utility baked in here silently overrides theirs.
 */
export const WATERFALL_LANE_CLASS = "w-[210px] shrink-0";
export const WATERFALL_DURATION_CLASS = "w-12 shrink-0 text-right";

export interface RuntimeTraceWaterfallProps {
  event: RuntimeTraceEventViewModel;
  turnStartedAtMs: number;
  turnDurationMs: number;
}

/**
 * A per-event waterfall bar sharing one "0 -> turn duration" axis across every row
 * in a turn, so where a turn's time actually went is visible at a glance instead of
 * requiring readers to mentally sum each row's duration. Purely decorative: the real
 * number sits in the duration column beside it, so this is aria-hidden.
 */
export function RuntimeTraceWaterfall({
  event,
  turnStartedAtMs,
  turnDurationMs,
}: RuntimeTraceWaterfallProps) {
  const geometry = buildWaterfallGeometry({ event, turnStartedAtMs, turnDurationMs });

  return (
    <span
      aria-hidden="true"
      className={cn(WATERFALL_LANE_CLASS, "relative hidden h-3.5 rounded-[2px] sm:block")}
      style={{ backgroundImage: LANE_GRID }}
    >
      {geometry ? (
        <span
          className={cn(
            "absolute top-1 h-1.5 rounded-full",
            KIND_BAR_COLORS[event.kind] ?? DEFAULT_BAR_COLOR,
          )}
          style={{
            left: `${geometry.offsetPercent}%`,
            width: `${geometry.widthPercent}%`,
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * The ruler every row's bar is plotted against. Without it the bars are decoration:
 * a reader cannot tell 4.1s from 250ms by eye alone.
 */
export function RuntimeTraceWaterfallAxis({ turnDurationMs }: { turnDurationMs: number }) {
  // Three ticks, not five: at 210px a five-label ruler collides with itself.
  const ticks = [
    "0",
    formatTraceDuration(turnDurationMs / 2),
    formatTraceDuration(turnDurationMs),
  ];

  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-2 px-2 pb-1 pt-0.5 text-[9px] text-stone-400"
    >
      <span className="min-w-0 flex-1" />
      <span
        className={cn(
          WATERFALL_LANE_CLASS,
          "hidden justify-between font-mono tabular-nums sm:flex",
        )}
      >
        {ticks.map((tick, index) => (
          <span key={`${tick}:${index}`}>{tick}</span>
        ))}
      </span>
      <span className={WATERFALL_DURATION_CLASS} />
    </div>
  );
}

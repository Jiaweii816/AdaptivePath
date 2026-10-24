"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RuntimeTraceEventFilterPreset {
  readonly id: string;
  readonly label: string;
  /** Empty means "no kind restriction" — matches filterTraceEvents' own convention. */
  readonly kinds: readonly string[];
}

/**
 * The five scopes a debugger reaches for, per the approved filter design:
 * "just the agent loop" is the common case, so it gets its own chip rather
 * than making people multi-select llm + tool every time.
 */
export const RUNTIME_TRACE_EVENT_FILTER_PRESETS: readonly RuntimeTraceEventFilterPreset[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "loop", label: "Agent loop", kinds: ["llm", "tool"] },
  { id: "llm", label: "llm", kinds: ["llm"] },
  { id: "tool", label: "tool", kinds: ["tool"] },
  { id: "memory", label: "memory", kinds: ["retrieval", "memory"] },
];

export interface RuntimeTraceFilterBarProps {
  kinds: readonly string[];
  onKindsChange: (kinds: readonly string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
}

export function RuntimeTraceFilterBar({
  kinds,
  onKindsChange,
  query,
  onQueryChange,
  className,
}: RuntimeTraceFilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div
        role="group"
        aria-label="Filter trace events by kind"
        className="inline-flex shrink-0 flex-wrap gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5"
      >
        {RUNTIME_TRACE_EVENT_FILTER_PRESETS.map((preset) => {
          const active = isFilterPresetActive(preset.kinds, kinds);
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => onKindsChange(preset.kinds)}
              className={cn(
                "h-7 rounded-[4px] px-2.5 text-xs font-medium text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-white text-stone-950 shadow-sm",
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search trace events</span>
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search title or content"
          className="h-7 w-full rounded-md border border-stone-200 bg-white pl-7 pr-2 text-xs text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
    </div>
  );
}

/** A preset is active when the current selection is exactly its kind set, order-independent. */
function isFilterPresetActive(
  presetKinds: readonly string[],
  currentKinds: readonly string[],
): boolean {
  if (presetKinds.length !== currentKinds.length) return false;
  const presetKindSet = new Set(presetKinds);
  return currentKinds.every((kind) => presetKindSet.has(kind));
}

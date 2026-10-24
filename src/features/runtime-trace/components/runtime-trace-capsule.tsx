"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RuntimeTraceCapsuleProps {
  enabled: boolean;
  eventCount: number;
  state?: "live" | "settled" | "error" | "idle";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}

const STATE_LABELS = {
  live: "Live",
  settled: "Settled",
  error: "Error",
  idle: "Idle",
} as const;

export function RuntimeTraceCapsule({
  enabled,
  eventCount,
  state = "idle",
  open,
  onOpenChange,
  className,
}: RuntimeTraceCapsuleProps) {
  if (!enabled) return null;

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Open runtime trace. ${STATE_LABELS[state]}. ${eventCount} events.`}
      onClick={() => onOpenChange(!open)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border/90 bg-card/90 px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Activity
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5",
          state === "live" && "text-blue-600",
          state === "settled" && "text-emerald-700",
          state === "error" && "text-red-700",
          state === "idle" && "text-muted-foreground",
        )}
      />
      <span>Trace · {eventCount}</span>
      <span className="sr-only">{STATE_LABELS[state]}</span>
    </button>
  );
}

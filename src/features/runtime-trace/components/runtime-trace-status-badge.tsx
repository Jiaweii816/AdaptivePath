"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeStatus } from "./runtime-trace-view-model";

/**
 * Small enough, and needed by enough independent files (drawer, event row,
 * timeline), to live on its own rather than force those files to import
 * from each other.
 */
export function RuntimeTraceStatusBadge({ status }: { status: string }) {
  const attention = status === "failed" || status === "degraded" || status === "incomplete";
  const success = status === "succeeded" || status === "settled" || status === "complete";
  const live = status === "running" || status === "active" || status === "pending" || status === "open";
  const Icon = attention
    ? AlertTriangle
    : success
      ? CheckCircle2
      : live
        ? Clock3
        : CircleDashed;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]",
        attention && "border-red-200 bg-red-50 text-red-800",
        success && "border-emerald-200 bg-emerald-50 text-emerald-800",
        live && "border-blue-200 bg-blue-50 text-blue-800",
        !attention && !success && !live && "border-stone-200 bg-stone-50 text-stone-700",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {humanizeStatus(status)}
    </span>
  );
}

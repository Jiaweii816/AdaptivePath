"use client";

import * as React from "react";
import { Braces, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared low-level building blocks for the Runtime Trace timeline: a
 * collapsible dark-mode JSON panel, a labeled fact tile, and a persisted
 * disclosure wrapper. These have no trace-domain knowledge of their own —
 * event- and turn-specific rendering lives in `runtime-trace-event-panels.tsx`
 * and `runtime-trace-timeline.tsx`.
 */

export function DarkDataPanel({
  title,
  value,
  badge,
  defaultOpen = false,
  icon: Icon = Braces,
}: {
  title: string;
  value: unknown;
  badge?: string;
  defaultOpen?: boolean;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const rendered = stringifyTraceValue(value);
  return (
    <details
      open={defaultOpen || undefined}
      className="group overflow-hidden rounded-md border border-slate-700 bg-slate-950 text-slate-100"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge ? (
          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">
            {badge}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Copy ${title} as JSON`}
          onClick={(clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            void navigator.clipboard.writeText(rendered);
          }}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
        </button>
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-slate-500">
          {byteLabel(rendered)}
        </span>
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-slate-800 p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-slate-200">
        {rendered}
      </pre>
    </details>
  );
}

export function TraceFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border border-stone-200 bg-white px-2 py-1.5">
      <div className="truncate text-[9px] font-medium uppercase tracking-[0.05em] text-stone-500">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 truncate text-[11px] text-stone-900",
          mono && "font-mono tabular-nums",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function TraceDisclosure({
  defaultOpen,
  persistenceKey,
  summary,
  children,
  className,
  summaryClassName,
}: {
  defaultOpen: boolean;
  persistenceKey: string;
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  const [open, setOpen] = React.useState(() =>
    readDisclosureState(persistenceKey, defaultOpen),
  );
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() =>
          setOpen((current) => {
            const next = !current;
            writeDisclosureState(persistenceKey, next);
            return next;
          })
        }
        className={cn(
          "flex w-full items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          summaryClassName,
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
        {summary}
      </button>
      {open ? children : null}
    </div>
  );
}

const DISCLOSURE_STORAGE_PREFIX = "patterncoach.runtime-trace.disclosure.v1:";

function readDisclosureState(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.sessionStorage.getItem(
      `${DISCLOSURE_STORAGE_PREFIX}${key}`,
    );
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

function writeDisclosureState(key: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      `${DISCLOSURE_STORAGE_PREFIX}${key}`,
      open ? "1" : "0",
    );
  } catch {
    // Restricted storage must not make the diagnostic viewer unusable.
  }
}

function stringifyTraceValue(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

function byteLabel(value: string) {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}

"use client";

import { AlertTriangle, Check, Clipboard, FileJson2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatTimestamp,
  payloadAvailabilityPresentation,
  rawEventAccessibleLabel,
  serializeNormalizedTraceEvent,
  type RuntimeTraceRawEvent,
} from "./runtime-trace-presentation";

export type RuntimeTraceRawViewProps = {
  events: readonly RuntimeTraceRawEvent[];
  initialEventId?: string | null;
  allowCopy?: boolean;
  className?: string;
};

export function RuntimeTraceRawView({
  events,
  initialEventId = null,
  allowCopy = true,
  className,
}: RuntimeTraceRawViewProps) {
  const [requestedEventId, setRequestedEventId] = useState(initialEventId);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const selectedEvent =
    events.find((event) => event.eventId === requestedEventId) ?? events.at(-1) ?? null;
  const serialized = selectedEvent
    ? serializeNormalizedTraceEvent(selectedEvent.normalized)
    : "";

  async function copyRawEvent() {
    if (!selectedEvent || !navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(serialized);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section
      aria-labelledby="runtime-trace-raw-heading"
      className={cn("space-y-3", className)}
      data-testid="runtime-trace-raw"
    >
      <div className="space-y-1">
        <h2 id="runtime-trace-raw-heading" className="text-sm font-semibold text-foreground">
          Raw event
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Normalized event JSON. Capture limitations stay visible beside the retained skeleton.
        </p>
      </div>

      {events.length === 0 || !selectedEvent ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No normalized events are available yet.
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-1 text-xs font-medium text-foreground">
              <span>Event selector</span>
              <select
                aria-label="Select a Runtime Trace event"
                className="h-9 min-w-0 rounded-md border border-input bg-card px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedEvent.eventId}
                onChange={(event) => {
                  setRequestedEventId(event.target.value);
                  setCopyState("idle");
                }}
              >
                {events.map((event) => (
                  <option key={event.eventId} value={event.eventId}>
                    {event.seq === null ? "—" : `#${event.seq}`} · {event.title} · {event.status}
                  </option>
                ))}
              </select>
            </label>
            {allowCopy ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Copy normalized Runtime Trace event JSON"
                onClick={() => void copyRawEvent()}
              >
                {copyState === "copied" ? <Check aria-hidden="true" className="size-3.5" /> : <Clipboard aria-hidden="true" className="size-3.5" />}
                {copyState === "copied" ? "Copied" : "Copy JSON"}
              </Button>
            ) : null}
          </div>

          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{selectedEvent.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {selectedEvent.kind} · {selectedEvent.status} · {formatTimestamp(selectedEvent.occurredAt)}
                </p>
              </div>
              <PayloadStateNotice event={selectedEvent} />
            </div>
            <span className="sr-only">{rawEventAccessibleLabel(selectedEvent)}</span>
          </div>

          <div
            className="relative overflow-hidden rounded-md border border-[#302f38] bg-[#15151a] text-[#e8e7ea] shadow-inner"
            role="region"
            aria-label={`Normalized JSON for ${selectedEvent.title}`}
            tabIndex={0}
          >
            <div className="flex items-center justify-between border-b border-[#302f38] bg-[#1d1c22] px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[#aaa7b0]">
              <span className="inline-flex items-center gap-1.5">
                <FileJson2 aria-hidden="true" className="size-3.5" /> normalized event
              </span>
              <span>{new TextEncoder().encode(serialized).byteLength.toLocaleString()} bytes</span>
            </div>
            <pre className="max-h-[58vh] overflow-auto p-3 font-mono text-[11px] leading-5 [scrollbar-color:#55525e_#1d1c22]">
              <code>{serialized}</code>
            </pre>
          </div>

          <p className="min-h-4 text-[11px] text-muted-foreground" aria-live="polite">
            {copyState === "failed" ? "Copy failed. Select the JSON panel and copy manually." : copyState === "copied" ? "Normalized event JSON copied." : ""}
          </p>
        </>
      )}
    </section>
  );
}

function PayloadStateNotice({ event }: { event: RuntimeTraceRawEvent }) {
  const presentation = payloadAvailabilityPresentation({
    payloadState: event.payloadState,
    redactedFields: event.redactedFields,
    truncatedFields: event.truncatedFields,
    unavailableFields: event.unavailableFields,
  });
  const warning = presentation.tone === "warning" || presentation.tone === "error";
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1 text-[10px]">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-1 font-medium",
          presentation.tone === "complete" && "border-emerald-200 bg-emerald-50 text-emerald-800",
          presentation.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
          presentation.tone === "error" && "border-red-200 bg-red-50 text-red-800",
          presentation.tone === "neutral" && "border-border bg-muted text-muted-foreground",
        )}
      >
        {warning ? <ShieldAlert aria-hidden="true" className="size-3" /> : <Check aria-hidden="true" className="size-3" />}
        {presentation.label}
      </span>
      {presentation.notices.map((notice) => (
        <span key={notice} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-900">
          <AlertTriangle aria-hidden="true" className="size-3" />
          {notice}
        </span>
      ))}
    </div>
  );
}

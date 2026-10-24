import { AlertTriangle, Archive, CheckCircle2, Clock3, DatabaseZap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatTimestamp,
  historySessionAccessibleLabel,
  payloadAvailabilityPresentation,
  type RuntimeTraceHistorySession,
} from "./runtime-trace-presentation";

export type RuntimeTraceHistoryListProps = {
  sessions: readonly RuntimeTraceHistorySession[];
  selectedSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  className?: string;
};

export function RuntimeTraceHistoryList({
  sessions,
  selectedSessionId = null,
  onSelectSession,
  className,
}: RuntimeTraceHistoryListProps) {
  return (
    <section
      aria-labelledby="runtime-trace-history-heading"
      className={cn("space-y-3", className)}
      data-testid="runtime-trace-history"
    >
      <div className="space-y-1">
        <h2 id="runtime-trace-history-heading" className="text-sm font-semibold text-foreground">
          Session history
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Terminal workspace visits remain visible after detailed payload retention changes.
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No completed Runtime Trace Sessions yet.
        </div>
      ) : (
        <ul className="grid gap-2" aria-label="Completed Runtime Trace Sessions">
          {sessions.map((session) => {
            const selected = selectedSessionId === session.id;
            const payload = payloadAvailabilityPresentation({
              payloadState: session.payloadState,
            });
            const durationMs = session.foregroundEndedAt
              ? Math.max(
                  0,
                  new Date(session.foregroundEndedAt).valueOf() -
                    new Date(session.startedAt).valueOf(),
                )
              : null;
            const content = (
              <>
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
                      session.foregroundStatus === "abandoned"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {session.foregroundStatus === "abandoned" ? (
                      <AlertTriangle aria-hidden="true" className="size-3.5" />
                    ) : (
                      <Archive aria-hidden="true" className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {session.problemTitle ?? "Problem workspace"}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {shortId(session.id)}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 aria-hidden="true" className="size-3" />
                        {formatTimestamp(session.startedAt)} · {formatDuration(durationMs)}
                      </span>
                      <span>{session.turnCount ?? session.runCount} Turns</span>
                      <span>{session.eventCount} events</span>
                      <span>Started by {humanize(session.startTrigger)}</span>
                    </span>
                  </span>
                </div>

                <span className="flex shrink-0 flex-col items-end gap-1 text-[10px]">
                  <SessionState session={session} />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
                      payload.tone === "complete" && "border-border bg-muted/60 text-muted-foreground",
                      payload.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
                      payload.tone === "error" && "border-red-200 bg-red-50 text-red-800",
                      payload.tone === "neutral" && "border-border bg-muted/60 text-muted-foreground",
                    )}
                  >
                    <DatabaseZap aria-hidden="true" className="size-3" />
                    {payload.label}
                  </span>
                  {session.traceCompleteness && session.traceCompleteness !== "complete" ? (
                    <span className="font-medium text-amber-800">
                      Telemetry {humanize(session.traceCompleteness)}
                    </span>
                  ) : null}
                </span>
              </>
            );

            return (
              <li key={session.id}>
                {onSelectSession ? (
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md border bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected ? "border-primary/50 bg-primary/[0.035]" : "border-border hover:bg-muted/35",
                    )}
                    aria-label={historySessionAccessibleLabel(session)}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelectSession(session.id)}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
                    aria-label={historySessionAccessibleLabel(session)}
                  >
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SessionState({ session }: { session: RuntimeTraceHistorySession }) {
  const settled = session.backgroundStatus === "settled";
  const failed = session.backgroundStatus === "failed";
  const label = session.foregroundStatus === "abandoned"
    ? `Abandoned · background ${session.backgroundStatus}`
    : settled
      ? "Closed · background settled"
      : `Closed · background ${session.backgroundStatus}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold",
        failed || session.foregroundStatus === "abandoned"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : settled
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-border bg-muted/60 text-muted-foreground",
      )}
    >
      {settled && session.foregroundStatus !== "abandoned" ? (
        <CheckCircle2 aria-hidden="true" className="size-3" />
      ) : (
        <AlertTriangle aria-hidden="true" className="size-3" />
      )}
      {label}
    </span>
  );
}

function shortId(value: string) {
  return value.length > 11 ? `${value.slice(0, 8)}…` : value;
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

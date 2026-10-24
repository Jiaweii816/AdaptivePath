"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { RuntimeTraceSessionSelector } from "./runtime-trace-session-panels";
import { RuntimeTraceStatusBadge } from "./runtime-trace-status-badge";
import {
  humanizeStatus,
  type RuntimeTraceSessionMode,
  type RuntimeTraceSessionOptionViewModel,
  type RuntimeTraceSessionViewModel,
} from "./runtime-trace-view-model";

/**
 * The drawer's sticky title bar: session identity, foreground/background
 * status, the close button, and the current/history session selector below
 * it. Split out of `runtime-trace-drawer.tsx` so that file stays under the
 * file-size limit.
 */
export function RuntimeTraceDrawerHeader({
  session,
  sessionMode,
  onSessionModeChange,
  historySessions,
  selectedHistorySessionId,
  onHistorySessionChange,
}: {
  session: RuntimeTraceSessionViewModel | null;
  sessionMode: RuntimeTraceSessionMode;
  onSessionModeChange: (mode: RuntimeTraceSessionMode) => void;
  historySessions: RuntimeTraceSessionOptionViewModel[];
  selectedHistorySessionId?: string | null;
  onHistorySessionChange?: (sessionId: string) => void;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-[#fbfaf6]/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogPrimitive.Title className="truncate text-[15px] font-semibold tracking-[-0.01em] text-stone-950">
            Runtime trace{session?.problemTitle ? ` · ${session.problemTitle}` : ""}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="runtime-trace-drawer-description"
            className="sr-only"
          >
            Developer runtime trace for the current problem workspace session.
          </DialogPrimitive.Description>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-600">
            {session ? (
              <>
                <code className="max-w-56 truncate font-mono text-[11px]">
                  session {compactId(session.id)}
                </code>
                <RuntimeTraceStatusBadge status={session.foregroundStatus} />
                <span>
                  background {humanizeStatus(session.backgroundStatus)}
                </span>
              </>
            ) : (
              <span>No observable action yet</span>
            )}
          </div>
          {session?.sharedChatSessionId ? (
            <p className="mt-1 truncate text-[11px] text-stone-500">
              Shared ChatSession with session {compactId(session.sharedChatSessionId)}
            </p>
          ) : null}
        </div>
        <DialogPrimitive.Close
          aria-label="Close runtime trace"
          className="-mr-1 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </div>

      <RuntimeTraceSessionSelector
        mode={sessionMode}
        onModeChange={onSessionModeChange}
        historySessions={historySessions}
        selectedHistorySessionId={selectedHistorySessionId}
        onHistorySessionChange={onHistorySessionChange}
      />
    </header>
  );
}

function compactId(value: string) {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-3)}`;
}

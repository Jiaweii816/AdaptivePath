"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { RuntimeTraceFilterBar } from "./runtime-trace-filter-bar";
import { RuntimeTraceDrawerHeader } from "./runtime-trace-drawer-header";
import {
  MAX_DRAWER_WIDTH,
  MIN_DRAWER_WIDTH,
  useDrawerResize,
} from "./runtime-trace-drawer-resize";
import { RuntimeTraceSessionSummary } from "./runtime-trace-session-panels";
import type {
  RuntimeTraceDrawerView,
  RuntimeTraceSessionMode,
  RuntimeTraceSessionOptionViewModel,
  RuntimeTraceSessionViewModel,
  RuntimeTraceSummaryViewModel,
} from "./runtime-trace-view-model";

export { RuntimeTraceStatusBadge } from "./runtime-trace-status-badge";

export interface RuntimeTraceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RuntimeTraceSessionViewModel | null;
  summary?: RuntimeTraceSummaryViewModel | null;
  sessionMode: RuntimeTraceSessionMode;
  onSessionModeChange: (mode: RuntimeTraceSessionMode) => void;
  historySessions?: RuntimeTraceSessionOptionViewModel[];
  selectedHistorySessionId?: string | null;
  onHistorySessionChange?: (sessionId: string) => void;
  activeView: RuntimeTraceDrawerView;
  onActiveViewChange: (view: RuntimeTraceDrawerView) => void;
  eventFilterKinds: readonly string[];
  onEventFilterKindsChange: (kinds: readonly string[]) => void;
  eventFilterQuery: string;
  onEventFilterQueryChange: (query: string) => void;
  timeline: React.ReactNode;
  metrics: React.ReactNode;
  raw: React.ReactNode;
  unseenCount?: number;
  onAcknowledgeUnseen?: () => void;
  onViewportAtTailChange?: (atTail: boolean) => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  className?: string;
}

export function RuntimeTraceDrawer({
  open,
  onOpenChange,
  session,
  summary,
  sessionMode,
  onSessionModeChange,
  historySessions = [],
  selectedHistorySessionId,
  onHistorySessionChange,
  activeView,
  onActiveViewChange,
  eventFilterKinds,
  onEventFilterKindsChange,
  eventFilterQuery,
  onEventFilterQueryChange,
  timeline,
  metrics,
  raw,
  unseenCount = 0,
  onAcknowledgeUnseen,
  onViewportAtTailChange,
  width: controlledWidth,
  onWidthChange,
  className,
}: RuntimeTraceDrawerProps) {
  const { width, handleProps: resizeHandleProps } = useDrawerResize({
    controlledWidth,
    onWidthChange,
  });
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const viewportScrollPositionsRef = React.useRef<
    Record<RuntimeTraceDrawerView, number>
  >({ timeline: 0, metrics: 0, raw: 0 });

  const reportViewportPosition = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewportScrollPositionsRef.current[activeView] = viewport.scrollTop;
    const distanceFromTail = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    onViewportAtTailChange?.(distanceFromTail <= 24);
  }, [activeView, onViewportAtTailChange]);

  React.useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollTop =
          viewportScrollPositionsRef.current[activeView];
      }
      reportViewportPosition();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, open, reportViewportPosition]);

  return (
    <DialogPrimitive.Root
      modal={open}
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Overlay
          forceMount
          className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px] data-[state=closed]:hidden data-[state=open]:animate-in"
        />
        <DialogPrimitive.Content
          forceMount
          aria-describedby="runtime-trace-drawer-description"
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-stone-300/90 bg-[#fbfaf6] text-foreground shadow-[-12px_0_32px_rgba(23,32,27,0.12)] focus:outline-none data-[state=closed]:hidden sm:w-[var(--trace-drawer-width)]",
            className,
          )}
          style={
            {
              "--trace-drawer-width": `${width}px`,
            } as React.CSSProperties
          }
        >
          <div
            role="separator"
            aria-label="Resize runtime trace drawer"
            aria-orientation="vertical"
            aria-valuemin={MIN_DRAWER_WIDTH}
            aria-valuemax={MAX_DRAWER_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            {...resizeHandleProps}
            className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
          >
            <span className="h-12 w-1 rounded-full bg-stone-300 transition-colors hover:bg-blue-500" />
          </div>

          <RuntimeTraceDrawerHeader
            session={session}
            sessionMode={sessionMode}
            onSessionModeChange={onSessionModeChange}
            historySessions={historySessions}
            selectedHistorySessionId={selectedHistorySessionId}
            onHistorySessionChange={onHistorySessionChange}
          />

          <RuntimeTraceSessionSummary summary={summary} session={session} />

          <Tabs
            value={activeView}
            onValueChange={(value) =>
              onActiveViewChange(value as RuntimeTraceDrawerView)
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b border-stone-200 bg-[#fbfaf6] px-4 py-2">
              <TabsList className="h-8 w-full justify-start rounded-md bg-stone-100 p-0.5">
                {(["timeline", "metrics", "raw"] as const).map((view) => (
                  <TabsTrigger
                    key={view}
                    value={view}
                    className="h-7 flex-1 px-3 text-xs capitalize data-[state=active]:bg-white data-[state=active]:shadow-sm"
                  >
                    {view}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {activeView === "timeline" ? (
              <div className="border-b border-stone-200 bg-[#fbfaf6] px-4 py-2">
                <RuntimeTraceFilterBar
                  kinds={eventFilterKinds}
                  onKindsChange={onEventFilterKindsChange}
                  query={eventFilterQuery}
                  onQueryChange={onEventFilterQueryChange}
                />
              </div>
            ) : null}

            <div
              ref={viewportRef}
              onScroll={reportViewportPosition}
              className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              <section
                aria-label="Runtime trace timeline"
                hidden={activeView !== "timeline"}
                className="min-h-full"
              >
                {timeline}
              </section>
              <section
                aria-label="Runtime trace metrics"
                hidden={activeView !== "metrics"}
                className="min-h-full"
              >
                {metrics}
              </section>
              <section
                aria-label="Runtime trace raw events"
                hidden={activeView !== "raw"}
                className="min-h-full"
              >
                {raw}
              </section>

              {unseenCount > 0 ? (
                <div className="pointer-events-none sticky bottom-4 flex justify-center px-4">
                  <button
                    type="button"
                    onClick={() => {
                      viewportRef.current?.scrollTo({
                        top: viewportRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                      onAcknowledgeUnseen?.();
                      onViewportAtTailChange?.(true);
                    }}
                    className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 text-xs font-medium text-blue-800 shadow-md hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    {unseenCount} new {unseenCount === 1 ? "event" : "events"}
                  </button>
                </div>
              ) : null}
            </div>
          </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

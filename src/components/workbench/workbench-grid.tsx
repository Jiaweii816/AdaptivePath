"use client";

import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useSidePanelResize } from "./use-side-panel-resize";

/**
 * The original Workbench's exact five-slot grid (left, resize gutter,
 * student workspace, resize gutter, coach). Reused by Biology.
 * Original Workbench retains its own mature resize/panel state handlers.
 */
export const WORKBENCH_GRID_CLASS =
  "mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-[1800px] gap-3 overflow-y-auto p-3 lg:h-[calc(100vh-4rem)] lg:grid-cols-[var(--problem-panel-width)_8px_minmax(0,1fr)_8px_var(--coach-panel-width)] lg:gap-0 lg:overflow-hidden";

function ResizeGutter({ label, active, onPointerDown }: {
  label: string; active: boolean; onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" role="separator" aria-orientation="vertical" aria-label={label} onPointerDown={onPointerDown}
      className="group hidden min-h-0 cursor-col-resize touch-none items-center justify-center lg:flex">
      <span className={`h-14 w-1 rounded-full transition-colors group-hover:bg-primary/70 ${active ? "bg-primary" : "bg-border"}`} />
    </button>
  );
}

export function BiologyWorkbenchGrid({ left, middle, right }: { left: ReactNode; middle: ReactNode; right: ReactNode }) {
  const layoutRef = useRef<HTMLElement>(null);
  const { widths, active, start } = useSidePanelResize(layoutRef);
  const layoutStyle = {
    "--problem-panel-width": `${widths.left}px`,
    "--coach-panel-width": `${widths.right}px`,
  } as CSSProperties;
  return (
    <main ref={layoutRef} aria-label="AdaptivePath Biology Workbench" style={layoutStyle} className={WORKBENCH_GRID_CLASS}>
      {left}
      <ResizeGutter label="Resize problem panel" active={active === "left"} onPointerDown={start("left")} />
      {middle}
      <ResizeGutter label="Resize coach panel" active={active === "right"} onPointerDown={start("right")} />
      {right}
    </main>
  );
}

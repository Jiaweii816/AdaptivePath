"use client";
/**
 * Biology page layout: question workspace and tutor, plus a textbook column
 * that appears on the left only while the reference is open.
 * Independent of the coding Workbench grid.
 */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useSidePanelResize } from "@/components/workbench/use-side-panel-resize";

const BASE_GRID = "mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-[1800px] gap-3 overflow-y-auto p-3 lg:h-[calc(100vh-4rem)] lg:gap-0 lg:overflow-hidden";
const WITH_REFERENCE = "lg:grid-cols-[var(--reference-panel-width)_8px_minmax(0,1fr)_8px_var(--coach-panel-width)]";
const WITHOUT_REFERENCE = "lg:grid-cols-[minmax(0,1fr)_8px_var(--coach-panel-width)]";

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

export function BiologyWorkbenchLayout({ reference, workspace, tutor }: { reference: ReactNode | null; workspace: ReactNode; tutor: ReactNode }) {
  const layoutRef = useRef<HTMLElement>(null);
  const { widths, active, start } = useSidePanelResize(layoutRef);
  const style = { "--reference-panel-width": `${widths.left}px`, "--coach-panel-width": `${widths.right}px` } as CSSProperties;
  return (
    <main ref={layoutRef} aria-label="AdaptivePath Biology Workbench" style={style} className={`${BASE_GRID} ${reference ? WITH_REFERENCE : WITHOUT_REFERENCE}`}>
      {reference && <>
        {reference}
        <ResizeGutter label="Resize reference panel" active={active === "left"} onPointerDown={start("left")} />
      </>}
      {workspace}
      <ResizeGutter label="Resize coach panel" active={active === "right"} onPointerDown={start("right")} />
      {tutor}
    </main>
  );
}

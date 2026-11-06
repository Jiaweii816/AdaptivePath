"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export type SidePanel = "left" | "right";

const DEFAULT_PANEL_WIDTH = 390;
const MIN_PANEL_WIDTH = 260;
const MIN_MIDDLE_WIDTH = 360;
const GUTTER_WIDTH = 8;

type DragOrigin = { panel: SidePanel; startX: number; left: number; right: number };

/** Pointer-driven widths for the two side columns; the middle column keeps a minimum width. */
export function useSidePanelResize(layoutRef: RefObject<HTMLElement | null>) {
  const [widths, setWidths] = useState({ left: DEFAULT_PANEL_WIDTH, right: DEFAULT_PANEL_WIDTH });
  const [active, setActive] = useState<SidePanel | null>(null);
  const origin = useRef<DragOrigin | null>(null);

  useEffect(() => {
    if (!active) return;
    const body = document.body.style;
    const previous = { cursor: body.cursor, userSelect: body.userSelect };
    body.cursor = "col-resize";
    body.userSelect = "none";

    const onMove = (event: PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      const layoutWidth = layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const other = start.panel === "left" ? start.right : start.left;
      const max = Math.max(MIN_PANEL_WIDTH, layoutWidth - other - MIN_MIDDLE_WIDTH - 2 * GUTTER_WIDTH);
      const delta = event.clientX - start.startX;
      const next = start.panel === "left" ? start.left + delta : start.right - delta;
      const width = Math.min(max, Math.max(MIN_PANEL_WIDTH, next));
      setWidths(current => ({ ...current, [start.panel]: width }));
    };
    const onUp = () => { origin.current = null; setActive(null); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      body.cursor = previous.cursor;
      body.userSelect = previous.userSelect;
    };
  }, [active, layoutRef]);

  const start = (panel: SidePanel) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    origin.current = { panel, startX: event.clientX, ...widths };
    setActive(panel);
  };

  return { widths, active, start };
}

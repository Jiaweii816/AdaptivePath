"use client";

import * as React from "react";

export const MIN_DRAWER_WIDTH = 480;
export const MAX_DRAWER_WIDTH = 1400;
const DEFAULT_DRAWER_WIDTH = 680;

function clampDrawerWidth(width: number) {
  return Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, width));
}

/**
 * Drag-to-resize state for the trace drawer's left edge: pointer-drag width
 * updates plus arrow/Home/End keyboard steps, clamped to
 * [MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH]. Width can be externally controlled
 * (`controlledWidth`) or self-managed when the caller doesn't pass one.
 * Split out of `runtime-trace-drawer.tsx` so that file stays focused on
 * layout/composition rather than pointer-event bookkeeping.
 */
export function useDrawerResize({
  controlledWidth,
  onWidthChange,
}: {
  controlledWidth?: number;
  onWidthChange?: (width: number) => void;
}) {
  const [internalWidth, setInternalWidth] = React.useState(DEFAULT_DRAWER_WIDTH);
  const resizeStartRef = React.useRef<{ pointerX: number; width: number } | null>(null);
  const width = clampDrawerWidth(controlledWidth ?? internalWidth);

  const updateWidth = React.useCallback(
    (nextWidth: number) => {
      const clamped = clampDrawerWidth(nextWidth);
      if (controlledWidth === undefined) setInternalWidth(clamped);
      onWidthChange?.(clamped);
    },
    [controlledWidth, onWidthChange],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeStartRef.current = { pointerX: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    updateWidth(start.width + start.pointerX - event.clientX);
  };

  const stopResize = (event: React.PointerEvent<HTMLDivElement>) => {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateWidth(width + 16);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateWidth(width - 16);
    } else if (event.key === "Home") {
      event.preventDefault();
      updateWidth(MIN_DRAWER_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      updateWidth(MAX_DRAWER_WIDTH);
    }
  };

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stopResize,
      onPointerCancel: stopResize,
      onKeyDown,
    },
  };
}

"use client";

/**
 * The original Workbench's exact five-slot grid (left, resize gutter,
 * student workspace, resize gutter, coach).
 * Original Workbench retains its own mature resize/panel state handlers.
 */
export const WORKBENCH_GRID_CLASS =
  "mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-[1800px] gap-3 overflow-y-auto p-3 lg:h-[calc(100vh-4rem)] lg:grid-cols-[var(--problem-panel-width)_8px_minmax(0,1fr)_8px_var(--coach-panel-width)] lg:gap-0 lg:overflow-hidden";

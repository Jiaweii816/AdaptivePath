import type { CSSProperties, ReactNode } from "react";

/**
 * The original Workbench's exact five-slot grid (left, resize gutter,
 * student workspace, resize gutter, coach). Reused by Biology.
 * Original Workbench retains its own mature resize/panel state handlers.
 */
export const WORKBENCH_GRID_CLASS =
  "mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-[1800px] gap-3 overflow-y-auto p-3 lg:h-[calc(100vh-4rem)] lg:grid-cols-[var(--problem-panel-width)_8px_minmax(0,1fr)_8px_var(--coach-panel-width)] lg:gap-0 lg:overflow-hidden";

export function BiologyWorkbenchGrid({
  left,
  middle,
  right,
}: {
  left: ReactNode;
  middle: ReactNode;
  right: ReactNode;
}) {
  const layoutStyle = {
    "--problem-panel-width": "min(30vw, 390px)",
    "--coach-panel-width": "min(30vw, 390px)",
  } as CSSProperties;
  return (
    <main aria-label="AdaptivePath Biology Workbench" style={layoutStyle} className={WORKBENCH_GRID_CLASS}>
      {left}
      <div aria-hidden="true" className="hidden min-h-0 items-center justify-center lg:flex">
        <span className="h-14 w-1 rounded-full bg-border" />
      </div>
      {middle}
      <div aria-hidden="true" className="hidden min-h-0 items-center justify-center lg:flex">
        <span className="h-14 w-1 rounded-full bg-border" />
      </div>
      {right}
    </main>
  );
}

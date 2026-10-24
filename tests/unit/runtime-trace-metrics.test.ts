import { describe, expect, it } from "vitest";
import { computeForegroundTimingMetrics } from "@/server/observability/runtime-trace-metrics";

describe("runtime trace foreground timing metrics", () => {
  it("uses the interval union for Agent busy and labels overlapping total work", () => {
    const at = (milliseconds: number) =>
      new Date(Date.UTC(2026, 6, 12, 12, 0, 0, milliseconds));

    const metrics = computeForegroundTimingMetrics({
      sessionStartedAt: at(0),
      foregroundEndedAt: at(1_000),
      runs: [
        { startedAt: at(100), endedAt: at(600) },
        { startedAt: at(400), endedAt: at(800) },
      ],
    });

    expect(metrics).toEqual({
      visitElapsedMs: 1_000,
      agentBusyMs: 700,
      totalWorkMs: 900,
      workMayOverlap: true,
    });
    expect(metrics.agentBusyMs).toBeLessThanOrEqual(metrics.visitElapsedMs);
  });

  it("clamps open and out-of-visit intervals to the visit wall clock", () => {
    const base = Date.UTC(2026, 6, 12, 12, 0, 0, 0);
    const at = (milliseconds: number) => new Date(base + milliseconds);

    expect(
      computeForegroundTimingMetrics({
        sessionStartedAt: at(100),
        now: at(1_000),
        runs: [
          { startedAt: at(0), endedAt: at(300) },
          { startedAt: at(900), endedAt: null },
        ],
      }),
    ).toEqual({
      visitElapsedMs: 900,
      agentBusyMs: 300,
      totalWorkMs: 300,
      workMayOverlap: false,
    });
  });
});

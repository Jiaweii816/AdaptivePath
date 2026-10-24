export type ForegroundInterval = {
  startedAt: Date;
  endedAt: Date | null;
};

export type ForegroundTimingMetrics = {
  visitElapsedMs: number;
  agentBusyMs: number;
  totalWorkMs: number;
  workMayOverlap: boolean;
};

/**
 * Computes foreground wall-clock metrics without double-counting overlapping
 * Turns. Open Runs are measured to `now`; intervals are clamped to the visit.
 */
export function computeForegroundTimingMetrics(args: {
  sessionStartedAt: Date;
  foregroundEndedAt?: Date | null;
  now?: Date;
  runs: readonly ForegroundInterval[];
}): ForegroundTimingMetrics {
  const now = args.now ?? new Date();
  const visitStart = args.sessionStartedAt.getTime();
  const visitEnd = Math.max(
    visitStart,
    (args.foregroundEndedAt ?? now).getTime(),
  );
  const intervals = args.runs
    .map((run) => ({
      start: Math.max(visitStart, run.startedAt.getTime()),
      end: Math.min(
        visitEnd,
        (run.endedAt ?? now).getTime(),
      ),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const totalWorkMs = intervals.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  let agentBusyMs = 0;
  let activeStart: number | undefined;
  let activeEnd: number | undefined;
  for (const interval of intervals) {
    if (activeStart === undefined || activeEnd === undefined) {
      activeStart = interval.start;
      activeEnd = interval.end;
    } else if (interval.start <= activeEnd) {
      activeEnd = Math.max(activeEnd, interval.end);
    } else {
      agentBusyMs += activeEnd - activeStart;
      activeStart = interval.start;
      activeEnd = interval.end;
    }
  }
  if (activeStart !== undefined && activeEnd !== undefined) {
    agentBusyMs += activeEnd - activeStart;
  }

  return {
    visitElapsedMs: visitEnd - visitStart,
    agentBusyMs,
    totalWorkMs,
    workMayOverlap: totalWorkMs !== agentBusyMs,
  };
}

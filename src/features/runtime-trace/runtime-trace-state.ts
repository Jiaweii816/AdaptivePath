import type {
  RuntimeTraceEvent,
  RuntimeTracePage,
  RuntimeTraceRun,
  RuntimeTraceSession,
  RuntimeTraceTurn,
} from "./runtime-trace-api";

export type RuntimeTraceDataState = {
  /** Session whose sequence space nextSeq belongs to, retained across a null current response. */
  cursorSessionId: string | null;
  session: RuntimeTraceSession | null;
  turns: RuntimeTraceTurn[];
  runs: RuntimeTraceRun[];
  events: RuntimeTraceEvent[];
  nextSeq: number;
  highWaterSeq: number;
  hasMore: boolean;
  hasActiveTurn: boolean;
  backgroundStatus: RuntimeTracePage["backgroundStatus"];
};

export const EMPTY_RUNTIME_TRACE_STATE: RuntimeTraceDataState = {
  cursorSessionId: null,
  session: null,
  turns: [],
  runs: [],
  events: [],
  nextSeq: 0,
  highWaterSeq: 0,
  hasMore: false,
  hasActiveTurn: false,
  backgroundStatus: null,
};

export function mergeRuntimeTracePage(
  previous: RuntimeTraceDataState,
  page: RuntimeTracePage,
): RuntimeTraceDataState {
  if (!page.session) {
    return {
      ...EMPTY_RUNTIME_TRACE_STATE,
      cursorSessionId: previous.session?.id ?? previous.cursorSessionId,
      nextSeq: page.nextSeq,
    };
  }
  const isSameSession = previous.session?.id === page.session.id;
  if (!isSameSession) return pageToState(page);

  return {
    cursorSessionId: page.session.id,
    session: page.session,
    turns: mergeBy(previous.turns, page.turns, (turn) => String(turn.turnOrdinal)),
    runs: mergeBy(previous.runs, page.runs, (run) => run.id),
    events: mergeBy(previous.events, page.events, (event) => event.eventId)
      .sort(compareEvents),
    nextSeq: Math.max(previous.nextSeq, page.nextSeq),
    highWaterSeq: Math.max(previous.highWaterSeq, page.highWaterSeq),
    hasMore: page.hasMore,
    hasActiveTurn: page.hasActiveTurn,
    backgroundStatus: page.backgroundStatus,
  };
}

export async function drainRuntimeTracePages(input: {
  since: number;
  loadPage: (since: number) => Promise<RuntimeTracePage>;
  initialState?: RuntimeTraceDataState;
  maxPages?: number;
}) {
  let state = input.initialState ?? EMPTY_RUNTIME_TRACE_STATE;
  let since = input.since;
  let pageCount = 0;
  let addedEventCount = 0;
  const knownEventIds = new Set(state.events.map((event) => event.eventId));

  while (true) {
    if (pageCount >= (input.maxPages ?? 1_000)) {
      throw new Error("Runtime trace cursor drain exceeded its safety limit.");
    }
    const page = await input.loadPage(since);
    pageCount += 1;

    if (page.session && state.cursorSessionId && state.cursorSessionId !== page.session.id && since > 0) {
      state = EMPTY_RUNTIME_TRACE_STATE;
      since = 0;
      knownEventIds.clear();
      continue;
    }

    for (const event of page.events) {
      if (!knownEventIds.has(event.eventId)) {
        knownEventIds.add(event.eventId);
        addedEventCount += 1;
      }
    }
    state = mergeRuntimeTracePage(state, page);
    if (!page.hasMore) break;
    if (page.nextSeq <= since) {
      throw new Error("Runtime trace cursor did not advance while more events were reported.");
    }
    since = page.nextSeq;
  }

  return { state, addedEventCount, pageCount };
}

function pageToState(page: RuntimeTracePage): RuntimeTraceDataState {
  return {
    cursorSessionId: page.session?.id ?? null,
    session: page.session,
    turns: [...page.turns],
    runs: [...page.runs],
    events: [...page.events].sort(compareEvents),
    nextSeq: page.nextSeq,
    highWaterSeq: page.highWaterSeq,
    hasMore: page.hasMore,
    hasActiveTurn: page.hasActiveTurn,
    backgroundStatus: page.backgroundStatus,
  };
}

function mergeBy<T>(previous: readonly T[], incoming: readonly T[], key: (value: T) => string) {
  const merged = new Map(previous.map((value) => [key(value), value]));
  for (const value of incoming) merged.set(key(value), value);
  return [...merged.values()];
}

function compareEvents(left: RuntimeTraceEvent, right: RuntimeTraceEvent) {
  if (left.seq !== null && right.seq !== null) return left.seq - right.seq;
  if (left.seq !== null) return -1;
  if (right.seq !== null) return 1;
  return left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCurrentRuntimeTracePage,
  fetchRuntimeTraceDetailPage,
  fetchRuntimeTraceHistoryPage,
  RuntimeTraceApiError,
  type RuntimeTraceHistorySession,
  type RuntimeTracePage,
} from "./runtime-trace-api";
import {
  drainRuntimeTracePages,
  EMPTY_RUNTIME_TRACE_STATE,
  type RuntimeTraceDataState,
} from "./runtime-trace-state";

export type RuntimeTraceAvailability = "disabled" | "idle" | "loading" | "ready" | "error";

export interface RuntimeTraceEventFilterState {
  kinds: readonly string[];
  query: string;
}

export interface RuntimeTraceEventFilterControls extends RuntimeTraceEventFilterState {
  setKinds: (kinds: readonly string[]) => void;
  setQuery: (query: string) => void;
}

/** Holds the timeline's kind/text filter selection; lifted here so drawer.tsx stays presentational. */
export function useRuntimeTraceEventFilter(): RuntimeTraceEventFilterControls {
  const [kinds, setKinds] = useState<readonly string[]>([]);
  const [query, setQuery] = useState("");
  return { kinds, query, setKinds, setQuery };
}

type PollingOptions = {
  enabled: boolean;
  open: boolean;
  /** Keep polling a null current Session while a drawer/foreground action is waiting for creation. */
  keepAliveWhenEmpty?: boolean;
  pageLimit?: number;
};

export function useCurrentRuntimeTrace(input: PollingOptions & {
  browserInstanceId: string | null;
  problemId: string | null;
}) {
  const loadPage = useCallback((since: number, signal: AbortSignal) => {
    if (!input.browserInstanceId || !input.problemId) {
      return Promise.reject(new Error("Runtime trace needs a browser instance and problem."));
    }
    return fetchCurrentRuntimeTracePage({
      browserInstanceId: input.browserInstanceId,
      problemId: input.problemId,
      since,
      limit: input.pageLimit,
      signal,
    });
  }, [input.browserInstanceId, input.pageLimit, input.problemId]);

  return useRuntimeTracePolling({
    ...input,
    identityKey: `${input.browserInstanceId ?? ""}:${input.problemId ?? ""}`,
    ready: Boolean(input.browserInstanceId && input.problemId),
    loadPage,
  });
}

export function useRuntimeTraceSessionDetail(input: PollingOptions & {
  sessionId: string | null;
}) {
  const loadPage = useCallback((since: number, signal: AbortSignal) => {
    if (!input.sessionId) return Promise.reject(new Error("Runtime trace needs a Session id."));
    return fetchRuntimeTraceDetailPage({
      sessionId: input.sessionId,
      since,
      limit: input.pageLimit,
      signal,
    });
  }, [input.pageLimit, input.sessionId]);

  return useRuntimeTracePolling({
    ...input,
    identityKey: input.sessionId ?? "",
    ready: Boolean(input.sessionId),
    loadPage,
  });
}

function useRuntimeTracePolling(input: PollingOptions & {
  identityKey: string;
  ready: boolean;
  loadPage: (since: number, signal: AbortSignal) => Promise<RuntimeTracePage>;
}) {
  const { enabled, identityKey, keepAliveWhenEmpty = false, loadPage, open, ready } = input;
  const [stored, setStored] = useState<{
    identityKey: string;
    data: RuntimeTraceDataState;
  }>({ identityKey, data: EMPTY_RUNTIME_TRACE_STATE });
  const [internalAvailability, setInternalAvailability] = useState<RuntimeTraceAvailability>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unseen, setUnseen] = useState({ identityKey, count: 0 });
  const [refreshToken, setRefreshToken] = useState(0);
  const dataRef = useRef(stored);
  const atTailRef = useRef(true);
  const failureCountRef = useRef(0);
  const data = stored.identityKey === identityKey ? stored.data : EMPTY_RUNTIME_TRACE_STATE;
  const hasKnownPollingWork =
    getRuntimeTraceNextPollDelay(data, { keepAliveWhenEmpty: false }) !== null;
  const shouldPoll = enabled && ready && (open || keepAliveWhenEmpty || hasKnownPollingWork);

  useEffect(() => {
    if (!shouldPoll) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const schedule = (delay: number | null) => {
      if (cancelled || delay === null) return;
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      const currentData = dataRef.current.identityKey === identityKey
        ? dataRef.current.data
        : EMPTY_RUNTIME_TRACE_STATE;
      if (currentData.events.length === 0) setInternalAvailability("loading");
      try {
        const drained = await drainRuntimeTracePages({
          since: currentData.nextSeq,
          initialState: currentData,
          loadPage: (since) => loadPage(since, controller.signal),
        });
        if (cancelled) return;
        dataRef.current = { identityKey, data: drained.state };
        setStored({ identityKey, data: drained.state });
        setError(null);
        setInternalAvailability("ready");
        failureCountRef.current = 0;
        if (drained.addedEventCount > 0) {
          setUnseen((current) => ({
            identityKey,
            count: atTailRef.current || current.identityKey !== identityKey
              ? atTailRef.current ? 0 : drained.addedEventCount
              : current.count + drained.addedEventCount,
          }));
        }
        schedule(getRuntimeTraceNextPollDelay(drained.state, { keepAliveWhenEmpty }));
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        const disabled = caught instanceof RuntimeTraceApiError && caught.disabled;
        setInternalAvailability(disabled ? "disabled" : "error");
        setError(caught instanceof Error ? caught.message : "Unable to read runtime trace.");
        if (!disabled) {
          failureCountRef.current += 1;
          schedule(Math.min(30_000, 1_000 * 2 ** Math.min(failureCountRef.current - 1, 5)));
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [identityKey, keepAliveWhenEmpty, loadPage, refreshToken, shouldPoll]);

  const setViewportAtTail = useCallback((atTail: boolean) => {
    atTailRef.current = atTail;
    if (atTail) setUnseen({ identityKey, count: 0 });
  }, [identityKey]);

  const availability: RuntimeTraceAvailability = !enabled
    ? "disabled"
    : !ready
      ? "idle"
      : !open && !keepAliveWhenEmpty && !hasKnownPollingWork
        ? "idle"
      : internalAvailability;
  const unseenCount = unseen.identityKey === identityKey ? unseen.count : 0;

  return {
    ...data,
    availability,
    error,
    unseenCount,
    acknowledgeUnseen: useCallback(() => setUnseen({ identityKey, count: 0 }), [identityKey]),
    setViewportAtTail,
    refresh: useCallback(() => setRefreshToken((token) => token + 1), []),
  };
}

export function getRuntimeTraceNextPollDelay(
  state: RuntimeTraceDataState,
  options: { keepAliveWhenEmpty?: boolean } = {},
) {
  if (!state.session) return options.keepAliveWhenEmpty ? 1_000 : null;
  if (state.hasActiveTurn) return 1_000;
  if (state.backgroundStatus === "pending" || state.session.backgroundStatus === "pending") return 5_000;
  return null;
}

export function useRuntimeTraceHistory(input: {
  enabled: boolean;
  open: boolean;
  pageLimit?: number;
}) {
  const [sessions, setSessions] = useState<RuntimeTraceHistorySession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [internalAvailability, setInternalAvailability] = useState<RuntimeTraceAvailability>("idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const loadingRef = useRef(false);

  const load = useCallback(async (cursor: string | null, replace: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    await Promise.resolve();
    setInternalAvailability("loading");
    try {
      const page = await fetchRuntimeTraceHistoryPage({ cursor, limit: input.pageLimit });
      setSessions((current) => mergeHistory(replace ? [] : current, page.sessions));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
      setInternalAvailability("ready");
    } catch (caught) {
      const disabled = caught instanceof RuntimeTraceApiError && caught.disabled;
      setInternalAvailability(disabled ? "disabled" : "error");
      setError(caught instanceof Error ? caught.message : "Unable to read runtime trace history.");
    } finally {
      loadingRef.current = false;
    }
  }, [input.pageLimit]);

  useEffect(() => {
    if (!input.enabled || !input.open) return;
    const timer = setTimeout(() => void load(null, true), 0);
    return () => clearTimeout(timer);
  }, [input.enabled, input.open, load, refreshToken]);

  return {
    sessions,
    nextCursor,
    hasMore,
    availability: !input.enabled ? "disabled" : !input.open ? "idle" : internalAvailability,
    error,
    loadMore: useCallback(() => {
      if (hasMore && nextCursor) void load(nextCursor, false);
    }, [hasMore, load, nextCursor]),
    refresh: useCallback(() => setRefreshToken((token) => token + 1), []),
  };
}

function mergeHistory(
  current: readonly RuntimeTraceHistorySession[],
  incoming: readonly RuntimeTraceHistorySession[],
) {
  const sessions = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) sessions.set(session.id, session);
  return [...sessions.values()].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id),
  );
}

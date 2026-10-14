"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnline } from "@/hooks/useOfflineRows";

export type InfinitePage<T> = {
  /** The rows for the requested page. */
  rows: T[];
  /** Whether more pages remain after this one. */
  hasMore: boolean;
};

type Options<T> = {
  /** Rows the server already rendered (page 1). */
  initialRows: T[];
  /** Whether more rows exist beyond the initial page. */
  initialHasMore: boolean;
  /** Fetch a given 1-based page from the server (a server action). Page 1 is the
   *  initial render, so this is only ever called with page >= 2. */
  fetchPage: (page: number) => Promise<InfinitePage<T>>;
  /** Stable id for de-duping (offset paging can shift when rows are inserted). */
  getId: (row: T) => string;
  /** Start loading this far before the sentinel is actually on screen. Default "400px". */
  rootMargin?: string;
  /**
   * When the server read `initialRows` (Date.now() there). Next can show a
   * page it fetched ahead of the click — minutes ago, possibly — so a first
   * page older than STALE_FIRST_PAGE_MS is shown at once and then quietly
   * swapped for a fresh one (`fetchPage(1)`). Leave unset to never refetch.
   */
  loadedAt?: number;
  /**
   * Whether this list is the one on screen. A page that swaps between two
   * lists in one place (the customers list and its search results) turns the
   * hidden one off, and the shown one watches its sentinel again — the
   * sentinel is a new element each time it's put back. Default true.
   */
  enabled?: boolean;
};

// How old a first page may be before it is fetched again behind the scenes —
// the same window the projects list uses.
export const STALE_FIRST_PAGE_MS = 15_000;

// After a page fails to load, how long before the bottom of the list asks
// again by itself (it also asks again the moment the connection comes back,
// or on retry()).
export const LOAD_RETRY_PAUSE_MS = 10_000;

/**
 * Fetch-from-DB-as-you-scroll: keep an accumulating list of server rows and pull
 * the next page when a bottom sentinel scrolls into view — no "next page" button,
 * and only ~one page is held per request so it stays light.
 *
 * Wire `sentinelRef` to an empty `<div>` after the rows. If the rows live inside
 * an `overflow-auto` box, also wire `scrollRef` to that box; otherwise leave it
 * unset and the page viewport is used. For a layout that has BOTH a desktop
 * scroll-box and a mobile list that scrolls with the page, put `sentinelRef`
 * inside the box (with `scrollRef` on the box) and `mobileSentinelRef` after the
 * mobile list — only the visible one ever fires.
 *
 * With no connection it doesn't ask at all (`offline`), and a page that fails
 * stops the asking (`error`) until retry(), the connection coming back, or
 * LOAD_RETRY_PAUSE_MS — the sentinel is usually still on screen after a
 * failure, and asking again at once looped as fast as the requests could fail.
 *
 * Resets back to page 1 whenever `initialRows` identity changes (a filter change
 * that re-renders the server component). Wrap `fetchPage`/`getId` in `useCallback`
 * so the observer is not torn down on every render.
 */
export function useInfiniteScroll<T>({
  initialRows,
  initialHasMore,
  fetchPage,
  getId,
  rootMargin = "400px",
  loadedAt,
  enabled = true,
}: Options<T>) {
  const [rows, setRows] = useState<T[]>(initialRows);
  const [nextPage, setNextPage] = useState(2);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A page failed: the sentinel stops asking until something says try again.
  const [halted, setHalted] = useState(false);
  const online = useOnline();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const mobileSentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // When the server re-renders with a fresh first page (filter changed), start
  // over. React's "adjust state during render" pattern — guarded by identity.
  const [prevInitial, setPrevInitial] = useState(initialRows);
  if (initialRows !== prevInitial) {
    setPrevInitial(initialRows);
    setRows(initialRows);
    setNextPage(2);
    setHasMore(initialHasMore);
    setError(null);
    setHalted(false);
  }

  // One page at a time: both sentinels (and a retry) can ask in the same
  // moment, and two answers for the same page raced each other.
  const inFlightRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(nextPage);
      setRows((prev) => {
        const seen = new Set(prev.map(getId));
        const fresh = result.rows.filter((row) => !seen.has(getId(row)));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      setNextPage((page) => page + 1);
      setHasMore(result.hasMore);
    } catch (caught) {
      setError(toHebrewError(caught, "טעינת הרשימה נכשלה. נסו שוב."));
      setHalted(true);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [fetchPage, getId, nextPage]);

  // Observe the sentinel; reconnect after each load so a tall screen keeps
  // filling until the bottom is genuinely reached.
  useEffect(() => {
    if (!enabled || !hasMore || loading || halted || !online) return;

    const observers: IntersectionObserver[] = [];
    const observe = (target: Element | null, root: Element | null) => {
      if (!target) return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void loadMore();
        },
        { root, rootMargin }
      );
      io.observe(target);
      observers.push(io);
    };
    observe(sentinelRef.current, scrollRef.current);
    observe(mobileSentinelRef.current, null);
    return () => observers.forEach((io) => io.disconnect());
  }, [enabled, hasMore, loading, halted, online, loadMore, rootMargin]);

  // A halt lifts by itself after a pause, or as soon as the connection is back.
  useEffect(() => {
    if (!halted) return;
    const resume = () => setHalted(false);
    const timer = window.setTimeout(resume, LOAD_RETRY_PAUSE_MS);
    window.addEventListener("online", resume);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", resume);
    };
  }, [halted]);

  /** Ask for the next page now — the "נסו שוב" under a failed page. */
  const retry = useCallback(() => {
    setHalted(false);
    if (!loading && hasMore) void loadMore();
  }, [hasMore, loadMore, loading]);

  // An old first page (see `loadedAt`): fetch it again and swap it in — only
  // if nothing past it has been added meanwhile, so a scroll isn't undone.
  const latestRef = useRef({ fetchPage, nextPage });
  useEffect(() => {
    latestRef.current = { fetchPage, nextPage };
  }, [fetchPage, nextPage]);
  useEffect(() => {
    if (loadedAt === undefined || Date.now() - loadedAt <= STALE_FIRST_PAGE_MS) return;
    let cancelled = false;
    latestRef.current
      .fetchPage(1)
      .then((result) => {
        if (cancelled || latestRef.current.nextPage !== 2) return;
        setRows(result.rows);
        setHasMore(result.hasMore);
      })
      // The copy on screen stays; the next visit tries again.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialRows, loadedAt]);

  return {
    /** The accumulated rows to render. */
    rows,
    /** Mutate the accumulated rows directly — e.g. optimistic edits/inserts. */
    setRows,
    /** How many rows are currently shown. */
    count: rows.length,
    hasMore,
    loading,
    /** The last page's failure, in Hebrew — cleared when the next attempt starts. */
    error,
    /** Try the failed page again now. */
    retry,
    /** No connection: nothing more is asked for until it's back. */
    offline: !online,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  };
}

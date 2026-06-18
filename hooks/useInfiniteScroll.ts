"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useRef, useState } from "react";

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
};

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
}: Options<T>) {
  const [rows, setRows] = useState<T[]>(initialRows);
  const [nextPage, setNextPage] = useState(2);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  }

  // Observe the sentinel; reconnect after each load so a tall screen keeps
  // filling until the bottom is genuinely reached.
  useEffect(() => {
    if (!hasMore || loading) return;

    const loadMore = async () => {
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
        setError(toHebrewError(caught, String(caught)));
      } finally {
        setLoading(false);
      }
    };

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
  }, [hasMore, loading, nextPage, fetchPage, getId, rootMargin]);

  return {
    /** The accumulated rows to render. */
    rows,
    /** Mutate the accumulated rows directly — e.g. optimistic edits/inserts. */
    setRows,
    /** How many rows are currently shown. */
    count: rows.length,
    hasMore,
    loading,
    error,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  };
}

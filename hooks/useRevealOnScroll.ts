"use client";

import { useEffect, useRef, useState } from "react";

type Options = {
  /** How many rows to show before any scrolling. Default 30. */
  initial?: number;
  /** How many more rows to reveal each time the bottom comes into view. Default 30. */
  step?: number;
  /** How early to start revealing, before the sentinel is actually on screen. Default "400px". */
  rootMargin?: string;
};

/**
 * Reveal-on-scroll for a list that is *already loaded* in memory — the same
 * pattern the financial ledger uses: keep a growing "visible" window and bump it
 * whenever a bottom sentinel scrolls into view, so there is never a "next page"
 * button and the page never reloads.
 *
 * Wire up the returned refs like this:
 *   - `scrollRef`        → the element with `overflow-auto` (the desktop scroll box)
 *   - `sentinelRef`      → an empty `<div>` placed inside that scroll box, after the rows
 *   - `mobileSentinelRef`→ an empty `<div>` after a list that scrolls with the page (no scroll box)
 * Use whichever sentinels your layout actually has; unused refs simply stay idle.
 *
 * IMPORTANT: pass a *stable* (memoized or state-held) `items` array. The window
 * resets to the top whenever the array identity changes — that is what you want
 * when a filter/search/sort produces a new list, but it would thrash if `items`
 * were rebuilt on every render.
 */
export function useRevealOnScroll<T>(items: T[], options: Options = {}) {
  const initial = options.initial ?? 30;
  const step = options.step ?? 30;
  const rootMargin = options.rootMargin ?? "400px";

  const [visibleCount, setVisibleCount] = useState(initial);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const mobileSentinelRef = useRef<HTMLDivElement>(null);

  // Jump back to the top of the window when the underlying list changes (new
  // filter / search / sort). This is React's "adjust state during render" pattern
  // — guarded so it only fires when the array identity actually changes, which is
  // why callers must pass a stable array.
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setVisibleCount(initial);
  }

  const total = items.length;
  const hasMore = visibleCount < total;

  // Reconnect the observers after every reveal so that, if the sentinel is still
  // in view (e.g. a tall container that one step did not fill), it keeps loading
  // until the bottom is genuinely off-screen or everything is shown.
  useEffect(() => {
    if (!hasMore) return;
    const loadMore = () => setVisibleCount((v) => Math.min(v + step, total));
    const observers: IntersectionObserver[] = [];
    const observe = (target: Element | null, root: Element | null) => {
      if (!target) return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) loadMore();
        },
        { root, rootMargin }
      );
      io.observe(target);
      observers.push(io);
    };
    observe(sentinelRef.current, scrollRef.current);
    observe(mobileSentinelRef.current, null);
    return () => observers.forEach((io) => io.disconnect());
  }, [hasMore, total, step, rootMargin, visibleCount]);

  return {
    /** The slice of `items` to render. */
    visibleItems: items.slice(0, visibleCount),
    /** How many rows are currently shown (never more than the total). */
    visibleCount: Math.min(visibleCount, total),
    /** Whether more rows remain to be revealed. */
    hasMore,
    /** Total number of rows in the list. */
    total,
    scrollRef,
    sentinelRef,
    mobileSentinelRef,
  };
}

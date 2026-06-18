"use client";

import { useEffect, useRef, useState } from "react";

type Options = {
  /** How many rows to show before any scrolling. Default 30. */
  initial?: number;
  /** How many more rows to reveal each time the bottom comes into view. Default 30. */
  step?: number;
  /** How early to start revealing (for the mobile/viewport sentinel). Default "400px". */
  rootMargin?: string;
  /**
   * Optional value mixed into the observer effect's deps. Change it to force the
   * listener to re-attach and re-fire its initial fill — needed when the scroll
   * container starts with zero height (e.g. an inactive Radix tab is display:none)
   * and only gets real layout once it becomes visible.
   */
  watch?: unknown;
};

/**
 * Reveal-on-scroll for a list that is *already loaded* in memory.
 *
 * Wire up the returned refs like this:
 *   - `scrollRef`         → the element with `overflow-auto` (the desktop scroll box)
 *   - `mobileSentinelRef` → an empty `<div>` after a list that scrolls with the page (no scroll box)
 * `sentinelRef` is returned for backward compat but is no longer used internally.
 *
 * IMPORTANT: pass a *stable* (memoized or state-held) `items` array. The window
 * resets to the top whenever the array identity changes.
 */
export function useRevealOnScroll<T>(items: T[], options: Options = {}) {
  const initial = options.initial ?? 30;
  const step = options.step ?? 30;
  const rootMargin = options.rootMargin ?? "400px";
  const watch = options.watch;

  const [visibleCount, setVisibleCount] = useState(initial);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const mobileSentinelRef = useRef<HTMLDivElement>(null);

  // Reset when the list identity changes (new filter/search/sort).
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setVisibleCount(initial);
  }

  const total = items.length;
  const hasMore = visibleCount < total;

  useEffect(() => {
    if (!hasMore) return;
    const loadMore = () => setVisibleCount((v) => Math.min(v + step, total));
    const cleanups: (() => void)[] = [];

    // Desktop: scroll event on the inner overflow container.
    // Avoids IntersectionObserver's unreliable behavior when the container
    // starts hidden (inactive Radix tab has display:none → IO never fires).
    const container = scrollRef.current;
    if (container) {
      const onScroll = () => {
        // Guard: if the container has no layout (hidden tab), do nothing.
        if (container.clientHeight === 0) return;
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 400) {
          loadMore();
        }
      };
      container.addEventListener("scroll", onScroll, { passive: true });
      // Fire once immediately in case the initial batch doesn't fill the container.
      onScroll();
      cleanups.push(() => container.removeEventListener("scroll", onScroll));
    }

    // Mobile: IntersectionObserver on the sentinel placed outside the scroll box,
    // which scrolls with the page so the viewport is the correct root.
    const mobileSentinel = mobileSentinelRef.current;
    if (mobileSentinel) {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMore();
        },
        { rootMargin }
      );
      io.observe(mobileSentinel);
      cleanups.push(() => io.disconnect());
    }

    return () => cleanups.forEach((fn) => fn());
  }, [hasMore, step, total, rootMargin, visibleCount, watch]);

  return {
    visibleItems: items.slice(0, visibleCount),
    visibleCount: Math.min(visibleCount, total),
    hasMore,
    total,
    scrollRef,
    sentinelRef,
    mobileSentinelRef,
  };
}

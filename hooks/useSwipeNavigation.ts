"use client";

import { useEffect, useRef } from "react";

/**
 * Swipe left/right on a container to step through a sequence — the phone
 * gesture for "next tab", matching how the calendar pages between months.
 *
 * Deliberately conservative about what counts as a swipe:
 *  - a single finger only (two fingers is a pinch/zoom, never navigation);
 *  - mostly horizontal (|dx| > |dy|), so scrolling a long tab down never fires;
 *  - past a real threshold, so a tap with a shaky thumb doesn't switch tabs;
 *  - and never when the gesture started inside something horizontally
 *    scrollable (a table, the tab strip itself) — that content owns the axis.
 *
 * Direction follows the app's RTL layout, and matches how the calendar pages
 * between months: the NEXT tab sits to the left of the current one, so you drag
 * the page to the RIGHT to bring it in — swipe right = forward, swipe left =
 * back. (That's the opposite of the LTR convention, which is why it felt
 * backwards the first time.)
 */
export function useSwipeNavigation(
  ref: React.RefObject<HTMLElement | null>,
  {
    onNext,
    onPrevious,
    enabled = true,
    threshold = 60,
  }: {
    onNext: () => void;
    onPrevious: () => void;
    enabled?: boolean;
    /** Minimum horizontal travel, in px, before it counts. */
    threshold?: number;
  }
) {
  // Keep the latest callbacks without re-binding the listeners on every render
  // (they're usually inline arrows, so their identity changes constantly).
  const handlers = useRef({ onNext, onPrevious });
  useEffect(() => {
    handlers.current = { onNext, onPrevious };
  }, [onNext, onPrevious]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;

    let startX: number | null = null;
    let startY: number | null = null;
    let ignore = false;
    // The nearest horizontally scrollable ancestor of wherever the finger landed,
    // and where it was scrolled to when the gesture started.
    let scroller: HTMLElement | null = null;
    let scrollerLeft = 0;

    const findScroller = (target: EventTarget | null) => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== node) {
        if (el.scrollWidth > el.clientWidth + 8) return el;
        el = el.parentElement;
      }
      return null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        startX = null;
        startY = null;
        ignore = true;
        return;
      }
      ignore = false;
      scroller = findScroller(event.target);
      scrollerLeft = scroller?.scrollLeft ?? 0;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (ignore || startX == null || startY == null || event.touches.length > 0) {
        startX = null;
        startY = null;
        ignore = false;
        return;
      }
      // Only yield to a scrollable child if it ACTUALLY scrolled. Bailing merely
      // because one exists meant a tab strip that's already at its end — or any
      // wide table on the page — silently ate every swipe, so the page slid
      // sideways and the tab never changed.
      if (scroller && Math.abs(scroller.scrollLeft - scrollerLeft) > 2) {
        startX = null;
        startY = null;
        scroller = null;
        return;
      }
      scroller = null;
      const touch = event.changedTouches[0];
      const dx = (touch?.clientX ?? startX) - startX;
      const dy = (touch?.clientY ?? startY) - startY;
      startX = null;
      startY = null;
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < threshold) return;
      if (dx > 0) handlers.current.onNext();
      else handlers.current.onPrevious();
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchend", onTouchEnd);
    };
  }, [ref, enabled, threshold]);
}

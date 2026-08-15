"use client";

import { useEffect, useRef } from "react";
import { consumeHorizontalGestureClaim } from "@/lib/ui/gesture-claim";

/** Accumulated horizontal wheel travel before a trackpad swipe counts as one step. */
const WHEEL_THRESHOLD = 60;

/**
 * Swipe left/right on a container to step through a sequence — the phone
 * gesture for "next tab", matching how the calendar pages between months.
 * Handles BOTH a finger (touch events) and a trackpad two-finger swipe (a wheel
 * with deltaX); binding only touch is why it appeared dead on a desktop.
 *
 * Deliberately conservative about what counts as a swipe:
 *  - a single finger only (two fingers is a pinch/zoom, never navigation);
 *  - mostly horizontal (|dx| > |dy|), so scrolling a long tab down never fires;
 *  - past a real threshold, so a tap with a shaky thumb doesn't switch tabs;
 *  - and never when the gesture starts on content that owns the horizontal axis
 *    itself: anything scrollable sideways (a table), or anything marked
 *    `data-swipe-owner` (a swipe-actions row). See ownsGesture below.
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

    /**
     * Does the finger land on something that owns horizontal movement of its
     * own? Two kinds count, and BOTH are decided up front rather than by
     * watching what moved:
     *
     *  - anything horizontally scrollable (a table, a strip of chips). Asking
     *    afterwards whether it actually scrolled is not enough: one already at
     *    its end doesn't move, so the drag looked free and paged the tab;
     *  - anything carrying `data-swipe-owner` — a swipe-actions row, which
     *    moves by transform and so never touches scrollLeft at all.
     *
     * Erring toward NOT paging is the right way round: a swipe that does
     * nothing is a non-event, while one that jumps you to another tab loses
     * your place.
     */
    const ownsGesture = (target: EventTarget | null) => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== node) {
        if (el.hasAttribute("data-swipe-owner")) return true;
        if (el.scrollWidth > el.clientWidth + 8) return true;
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        startX = null;
        startY = null;
        ignore = true;
        return;
      }
      ignore = ownsGesture(event.target);
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onTouchEnd = (event: TouchEvent) => {
      // The decisive check: did a widget CLAIM this drag as it started? A
      // swipe-actions row does, on pointerdown. Unlike inspecting the DOM under
      // the finger, this can't be fooled by an <svg> target, a row that
      // re-rendered mid-gesture, or a widget that moves by transform.
      // Consumed unconditionally so a claim never survives into the next drag.
      const wasClaimed = consumeHorizontalGestureClaim();
      // Re-checked at the END as well: a row that re-rendered mid-gesture (its
      // editor opening, say) leaves the start target detached from the document,
      // so the touchstart check alone can miss an owner that's plainly there.
      if (!ignore && (wasClaimed || ownsGesture(event.target))) ignore = true;
      if (ignore || startX == null || startY == null || event.touches.length > 0) {
        startX = null;
        startY = null;
        ignore = false;
        return;
      }
      const touch = event.changedTouches[0];
      const dx = (touch?.clientX ?? startX) - startX;
      const dy = (touch?.clientY ?? startY) - startY;
      startX = null;
      startY = null;
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < threshold) return;
      if (dx > 0) handlers.current.onNext();
      else handlers.current.onPrevious();
    };

    // A trackpad two-finger swipe is not a touch — it arrives as a wheel with
    // deltaX, which is why this did nothing at all on a desktop. Same convention
    // as the calendar's month paging: accumulate deltaX, and positive is forward.
    let wheelAcc = 0;
    let wheelIdle: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (event: WheelEvent) => {
      // Vertical scrolling with a little sideways drift is not a swipe.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      // A sideways-scrolling table (or a swipeable row) owns this axis.
      if (ownsGesture(event.target)) return;

      wheelAcc += event.deltaX;
      if (wheelIdle) clearTimeout(wheelIdle);
      // Momentum decays; without this, two unrelated nudges minutes apart would
      // eventually add up to a tab change.
      wheelIdle = setTimeout(() => {
        wheelAcc = 0;
      }, 250);

      if (Math.abs(wheelAcc) < WHEEL_THRESHOLD) return;
      const forward = wheelAcc > 0;
      wheelAcc = 0;
      if (forward) handlers.current.onNext();
      else handlers.current.onPrevious();
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchend", onTouchEnd, { passive: true });
    node.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("wheel", onWheel);
      if (wheelIdle) clearTimeout(wheelIdle);
    };
  }, [ref, enabled, threshold]);
}

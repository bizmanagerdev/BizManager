"use client";

import { useCallback, useRef } from "react";

// A long press, for the question a phone has no hover to ask: "which ones?".
//
// Deliberately cancelled by movement — a press that turns into a scroll is a
// scroll, and a gallery is mostly scrolled. Without the movement guard, flicking
// through photographs drops you into selection mode every few swipes.

const HOLD_MS = 450;
/** Past this the finger is scrolling, not holding. */
const MOVE_TOLERANCE_PX = 10;

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      fired.current = false;
      origin.current = { x: touch.clientX, y: touch.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, HOLD_MS);
    },
    [onLongPress]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      const start = origin.current;
      if (!touch || !start) return;
      const moved =
        Math.abs(touch.clientX - start.x) > MOVE_TOLERANCE_PX ||
        Math.abs(touch.clientY - start.y) > MOVE_TOLERANCE_PX;
      if (moved) clear();
    },
    [clear]
  );

  /** True when the press already opened selection — the tap must not also open the viewer. */
  const consumed = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear, consumed };
}

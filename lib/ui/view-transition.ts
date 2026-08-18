"use client";

import { flushSync } from "react-dom";

type TransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * Run a state update as a VIEW TRANSITION, so what's on screen moves to its new
 * place instead of jumping there.
 *
 * The dashboard repacks whenever a card appears or goes quiet — dismiss the
 * activity digest and four cards shuffle up a column. Done instantly that reads
 * as a glitch; done as a 200ms slide it reads as a consequence of what you just
 * clicked. Each board cell carries a `viewTransitionName`, which is what lets the
 * browser pair the before and after and animate between them.
 *
 * `flushSync` is the necessary part: React batches state updates, so without it
 * the callback returns before the DOM has changed and the browser snapshots two
 * identical frames.
 *
 * Degrades to a plain update — no polyfill, no delay — when the API is missing
 * (Firefox at time of writing) or the viewer asked for less motion.
 */
export function withViewTransition(update: () => void) {
  const doc = typeof document === "undefined" ? null : (document as TransitionDocument);
  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (!doc?.startViewTransition || reduced) {
    update();
    return;
  }

  doc.startViewTransition(() => flushSync(update));
}

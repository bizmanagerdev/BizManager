"use client";

import { useEffect, useRef } from "react";
import { BOARD_PENDING_SELECTOR, pictureScript, savePicture } from "@/lib/dashboard/picture";

/** The live board is shown after this long whatever state it's in. */
const HANDOVER_AT_MOST_MS = 5000;
/** The complete board, unchanged this long: kept as the next opening's picture. */
const KEEP_WHEN_STILL_MS = 1500;
/** And at most this often while the page stays open (it's kept again when the app goes to the background). */
const KEEP_AT_MOST_EVERY_MS = 15_000;

/**
 * Opens the dashboard instantly: the board as it last stood on this device
 * (lib/dashboard/picture.ts) is put on screen by an inline script while the
 * page is still being read — before any of the app's code runs — over the
 * live board, which stays hidden beneath it. The moment the live board is
 * complete (no placeholders, no card still waiting for its fresh figures) it
 * takes the picture's place, in the same frame. A tap, or 5 seconds, hands
 * over early. The complete board is kept as the next picture once it settles,
 * when the app goes to the background, and when the dashboard is left.
 *
 * Renders the picture's box and the script, as the first children of the
 * board's holder; the board itself is the holder's `[data-dashboard-board]`.
 */
export default function DashboardPicture({ userId }: { userId: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const picture = box.current;
    const holder = picture?.parentElement;
    const board = holder?.querySelector<HTMLElement>("[data-dashboard-board]");
    if (!picture || !holder || !board) return;
    const complete = () => !board.querySelector(BOARD_PENDING_SELECTOR);

    let showing = holder.hasAttribute("data-picture-showing");
    const handOver = () => {
      if (!showing) return;
      showing = false;
      holder.removeAttribute("data-picture-showing");
      picture.innerHTML = "";
    };

    let keptAt = 0;
    const keep = (whatever = false) => {
      if (!complete()) return;
      if (!whatever && Date.now() - keptAt < KEEP_AT_MOST_EVERY_MS) return;
      keptAt = Date.now();
      savePicture(userId, board);
    };

    let stillTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (complete()) handOver();
      clearTimeout(stillTimer);
      stillTimer = setTimeout(() => keep(), KEEP_WHEN_STILL_MS);
    };
    const observer = new MutationObserver(onChange);
    observer.observe(board, { subtree: true, childList: true, characterData: true });
    onChange();

    const giveUp = setTimeout(handOver, HANDOVER_AT_MOST_MS);
    const onBackground = () => {
      if (document.visibilityState === "hidden") keep(true);
    };
    document.addEventListener("visibilitychange", onBackground);
    holder.addEventListener("pointerdown", handOver);
    window.addEventListener("keydown", handOver);

    return () => {
      observer.disconnect();
      clearTimeout(stillTimer);
      clearTimeout(giveUp);
      document.removeEventListener("visibilitychange", onBackground);
      holder.removeEventListener("pointerdown", handOver);
      window.removeEventListener("keydown", handOver);
      keep(true); // leaving the dashboard: its latest state for next time
      handOver();
    };
  }, [userId]);

  return (
    <>
      {/* Filled by the script below before the page is drawn; React never
          fills it (its HTML is "" on both sides), so hydration leaves it be. */}
      <div
        ref={box}
        inert
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script dangerouslySetInnerHTML={{ __html: pictureScript(userId) }} />
    </>
  );
}

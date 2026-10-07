"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  BOARD_PENDING_SELECTOR,
  PICTURE_BOX_ID,
  pictureScript,
  pictureShowing,
  savePicture,
  takeDownPicture,
} from "@/lib/dashboard/picture";

// The dashboard opens instantly: the board as it last stood on this device
// (lib/dashboard/picture.ts) is put on screen by an inline script while the
// page is still being read — before any of the app's code runs, and before
// the page's own loading screen could show — at the very spot the board will
// be, with the loading screen and the live board hidden beneath it
// (globals.css). The moment the live board is complete (no placeholders, no
// card still waiting for its fresh figures) it takes the picture's place.
//
// Two parts: DashboardPictureFrame lives in the app's frame (app/(app)/
// layout.tsx), which is on screen from the first moment; DashboardPicture-
// Keeper lives on the dashboard itself, hands over, and keeps the picture.

/** The live board is shown after this long whatever state it's in. */
const HANDOVER_AT_MOST_MS = 5000;
/** The complete board, unchanged this long: kept as the next opening's picture. */
const KEEP_WHEN_STILL_MS = 1500;
/** And at most this often while the page stays open (it's kept again when the app goes to the background). */
const KEEP_AT_MOST_EVERY_MS = 15_000;

/** The picture's box and the script that fills it — and takes it down if the app moves off the dashboard first. */
export function DashboardPictureFrame({ userId }: { userId: string }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/dashboard" && pictureShowing()) takeDownPicture();
  }, [pathname]);

  return (
    <>
      {/* Filled by the script below before the page is drawn; React never
          fills it (its HTML is "" on both sides), so hydration leaves it be. */}
      <div
        id={PICTURE_BOX_ID}
        inert
        aria-hidden
        className="pointer-events-none absolute z-10"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script dangerouslySetInnerHTML={{ __html: pictureScript(userId) }} />
    </>
  );
}

/**
 * On the dashboard: hands the screen over to the live board (`[data-dashboard-
 * board]`) the moment it's complete — or on a tap, or after 5 seconds — and
 * keeps the complete board as the next picture once it settles, when the app
 * goes to the background, and when the dashboard is left.
 */
export function DashboardPictureKeeper({ userId }: { userId: string }) {
  const keepNow = useRef<(() => void) | null>(null);
  // Leaving the dashboard: its latest state for next time — while the board
  // is still on the page (a layout effect's cleanup runs before it's removed).
  useLayoutEffect(() => () => keepNow.current?.(), []);

  useEffect(() => {
    const board = document.querySelector<HTMLElement>("[data-dashboard-board]");
    if (!board) return;
    const complete = () => !board.querySelector(BOARD_PENDING_SELECTOR);
    const handOver = () => {
      if (pictureShowing()) takeDownPicture();
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

    keepNow.current = () => keep(true);

    const giveUp = setTimeout(handOver, HANDOVER_AT_MOST_MS);
    const onBackground = () => {
      if (document.visibilityState === "hidden") keep(true);
    };
    document.addEventListener("visibilitychange", onBackground);
    document.addEventListener("pointerdown", handOver, true);
    window.addEventListener("keydown", handOver);

    return () => {
      observer.disconnect();
      clearTimeout(stillTimer);
      clearTimeout(giveUp);
      document.removeEventListener("visibilitychange", onBackground);
      document.removeEventListener("pointerdown", handOver, true);
      window.removeEventListener("keydown", handOver);
      keepNow.current = null;
      handOver();
    };
  }, [userId]);

  return null;
}

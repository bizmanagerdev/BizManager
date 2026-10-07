"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  BOARD_PENDING_SELECTOR,
  DASHBOARD_PICTURE_ON,
  PICTURE_BOX_ID,
  clearPicture,
  pictureScript,
  pictureShowing,
  savePicture,
  takeDownPicture,
} from "@/lib/dashboard/picture";
import type { Locale } from "@/lib/i18n/types";

// The dashboard opens instantly: its whole screen as it last stood on this
// device (lib/dashboard/picture.ts) — top bar and greeting, cards, bottom
// bar — is put up over everything by an inline script while the page is
// still being read, before any of the app's code runs and before the page's
// own loading screen could show. The moment the live screen looks the same
// (its board complete, the greeting in the top bar) it takes the picture's
// place.
//
// Two parts: DashboardPictureFrame lives in the app's frame (app/(app)/
// layout.tsx), on screen from the first moment; DashboardPictureKeeper lives
// on the dashboard itself, hands over, and keeps the picture. Both do nothing
// while the off switch is set (DASHBOARD_PICTURE_ON).

/** The live screen is shown after this long whatever state it's in. */
const HANDOVER_AT_MOST_MS = 5000;
/** The complete screen, unchanged this long: kept as the next opening's picture. */
const KEEP_WHEN_STILL_MS = 1500;
/** And at most this often while the page stays open (it's kept again when the app goes to the background). */
const KEEP_AT_MOST_EVERY_MS = 15_000;

/** The picture's box and the script that fills it — and takes it down if the app moves off the dashboard first. */
export function DashboardPictureFrame({ userId, locale }: { userId: string; locale: Locale }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== "/dashboard" && pictureShowing()) takeDownPicture();
  }, [pathname]);

  if (!DASHBOARD_PICTURE_ON) return null;
  return (
    <>
      {/* Filled by the script below before the page is drawn; React never
          fills it (its HTML is "" on both sides), so hydration leaves it be.
          Empty, it's an invisible layer nothing can touch. */}
      <div
        id={PICTURE_BOX_ID}
        inert
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[2147483000] overflow-hidden"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <script dangerouslySetInnerHTML={{ __html: pictureScript(userId, locale) }} />
    </>
  );
}

/**
 * On the dashboard: hands the screen over to the live one the moment it looks
 * the same — the board (`[data-dashboard-board]`) complete and the greeting
 * in the top bar — or on a tap, or after 5 seconds; and keeps the complete
 * screen (`[data-app-screen]`) as the next picture once it settles, and when
 * the app goes to the background.
 */
export function DashboardPictureKeeper({ userId, locale }: { userId: string; locale: Locale }) {
  useEffect(() => {
    if (!DASHBOARD_PICTURE_ON) {
      clearPicture(); // switched off: nothing kept on the device either
      return;
    }
    const screen = document.querySelector<HTMLElement>("[data-app-screen]");
    const board = document.querySelector<HTMLElement>("[data-dashboard-board]");
    if (!screen || !board) return;
    const complete = () => !board.querySelector(BOARD_PENDING_SELECTOR) && !!screen.querySelector("[data-dashboard-greeting]");
    const handOver = () => {
      if (pictureShowing()) takeDownPicture();
    };

    let keptAt = 0;
    const keep = (whatever = false) => {
      if (!complete() || pictureShowing()) return;
      if (!whatever && Date.now() - keptAt < KEEP_AT_MOST_EVERY_MS) return;
      keptAt = Date.now();
      savePicture(userId, screen, locale);
    };

    let stillTimer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (complete()) handOver();
      clearTimeout(stillTimer);
      stillTimer = setTimeout(() => keep(), KEEP_WHEN_STILL_MS);
    };
    const observer = new MutationObserver(onChange);
    observer.observe(screen, { subtree: true, childList: true, characterData: true });
    onChange();

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
      handOver();
    };
  }, [userId, locale]);

  return null;
}

"use client";

import { useSyncExternalStore } from "react";
import { useSetPageTitle } from "@/components/layout/page-title-context";

// No reactive source — the date is read once per render from the local clock.
const subscribe = () => () => {};

// "יום ראשון · 16.8" — weekday spelled out (the part you actually use in Israel),
// date numeric, no year.
//
// The bar's middle slot is ~125px on a 360px phone once the back arrow and the
// three end icons have taken theirs, and the title does NOT shrink to fit — it
// overflows. The month spelled out ("16 באוגוסט") is ~12px too wide and ran under
// the search glyph. Keep this string short; it is the longest title in the app.
function formatHeaderDate(date: Date) {
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(date);
  const rest = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" }).format(date);
  return `${weekday} · ${rest}`;
}

/**
 * The dashboard's MOBILE header text. Every other screen puts its name up there
 * ("לקוחות", "פרויקטים") because on a phone there's no sidebar to say where you
 * are — but "דשבורד" is the one screen you never need told, since it's where the
 * app opens. So the bar carries today's date instead, and the greeting block
 * below drops its own date line at those widths (see DashboardGreeting) so it's
 * never printed twice.
 *
 * Renders nothing: it only declares the title through the page-title context.
 * Read from the CLIENT clock (server value used for the SSR snapshot) so a
 * cached/PWA-restored page can't leave yesterday's date sitting in the bar.
 */
export default function DashboardHeaderDate({ initialDate }: { initialDate: string }) {
  const today = useSyncExternalStore(
    subscribe,
    () => formatHeaderDate(new Date()),
    () => initialDate
  );
  useSetPageTitle(today);
  return null;
}

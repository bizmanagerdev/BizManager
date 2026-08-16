"use client";

import { useSyncExternalStore } from "react";
import { useSetPageTitle } from "@/components/layout/page-title-context";

// No reactive source — the date is read once per render from the local clock.
const subscribe = () => () => {};

// "יום ראשון · 16 באוגוסט". No year: the bar is one shrink-to-fit line and the
// year is the one part of today's date nobody needs told.
function formatHeaderDate(date: Date) {
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(date);
  const rest = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(date);
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

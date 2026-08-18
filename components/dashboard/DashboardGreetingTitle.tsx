"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { greetingForHour } from "@/lib/dashboard/greeting";

// No reactive source — the greeting is read from the local clock on each render.
const subscribe = () => () => {};

/**
 * The dashboard's greeting, in the TOP BAR (user, 2026-08-18: "move the greeting
 * to the header"). Renders nothing itself: it only declares the page title, so
 * the bar shows "ערב טוב, סורוצקין 👋" where every other page shows its name — and
 * now, like every other page's title, at every width (not just on a phone).
 *
 * A greeting greets the PERSON, which is what the chrome is for; the day's card
 * is named by the date instead.
 *
 * Read from the VIEWER's clock via useSyncExternalStore (the server snapshot is
 * the SSR value), so a page cached at 11:00 and restored at 16:00 doesn't still
 * say בוקר טוב.
 */
export default function DashboardGreetingTitle({
  name,
  initialGreeting,
}: {
  /** The viewer's first name. */
  name: string;
  /** SSR snapshot from the server's clock. */
  initialGreeting: string;
}) {
  const greeting = useSyncExternalStore(
    subscribe,
    () => greetingForHour(new Date().getHours()),
    () => initialGreeting
  );

  // The NAME is what gives on a narrow bar. "ערב טוב, סורוצקין 👋" is the longest
  // title in the app and the slot doesn't shrink — it spills under the search
  // glyph — so below `sm` the greeting stands alone. You know who you are; the
  // time of day is the part that changes.
  //
  // useMemo is NOT optional: useSetPageTitle stores the node in state and lists
  // it as an effect dependency, so a fresh element every render would set state
  // on every render — an infinite loop.
  const title = useMemo(
    () => (
      <>
        {greeting}
        {name ? <span className="hidden sm:inline">, {name}</span> : null}
        <span aria-hidden> 👋</span>
      </>
    ),
    [greeting, name]
  );

  useSetPageTitle(title);
  return null;
}

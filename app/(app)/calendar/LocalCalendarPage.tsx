"use client";

import { useLayoutEffect, useState } from "react";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import { emitNavigationContentShown } from "@/components/layout/TopNavigationProgress";
import { LIST_STORED_MAX_AGE_MS } from "@/lib/powersync/stored-results";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import { israelDateKey } from "@/lib/timezone";
import CalendarSection from "@/app/(app)/calendar/CalendarSection";
import CalendarSkeleton from "@/app/(app)/calendar/CalendarSkeleton";

// The calendar drawn from the on-device copy (LOCAL_DATA_PAGES.calendar): mine,
// and everyone's for the back office, read with the server's own loader
// (getCalendarFeeds) on the device — again by itself whenever a task, project,
// order, reminder or snooze changes. Paging the months, the שלי / הכל switch
// and the search never asked the server; now the opening doesn't either. If
// the device's copy can't serve it, the page reloads as the server version
// (?data=server).

export default function LocalCalendarPage({ viewer }: { viewer: LocalCardViewer }) {
  const feeds = useLocalCard({
    kind: "calendar",
    viewer,
    page: "calendar",
    serverHref: "/calendar?data=server",
    storedMaxAgeMs: LIST_STORED_MAX_AGE_MS,
  });
  useDevicePageTiming("calendar", feeds, feeds?.data.mine.length);
  // Today on this device's clock, in Israel's calendar — the page is drawn
  // here, after the server's HTML (its placeholder), so nothing disagrees.
  const [todayIso] = useState(() => israelDateKey());

  // On screen with its content: the top bar is done.
  const contentOnScreen = feeds !== null;
  useLayoutEffect(() => {
    if (contentOnScreen) emitNavigationContentShown();
  }, [contentOnScreen]);

  if (!feeds) return <CalendarSkeleton />;
  return (
    <CalendarSection entries={feeds.data.mine} allEntries={feeds.data.all} todayIso={todayIso} locale={viewer.locale} />
  );
}

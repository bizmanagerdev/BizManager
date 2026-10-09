"use client";

import { usePathname } from "next/navigation";
import MeetingSkeleton, { MeetingRecordSkeleton, MeetingsHistorySkeleton } from "./MeetingSkeleton";

// The meetings page's loading screen is also what the router can show on the
// way from outside /meetings to the pages under it (its boundary is the outer
// one), so it looks at the address: the history — its list; a past meeting —
// that meeting's page; the meetings page itself — the live meeting.
export default function MeetingsLoadingBody() {
  const pathname = usePathname() ?? "/meetings";
  if (pathname === "/meetings/history") {
    return (
      <div data-route-loading="true">
        <MeetingsHistorySkeleton />
      </div>
    );
  }
  if (pathname.startsWith("/meetings/")) {
    return (
      <div data-route-loading="true">
        <MeetingRecordSkeleton />
      </div>
    );
  }
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
      <MeetingSkeleton />
    </div>
  );
}

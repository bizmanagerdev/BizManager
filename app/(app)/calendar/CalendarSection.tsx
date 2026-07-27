"use client";

import CalendarView from "@/app/(app)/calendar/CalendarView";
import type { CalendarEntry } from "@/lib/projectSchedule";

// Thin wrapper: the month calendar owns its own scope (שלי/הכל, via a header
// menu) and header. The old timeline (ציר זמן) view + toggle bar were removed.
export default function CalendarSection({
  entries,
  allEntries = null,
  todayIso,
}: {
  entries: CalendarEntry[];
  /** When provided (admin/office), enables the שלי/הכל scope menu. */
  allEntries?: CalendarEntry[] | null;
  todayIso: string;
}) {
  return <CalendarView entries={entries} allEntries={allEntries} todayIso={todayIso} />;
}

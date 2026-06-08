import type { CalendarEntry } from "@/lib/projectSchedule";

/**
 * Pure week-bucketing helpers shared by the inline dashboard `WeekOverview` and the
 * "מה קורה השבוע" quick-action dialog (DashboardActions). Keeping the logic here
 * means both surfaces bucket the same schedule feed identically.
 */

export function toDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date: Date): Date {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  value.setDate(value.getDate() - value.getDay()); // Sunday-start week (Israel)
  return value;
}

export function addDays(date: Date, days: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Israeli work week: Friday (5) and Saturday (6) are the weekend. */
export function addWorkingDays(date: Date, workingDays: number): Date {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let added = 0;
  while (added < workingDays) {
    value.setDate(value.getDate() + 1);
    const day = value.getDay();
    if (day !== 5 && day !== 6) added += 1;
  }
  return value;
}

export type WeekDayBucket = { day: Date; isToday: boolean; entries: CalendarEntry[] };

export type WeekView = {
  weekStart: Date;
  weekEnd: Date;
  /** Long-running projects (15+ days) that span this week — shown as a legend, not per-day. */
  generalEntries: CalendarEntry[];
  days: WeekDayBucket[];
  totalCount: number;
};

/**
 * Bucket a schedule feed into the current Sun–Sat week:
 *   - long projects (started before the week, 15+ days) → `generalEntries` legend,
 *   - tasks → only on their due day,
 *   - shorter/just-started projects → every active day within the week.
 */
export function buildWeekView(entries: CalendarEntry[], today: Date): WeekView {
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  const generalEntries = entries.filter((entry) => {
    if (entry.kind !== "project") return false;
    const start = toDateOnly(entry.startDate);
    const end = toDateOnly(entry.endDate) ?? start;
    if (!start || !end) return false;
    const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
    return start < weekStart && end >= weekStart && durationDays >= 15;
  });
  const generalIds = new Set(generalEntries.map((e) => e.id));

  const days: WeekDayBucket[] = Array.from({ length: 7 }).map((_, index) => {
    const day = addDays(weekStart, index);
    const dayEntries = entries.filter((entry) => {
      if (generalIds.has(entry.id)) return false;
      const start = toDateOnly(entry.startDate);
      const end = toDateOnly(entry.endDate) ?? start;
      if (!start || !end) return false;
      if (entry.kind === "task") return isSameDay(day, start);
      const effectiveStart = start < weekStart ? weekStart : start;
      return day >= effectiveStart && day <= end && day <= weekEnd;
    });
    return { day, isToday: isSameDay(day, today), entries: dayEntries };
  });

  const totalCount =
    generalEntries.length + days.reduce((sum, bucket) => sum + bucket.entries.length, 0);

  return { weekStart, weekEnd, generalEntries, days, totalCount };
}

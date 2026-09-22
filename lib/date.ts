import { israelDateKey, israelParts, type WallClockParts } from "@/lib/timezone";

/**
 * A stored value as the wall-clock fields we should SHOW, on the business's own
 * clock. Three shapes reach here and they are not the same thing:
 *
 *  - "2026-09-22" is a calendar DATE. It has no hour, so there is nothing to
 *    convert — shifting it through any timezone is the classic off-by-one.
 *  - "2026-09-22T08:30" carries no offset, so it is not an instant either. In
 *    this app such a value is a wall clock someone typed, and the wall clock
 *    everyone here means is Israel's. Its digits are read as written, NOT as
 *    `new Date()` would read them (that is the device's clock, which for a
 *    worker abroad is a different hour entirely).
 *  - Anything with a Z or a ±hh:mm — every timestamptz Supabase returns — IS an
 *    instant, and gets converted to what a clock in Israel showed at that moment.
 */
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function displayParts(value: string): WallClockParts | null {
  const trimmed = value.trim();
  const wall = WALL_CLOCK_PATTERN.exec(trimmed);
  if (wall) {
    return {
      year: Number(wall[1]),
      month: Number(wall[2]),
      day: Number(wall[3]),
      hour: Number(wall[4] ?? 0),
      minute: Number(wall[5] ?? 0),
      second: Number(wall[6] ?? 0),
    };
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : israelParts(date);
}

/** A calendar day as a comparable number, with no timezone left in it. */
function dayIndex(parts: WallClockParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/**
 * "יום שני" — the full Hebrew weekday of a timestamp, in Israel time.
 *
 * Lives here rather than beside the attendance card that first needed it: a
 * "use client" module's exports can't be called from a server component (Next
 * throws "attempted to call X from the server but X is on the client"), and the
 * dashboard's server-rendered day headings need exactly this.
 */
export function hebrewWeekday(iso: string) {
  const parts = displayParts(iso);
  if (!parts) return "";
  // Already resolved to an Israeli wall clock above, so the weekday is read off
  // that date in UTC — converting a second time would shift it back.
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "UTC" }).format(
    new Date(dayIndex(parts))
  );
}

export function formatShortDate(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parts = displayParts(value);
  if (!parts) return value;
  return `${pad(parts.day)}/${pad(parts.month)}/${pad(parts.year % 100)}`;
}

/**
 * "05/09" — day/month only, no year. For compact spots (a status badge) where
 * the year would just widen it without adding anything a reader needs.
 */
export function formatDayMonth(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parts = displayParts(value);
  if (!parts) return value;
  return `${pad(parts.day)}/${pad(parts.month)}`;
}

export function formatShortDateTime(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parts = displayParts(value);
  if (!parts) return value;
  return `${formatShortDate(value, fallback)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Just the clock time ("08:30") — for rows that already say which day it was, so
 * the date isn't repeated on every line.
 */
export function formatTimeOnly(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const parts = displayParts(value);
  if (!parts) return value;
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export type DueUrgency = "overdue" | "due-soon" | "due-week" | "none";

/**
 * How close a due date is, for colour-coding:
 *  - "overdue"  : already past (and the task isn't done)
 *  - "due-soon" : within the next 3 days → red
 *  - "due-week" : within the next 7 days → yellow
 *  - "none"     : further out, missing, or the task is done
 *
 * "Today" is today IN ISRAEL, not on the reader's device: a task due the 22nd is
 * overdue when the business's day has turned over, not when a phone in another
 * country says so.
 */
export function getDueUrgency(
  value: string | null | undefined,
  options?: { done?: boolean; refDate?: string }
): DueUrgency {
  if (!value || options?.done) return "none";
  const target = displayParts(value);
  if (!target) return "none";

  const today = displayParts(options?.refDate ?? israelDateKey());
  if (!today) return "none";
  const diffDays = Math.round((dayIndex(target) - dayIndex(today)) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "due-soon";
  if (diffDays <= 7) return "due-week";
  return "none";
}

// Soft-outline chip classes (border + light tint + text) for a due-date urgency.
// Empty string for "none" so the date renders as plain text. Matches the app's
// soft-badge convention (no solid pills).
export function dueUrgencyChipClass(urgency: DueUrgency): string {
  switch (urgency) {
    case "overdue":
    case "due-soon":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "due-week":
      return "border-warning/40 bg-warning/15 text-warning-strong";
    default:
      return "";
  }
}

// Text-only colour for a due-date urgency (when a chip background isn't wanted).
export function dueUrgencyTextClass(urgency: DueUrgency): string {
  switch (urgency) {
    case "overdue":
    case "due-soon":
      return "text-destructive";
    case "due-week":
      return "text-warning-strong";
    default:
      return "";
  }
}

export function formatRelativeDateLabel(value: string | null | undefined, fallback = "-", refDate?: string) {
  if (!value) return fallback;
  const target = displayParts(value);
  if (!target) return fallback;

  const today = displayParts(refDate ?? israelDateKey());
  if (!today) return fallback;
  const diffDays = Math.round((dayIndex(target) - dayIndex(today)) / (1000 * 60 * 60 * 24));
  const absDiffDays = Math.abs(diffDays);

  if (diffDays === 0) return "היום";
  if (diffDays === -1) return "אתמול";
  if (diffDays === 1) return "מחר";

  if (absDiffDays < 7) {
    return diffDays < 0 ? `לפני ${absDiffDays} ימים` : `בעוד ${absDiffDays} ימים`;
  }

  if (absDiffDays < 30) {
    const weeks = Math.round(absDiffDays / 7);
    return diffDays < 0 ? `לפני ${weeks} שבועות` : `בעוד ${weeks} שבועות`;
  }

  const months = Math.max(1, Math.round(absDiffDays / 30));
  return diffDays < 0 ? `לפני ${months} חודשים` : `בעוד ${months} חודשים`;
}

import { israelDateKey, israelParts, israelWallClockToUtc } from "@/lib/timezone";

// The activity feed reads by the Israeli calendar, like every other day in the
// app: an action at 00:30 on a Thursday belongs to Thursday even on a laptop
// abroad, and "today" starts at Israel's midnight, not the server's (UTC).

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** The Israeli day (YYYY-MM-DD) an instant falls on, or null for a missing / bad stamp. */
export function israelDayKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return israelDateKey(date);
}

/** A day key N days after another, by the calendar (no clock involved). */
export function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The heading over a day's actions: "היום", "אתמול", or the weekday and date
 * ("יום חמישי · 9.10"), with the year only when it isn't this year's.
 */
export function dayHeading(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return "היום";
  if (dayKey === shiftDayKey(todayKey, -1)) return "אתמול";
  const [year, month, day] = dayKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const yearPart = dayKey.slice(0, 4) === todayKey.slice(0, 4) ? "" : `.${String(year).slice(-2)}`;
  return `יום ${weekday} · ${day}.${month}${yearPart}`;
}

/** The UTC instant of Israel's midnight that opens a day. */
export function israelDayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return israelWallClockToUtc(year, month, day, 0, 0);
}

/** The hour (0–23) on an Israeli clock at an instant. */
export function israelHourOf(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return israelParts(date).hour;
}

/** "14:05" on an Israeli clock. */
export function israelClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = israelParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

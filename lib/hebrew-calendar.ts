import { HDate, HebrewCalendar, gematriya, flags } from "@hebcal/core";

// Jewish-calendar helpers for the events calendar: Hebrew date labels + holidays.
// @hebcal/core is pure JS and runs fine in the browser.

function toIsoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/** Hebrew day-of-month numeral for a Gregorian date, e.g. "כ״ב". */
export function hebrewDayLabel(date: Date): string {
  return gematriya(new HDate(date).getDate());
}

/** Full Hebrew date for a Gregorian date, e.g. "כ״ב סִיוָן תשפ״ו". */
export function hebrewFullDate(date: Date): string {
  return new HDate(date).renderGematriya();
}

// Holidays worth surfacing in a business calendar (Israel). Excludes parashat
// hashavua, candle-lighting times, omer count and special-Shabbat labels.
const HOLIDAY_MASK =
  flags.CHAG |
  flags.MAJOR_FAST |
  flags.MINOR_FAST |
  flags.MODERN_HOLIDAY |
  flags.MINOR_HOLIDAY |
  flags.ROSH_CHODESH |
  flags.EREV;

/** Map of `YYYY-MM-DD` (local) → Hebrew holiday name for the given range. */
export function getHolidaysInRange(start: Date, end: Date): Map<string, string> {
  const events = HebrewCalendar.calendar({
    start,
    end,
    il: true,
    sedrot: false,
    candlelighting: false,
    omer: false,
  });

  const byDay = new Map<string, string>();
  for (const ev of events) {
    if ((ev.getFlags() & HOLIDAY_MASK) === 0) continue;
    const iso = toIsoLocal(ev.getDate().greg());
    // First (most significant) event per day wins.
    if (!byDay.has(iso)) byDay.set(iso, ev.render("he"));
  }
  return byDay;
}

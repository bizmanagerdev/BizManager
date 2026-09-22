/**
 * Israel time, in one place.
 *
 * The business runs on one clock — payroll months, the attendance queue, the
 * crons, the day tiles — and that clock is Asia/Jerusalem. The DEVICE's clock is
 * not it: a worker abroad who types 08:30 into a `datetime-local` field means
 * 08:30 in Israel, and `new Date("2026-09-22T08:30")` reads that string as the
 * phone's wall clock instead. In New York that stored 12:30Z, which the office
 * then read back as 15:30 — a seven-hour shift error that no validation could
 * catch, because 15:30 is a perfectly legal time to start work.
 *
 * So every crossing between a wall-clock STRING ("YYYY-MM-DDTHH:mm", what the
 * inputs hold) and an INSTANT (an ISO timestamp, what the database holds) goes
 * through here, and pins the conversion to Israel at both ends.
 */

export const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

const LOCAL_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ISRAEL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** An instant broken into the wall-clock fields a viewer in Israel would read off a clock. */
export function israelParts(date: Date): WallClockParts {
  const parts = partsFormatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Minutes that Israel local time is ahead of UTC at the given instant (120 winter / 180 summer). */
export function israelOffsetMinutes(date: Date): number {
  const p = israelParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60000;
}

/** Convert an Israel wall-clock (y, month 1-12, d, h, mi) to the correct UTC instant. */
export function israelWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even across a DST boundary.
  let utc = guess - israelOffsetMinutes(new Date(guess)) * 60000;
  utc = guess - israelOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc);
}

/** A date as YYYY-MM-DD on the Israeli calendar — "today" for anyone the business cares about. */
export function israelDateKey(referenceDate: Date = new Date()): string {
  const p = israelParts(referenceDate);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * An instant as the "YYYY-MM-DDTHH:mm" value a DateTimeInput holds, in Israel time.
 * Use this to PREFILL an editor, so the hour on screen is the hour the office keeps.
 */
export function toIsraelLocalValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = israelParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Now as a DateTimeInput value in Israel time. `offsetMinutes` nudges it forward
 * (a reminder defaulting to "in an hour") before the conversion.
 */
export function nowIsraelLocalValue(offsetMinutes = 0): string {
  const now = new Date();
  now.setSeconds(0, 0);
  return toIsraelLocalValue(new Date(now.getTime() + offsetMinutes * 60000));
}

/**
 * The inverse: a "YYYY-MM-DDTHH:mm" the user typed, read as ISRAEL wall clock,
 * returned as the ISO instant to store. "" when the value isn't a usable
 * datetime — callers treat that the same as the `Number.isNaN` check they used
 * to do on `new Date(value)`.
 */
export function israelLocalValueToIso(value: string | null | undefined): string {
  const match = LOCAL_VALUE_PATTERN.exec((value ?? "").trim());
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  const date = israelWallClockToUtc(Number(year), Number(month), Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * The same conversion as a Date, for the callers that hand the value straight to
 * a server action. `null` where `israelLocalValueToIso` returns "" — so the
 * guard is one falsy check instead of a `Number.isNaN(d.getTime())` dance.
 */
export function israelLocalValueToDate(value: string | null | undefined): Date | null {
  const iso = israelLocalValueToIso(value);
  return iso ? new Date(iso) : null;
}

/**
 * Does this device's clock currently agree with Israel's?
 *
 * Compared by OFFSET, not by timezone name: a phone reporting "Asia/Tel_Aviv",
 * or no zone at all, still shows the right numbers as long as it is +3 (or +2 in
 * winter). Only a genuine disagreement is worth telling the user about.
 *
 * CLIENT ONLY, and only after mount — the server runs UTC, so calling this
 * during render would hydrate-mismatch every time.
 */
export function isDeviceClockOnIsraelTime(referenceDate: Date = new Date()): boolean {
  return -referenceDate.getTimezoneOffset() === israelOffsetMinutes(referenceDate);
}

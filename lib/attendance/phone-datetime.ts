/**
 * Parse + validate the keypad date/time a worker enters when reporting a FORGOTTEN shift by phone
 * (menu option 3). The provider collects four DTMF fields and posts them to /api/attendance/call:
 *   start_date = DDMM, start_time = HHMM, end_date = DDMM, end_time = HHMM
 * The worker keys wall-clock ISRAEL time; we convert to a UTC instant (DST-aware) for storage.
 *
 * Year is inferred: a forgotten shift is recent, so we assume the current year and roll back a year
 * only when the date lands clearly in the future (a late-December shift reported in early January).
 */

const TZ = "Asia/Jerusalem";
const MAX_SHIFT_MINUTES = 24 * 60; // a single shift can't exceed a day
const MAX_PAST_DAYS = 62; // guard against fat-fingered dates far in the past
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // allow small clock skew

export type ParsedDate = { day: number; month: number };
export type ParsedTime = { hour: number; minute: number };

export type PastShiftFields = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export type PastShiftResult =
  | { ok: true; clockIn: Date; clockOut: Date; workedMinutes: number }
  // "invalid" = unparseable/impossible; "order" = end not after start; "range" = too long or too old;
  // "future" = the shift ends in the future. All map to one Hebrew error recording.
  | { ok: false; reason: "invalid" | "order" | "range" | "future" };

function digitsOnly(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

/** DDMM (accepts 3–4 digits, left-padded): "0407"/"407" → 4 July. */
export function parseDateField(value: string | null | undefined): ParsedDate | null {
  const digits = digitsOnly(value);
  if (digits.length < 3 || digits.length > 4) return null;
  const padded = digits.padStart(4, "0");
  const day = Number(padded.slice(0, 2));
  const month = Number(padded.slice(2, 4));
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day, month };
}

/** HHMM (accepts 3–4 digits, left-padded): "0830"/"830" → 08:30. */
export function parseTimeField(value: string | null | undefined): ParsedTime | null {
  const digits = digitsOnly(value);
  if (digits.length < 3 || digits.length > 4) return null;
  const padded = digits.padStart(4, "0");
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Minutes that Israel local time is ahead of UTC at the given instant (120 winter / 180 summer). */
function israelOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {} as Record<string, string>);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/** Convert an Israel wall-clock (y, month 1-12, d, h, mi) to the correct UTC instant. */
export function israelWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even across a DST boundary.
  let utc = guess - israelOffsetMinutes(new Date(guess)) * 60000;
  utc = guess - israelOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function buildPastShift(fields: PastShiftFields, now: Date): PastShiftResult {
  const sd = parseDateField(fields.startDate);
  const st = parseTimeField(fields.startTime);
  const ed = parseDateField(fields.endDate);
  const et = parseTimeField(fields.endTime);
  if (!sd || !st || !ed || !et) return { ok: false, reason: "invalid" };

  let year = now.getFullYear();
  if (sd.day > daysInMonth(year, sd.month) || ed.day > daysInMonth(year, ed.month)) {
    return { ok: false, reason: "invalid" };
  }

  let start = israelWallClockToUtc(year, sd.month, sd.day, st.hour, st.minute);
  // A date more than a day in the future belongs to last year (Dec shift reported in Jan).
  if (start.getTime() - now.getTime() > 24 * 60 * 60000) {
    year -= 1;
    start = israelWallClockToUtc(year, sd.month, sd.day, st.hour, st.minute);
  }

  let end = israelWallClockToUtc(year, ed.month, ed.day, et.hour, et.minute);
  // End not after start with the same year → the shift crossed into the next year.
  if (end.getTime() <= start.getTime()) {
    end = israelWallClockToUtc(year + 1, ed.month, ed.day, et.hour, et.minute);
  }

  const workedMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (workedMinutes <= 0) return { ok: false, reason: "order" };
  if (workedMinutes > MAX_SHIFT_MINUTES) return { ok: false, reason: "range" };
  if (end.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return { ok: false, reason: "future" };
  if (start.getTime() < now.getTime() - MAX_PAST_DAYS * 24 * 60 * 60000) return { ok: false, reason: "range" };

  return { ok: true, clockIn: start, clockOut: end, workedMinutes };
}

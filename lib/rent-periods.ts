import { HDate, gematriya } from "@hebcal/core";

// A lease's rent periods (owner, 2026-10-20 — the ניהול נכסים card): paid on a
// day of the regular month or of the Hebrew month ("every א׳ of the month,
// whatever the English date is, that's when it's due, the alert, everything"),
// monthly or once a year. A period is named by the day it's due — its start:
// 1 Nov 2026, or א׳ חשון's date (12 Oct 2026). A Hebrew leap year has 13
// months, so 13 payments (owner, 2026-10-20: "yes"). Pure; dates are
// "YYYY-MM-DD" in Israel's calendar.

export type RentCalendar = "gregorian" | "hebrew";

export type RentPeriodLease = {
  startDate: string | null;
  endDate?: string | null;
  rentCalendar?: RentCalendar | string | null;
  /** The regular month's day; null ⇒ the day the lease started. */
  rentDayOfMonth?: number | null;
  /** The Hebrew month's day (1–30) when the lease is on the Hebrew calendar. */
  rentHebrewDay?: number | null;
  /** 1 = monthly, 12 = yearly. */
  periodMonths?: number | null;
};

const NIQQUD = /[֑-ׇ]/g;

function noon(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isHebrewLease(lease: RentPeriodLease): boolean {
  return lease.rentCalendar === "hebrew" && Number(lease.rentHebrewDay) >= 1;
}

function isYearly(lease: RentPeriodLease): boolean {
  return Number(lease.periodMonths) === 12;
}

function gregorianDay(lease: RentPeriodLease): number {
  const stored = Number(lease.rentDayOfMonth);
  if (Number.isFinite(stored) && stored >= 1 && stored <= 31) return Math.round(stored);
  return Number(lease.startDate?.slice(8, 10)) || 1;
}

/** The regular month's period that `month` (its first day) holds, on the lease's day (a short month: its last). */
function gregorianDue(year: number, monthIndex: number, day: number): string {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return isoOf(new Date(year, monthIndex, Math.min(day, last), 12));
}

/** The Hebrew month's due day (a 29-day month has no ל׳: its last day). */
function hebrewDue(month: number, year: number, day: number): string {
  const length = HDate.daysInMonth(month, year);
  return isoOf(new HDate(Math.min(day, length), month, year).greg());
}

/** Every period due date from `fromIso` to `toIso` (both included), oldest first. */
export function rentPeriodStarts(lease: RentPeriodLease, fromIso: string, toIso: string): string[] {
  if (fromIso > toIso) return [];
  const out: string[] = [];
  const from = noon(fromIso);
  const to = noon(toIso);
  if (isHebrewLease(lease)) {
    const day = Math.round(Number(lease.rentHebrewDay));
    if (isYearly(lease)) {
      const anchor = new HDate(noon(lease.startDate ?? fromIso));
      for (let year = new HDate(from).getFullYear() - 1; year <= new HDate(to).getFullYear() + 1; year++) {
        // Adar in a year without two: the one Adar (hebcal maps ADAR_II to it).
        const month = anchor.getMonth() > HDate.monthsInYear(year) ? HDate.monthsInYear(year) : anchor.getMonth();
        const due = hebrewDue(month, year, day);
        if (due >= fromIso && due <= toIso) out.push(due);
      }
      return out.sort();
    }
    let cursor = new HDate(1, new HDate(from).getMonth(), new HDate(from).getFullYear()).subtract(1, "month");
    for (let i = 0; i < 400; i++) {
      const due = hebrewDue(cursor.getMonth(), cursor.getFullYear(), day);
      if (due > toIso) break;
      if (due >= fromIso) out.push(due);
      cursor = new HDate(1, cursor.getMonth(), cursor.getFullYear()).add(1, "month");
    }
    return out;
  }
  const day = gregorianDay(lease);
  if (isYearly(lease)) {
    const monthIndex = Number(lease.startDate?.slice(5, 7) ?? "1") - 1;
    for (let year = from.getFullYear() - 1; year <= to.getFullYear() + 1; year++) {
      const due = gregorianDue(year, monthIndex, day);
      if (due >= fromIso && due <= toIso) out.push(due);
    }
    return out.sort();
  }
  for (let y = from.getFullYear(), m = from.getMonth() - 1; ; m++) {
    const due = gregorianDue(y, m, day);
    if (due > toIso) break;
    if (due >= fromIso) out.push(due);
    if (out.length > 400) break;
  }
  return out;
}

/** The lease's first period: the first due date on or after its start. */
export function firstRentPeriod(lease: RentPeriodLease): string | null {
  if (!lease.startDate) return null;
  const start = lease.startDate.slice(0, 10);
  // A lease that starts a few days before its due day pays its first period then.
  return rentPeriodStarts(lease, start, isoOf(new Date(noon(start).getTime() + 400 * 86_400_000)))[0] ?? null;
}

/** The period a day falls in: the last due date on or before it (the first one, before the lease's first). */
export function rentPeriodOf(lease: RentPeriodLease, dateIso: string): string {
  const day = dateIso.slice(0, 10);
  const back = isoOf(new Date(noon(day).getTime() - 400 * 86_400_000));
  const starts = rentPeriodStarts(lease, back, day);
  return starts[starts.length - 1] ?? day;
}

/** `count` periods on from `startIso` (0 = itself). */
export function addRentPeriods(lease: RentPeriodLease, startIso: string, count: number): string {
  if (count <= 0) return startIso;
  const ahead = isoOf(new Date(noon(startIso).getTime() + (count + 2) * (isYearly(lease) ? 400 : 32) * 86_400_000));
  const starts = rentPeriodStarts(lease, startIso, ahead);
  return starts[Math.min(count, starts.length - 1)] ?? startIso;
}

/** The next due date after `dateIso`. */
export function nextRentPeriod(lease: RentPeriodLease, dateIso: string): string | null {
  const day = isoOf(new Date(noon(dateIso).getTime() + 86_400_000));
  const ahead = isoOf(new Date(noon(day).getTime() + 400 * 86_400_000));
  return rentPeriodStarts(lease, day, ahead)[0] ?? null;
}

/**
 * The periods to pick from for a payment: `before` back and `after` on from the
 * period `aroundIso` falls in, kept within the lease (its first period to its
 * end) — and that period itself always, so a saved one outside still shows.
 */
export function rentPeriodChoices(lease: RentPeriodLease, aroundIso: string, before = 12, after = 12): string[] {
  const center = rentPeriodOf(lease, aroundIso);
  const span = isYearly(lease) ? 366 : 31;
  const from = isoOf(new Date(noon(center).getTime() - (before + 1) * span * 86_400_000));
  const to = isoOf(new Date(noon(center).getTime() + (after + 1) * span * 86_400_000));
  const starts = rentPeriodStarts(lease, from, to);
  const at = Math.max(0, starts.indexOf(center));
  const first = firstRentPeriod(lease);
  const end = lease.endDate?.slice(0, 10) ?? null;
  return starts
    .slice(Math.max(0, at - before), at + after + 1)
    .filter((start) => start === center || ((!first || start >= first) && (!end || start <= end)));
}

/** "א׳", "ט״ו", "ל׳" — a Hebrew day of the month. */
export function hebrewDayName(day: number): string {
  return gematriya(day);
}

/** "חשון תשפ״ז" / "נובמבר 2026" / "שנת תשפ״ז"; two or more: "חשון – כסלו תשפ״ז". */
export function rentPeriodLabel(lease: RentPeriodLease, startIso: string, count = 1): string {
  const hebrew = isHebrewLease(lease);
  const label = (iso: string, withYear: boolean) => {
    if (hebrew) {
      const h = new HDate(noon(iso));
      if (isYearly(lease)) return `שנת ${gematriya(h.getFullYear())}`;
      // "א׳ חֶשְׁוָן תשפ״ז" → "חשון" (the day first, the year last; "אדר א׳" is two words).
      const words = h.renderGematriya().replace(NIQQUD, "").split(" ");
      const month = words.slice(1, -1).join(" ");
      return withYear ? `${month} ${words[words.length - 1]}` : month;
    }
    if (isYearly(lease)) return `שנה מ-${noon(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" })}`;
    return new Intl.DateTimeFormat("he-IL", withYear ? { month: "long", year: "numeric" } : { month: "long" }).format(noon(iso));
  };
  if (count <= 1) return label(startIso, true);
  return `${label(startIso, false)} – ${label(addRentPeriods(lease, startIso, count - 1), true)}`;
}

/** A due date in words: "א׳ חשון" for a Hebrew lease, "1.11" for a regular one. */
export function rentDueDateLabel(lease: RentPeriodLease, dueIso: string): string {
  const date = noon(dueIso);
  if (!isHebrewLease(lease)) return `${date.getDate()}.${date.getMonth() + 1}`;
  // "א׳ חֶשְׁוָן תשפ״ז" → "א׳ חשון".
  const words = new HDate(date).renderGematriya().replace(NIQQUD, "").split(" ");
  return words.slice(0, -1).join(" ");
}

/** When it's due, in words: "בכל א׳ לחודש העברי" / "בכל 1 לחודש" / "פעם בשנה". */
export function rentDueLabel(lease: RentPeriodLease): string {
  if (isHebrewLease(lease)) {
    const day = hebrewDayName(Math.round(Number(lease.rentHebrewDay)));
    return isYearly(lease) ? `פעם בשנה, ב-${day} בחודש העברי` : `בכל ${day} לחודש העברי`;
  }
  return isYearly(lease) ? `פעם בשנה, ב-${gregorianDay(lease)} בחודש` : `בכל ${gregorianDay(lease)} לחודש`;
}

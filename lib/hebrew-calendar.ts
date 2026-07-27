import { HDate, HebrewCalendar, gematriya, flags } from "@hebcal/core";

// Jewish-calendar helpers for the events calendar: Hebrew date labels + holidays.
// @hebcal/core is pure JS and runs fine in the browser.

function toIsoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

// @hebcal renders pointed Hebrew (with niqqud + cantillation), e.g. "פָּרָשַׁת עֵקֶב".
// The app shows plain Hebrew everywhere, so strip the niqqud + te'amim (the
// U+0591–U+05C7 combining block); base letters and gereshayim (״) are kept.
const NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;
function stripNikud(text: string): string {
  return text.replace(NIQQUD, "");
}

/** Hebrew day-of-month numeral for a Gregorian date, e.g. "כ״ב". */
export function hebrewDayLabel(date: Date): string {
  return gematriya(new HDate(date).getDate());
}

/** Full Hebrew date for a Gregorian date, e.g. "כ״ב סִיוָן תשפ״ו". */
export function hebrewFullDate(date: Date): string {
  return stripNikud(new HDate(date).renderGematriya());
}

/**
 * Weekly Torah portion read on the Shabbat of the given date's week, e.g.
 * "פָּרָשַׁת דְּבָרִים". Returns null when there's no parsha that week (e.g. a
 * festival Shabbat). Used by the calendar's day-summary hero.
 */
export function hebrewParsha(date: Date): string | null {
  // The parsha belongs to the week's Shabbat — walk forward to Saturday.
  const sat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  sat.setDate(sat.getDate() + (6 - sat.getDay()));
  try {
    const events = HebrewCalendar.calendar({
      start: sat,
      end: sat,
      il: true,
      sedrot: true,
      noHolidays: true,
    });
    for (const ev of events) {
      if ((ev.getFlags() & flags.PARSHA_HASHAVUA) !== 0) return stripNikud(ev.render("he"));
    }
  } catch {
    // @hebcal can throw around year boundaries — treat as "no parsha".
  }
  return null;
}

// Curated list — @hebcal surfaces a LOT of trivia (Jabotinsky Day, Rosh Hashana
// LaBehemot, Family Day…) that just clutters a business calendar. We keep only:
//   • MAJOR  → the festivals (non-work) + Independence Day → highlighted cell.
//   • MINOR  → still worth a text label but a normal work-day cell (no highlight):
//              Rosh Chodesh, Chanukah, Purim, the fasts, Yom HaZikaron/HaShoah…
// Everything else is dropped. Matched by @hebcal's stable English `basename()`.
const MAJOR_HOLIDAYS = new Set<string>([
  "Rosh Hashana",
  "Yom Kippur",
  "Sukkot",
  "Shmini Atzeret",
  "Simchat Torah",
  "Pesach",
  "Shavuot",
  "Yom HaAtzma'ut",
]);
const MINOR_HOLIDAYS = new Set<string>([
  "Chanukah",
  "Purim",
  "Shushan Purim",
  "Tu BiShvat",
  "Lag BaOmer",
  "Tu B'Av",
  "Pesach Sheni",
  "Yom HaZikaron",
  "Yom HaShoah",
  "Yom Yerushalayim",
  "Tzom Gedaliah",
  "Asara B'Tevet",
  "Ta'anit Esther",
  "Tzom Tammuz",
  "Tish'a B'Av",
  "Erev Rosh Hashana",
  "Erev Yom Kippur",
  "Erev Pesach",
]);

export type HolidayInfo = { name: string; major: boolean };

/** Map of `YYYY-MM-DD` (local) → curated holiday info for the given range. */
export function getHolidaysInRange(start: Date, end: Date): Map<string, HolidayInfo> {
  const events = HebrewCalendar.calendar({
    start,
    end,
    il: true,
    sedrot: false,
    candlelighting: false,
    omer: false,
  });

  const byDay = new Map<string, HolidayInfo>();
  for (const ev of events) {
    const base = ev.basename();
    const isChag = (ev.getFlags() & flags.CHAG) !== 0;
    let major: boolean;
    if (isChag || MAJOR_HOLIDAYS.has(base)) major = true;
    else if (base.startsWith("Rosh Chodesh") || MINOR_HOLIDAYS.has(base)) major = false;
    else continue; // drop the trivia
    const iso = toIsoLocal(ev.getDate().greg());
    // First (most significant) event per day wins; a later MAJOR upgrades it.
    const existing = byDay.get(iso);
    if (!existing) byDay.set(iso, { name: stripNikud(ev.render("he")), major });
    else if (major && !existing.major) byDay.set(iso, { name: stripNikud(ev.render("he")), major });
  }
  return byDay;
}

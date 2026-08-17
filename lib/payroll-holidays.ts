import { HebrewCalendar, flags } from "@hebcal/core";

/**
 * Which days the business simply doesn't work — for the global-salary hours sheet.
 *
 * This used to come from `date-holidays`, which knows only the *official* Israeli
 * public holidays: it marks יום כיפור and פסח א׳, but happily prints a full
 * 09:00–18:00 workday on ערב סוכות and on חול המועד, when nobody was in.
 * @hebcal/core (already a dependency, used by the calendar) has the distinctions
 * the sheet needs, and with `il: true` it uses the Israeli one-day-yom-tov schedule.
 *
 * A day counts as non-working when hebcal flags it as any of:
 *   • CHAG        — ראש השנה (both days), יום כיפור, סוכות א׳, שמיני עצרת,
 *                   פסח א׳, פסח ז׳, שבועות
 *   • EREV **of one of those** — ערב ראש השנה / יום כיפור / סוכות / פסח / שבועות
 *   • the LAST day of חול המועד only — הושענא רבה (ערב שמיני עצרת) and פסח ו׳
 *     (ערב שביעי של פסח). The rest of chol hamoed is worked (user, Aug 2026).
 * plus יום העצמאות, which isn't a chag but is a national day off.
 *
 * Anything else — the middle of chol hamoed, פורים, תשעה באב, the minor fasts,
 * יום הזיכרון, ל״ג בעומר, ראש חודש — is a normal working day. If the business is
 * closed on one of those, mark it per worker as a day off (worker_absences); that's
 * the manual override and it shows up on the sheet the same way.
 */

/**
 * The festivals whose EVE is also a day off. The EREV flag on its own is not
 * enough: hebcal also stamps it on ערב פורים, ערב תשעה באב and even on the first
 * night of Chanukah — all ordinary working days here.
 */
const EREV_COUNTS_FOR_BASENAMES = new Set<string>([
  "Rosh Hashana",
  "Yom Kippur",
  "Sukkot",
  "Shmini Atzeret",
  "Simchat Torah",
  "Pesach",
  "Shavuot",
]);

/** Days off that aren't a chag but are still nobody-works days, by hebcal basename. */
const EXTRA_NON_WORKING_BASENAMES = new Set<string>(["Yom HaAtzma'ut"]);

const NIQQUD = /[֑-ׇ]/g;

/**
 * The holiday name in plain Hebrew.
 *
 * `he` renders pointed text in defective spelling ("סֻכּוֹת"), so merely stripping
 * the niqqud leaves "סכות" — right letters, wrong-looking word. hebcal's
 * `he-x-NoNikud` locale gives the full spelling people actually write
 * ("סוכות"); the strip stays as a fallback in case that locale ever goes away.
 */
function holidayName(render: (locale: string) => string) {
  try {
    const unpointed = render("he-x-NoNikud").trim();
    if (unpointed) return unpointed;
  } catch {
    // fall through
  }
  return render("he").replace(NIQQUD, "");
}

function toIsoLocal(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/**
 * `YYYY-MM-DD` (local) → Hebrew holiday name, for every non-working day in the
 * range. Empty map rather than a throw if hebcal chokes on a year boundary — a
 * missing holiday prints an ordinary work row, which is recoverable; a crashed
 * export is not.
 */
export function getNonWorkingHolidaysInRange(start: Date, end: Date): Map<string, string> {
  const byDay = new Map<string, string>();

  // Padded by a fortnight on each side. "Is this the LAST day of chol hamoed?" is
  // answered by looking at the NEXT day, which can fall outside the asked-for
  // range — a month ending on הושענא רבה would otherwise not see שמיני עצרת and
  // would print the day as worked.
  const paddedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 14);
  const paddedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 14);

  let events;
  try {
    events = HebrewCalendar.calendar({
      start: paddedStart,
      end: paddedEnd,
      il: true,
      sedrot: false,
      candlelighting: false,
      omer: false,
    });
  } catch {
    return byDay;
  }

  const chagDays = new Set<string>();
  const candidates: Array<{ iso: string; name: string; isCholHamoed: boolean }> = [];

  for (const event of events) {
    const eventFlags = event.getFlags();
    const basename = event.basename();
    const iso = toIsoLocal(event.getDate().greg());
    const isChag = (eventFlags & flags.CHAG) !== 0;
    if (isChag) chagDays.add(iso);

    const isCholHamoed = (eventFlags & flags.CHOL_HAMOED) !== 0;
    const isNonWorking =
      isChag ||
      isCholHamoed ||
      ((eventFlags & flags.EREV) !== 0 && EREV_COUNTS_FOR_BASENAMES.has(basename)) ||
      EXTRA_NON_WORKING_BASENAMES.has(basename);
    if (!isNonWorking) continue;

    candidates.push({ iso, name: holidayName((locale) => event.render(locale)), isCholHamoed });
  }

  const startIso = toIsoLocal(start);
  const endIso = toIsoLocal(end);

  for (const candidate of candidates) {
    // Chol hamoed is worked, except its final day — the eve of the closing yom
    // tov (הושענא רבה before שמיני עצרת, פסח ו׳ before שביעי של פסח). Derived from
    // "is tomorrow a chag?" rather than hard-coding day numbers, so it holds for
    // both festivals without a table.
    if (candidate.isCholHamoed && !chagDays.has(nextDayIso(candidate.iso))) continue;
    if (candidate.iso < startIso || candidate.iso > endIso) continue;
    // First event of the day wins — hebcal emits the festival before the
    // trivia that shares its date (e.g. תענית בכורות alongside ערב פסח).
    if (!byDay.has(candidate.iso)) byDay.set(candidate.iso, candidate.name);
  }

  return byDay;
}

function nextDayIso(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(year, month - 1, day + 1);
  return toIsoLocal(next);
}

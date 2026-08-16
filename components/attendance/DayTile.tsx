import { formatShortDate } from "@/lib/date";

/**
 * The day of a shift as a little calendar tile — the weekday initial over the
 * day of the month. Shared by every surface that lists shifts (the worker card's
 * SessionList, the attendance approval queue) so one shift looks the same
 * wherever you meet it.
 */

/** "א" … "ש" — the Hebrew weekday initial, in Israel time. */
function weekdayNarrow(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "narrow", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

function dayOfMonth(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : String(d.getDate());
}

/** A shift that ran past midnight ends on a day the tile wouldn't otherwise show. */
export function endsNextDay(clockIn: string, clockOut: string | null | undefined) {
  return Boolean(clockOut) && formatShortDate(clockIn) !== formatShortDate(clockOut);
}

export function DayTile({ clockIn, clockOut }: { clockIn: string; clockOut?: string | null }) {
  const spansDays = endsNextDay(clockIn, clockOut);
  return (
    <span className="flex h-9 min-w-9 shrink-0 flex-col items-center justify-center rounded-lg border border-border/60 bg-muted/40 px-1 leading-none">
      <span className="text-[0.625rem] text-muted-foreground">{weekdayNarrow(clockIn)}</span>
      {/* dir="ltr" on the RANGE: as RTL text, "30–31" laid out right-to-left and
          came out reading 31–30 — the shift backwards. A span of numbers reads
          left-to-right whatever language surrounds it. */}
      <span className="whitespace-nowrap text-sm font-semibold" dir={spansDays ? "ltr" : undefined}>
        {dayOfMonth(clockIn)}
        {spansDays ? `–${dayOfMonth(clockOut)}` : ""}
      </span>
    </span>
  );
}

/**
 * "11:15 עד 01:00" — start first, then end, in Hebrew reading order.
 *
 * Deliberately NOT a dir="ltr" dash range: that pinned the START to the left, so
 * in an RTL row the eye met the end time first and read the shift backwards.
 * Plain RTL text with the word עד puts the start on the right where it belongs;
 * each HH:MM is digits, which the browser lays out left-to-right on its own.
 *
 * A shift still running says "עד עכשיו", never "…" — an ellipsis reads as text
 * the layout cut off rather than as a fact about the shift.
 */
export function shiftHoursText(clockIn: string, clockOut: string | null | undefined) {
  const time = (iso: string) =>
    new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  return `${time(clockIn)} עד ${clockOut ? time(clockOut) : "עכשיו"}`;
}

export default DayTile;

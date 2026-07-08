// Period presets for the financial filters. Everything is computed as ISO date
// strings (YYYY-MM-DD) from a reference "today" so results are timezone-stable
// and match the server's referenceDate (data.todayIso).

export type PeriodPreset = "this_month" | "last_month" | "this_year";

export type DateRange = { from: string; to: string };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Last calendar day of a given year/month (1-based month). */
function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Full-month range for a "YYYY-MM" key. */
export function monthRange(monthKey: string): DateRange | null {
  const [y, m] = monthKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
}

/** Range for a named preset, relative to `todayIso` (YYYY-MM-DD). */
export function presetRange(preset: PeriodPreset, todayIso: string): DateRange {
  const [y, m] = todayIso.split("-").map(Number);
  switch (preset) {
    case "this_month":
      return monthRange(`${y}-${pad(m)}`)!;
    case "last_month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return monthRange(`${ly}-${pad(lm)}`)!;
    }
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** True when [from,to] exactly equals the preset's range for todayIso. */
export function matchesPreset(preset: PeriodPreset, from: string, to: string, todayIso: string) {
  const range = presetRange(preset, todayIso);
  return range.from === from && range.to === to;
}

/** Recent "YYYY-MM" keys, newest first, going back `count` months from todayIso. */
export function recentMonthKeys(todayIso: string, count = 18): string[] {
  let [y, m] = todayIso.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${pad(m)}`);
    if (--m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "החודש",
  last_month: "חודש שעבר",
  this_year: "השנה",
};

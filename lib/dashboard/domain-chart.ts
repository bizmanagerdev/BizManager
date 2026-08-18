// The dashboard's "הכנסות והוצאות לפי תחום" card, month by month.
//
// The card used to be fixed to the current month with "החודש הנוכחי" printed
// under its title. It now carries a month PICKER at the far end of its header
// (user, 2026-08-18) — which is also why that line is gone: the picker already
// names the month, and the two together were the same sentence twice.
//
// Everything here is pure and shared by all three sides: the server component
// that renders the first month, the client card that switches months, and the
// server action that fetches the one it switched to.

/**
 * What the chart draws — one bar pair per business domain, plus the SAME pair
 * from the month before as a ghost behind it. A single month's bars have no
 * scale of their own: ₪35K of expenses means nothing until you can see that last
 * month was ₪12K.
 */
export type DomainBar = {
  name: string;
  inflow: number;
  outflow: number;
  /** The month before — 0 when that domain didn't move money then. */
  prevInflow: number;
  prevOutflow: number;
};

/** A month as "YYYY-MM" — the picker's value and the action's argument. */
export type MonthKey = string;

// Hardcoded rather than Intl: these strings render on the server AND in the
// browser, and any ICU difference between the two would be a hydration mismatch
// inside a <select>. The names don't change.
const HE_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** How far back the picker goes, counting the current month. */
export const MONTH_CHOICES = 24;

export function monthKeyOf(date: Date): MonthKey {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** "אוגוסט 2026" — with the year, since the picker reaches back past January. */
export function monthLabel(key: MonthKey): string {
  const [year, month] = key.split("-");
  const index = Number(month) - 1;
  return HE_MONTHS[index] ? `${HE_MONTHS[index]} ${year}` : key;
}

/** The picker's list: this month first, then backwards. */
export function monthChoices(todayIso: string, count = MONTH_CHOICES): { value: MonthKey; label: string }[] {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  return Array.from({ length: count }, (_, back) => {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value: key, label: monthLabel(key) };
  });
}

/**
 * The window to load for a chosen month. The CURRENT month stops at today —
 * this is a cash chart, so "so far this month" is the honest reading; a past
 * month runs to its last day.
 */
export function monthWindow(key: MonthKey, todayIso: string): { from: string; to: string } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  // Day 0 of the next month = the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = `${key}-01`;
  const to = `${key}-${String(lastDay).padStart(2, "0")}`;
  return { from, to: to > todayIso ? todayIso : to };
}

/** The month before this one — the chart's baseline. */
export function previousMonth(key: MonthKey): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

type CashPoint = { domainName: string; inflow: number; outflow: number };

/**
 * Only domains that actually moved money get a bar — in EITHER month. A domain
 * that ran last month and stopped this one is exactly what a baseline is for, so
 * it keeps its slot and shows as a ghost with nothing in front of it.
 */
export function toBars(points: CashPoint[], previous: CashPoint[] = []): DomainBar[] {
  const prevByName = new Map(previous.map((d) => [d.domainName, d]));
  const names = [...points.map((d) => d.domainName), ...previous.map((d) => d.domainName)];
  const seen = new Set<string>();

  return names
    .filter((name) => (seen.has(name) ? false : (seen.add(name), true)))
    .map((name) => {
      const now = points.find((d) => d.domainName === name);
      const then = prevByName.get(name);
      return {
        name,
        inflow: now?.inflow ?? 0,
        outflow: now?.outflow ?? 0,
        prevInflow: then?.inflow ?? 0,
        prevOutflow: then?.outflow ?? 0,
      };
    })
    .filter((d) => d.inflow > 0 || d.outflow > 0 || d.prevInflow > 0 || d.prevOutflow > 0);
}

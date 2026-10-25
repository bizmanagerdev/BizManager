// Where a lease's rent stands this period — one rule for the property's own
// page (the שכירות החודש card), the properties list (owner's card, note 17:
// "להראות על כל נכס בחוץ אם השכירות של החודש שולם") and the rent alert.
//
// A period is the lease's own (lib/rent-periods.ts): א׳ of each Hebrew month
// for a lease on the Hebrew calendar, its day of the regular month, or once a
// year. A payment covers the period(s) it says (payments.rent_period_start /
// rent_periods — "שולם לחודשיים" covers two); one that doesn't say yet covers
// the period its date falls in. Everything a property takes in counts as rent
// unless it's marked not to be (payments.counts_as_rent — a refund), and a
// payment tied to another lease (a storage spot on the same property) isn't
// this one's. A payment recorded for months ticked one by one (owner,
// 2026-10-22: "I choose what months it will cover") says how much of it went
// to each (payments.rent_allocation); one that doesn't is split evenly over
// its run of periods.

import { israelDateKey } from "@/lib/timezone";
import { addRentPeriods, firstRentPeriod, rentPeriodLabel, rentPeriodOf, type RentPeriodLease } from "@/lib/rent-periods";

/** "2026-11-01T00:00:00+00:00" → "2026-11-01" — payment_date is a timestamp. */
export function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

export type RentMonthState = "paid" | "partial" | "check" | "late" | "upcoming" | "none";

export type RentLease = RentPeriodLease & {
  id?: string | null;
  status: string | null;
  /** The amount per period (a month, or a year for a yearly lease). */
  monthlyRentAmount: number;
};

/** How much of a payment went to one period (that period's due date) — payments.rent_allocation. */
export type RentShare = { period: string; amount: number };

export type RentPayment = {
  date: string | null;
  paymentStatus: string | null;
  amount: number;
  leaseId?: string | null;
  periodStart?: string | null;
  periods?: number | null;
  countsAsRent?: boolean | null;
  /** The months it was recorded for, and how much each — when they were ticked; null: evenly over its run. */
  allocation?: RentShare[] | null;
  /** A check's day (פירעון). Past it and not in, its rent is still owed — we hold the check (owner, 2026-10-25). */
  dueDate?: string | null;
};

export type RentMonthStatus = {
  state: RentMonthState;
  collected: number;
  pending: number;
  /** Of `pending`, the checks whose day has passed and that aren't in: still owed, though we hold them (owner,
   *  2026-10-25: "I want to show that it's debt, and I want to show that we have it" — a check kept back is
   *  usually kept back for a reason, a transfer promised instead). */
  pendingDue?: number;
  rent: number;
  /** The period this is about — its due date — and its name ("חשון", "נובמבר"). */
  periodStart: string | null;
  periodLabel: string | null;
};

const NONE: RentMonthStatus = { state: "none", collected: 0, pending: 0, rent: 0, periodStart: null, periodLabel: null };

/** A payment that doesn't say its period: the one its date falls in — before the lease's first, that first one (paid ahead). */
function fallbackPeriod(lease: RentLease, day: string | null): string | null {
  if (!day) return null;
  const first = firstRentPeriod(lease);
  return first && day < first ? first : rentPeriodOf(lease, day);
}

/** payments.rent_allocation as it's read — a list from the server, its JSON text on the device; anything else: none. */
export function rentAllocationOf(value: unknown): RentShare[] | null {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const shares = list
    .map((s) => ({ period: typeof s?.period === "string" ? s.period.slice(0, 10) : "", amount: Number(s?.amount) }))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.period) && Number.isFinite(s.amount) && s.amount > 0);
  return shares.length > 0 ? shares.sort((a, b) => a.period.localeCompare(b.period)) : null;
}

/** The periods a payment pays for, or null when it isn't this lease's rent. Ticked months: the first, and how many. */
export function rentCoverage(lease: RentLease, payment: RentPayment): { start: string; periods: number } | null {
  if (payment.countsAsRent === false) return null;
  if (payment.leaseId && lease.id && payment.leaseId !== lease.id) return null;
  const shares = payment.allocation?.length ? payment.allocation : null;
  if (shares) return { start: shares.reduce((min, s) => (s.period < min ? s.period : min), shares[0].period), periods: shares.length };
  const start = payment.periodStart ?? fallbackPeriod(lease, dayKey(payment.date));
  if (!start) return null;
  return { start, periods: Math.max(1, Math.round(payment.periods ?? 1)) };
}

/** The last period a payment pays for — the latest month ticked, or the end of its run. */
export function rentLastPeriod(lease: RentLease, payment: RentPayment): string | null {
  const cover = rentCoverage(lease, payment);
  if (!cover) return null;
  if (payment.allocation?.length) return payment.allocation.reduce((max, s) => (s.period > max ? s.period : max), cover.start);
  return cover.periods > 1 ? addRentPeriods(lease, cover.start, cover.periods - 1) : cover.start;
}

/** Whether a payment pays for `period`, and how much of it: what was put on that month, or its even share (a 2-period payment: half each). */
export function paidTowards(lease: RentLease, payment: RentPayment, period: string): number {
  const cover = rentCoverage(lease, payment);
  if (!cover) return 0;
  if (payment.allocation?.length) return payment.allocation.reduce((sum, s) => (s.period === period ? sum + s.amount : sum), 0);
  const last = cover.periods > 1 ? addRentPeriods(lease, cover.start, cover.periods - 1) : cover.start;
  return period >= cover.start && period <= last ? payment.amount / cover.periods : 0;
}

/**
 * Money into months, oldest first (owner, 2026-10-22): each month gets what it still needs, the next one what's
 * left — so ₪10,000 for three months of ₪4,000 is ₪4,000, ₪4,000 and ₪2,000, and a month part-paid only gets
 * what it's missing. Several payments fill them in turn, each its own shares. What's left once every month is
 * full: `extra`; what the months still lack: `short`.
 */
export function allocateRent(
  amounts: number[],
  months: Array<{ period: string; need: number }>
): { shares: RentShare[][]; short: number; extra: number } {
  const ordered = [...months].sort((a, b) => a.period.localeCompare(b.period));
  const cents = (n: number) => Math.round(n * 100) / 100;
  let m = 0;
  let need = Math.max(0, ordered[0]?.need ?? 0);
  let extra = 0;
  const shares = amounts.map((amount) => {
    const mine: RentShare[] = [];
    let left = cents(amount);
    while (left > 0.004 && m < ordered.length) {
      const take = cents(Math.min(left, need));
      if (take > 0) mine.push({ period: ordered[m].period, amount: take });
      left = cents(left - take);
      need = cents(need - take);
      if (need <= 0.004) {
        m += 1;
        need = Math.max(0, ordered[m]?.need ?? 0);
      }
    }
    extra = cents(extra + left);
    return mine;
  });
  const short = cents((m < ordered.length ? need : 0) + ordered.slice(m + 1).reduce((sum, o) => sum + Math.max(0, o.need), 0));
  return { shares, short, extra };
}

export function rentThisPeriod(
  lease: RentLease | null,
  payments: RentPayment[],
  today: string = israelDateKey()
): RentMonthStatus {
  if (!lease || lease.status !== "active") return NONE;
  const first = firstRentPeriod(lease);
  return rentPeriodStatus(lease, payments, first && today < first ? first : rentPeriodOf(lease, today), today);
}

/** Where a lease's rent stands for one period (its due date) — this one, or any other (the rent roll's months). */
export function rentPeriodStatus(
  lease: RentLease,
  payments: RentPayment[],
  period: string,
  today: string = israelDateKey()
): RentMonthStatus {
  let collected = 0;
  let pending = 0;
  let pendingDue = 0;
  for (const payment of payments) {
    if (payment.paymentStatus === "rejected") continue;
    const part = paidTowards(lease, payment, period);
    if (part <= 0) continue;
    if (payment.paymentStatus === "pending") {
      pending += part;
      const day = dayKey(payment.dueDate ?? payment.date);
      if (day && day < today) pendingDue += part;
    } else collected += part;
  }
  const rent = lease.monthlyRentAmount;
  const state: RentMonthState =
    rent > 0 && collected >= rent - 0.5
      ? "paid"
      : collected > 0
        ? "partial"
        : pending > 0
          ? "check"
          : today > period
            ? "late"
            : "upcoming";
  // Just the month's name for the chip ("חשון", "נובמבר"); the year shows only for a yearly lease.
  const label = Number(lease.periodMonths) === 12 ? rentPeriodLabel(lease, period) : rentPeriodLabel(lease, period).replace(/ (תש\S*|\d{4})$/, "");
  return { state, collected, pending, pendingDue, rent, periodStart: period, periodLabel: label };
}

/** The lease a payment is rent for: the one it names, else the one running on its date, else the current one. */
export function leaseForPayment<L extends RentLease & { id: string }>(
  leases: L[],
  payment: RentPayment,
  current: L | null = null
): L | null {
  if (payment.countsAsRent === false) return null;
  if (payment.leaseId) return leases.find((l) => l.id === payment.leaseId) ?? null;
  const day = payment.periodStart ?? dayKey(payment.date);
  const running = day
    ? leases.find((l) => (!l.startDate || l.startDate.slice(0, 10) <= day) && (!l.endDate || l.endDate.slice(0, 10) >= day))
    : null;
  return running ?? current;
}

/** "חשון תשפ״ז", "יוני – יולי 2026", "אלול, חשון – כסלו תשפ״ז": the period(s) a rent payment pays for. */
export function paymentPeriodLabel(lease: RentLease | null, payment: RentPayment): string | null {
  if (!lease) return null;
  const cover = rentCoverage(lease, payment);
  if (!cover) return null;
  if (!payment.allocation?.length) return rentPeriodLabel(lease, cover.start, cover.periods);
  return rentPeriodsLabel(lease, payment.allocation.map((s) => s.period));
}

/** Months ticked one by one, in words: runs of months together ("חשון – כסלו"), the rest by name, the year once at the end. */
export function rentPeriodsLabel(lease: RentLease, periods: string[]): string {
  const sorted = [...new Set(periods)].sort();
  if (sorted.length === 0) return "";
  const runs: Array<{ start: string; count: number }> = [];
  for (const period of sorted) {
    const run = runs[runs.length - 1];
    if (run && addRentPeriods(lease, run.start, run.count) === period) run.count += 1;
    else runs.push({ start: period, count: 1 });
  }
  if (runs.length === 1) return rentPeriodLabel(lease, runs[0].start, runs[0].count);
  const noYear = (label: string) => label.replace(/ (תש\S*|\d{4})$/, "");
  return runs
    .map((run, i) => (i === runs.length - 1 ? rentPeriodLabel(lease, run.start, run.count) : noYear(rentPeriodLabel(lease, run.start, run.count))))
    .join(", ");
}

/** The first period after the last one this lease's payments cover — where a new schedule starts. */
export function nextUncoveredPeriod(lease: RentLease, payments: RentPayment[], today: string = israelDateKey()): string {
  let last: string | null = null;
  for (const payment of payments) {
    if (payment.paymentStatus === "rejected") continue;
    const end = rentLastPeriod(lease, payment);
    if (!end) continue;
    if (!last || end > last) last = end;
  }
  if (last) return addRentPeriods(lease, last, 1);
  const first = firstRentPeriod(lease);
  return first && today < first ? first : rentPeriodOf(lease, today);
}

/** The leases running on `today`: active, and not ended. */
export function runningLeases<L extends { status: string | null; endDate?: string | null }>(leases: L[], today: string): L[] {
  return leases.filter((l) => l.status === "active" && (!l.endDate || l.endDate.slice(0, 10) >= today));
}

/**
 * A property with renters (the ניהול נכסים card: "storage: one big property
 * with a list of renters"): a storage property always, any other once two
 * leases run at once.
 */
export function hasRenters(propertyType: string | null, runningCount: number): boolean {
  return propertyType === "storage" || runningCount > 1;
}

/** A renter's rent: the payments that say they're for its lease — one that doesn't, only when it's the only renter. */
export function renterPayments<P extends { leaseId?: string | null; countsAsRent?: boolean | null }>(
  leaseId: string,
  payments: P[],
  onlyRenter: boolean
): P[] {
  return payments.filter((p) => p.countsAsRent !== false && (p.leaseId === leaseId || (!p.leaseId && onlyRenter)));
}

/** Its words, and how each reads: as the card's big value, and as a chip on the list. */
export const RENT_STATE: Record<
  RentMonthState,
  { label: string; className: string; badge: "success" | "warning" | "info" | "destructive" | "neutral" | "outline" }
> = {
  paid: { label: "שולם", className: "text-success", badge: "success" },
  partial: { label: "שולם חלקית", className: "text-warning-strong", badge: "warning" },
  check: { label: "צ׳ק ממתין לפירעון", className: "text-secondary", badge: "info" },
  late: { label: "לא שולם", className: "text-destructive", badge: "destructive" },
  upcoming: { label: "טרם שולם", className: "text-foreground", badge: "outline" },
  none: { label: "אין שוכר", className: "text-muted-foreground", badge: "neutral" },
};

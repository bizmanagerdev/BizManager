// The rent roll (owner, 2026-10-21: "a rent roll page with all the apartments
// and the rent due date, where you can mark who paid, instead of going into
// each apartment"): every lease's rent for one month, on one page.
//
// "A month" is each lease's own (lib/rent-periods.ts): this month is the
// period each lease is in today — חשון for a lease paid on א׳ of the Hebrew
// month, October for one paid on the 1st — and a step back or on moves every
// lease by one of its own periods, so no Hebrew month is skipped or shown
// twice however the two calendars fall. A yearly lease shows in the month its
// year is due. A payment is one lease's rent: the one it names, else the one
// running on its date (leaseForPayment) — a storage spot's rent never counts
// for the apartment beside it. Pure; the page and the device copy read the
// data (lib/properties.ts loadRentRoll).
//
// Beside the month, what a rent roll carries (owner, same day, after looking
// at what such a system needs): what earlier months still owe — its own
// figure, by how old, never mixed into the month's state — the post-dated
// checks still in hand and the last month they reach, the checks that came
// back, the properties with no tenant, and a year at a glance.

import { israelDateKey } from "@/lib/timezone";
import { pickCurrentLease, type LeaseAgreement, type RentRollData, type RentRollPayment, type RentRollProperty } from "@/lib/properties";
import { leaseForPayment, paidTowards, rentCoverage, rentPeriodStatus, type RentMonthStatus, type RentPayment } from "@/lib/property-rent";
import {
  addRentPeriods,
  firstRentPeriod,
  rentDueDateLabel,
  rentPeriodLabel,
  rentPeriodOf,
  rentPeriodStarts,
  shiftRentPeriod,
} from "@/lib/rent-periods";

/** What months before this one still owe, by how long past their due day. */
export type RentDebt = {
  /** Every month past its due day (within the 36 looked at): its rent, and what's in toward it. */
  due: number;
  paid: number;
  amount: number;
  /** Of `amount`, what checks we hold cover — their day has passed and they aren't in (owner, 2026-10-25). */
  withCheck: number;
  periods: number;
  upTo30: number;
  upTo60: number;
  over60: number;
  /** The oldest month still owing (its due date) — where a payment for it starts. */
  oldest: string | null;
  /** Each month still owing, oldest first: what's owed, and of it what a check we hold covers — the ledger's rows. */
  months: Array<{ period: string; owed: number; withCheck: number }>;
};

export type RentRollRow = {
  /** The lease's id — one row per lease. */
  key: string;
  property: RentRollProperty;
  lease: LeaseAgreement;
  /** Its period this month: the due date, its name ("חשון תשפ״ז") and the day in words ("א׳ חשון", "1.10"). */
  period: string;
  periodLabel: string;
  dueLabel: string;
  status: RentMonthStatus;
  /** Still to come in: the rent, less what's in and the checks for it not due yet — one past its day and not in
   *  is owed too (owner, 2026-10-25), though we hold it (`checkHeld`). */
  owed: number;
  /** Of `owed`, what a check we hold covers — its day has passed and it isn't in. */
  checkHeld: number;
  /** Of what's in, what came by check (cleared). */
  collectedByCheck: number;
  /** What pays it — the rent in, the checks waiting — oldest first. */
  payments: RentRollPayment[];
  /** Its checks that came back (bounced) — they pay nothing. */
  returned: RentRollPayment[];
  /** Its checks torn up — the month paid another way (owner, 2026-10-22); kept, paying nothing, and they can come back. */
  torn: RentRollPayment[];
  /** The months before this one still owing — past their due day, not paid or only in part. */
  debt: RentDebt;
  /** The lease's post-dated checks still in hand (not cleared), and the last month they reach. */
  checksInHand: { count: number; amount: number; lastPeriod: string | null; lastLabel: string | null };
  /** A lease that has ended, here for what its months still owe (owner, 2026-10-25: "stays as debt until paid")
   *  — no rent this month; `period` is its last month. */
  ended: boolean;
};

export type RentRollTotals = {
  /** The month's rent, every lease's. */
  expected: number;
  /** In the account (a check once cleared). */
  collected: number;
  /** Of that, by check (owner, 2026-10-21: "why does checks say 0" — the month's were all cleared). */
  collectedByCheck: number;
  /** Checks for it not cleared yet. */
  checks: number;
  /** Neither in nor waiting as a check. */
  owed: number;
  /** What the months before still owe. */
  debt: number;
  /** Every post-dated check still in hand, of the month's leases. */
  checksInHand: { count: number; amount: number };
};

export type RentRollMonth = {
  /** Periods from this one (0); -1 the month before. */
  offset: number;
  /** The month's names across its leases: "אוקטובר 2026 · חשון תשפ״ז". */
  label: string;
  rows: RentRollRow[];
  /** Active properties with no lease that month — "אין שוכר". */
  vacant: RentRollProperty[];
  totals: RentRollTotals;
};

/** How far back a row looks for months still owing. */
const DEBT_PERIODS = 36;

export function toRollRent(payment: RentRollPayment): RentPayment {
  return {
    date: payment.date,
    paymentStatus: payment.paymentStatus,
    amount: payment.amount,
    leaseId: payment.leaseId,
    periodStart: payment.rentPeriodStart,
    periods: payment.rentPeriods,
    countsAsRent: payment.countsAsRent,
    allocation: payment.rentAllocation,
    dueDate: payment.dueDate,
  };
}

/** A month's rent still owed: the rent, less what's in and the checks for it not due yet — a check we hold past
 *  its day and not in doesn't cover it (owner, 2026-10-25). The rent alert asks it too. */
export function rentLeftOf(status: RentMonthStatus): number {
  return Math.max(0, status.rent - status.collected - (status.pending - (status.pendingDue ?? 0)));
}

function isYearly(lease: LeaseAgreement): boolean {
  return lease.periodMonths === 12;
}

/** A lease that has (or had) a tenant paying: active, or ended on a known day. A cancelled one never ran. */
function counts(lease: LeaseAgreement): boolean {
  return lease.status === "active" || (lease.status === "ended" && Boolean(lease.endDate));
}

function within(lease: LeaseAgreement, period: string): boolean {
  const first = firstRentPeriod(lease);
  return Boolean(first) && period >= (first as string) && (!lease.endDate || period <= lease.endDate.slice(0, 10));
}

function noon(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

function dayBefore(iso: string): string {
  const date = noon(iso);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Whole days from `fromIso` to `toIso`. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((noon(toIso).getTime() - noon(fromIso).getTime()) / 86_400_000);
}

/** The first of the regular month `offset` months from today's. */
function gregorianMonthStart(today: string, offset: number): string {
  const [y, m] = today.split("-").map(Number);
  const date = new Date(y, m - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Each lease's rent payments — a check that came back too (it pays nothing, but shows). */
export function rentPaymentsByLease(data: Pick<RentRollData, "leases" | "payments">): Map<string, RentRollPayment[]> {
  const leasesByProperty = new Map<string, LeaseAgreement[]>();
  for (const lease of data.leases) {
    const list = leasesByProperty.get(lease.propertyId) ?? [];
    list.push(lease);
    leasesByProperty.set(lease.propertyId, list);
  }
  const currentByProperty = new Map([...leasesByProperty].map(([id, leases]) => [id, pickCurrentLease(leases)]));
  const out = new Map<string, RentRollPayment[]>();
  for (const payment of data.payments) {
    const leases = leasesByProperty.get(payment.propertyId) ?? [];
    const lease = leaseForPayment(leases, toRollRent(payment), currentByProperty.get(payment.propertyId) ?? null);
    if (!lease) continue;
    const list = out.get(lease.id) ?? [];
    list.push(payment);
    out.set(lease.id, list);
  }
  return out;
}

/**
 * What a lease's months still owe — past their due day, neither in nor a check for them not due yet — by how old;
 * a check we hold past its day and not in is owed, and said (`withCheck`: owner, 2026-10-25).
 * Up to today, or only the months before `before` (a row's own month apart); a lease that has ended, up to its
 * last month (owner, 2026-10-25: "stays as debt until paid"). The one rule for "rent owed": the rent page, a
 * tenant's page, collections and the rest ask it.
 */
export function rentDebtOf(lease: LeaseAgreement, rents: RentPayment[], today: string, before?: string): RentDebt {
  const debt: RentDebt = { due: 0, paid: 0, amount: 0, withCheck: 0, periods: 0, upTo30: 0, upTo60: 0, over60: 0, oldest: null, months: [] };
  const first = firstRentPeriod(lease);
  if (!first || (before && first >= before)) return debt;
  const end = lease.endDate?.slice(0, 10) ?? null;
  const upTo = [before ? dayBefore(before) : today, end].filter((d): d is string => Boolean(d)).sort()[0];
  for (const start of rentPeriodStarts(lease, first, upTo).slice(-DEBT_PERIODS)) {
    // Not due yet (a month ahead of today): nothing owed for it.
    if (start >= today) continue;
    const status = rentPeriodStatus(lease, rents, start, today);
    debt.due += status.rent;
    debt.paid += Math.min(status.collected, status.rent);
    const left = rentLeftOf(status);
    if (left <= 0.5) continue;
    const held = Math.min(left, status.pendingDue ?? 0);
    debt.amount += left;
    debt.withCheck += held;
    debt.months.push({ period: start, owed: left, withCheck: held });
    debt.periods += 1;
    debt.oldest ??= start;
    const days = daysBetween(start, today);
    if (days <= 30) debt.upTo30 += left;
    else if (days <= 60) debt.upTo60 += left;
    else debt.over60 += left;
  }
  return debt;
}

/** A lease's post-dated checks still in hand (not cleared), and the last month they reach. */
function checksInHandOf(lease: LeaseAgreement, payments: RentRollPayment[]): RentRollRow["checksInHand"] {
  const inHand = payments.filter((p) => p.method === "check" && p.paymentStatus === "pending");
  let lastPeriod: string | null = null;
  for (const check of inHand) {
    const cover = rentCoverage(lease, toRollRent(check));
    if (!cover) continue;
    const end = cover.periods > 1 ? addRentPeriods(lease, cover.start, cover.periods - 1) : cover.start;
    if (!lastPeriod || end > lastPeriod) lastPeriod = end;
  }
  return {
    count: inHand.length,
    amount: inHand.reduce((sum, p) => sum + p.amount, 0),
    lastPeriod,
    lastLabel: lastPeriod ? rentPeriodLabel(lease, lastPeriod) : null,
  };
}

/**
 * Each lease's rent in the month it falls due, up to `upTo` — earned whether paid or not (the books' "הרווחתי";
 * owner, 2026-10-13: rent counted in its month even if unpaid). From its first month to its end; a cancelled one
 * never ran.
 */
export function rentDueMonths(
  data: Pick<RentRollData, "leases">,
  upTo: string
): Array<{ leaseId: string; propertyId: string; period: string; amount: number }> {
  const out: Array<{ leaseId: string; propertyId: string; period: string; amount: number }> = [];
  for (const lease of data.leases.filter(counts)) {
    const first = firstRentPeriod(lease);
    if (!first || !(lease.monthlyRentAmount > 0)) continue;
    const end = lease.endDate?.slice(0, 10) ?? null;
    const last = end && end < upTo ? end : upTo;
    if (first > last) continue;
    for (const period of rentPeriodStarts(lease, first, last)) {
      out.push({ leaseId: lease.id, propertyId: lease.propertyId, period, amount: lease.monthlyRentAmount });
    }
  }
  return out;
}

/** What each lease still owes today (rentDebtOf) — a cancelled one never ran. A tenant's page asks it of theirs. */
export function rentDebtByLease(
  data: Pick<RentRollData, "leases" | "payments">,
  today: string = israelDateKey()
): Map<string, RentDebt> {
  const byLease = rentPaymentsByLease(data);
  return new Map(
    data.leases.filter(counts).map((lease) => [lease.id, rentDebtOf(lease, (byLease.get(lease.id) ?? []).map(toRollRent), today)])
  );
}

function rowFor(
  property: RentRollProperty,
  lease: LeaseAgreement,
  period: string,
  payments: RentRollPayment[],
  today: string
): RentRollRow {
  const rents = payments.map(toRollRent);
  const status = rentPeriodStatus(lease, rents, period, today);
  const byDate = (a: RentRollPayment, b: RentRollPayment) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id);
  const forPeriod = payments.filter((p) => paidTowards(lease, toRollRent(p), period) > 0).sort(byDate);
  const paying = forPeriod.filter((p) => p.paymentStatus !== "rejected");

  return {
    key: lease.id,
    property,
    lease,
    period,
    periodLabel: rentPeriodLabel(lease, period),
    dueLabel: rentDueDateLabel(lease, period),
    status,
    owed: rentLeftOf(status),
    checkHeld: Math.min(rentLeftOf(status), status.pendingDue ?? 0),
    collectedByCheck: paying
      .filter((p) => p.method === "check" && p.paymentStatus !== "pending")
      .reduce((sum, p) => sum + paidTowards(lease, toRollRent(p), period), 0),
    payments: paying,
    returned: forPeriod.filter((p) => p.paymentStatus === "rejected" && !p.tornAt),
    torn: forPeriod.filter((p) => p.paymentStatus === "rejected" && Boolean(p.tornAt)),
    debt: rentDebtOf(lease, rents, today, period),
    checksInHand: checksInHandOf(lease, payments),
    ended: false,
  };
}

/** A lease that has ended and still owes: a row for its debt alone — no rent this month (null: owes nothing). */
function endedRowFor(
  property: RentRollProperty,
  lease: LeaseAgreement,
  payments: RentRollPayment[],
  today: string
): RentRollRow | null {
  const end = lease.endDate?.slice(0, 10);
  if (!end) return null;
  const debt = rentDebtOf(lease, payments.map(toRollRent), today);
  if (debt.amount <= 0.5) return null;
  const last = rentPeriodOf(lease, end);
  return {
    key: lease.id,
    property,
    lease,
    period: last,
    periodLabel: rentPeriodLabel(lease, last),
    dueLabel: rentDueDateLabel(lease, last),
    status: { state: "none", collected: 0, pending: 0, rent: 0, periodStart: last, periodLabel: rentPeriodLabel(lease, last) },
    owed: 0,
    checkHeld: 0,
    collectedByCheck: 0,
    payments: [],
    returned: [],
    torn: [],
    debt,
    checksInHand: checksInHandOf(lease, payments),
    ended: true,
  };
}

function compareRows(order: Map<string, number>) {
  return (a: Pick<RentRollRow, "key" | "property" | "lease">, b: Pick<RentRollRow, "key" | "property" | "lease">) =>
    (order.get(a.property.id) ?? 0) - (order.get(b.property.id) ?? 0) ||
    (a.lease.unitLabel ?? "").localeCompare(b.lease.unitLabel ?? "", "he") ||
    (a.lease.customerName ?? "").localeCompare(b.lease.customerName ?? "", "he") ||
    a.key.localeCompare(b.key);
}

/** The rent roll for the month `offset` periods from this one. */
export function rentRollMonth(data: RentRollData, offset: number, today: string = israelDateKey()): RentRollMonth {
  const propertyById = new Map(data.properties.map((p) => [p.id, p]));
  const order = new Map(data.properties.map((p, i) => [p.id, i]));
  const leases = data.leases.filter((l) => counts(l) && propertyById.get(l.propertyId)?.isActive !== false && propertyById.has(l.propertyId));
  const paymentsByLease = rentPaymentsByLease(data);

  // Each monthly lease's period this month, and the month's span — from the
  // earliest of them to the earliest of the next month's — for the yearly ones.
  const monthly = leases.filter((l) => !isYearly(l));
  const periodAt = (lease: LeaseAgreement, n: number) => shiftRentPeriod(lease, rentPeriodOf(lease, today), n);
  const spanStart = (n: number) =>
    monthly.length > 0 ? monthly.map((l) => periodAt(l, n)).sort()[0] : gregorianMonthStart(today, n);
  const from = spanStart(offset);
  const to = dayBefore(spanStart(offset + 1));

  const rows: RentRollRow[] = [];
  for (const lease of leases) {
    const property = propertyById.get(lease.propertyId) as RentRollProperty;
    const period = isYearly(lease) ? rentPeriodStarts(lease, from, to)[0] : periodAt(lease, offset);
    const payments = paymentsByLease.get(lease.id) ?? [];
    if (period && within(lease, period)) {
      rows.push(rowFor(property, lease, period, payments, today));
      continue;
    }
    // Ended, and still owing: here, for its debt, from this month on — the months before show it as they were.
    const endDay = lease.endDate?.slice(0, 10);
    if (offset >= 0 && endDay && endDay < (period ?? from)) {
      const ended = endedRowFor(property, lease, payments, today);
      if (ended) rows.push(ended);
    }
  }
  rows.sort(compareRows(order));

  // Its names, earliest due first.
  const labels: string[] = [];
  for (const row of [...rows].sort((a, b) => a.period.localeCompare(b.period) || a.key.localeCompare(b.key))) {
    if (!labels.includes(row.periodLabel)) labels.push(row.periodLabel);
  }
  const label =
    labels.length > 0
      ? labels.join(" · ")
      : new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(noon(from));

  const rented = new Set(rows.filter((r) => !r.ended).map((r) => r.property.id));
  // One whose rent a management company collects is never empty for us (owner, 2026-10-23).
  const vacant = data.properties.filter((p) => p.isActive && !p.rentManagedByCompany && !rented.has(p.id));

  const totals: RentRollTotals = {
    expected: 0,
    collected: 0,
    collectedByCheck: 0,
    checks: 0,
    owed: 0,
    debt: 0,
    checksInHand: { count: 0, amount: 0 },
  };
  for (const row of rows) {
    totals.expected += row.status.rent;
    totals.collected += row.status.collected;
    totals.collectedByCheck += row.collectedByCheck;
    totals.checks += row.status.pending;
    totals.owed += row.owed;
    totals.debt += row.debt.amount;
    totals.checksInHand.count += row.checksInHand.count;
    totals.checksInHand.amount += row.checksInHand.amount;
  }
  return { offset, label, rows, vacant, totals };
}

export type RentRollYear = {
  /** The months shown: five before the month in view, it, and six after. */
  offsets: number[];
  /** Each month's short names across its leases ("חשון / אוקטובר"). */
  headers: string[];
  /** Each month's share collected of its rent past due (null: none due yet) — the grid's last line. */
  rates: (number | null)[];
  rows: { key: string; property: RentRollProperty; lease: LeaseAgreement; cells: (RentRollRow | null)[] }[];
};

/** A year at a glance: each lease a row, each of twelve months a cell (null: not its month). */
export function rentRollYear(data: RentRollData, offset: number, today: string = israelDateKey()): RentRollYear {
  const offsets = Array.from({ length: 12 }, (_, i) => offset - 5 + i);
  const months = offsets.map((n) => rentRollMonth(data, n, today));
  const headers = months.map((month) => {
    const names: string[] = [];
    for (const row of [...month.rows].sort((a, b) => a.period.localeCompare(b.period) || a.key.localeCompare(b.key))) {
      const name = row.status.periodLabel ?? row.periodLabel;
      if (!names.includes(name)) names.push(name);
    }
    return names.length > 0 ? names.join(" / ") : month.label;
  });
  const order = new Map(data.properties.map((p, i) => [p.id, i]));
  const byKey = new Map<string, { key: string; property: RentRollProperty; lease: LeaseAgreement }>();
  // A lease's months — an ended one here for its debt isn't a month of it.
  for (const month of months) for (const row of month.rows) if (!row.ended && !byKey.has(row.key)) byKey.set(row.key, row);
  const rows = [...byKey.values()].sort(compareRows(order)).map((row) => ({
    key: row.key,
    property: row.property,
    lease: row.lease,
    cells: months.map((month) => month.rows.find((r) => r.key === row.key && !r.ended) ?? null),
  }));
  return { offsets, headers, rates: months.map((month) => collectionRate(month, today)), rows };
}

/** The month where a lease's `period` shows — the rent alert's link lands on it; 0 when it's not within two years. */
export function rentRollOffsetFor(data: RentRollData, leaseId: string, period: string, today: string = israelDateKey()): number {
  for (let distance = 0; distance <= 24; distance++) {
    for (const offset of distance === 0 ? [0] : [distance, -distance]) {
      if (rentRollMonth(data, offset, today).rows.some((r) => r.key === leaseId && r.period === period)) return offset;
    }
  }
  return 0;
}

/** Still owing: this month not paid (or in part), or months before still owing — a check waiting counts as in hand. */
export function rentRowOwes(row: RentRollRow): boolean {
  return row.owed > 0.5 || row.debt.amount > 0.5;
}

// ── The page's "today" (owner, 2026-10-21, after looking at how property
// software does it: "it doesn't tell you what to do") ─────────────────────
//
// What needs doing first — a check that came back, rent late, checks to
// deposit, old debt, checks running out, a lease ending, a property with no
// tenant — then four plain figures, then each lease, the most urgent first.

export type RentToDo =
  | { kind: "bounced"; row: RentRollRow; check: RentRollPayment }
  | { kind: "late"; row: RentRollRow; days: number }
  | { kind: "deposit"; due: RentRollPayment[]; week: RentRollPayment[] }
  | { kind: "debt"; row: RentRollRow }
  | { kind: "checksLow"; row: RentRollRow }
  | { kind: "leaseEnd"; row: RentRollRow; days: number }
  | { kind: "vacant"; properties: RentRollProperty[] };

export type RentRollToday = {
  month: RentRollMonth;
  /** The month's rows, the most urgent first. */
  rows: RentRollRow[];
  todo: RentToDo[];
  tiles: {
    /** What's in of the month's rent, and how many have paid it. */
    collected: { amount: number; expected: number; paid: number; tenants: number; waitingChecks: number };
    /** Everything owed past its day — this month's and before — by age. */
    late: { amount: number; tenants: number; upTo30: number; upTo60: number; over60: number };
    /** Checks whose day has come (or comes within the week), not deposited yet. */
    deposit: { count: number; amount: number; overdue: number; next: string | null };
    /** Every rent check in hand, and the lease whose checks run out first. */
    inHand: { count: number; amount: number; firstOut: { row: RentRollRow; label: string } | null };
  };
};

/** A lease ending this soon shows on the list (owner's option notice: 90 days, Fair Rental Law). */
export const LEASE_END_NOTICE_DAYS = 90;
const WEEK_DAYS = 7;

function addDays(iso: string, days: number): string {
  const date = noon(iso);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** This month's part of a row still owed past its due day (0 when not due yet). */
export function lateThisMonth(row: RentRollRow, today: string): number {
  return today > row.period ? row.owed : 0;
}

/** How urgent a row is — the list's order: a check back, late, part paid, old debt, a check waiting, not due, paid. */
export function rentRowUrgency(row: RentRollRow, today: string): number {
  if (row.returned.length > 0 && row.owed > 0.5) return 0;
  if (lateThisMonth(row, today) > 0.5 && row.status.collected <= 0.5) return 1;
  if (lateThisMonth(row, today) > 0.5) return 2;
  if (row.debt.amount > 0.5) return 3;
  if (row.status.state === "check") return 4;
  if (row.owed > 0.5) return 5;
  return 6;
}

/** The checks of a lease that pays by check run out within two periods (or there are none) while the lease goes on. */
function checksRunningLow(row: RentRollRow, usesChecks: boolean): boolean {
  if (!usesChecks) return false;
  const lastLeasePeriod = row.lease.endDate ? rentPeriodOf(row.lease, row.lease.endDate.slice(0, 10)) : null;
  const last = row.checksInHand.lastPeriod;
  if (last && lastLeasePeriod && last >= lastLeasePeriod) return false;
  const horizon = shiftRentPeriod(row.lease, row.period, 2);
  if (lastLeasePeriod && lastLeasePeriod <= row.period) return false;
  return !last || last < horizon;
}

/**
 * The page for a month — `offset` periods from this one (owner, same day: "I
 * want to be able to change to see the rent table for a different month").
 * What to do and the checks figures are about now whatever the month shown;
 * the page takes them from offset 0.
 */
export function rentRollToday(data: RentRollData, today: string = israelDateKey(), offset = 0): RentRollToday {
  const month = rentRollMonth(data, offset, today);
  const order = new Map(data.properties.map((p, i) => [p.id, i]));
  const rows = [...month.rows].sort((a, b) => rentRowUrgency(a, today) - rentRowUrgency(b, today) || compareRows(order)(a, b));
  const byLease = rentPaymentsByLease(data);

  // Rent checks not deposited yet: those whose day has come, and the week's.
  const weekEnd = addDays(today, WEEK_DAYS);
  const pendingChecks = data.payments
    .filter((p) => p.method === "check" && p.paymentStatus === "pending")
    .map((p) => ({ p, day: (p.dueDate ?? p.date ?? "").slice(0, 10) }))
    .filter((x) => x.day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.p.id.localeCompare(b.p.id));
  const due = pendingChecks.filter((x) => x.day <= today).map((x) => x.p);
  const week = pendingChecks.filter((x) => x.day > today && x.day <= weekEnd).map((x) => x.p);
  const next = pendingChecks.find((x) => x.day > weekEnd)?.day ?? null;

  const todo: RentToDo[] = [];
  for (const row of rows) {
    const back = row.returned[0];
    if (back && row.owed > 0.5) todo.push({ kind: "bounced", row, check: back });
    else if (lateThisMonth(row, today) > 0.5) todo.push({ kind: "late", row, days: daysBetween(row.period, today) });
  }
  if (due.length > 0 || week.length > 0) todo.push({ kind: "deposit", due, week });
  for (const row of rows) if (row.debt.amount > 0.5) todo.push({ kind: "debt", row });
  for (const row of rows) {
    const usesChecks = (byLease.get(row.lease.id) ?? []).some((p) => p.method === "check");
    if (checksRunningLow(row, usesChecks)) todo.push({ kind: "checksLow", row });
  }
  for (const row of rows) {
    const end = row.lease.endDate?.slice(0, 10);
    if (!end || end < today) continue;
    const days = daysBetween(today, end);
    if (days <= LEASE_END_NOTICE_DAYS) todo.push({ kind: "leaseEnd", row, days });
  }
  if (month.vacant.length > 0) todo.push({ kind: "vacant", properties: month.vacant });

  const late = { amount: 0, tenants: 0, upTo30: 0, upTo60: 0, over60: 0 };
  for (const row of rows) {
    const now = lateThisMonth(row, today);
    if (now <= 0.5 && row.debt.amount <= 0.5) continue;
    late.tenants += 1;
    late.amount += now + row.debt.amount;
    late.upTo30 += now + row.debt.upTo30;
    late.upTo60 += row.debt.upTo60;
    late.over60 += row.debt.over60;
  }

  let firstOut: { row: RentRollRow; label: string } | null = null;
  for (const row of rows) {
    const last = row.checksInHand.lastPeriod;
    if (!last || !row.checksInHand.lastLabel) continue;
    if (!firstOut || last < (firstOut.row.checksInHand.lastPeriod as string)) firstOut = { row, label: row.checksInHand.lastLabel };
  }

  return {
    month,
    rows,
    todo,
    tiles: {
      collected: {
        amount: month.totals.collected,
        expected: month.totals.expected,
        paid: rows.filter((r) => r.status.state === "paid").length,
        tenants: rows.filter((r) => !r.ended).length,
        waitingChecks: month.totals.checks,
      },
      late,
      deposit: {
        count: due.length + week.length,
        amount: [...due, ...week].reduce((sum, p) => sum + p.amount, 0),
        overdue: due.length,
        next,
      },
      inHand: { count: month.totals.checksInHand.count, amount: month.totals.checksInHand.amount, firstOut },
    },
  };
}

/** Of a month's rent past its day, the share collected (null: none of it due yet). */
export function collectionRate(month: RentRollMonth, today: string): number | null {
  const due = month.rows.filter((r) => r.period <= today);
  const expected = due.reduce((sum, r) => sum + r.status.rent, 0);
  if (expected <= 0) return null;
  return Math.min(1, due.reduce((sum, r) => sum + Math.min(r.status.collected, r.status.rent), 0) / expected);
}

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
export type RentDebt = { amount: number; periods: number; upTo30: number; upTo60: number; over60: number };

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
  /** Still to come in: the rent, less what's in and the checks waiting for it. */
  owed: number;
  /** Of what's in, what came by check (cleared). */
  collectedByCheck: number;
  /** What pays it — the rent in, the checks waiting — oldest first. */
  payments: RentRollPayment[];
  /** Its checks that came back (bounced) — they pay nothing. */
  returned: RentRollPayment[];
  /** The months before this one still owing — past their due day, not paid or only in part. */
  debt: RentDebt;
  /** The lease's post-dated checks still in hand (not cleared), and the last month they reach. */
  checksInHand: { count: number; amount: number; lastPeriod: string | null; lastLabel: string | null };
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
  };
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
export function rentPaymentsByLease(data: RentRollData): Map<string, RentRollPayment[]> {
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

  const debt: RentDebt = { amount: 0, periods: 0, upTo30: 0, upTo60: 0, over60: 0 };
  const first = firstRentPeriod(lease);
  if (first && first < period) {
    for (const start of rentPeriodStarts(lease, first, dayBefore(period)).slice(-DEBT_PERIODS)) {
      // Not due yet (a month ahead of today): nothing owed for it.
      if (start >= today) continue;
      const before = rentPeriodStatus(lease, rents, start, today);
      const left = Math.max(0, before.rent - before.collected - before.pending);
      if (left <= 0.5) continue;
      debt.amount += left;
      debt.periods += 1;
      const days = daysBetween(start, today);
      if (days <= 30) debt.upTo30 += left;
      else if (days <= 60) debt.upTo60 += left;
      else debt.over60 += left;
    }
  }

  const inHand = payments.filter((p) => p.method === "check" && p.paymentStatus === "pending");
  let lastPeriod: string | null = null;
  for (const check of inHand) {
    const cover = rentCoverage(lease, toRollRent(check));
    if (!cover) continue;
    const end = cover.periods > 1 ? addRentPeriods(lease, cover.start, cover.periods - 1) : cover.start;
    if (!lastPeriod || end > lastPeriod) lastPeriod = end;
  }

  return {
    key: lease.id,
    property,
    lease,
    period,
    periodLabel: rentPeriodLabel(lease, period),
    dueLabel: rentDueDateLabel(lease, period),
    status,
    owed: Math.max(0, status.rent - status.collected - status.pending),
    collectedByCheck: paying
      .filter((p) => p.method === "check" && p.paymentStatus !== "pending")
      .reduce((sum, p) => sum + paidTowards(lease, toRollRent(p), period), 0),
    payments: paying,
    returned: forPeriod.filter((p) => p.paymentStatus === "rejected"),
    debt,
    checksInHand: {
      count: inHand.length,
      amount: inHand.reduce((sum, p) => sum + p.amount, 0),
      lastPeriod,
      lastLabel: lastPeriod ? rentPeriodLabel(lease, lastPeriod) : null,
    },
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
    if (!period || !within(lease, period)) continue;
    rows.push(rowFor(property, lease, period, paymentsByLease.get(lease.id) ?? [], today));
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

  const rented = new Set(rows.map((r) => r.property.id));
  const vacant = data.properties.filter((p) => p.isActive && !rented.has(p.id));

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
  for (const month of months) for (const row of month.rows) if (!byKey.has(row.key)) byKey.set(row.key, row);
  const rows = [...byKey.values()].sort(compareRows(order)).map((row) => ({
    key: row.key,
    property: row.property,
    lease: row.lease,
    cells: months.map((month) => month.rows.find((r) => r.key === row.key) ?? null),
  }));
  return { offsets, headers, rows };
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

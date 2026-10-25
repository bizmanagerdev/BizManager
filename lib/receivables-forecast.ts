// Money that should come in but has no ledger row yet — the incoming mirror of
// the outgoing forecasts in lib/payables.ts (recurring bills, wages, card
// charges). Pure: every function here takes rows and returns items.
//
// Three sources, each with a reason the ledger can't already answer it:
//   • A payment promise is a dated commitment ("₪5,000 by the 12th") that lives
//     in payment_promises and has never been part of the money engine at all.
//   • A card settlement is money the customer already paid, which the clearing
//     company deposits as one lump on the 10th of the next month. The engine
//     dates each payment on that day, but only the batch is one deposit.
//   • Rent beyond the generated schedule doesn't exist as rows: the office
//     pre-creates N months from a lease, and the months past that are invisible.
import type { PaymentCalendarItem } from "@/lib/payables";
import { NO_CONFIRMATIONS, isSettlementArrived, type SettlementConfirmations, type SettlementPayment } from "@/lib/card-settlements";
import { leaseForPayment, paidTowards, type RentLease, type RentPayment } from "@/lib/property-rent";
import { isHebrewLease, rentPeriodStarts } from "@/lib/rent-periods";

/** The fields every incoming item shares; callers fill what distinguishes theirs. */
function incomeItem(
  base: Pick<PaymentCalendarItem, "id" | "date" | "amount" | "label" | "stage"> &
    Partial<PaymentCalendarItem>
): PaymentCalendarItem {
  return {
    direction: "in",
    sourceLabel: "",
    sourceHref: null,
    paymentStatus: null,
    origin: "payment",
    sourceId: null,
    domainName: "",
    expenseId: null,
    category: null,
    businessDomain: null,
    accountId: null,
    paidAmount: null,
    descriptionRaw: null,
    notes: null,
    paymentMethod: null,
    dueDate: base.date,
    paidDate: null,
    overdue: false,
    installmentGroupId: null,
    installmentIndex: null,
    installmentCount: null,
    expenseProjectId: null,
    expenseOrderId: null,
    expensePropertyId: null,
    workerUserId: null,
    recurringTemplateId: null,
    recurrenceKey: null,
    variableAmount: false,
    autoPaid: false,
    paymentId: null,
    customerId: null,
    customerName: null,
    reference: null,
    ...base,
  };
}

// ── 1. Payment promises ────────────────────────────────────────────────────────

export type PaymentPromise = {
  id: string;
  customerId: string | null;
  orderId: string | null;
  projectId: string | null;
  amount: number;
  promisedDate: string;
  notes: string | null;
};

/**
 * One item per open promise, on the day it was promised for. A promise past its
 * date is `pending` (and therefore overdue on the board) — which is exactly the
 * state the `promise_broken` reminder rule already fires on.
 */
export function toPromiseItems(
  promises: PaymentPromise[],
  todayIso: string,
  customerNames?: Map<string, string>
): PaymentCalendarItem[] {
  return promises
    .filter((p) => p.amount > 0 && p.promisedDate)
    .map((p) => {
      const date = p.promisedDate.slice(0, 10);
      const customerName = p.customerId ? customerNames?.get(p.customerId) ?? null : null;
      const future = date > todayIso;
      return incomeItem({
        id: `promise:${p.id}`,
        date,
        amount: p.amount,
        label: customerName ? `הבטחת תשלום — ${customerName}` : "הבטחת תשלום",
        sourceLabel: customerName ?? "",
        // The promise was made and is chased on the customer's collection page.
        sourceHref: p.customerId ? `/collections?focus=${encodeURIComponent(p.customerId)}` : "/collections",
        stage: future ? "scheduled" : "pending",
        paymentStatus: "pending",
        overdue: !future,
        domainName: "גבייה",
        customerId: p.customerId,
        customerName,
        notes: p.notes,
        descriptionRaw: p.notes,
      });
    });
}

/**
 * A promise is a commitment ABOUT an existing debt, so showing both would count
 * the same money twice. Where a promise names an order or project, its amount
 * comes off that receivable; a receivable fully covered disappears, and the
 * promise carries it on its own date instead.
 */
export function suppressPromisedReceivables(
  items: PaymentCalendarItem[],
  promises: PaymentPromise[]
): PaymentCalendarItem[] {
  if (promises.length === 0) return items;
  const promisedByOrder = new Map<string, number>();
  const promisedByProject = new Map<string, number>();
  for (const p of promises) {
    if (!(p.amount > 0)) continue;
    if (p.orderId) promisedByOrder.set(p.orderId, (promisedByOrder.get(p.orderId) ?? 0) + p.amount);
    else if (p.projectId) promisedByProject.set(p.projectId, (promisedByProject.get(p.projectId) ?? 0) + p.amount);
  }
  if (promisedByOrder.size === 0 && promisedByProject.size === 0) return items;

  return items.flatMap((item) => {
    const promised =
      item.origin === "order_receivable" && item.sourceId
        ? promisedByOrder.get(item.sourceId)
        : item.origin === "project_receivable" && item.sourceId
          ? promisedByProject.get(item.sourceId)
          : undefined;
    if (promised === undefined) return [item];
    const remaining = Math.round((item.amount - promised) * 100) / 100;
    return remaining > 0 ? [{ ...item, amount: remaining }] : [];
  });
}

// ── 2. Credit-card settlement batches (Grow) ───────────────────────────────────

/** A card `payments` row, with `dueDate` already set to its deposit day. */
export type SettlementPaymentRow = {
  id: string;
  accountId: string | null;
  paymentDate: string;
  dueDate: string;
  amount: number;
  /** Who it was from, when the loader could resolve it. */
  label?: string;
};

export type SettlementBatch = {
  accountId: string | null;
  dueDate: string;
  gross: number;
  count: number;
  paymentIds: string[];
  /** The payments it is made of, newest first — what the user checks before confirming. */
  payments: SettlementPayment[];
};

/**
 * The same grouping lib/accounts.ts uses for the bank ledger: every card
 * payment sharing an account and a settlement date is one deposit. Keyed the
 * same way so the two surfaces can't disagree about what a batch is.
 */
export function groupSettlementBatches(rows: SettlementPaymentRow[]): SettlementBatch[] {
  const byKey = new Map<string, SettlementBatch>();
  for (const row of rows) {
    if (!(row.amount > 0) || !row.dueDate || !row.paymentDate) continue;
    const key = `${row.accountId ?? ""}|${row.dueDate}`;
    const batch =
      byKey.get(key) ?? { accountId: row.accountId, dueDate: row.dueDate, gross: 0, count: 0, paymentIds: [], payments: [] };
    batch.gross += row.amount;
    batch.count += 1;
    batch.paymentIds.push(row.id);
    batch.payments.push({ id: row.id, date: row.paymentDate, amount: row.amount, label: row.label ?? "תקבול אשראי" });
    byKey.set(key, batch);
  }
  return [...byKey.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * One row per batch, on the day the bank credits it, for the GROSS the
 * customers paid — the same figure the account shows. The clearing company's
 * fee is not estimated here; it is recorded as an expense from its receipt.
 */
export function toSettlementItems(
  batches: SettlementBatch[],
  todayIso: string,
  confirmations: SettlementConfirmations = NO_CONFIRMATIONS
): PaymentCalendarItem[] {
  return batches.map((b) => {
    const arrived = isSettlementArrived({ accountId: b.accountId, settlementDate: b.dueDate }, confirmations, todayIso);
    const future = b.dueDate > todayIso;
    // Confirmed → it landed. Not confirmed and its day has passed → it is late,
    // and shows red until someone confirms it. Otherwise it is still expected.
    const stage = arrived ? ("posted" as const) : future ? ("scheduled" as const) : ("pending" as const);
    return incomeItem({
      id: `grow_batch:${b.accountId ?? "none"}:${b.dueDate}`,
      date: b.dueDate,
      amount: Math.round(b.gross * 100) / 100,
      label: "אשראי משולם (גרואו)",
      sourceLabel: `${b.count} תקבולי אשראי`,
      sourceHref: "/financial/bank",
      stage,
      paymentStatus: arrived ? "cleared" : "pending",
      overdue: stage === "pending",
      // What the board needs to confirm it, and to list what it is made of.
      settlement: {
        accountId: b.accountId,
        date: b.dueDate,
        arrived,
        payments: [...b.payments].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)),
      },
      accountId: b.accountId,
      paymentMethod: "credit_card",
      domainName: "מכירות",
    });
  });
}

/**
 * Hide the individual card payments a batch already represents — the same rule
 * the outgoing side uses for itemized purchases once their lump card charge
 * exists. Without this the customer's payment shows on the day they paid AND
 * again inside the deposit.
 */
export function dropSettledCardPayments(
  items: PaymentCalendarItem[],
  batches: SettlementBatch[]
): PaymentCalendarItem[] {
  const covered = new Set(batches.flatMap((b) => b.paymentIds));
  if (covered.size === 0) return items;
  return items.filter((i) => !(i.paymentId && covered.has(i.paymentId)));
}

// ── 3. Rent projected from a lease ─────────────────────────────────────────────

export type LeaseRow = {
  id: string;
  propertyId: string;
  customerId: string | null;
  propertyLabel: string;
  startDate: string;
  endDate: string | null;
  monthlyAmount: number;
  /** Day of the month rent is due; falls back to the start day when absent. */
  rentDay?: number | null;
  /** On the Hebrew calendar: due on that day of each Hebrew month (lib/rent-periods.ts). */
  rentCalendar?: string | null;
  rentHebrewDay?: number | null;
  /** 1 = monthly, 12 = once a year; the amount is per period. */
  periodMonths?: number | null;
};

function ym(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * A month of rent for every month in [fromIso, toIso] that the lease covers and
 * that has NO payment row already. The office pre-creates rent rows from a
 * lease; the months past whatever it created are real, expected money that
 * nothing in the app currently shows.
 *
 * When it's due: the lease's own periods (lib/rent-periods.ts) — its agreed day
 * of the month (the start day when none is agreed), clamped to a short month
 * and never stepped from the previous month's date (a lease starting on the
 * 31st is due on the 30th in September and the 31st again in October); א׳ of
 * each Hebrew month for a lease on the Hebrew calendar (owner, 2026-10-20); or
 * once a year. A period some payment already pays for is never projected —
 * by the month(s) it says, or the period its date falls in (`rentPayments`);
 * without them, a payment row in the same calendar month takes it.
 */
export function projectRent(
  leases: LeaseRow[],
  existingMonthsByProperty: Map<string, Set<string>>,
  { fromIso, toIso, todayIso }: { fromIso: string; toIso: string; todayIso: string },
  rentPayments?: Map<string, RentPayment[]>
): PaymentCalendarItem[] {
  const items: PaymentCalendarItem[] = [];
  const periodLeases = new Map<string, RentLease & { id: string; propertyId: string }>();
  for (const lease of leases) {
    const startIso = (lease.startDate ?? "").slice(0, 10);
    if (!(lease.monthlyAmount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(startIso)) continue;
    periodLeases.set(lease.id, {
      id: lease.id,
      propertyId: lease.propertyId,
      status: "active",
      monthlyRentAmount: lease.monthlyAmount,
      startDate: startIso,
      endDate: lease.endDate,
      rentDayOfMonth: lease.rentDay,
      rentCalendar: lease.rentCalendar,
      rentHebrewDay: lease.rentHebrewDay,
      periodMonths: lease.periodMonths,
    });
  }
  for (const lease of leases) {
    const periodLease = periodLeases.get(lease.id);
    if (!periodLease) continue;
    const startIso = periodLease.startDate as string;
    const taken = existingMonthsByProperty.get(lease.propertyId) ?? new Set<string>();
    // Its own payments (owner, 2026-10-25): the lease each names, else the one running on its date — the only lease
    // on the property for one before its start — not every payment on the property (a storage renter's beside it).
    const here = [...periodLeases.values()].filter((l) => l.propertyId === lease.propertyId);
    const payments = rentPayments
      ?.get(lease.propertyId)
      ?.filter(
        (p) => p.paymentStatus !== "rejected" && leaseForPayment(here, p, here.length === 1 ? periodLease : null)?.id === lease.id
      );
    // What no payment row covers — a check or a part payment shows as its own item; only the rest is projected.
    const uncovered = (due: string) =>
      payments
        ? Math.max(0, lease.monthlyAmount - payments.reduce((sum, p) => sum + paidTowards(periodLease, p, due), 0))
        : taken.has(ym(due))
          ? 0
          : lease.monthlyAmount;
    const endIso = lease.endDate ? lease.endDate.slice(0, 10) : null;
    // Two Hebrew months can start in one calendar month: those are told apart by their day.
    const idPart = (due: string) => (isHebrewLease(periodLease) ? due : ym(due));

    // From whichever is later: the lease or the window.
    for (const due of rentPeriodStarts(periodLease, fromIso > startIso ? fromIso : startIso, toIso)) {
      if (endIso && due > endIso) break;
      const left = uncovered(due);
      if (left <= 0.5) continue;
      const future = due > todayIso;
      items.push(
        incomeItem({
          id: `rent_proj:${lease.id}:${idPart(due)}`,
          date: due,
          amount: left,
          label: `שכר דירה — ${lease.propertyLabel}`,
          sourceLabel: lease.propertyLabel,
          sourceHref: `/properties/${lease.propertyId}`,
          stage: future ? "scheduled" : "pending",
          paymentStatus: "pending",
          overdue: !future,
          domainName: "ניהול נכסים",
          businessDomain: "property_management",
          expensePropertyId: lease.propertyId,
          customerId: lease.customerId,
          sourceId: lease.propertyId,
        })
      );
    }
  }
  return items;
}


// Money that should come in but has no ledger row yet — the incoming mirror of
// the outgoing forecasts in lib/payables.ts (recurring bills, wages, card
// charges). Pure: every function here takes rows and returns items.
//
// Three sources, each with a reason the ledger can't already answer it:
//   • A payment promise is a dated commitment ("₪5,000 by the 12th") that lives
//     in payment_promises and has never been part of the money engine at all.
//   • A card settlement is money the customer already paid, which the bank pays
//     US later as one lump, net of the clearing fee. The engine sees only the
//     individual payments, on the day the customer paid.
//   • Rent beyond the generated schedule doesn't exist as rows: the office
//     pre-creates N months from a lease, and the months past that are invisible.
import type { PaymentCalendarItem } from "@/lib/payables";

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

/** A `payments` row that is a deferred card settlement (due_date ≠ payment_date). */
export type SettlementPaymentRow = {
  id: string;
  accountId: string | null;
  paymentDate: string;
  dueDate: string;
  amount: number;
};

export type SettlementBatch = {
  accountId: string | null;
  dueDate: string;
  gross: number;
  count: number;
  paymentIds: string[];
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
    if (row.dueDate === row.paymentDate) continue; // not deferred — ordinary card income
    const key = `${row.accountId ?? ""}|${row.dueDate}`;
    const batch = byKey.get(key) ?? { accountId: row.accountId, dueDate: row.dueDate, gross: 0, count: 0, paymentIds: [] };
    batch.gross += row.amount;
    batch.count += 1;
    batch.paymentIds.push(row.id);
    byKey.set(key, batch);
  }
  return [...byKey.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * One row per batch, on the day the bank credits it, NET of the clearing fee —
 * that is the figure that reaches the account, and the whole reason this is
 * worth showing instead of the individual payments.
 */
export function toSettlementItems(
  batches: SettlementBatch[],
  feeRate: number,
  todayIso: string
): PaymentCalendarItem[] {
  return batches.map((b) => {
    const net = Math.round(b.gross * (1 - feeRate) * 100) / 100;
    const future = b.dueDate > todayIso;
    return incomeItem({
      id: `grow_batch:${b.accountId ?? "none"}:${b.dueDate}`,
      date: b.dueDate,
      amount: net,
      label: "אשראי משולם (גרואו)",
      sourceLabel: `${b.count} תקבולי אשראי · לאחר עמלת סליקה`,
      sourceHref: "/financial/bank",
      // A settled batch is money that has arrived; a future one is expected.
      stage: future ? "scheduled" : "posted",
      paymentStatus: future ? "pending" : "cleared",
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
};

function ym(iso: string): string {
  return iso.slice(0, 7);
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole months from `a` to `b`, never negative. */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.slice(0, 7).split("-").map(Number);
  const [by, bm] = b.slice(0, 7).split("-").map(Number);
  if (!ay || !am || !by || !bm) return 0;
  return Math.max(0, (by - ay) * 12 + (bm - am));
}

/**
 * A month of rent for every month in [fromIso, toIso] that the lease covers and
 * that has NO payment row already. The office pre-creates rent rows from a
 * lease; the months past whatever it created are real, expected money that
 * nothing in the app currently shows.
 *
 * Day of the month: the lease's own start day — `lease_agreements` has no rent
 * day-of-month column, so that is the only signal there is. Every month is
 * computed from that day (clamped to a short month), never by stepping the
 * previous month's date: a lease starting on the 31st is due on the 30th in
 * September and the 31st again in October, not the 30th forever after. A
 * generated row for the same month always wins, whatever day it sits on.
 */
export function projectRent(
  leases: LeaseRow[],
  existingMonthsByProperty: Map<string, Set<string>>,
  { fromIso, toIso, todayIso }: { fromIso: string; toIso: string; todayIso: string }
): PaymentCalendarItem[] {
  const items: PaymentCalendarItem[] = [];
  for (const lease of leases) {
    if (!(lease.monthlyAmount > 0) || !lease.startDate) continue;
    const startIso = lease.startDate.slice(0, 10);
    const [sy, sm, startDay] = startIso.split("-").map(Number);
    if (!sy || !sm || !startDay) continue;
    // The agreed rent day wins; the lease's start day is only the fallback.
    const sd =
      typeof lease.rentDay === "number" && lease.rentDay >= 1 && lease.rentDay <= 31 ? lease.rentDay : startDay;
    const taken = existingMonthsByProperty.get(lease.propertyId) ?? new Set<string>();
    const endIso = lease.endDate ? lease.endDate.slice(0, 10) : null;
    // Start at whichever month is later: the lease's or the window's.
    const firstOffset = monthsBetween(startIso, fromIso);

    for (let k = firstOffset, guard = 0; guard < 400; k += 1, guard += 1) {
      const monthIndex = sm - 1 + k;
      const lastDay = new Date(sy, monthIndex + 1, 0).getDate();
      const due = isoLocal(new Date(sy, monthIndex, Math.min(sd, lastDay)));
      if (due > toIso) break;
      if (due < fromIso || due < startIso) continue;
      if (endIso && due > endIso) break;
      if (taken.has(ym(due))) continue;
      const future = due > todayIso;
      items.push(
        incomeItem({
          id: `rent_proj:${lease.id}:${ym(due)}`,
          date: due,
          amount: lease.monthlyAmount,
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


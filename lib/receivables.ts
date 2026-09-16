// The INCOMING half of the payments board: every shekel that should come in,
// on the day it should arrive.
//
// It mirrors lib/payables.ts, which maps the same ledger's OUTflow entries, and
// produces the same PaymentCalendarItem so one board can render both. What
// differs is entirely in the mapping, and it is not cosmetic — three things the
// money engine gets wrong for a calendar are fixed here:
//
//   1. A receivable's date. The engine's buildPlannedReceivableFlowMeta takes
//      the earliest of the order/project's own dates and, when that is already
//      past, collapses it to TODAY. That is fine for a "what do we still have
//      open" summary and useless on a calendar: every open order piles onto the
//      current day. The app already knows the real answer — orders and projects
//      carry payment_terms and an effective due_date, which lib/collections.ts
//      has used since payment terms were introduced — so we re-date each
//      receivable from those.
//   2. Bounced money. buildPaymentFlowMeta never looks at "rejected", so a
//      bounced CHECK stays an expected inflow on its due date forever and a
//      bounced transfer reads as posted income. Both are dropped here, the way
//      lib/accounts.ts and splitPaymentAmounts already drop them.
//   3. An open order is never late. Collections' rule (the user's): we don't
//      force payment before the goods are delivered, so an undelivered order
//      past its due date is צפוי, not באיחור.
import type { FinancialEntry } from "@/lib/financial/types";
import { computeDueDate } from "@/lib/paymentTerms";
import { isOpenOrderStatus } from "@/lib/collections";
import type { PaymentCalendarItem } from "@/lib/payables";

/** Payment terms + status of the order/project behind a receivable. */
export type ReceivableTerms = {
  dueDate: string | null;
  paymentTerms: string | null;
  status: string | null;
};

const RECEIVABLE_ORIGINS = new Set(["order_receivable", "project_receivable"]);

/** Money that bounced is not money coming in. */
export function isRejectedEntry(entry: FinancialEntry): boolean {
  return (entry.paymentStatus ?? "").trim().toLowerCase() === "rejected";
}

/**
 * When a receivable is really expected: the order/project's stored due_date, or
 * the date its payment terms imply from its own reference date. `recordedDate`
 * is what the engine picked as that reference (order_date for an order, the
 * earliest of end/start/created for a project) — the one date the entry carries
 * that the terms can be applied to. Null when neither is knowable, in which
 * case the caller keeps the engine's date.
 */
export function effectiveReceivableDate(entry: FinancialEntry, terms: ReceivableTerms | null): string | null {
  if (terms?.dueDate) return terms.dueDate.slice(0, 10);
  const reference = entry.recordedDate ?? entry.dueDate;
  return computeDueDate(reference, terms?.paymentTerms ?? null);
}

/**
 * Re-date a receivable onto the day it is actually expected, and restage it
 * against today. An OPEN order stays צפוי however old it is (see rule 3).
 */
export function redateReceivable(
  entry: FinancialEntry,
  terms: ReceivableTerms | null,
  todayIso: string
): FinancialEntry {
  if (!RECEIVABLE_ORIGINS.has(entry.origin)) return entry;
  const due = effectiveReceivableDate(entry, terms);
  if (!due) return entry;
  const blockOverdue = entry.origin === "order_receivable" && isOpenOrderStatus(terms?.status);
  const stage = due > todayIso || blockOverdue ? ("scheduled" as const) : ("pending" as const);
  return { ...entry, flowDate: due, dueDate: due, stage };
}

/** Which ids we need terms for, split by table. */
export function receivableSourceIds(entries: FinancialEntry[]): { orderIds: string[]; projectIds: string[] } {
  const orderIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const e of entries) {
    if (!e.sourceId) continue;
    if (e.origin === "order_receivable") orderIds.add(e.sourceId);
    else if (e.origin === "project_receivable") projectIds.add(e.sourceId);
  }
  return { orderIds: [...orderIds], projectIds: [...projectIds] };
}

/**
 * Where "למקור" takes an incoming item. A payment row lands on itself in the
 * checks register when it's a check (the one page that marks payment rows with
 * a focus id), otherwise on the order/project/property it belongs to; a
 * receivable lands on its own source page.
 */
export function incomeSourceHref(entry: FinancialEntry): string | null {
  if (entry.origin === "payment" && entry.paymentMethod?.trim().toLowerCase() === "check") {
    const paymentId = entry.id.startsWith("payment:") ? entry.id.slice("payment:".length) : null;
    if (paymentId) return `/checks?focus=${encodeURIComponent(paymentId)}`;
  }
  return entry.sourceHref;
}

/**
 * Map the ledger's inflow entries to calendar items. `terms` is keyed by the
 * order/project id (entry.sourceId) and only matters for receivables;
 * `customerNames` puts a name on a row whose source label is just an order
 * number.
 */
export function toIncomeCalendarItems(
  entries: FinancialEntry[],
  todayIso: string,
  {
    terms,
    customerNames,
  }: { terms?: Map<string, ReceivableTerms>; customerNames?: Map<string, string> } = {}
): PaymentCalendarItem[] {
  return entries
    .filter((entry) => entry.type === "inflow" && !isRejectedEntry(entry))
    .map((entry) => redateReceivable(entry, entry.sourceId ? terms?.get(entry.sourceId) ?? null : null, todayIso))
    .map((entry) => {
      const customerName = entry.customerId ? customerNames?.get(entry.customerId) ?? null : null;
      const paymentId = entry.id.startsWith("payment:") ? entry.id.slice("payment:".length) : null;
      return {
        id: entry.id,
        direction: "in" as const,
        date: entry.flowDate,
        amount: entry.amount,
        label: entry.description,
        // The customer is who this is from — worth more on a collections row
        // than "הזמנה 4f3c1b2a", which is what buildSource can produce.
        sourceLabel: customerName ? `${customerName} · ${entry.sourceLabel}` : entry.sourceLabel,
        sourceHref: incomeSourceHref(entry),
        stage: entry.stage,
        paymentStatus: entry.paymentStatus,
        origin: entry.origin,
        sourceId: entry.sourceId ?? null,
        domainName: entry.domainName,
        // Inbound rows are payments, not expenses: every expense-only field is
        // null so the shared card simply doesn't offer an expense's actions.
        expenseId: null,
        category: null,
        businessDomain: entry.businessDomain,
        accountId: null,
        paidAmount: null,
        descriptionRaw: entry.description,
        notes: null,
        paymentMethod: entry.paymentMethod,
        dueDate: entry.dueDate ?? entry.flowDate,
        paidDate: entry.stage === "posted" ? entry.recordedDate : null,
        // Same rule as the outgoing side: still pending and the day has passed.
        overdue: entry.stage === "pending" && entry.flowDate < todayIso,
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
        // Inbound-only:
        paymentId,
        customerId: entry.customerId ?? null,
        customerName,
        reference: entry.reference,
      };
    });
}

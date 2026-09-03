// Pure, framework-free logic extracted from CollectionsClient.tsx so it can be
// unit-tested (characterization) and the client stays presentational. Date-aware
// helpers take an optional reference date so tests are deterministic; callers omit
// it and get "now", preserving the original behavior.

import { formatShortDate } from "@/lib/date";
import { whatsappHref } from "@/lib/whatsapp";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { normalizePaymentMethodValue } from "@/lib/orders/paymentStatus";
import type { CollectionCustomerGroup } from "@/lib/collections";
import type { Reminder } from "@/lib/communications";

export type View = "debtors" | "reminders" | "activity";
export type FilterKey = "all" | "overdue" | "uncontacted";
export type SortKey = "amount" | "oldest" | "name" | "due";

export type ExpectedReceipt = {
  paymentId: string;
  amount: number;
  dueDate: string | null;
  methodKey: string; // normalized: check / bank_transfer / cash / bit / credit_card / ...
  methodRaw: string | null;
  checkNumber: string | null;
  overdue: boolean;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  sourceType: "order" | "project";
  sourceId: string;
  /** false = there's no actual payment record behind this row — it's the
   *  not-yet-due remainder of a source with nothing registered yet (no check,
   *  no scheduled transfer). Read-only: there's no payment id to mark
   *  collected against. True for a real row from pending_payments. */
  isScheduled: boolean;
};

// Method chips. Only those actually present in the data are shown (plus "הכל").
export const RECEIPT_METHODS: { key: string; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "check", label: "צ׳ק" },
  { key: "bank_transfer", label: "העברה" },
  { key: "bit", label: "ביט" },
  { key: "cash", label: "מזומן" },
  { key: "credit_card", label: "אשראי" },
];

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | null) {
  return value ? formatShortDate(value) : "—";
}

export function todayIso(today: Date = new Date()) {
  return today.toISOString().slice(0, 10);
}

export function daysSince(dateIso: string | null, now: Date = new Date()): number | null {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const ref = new Date(now);
  ref.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.max(Math.floor((ref.getTime() - d.getTime()) / 86_400_000), 0);
}

/** Build a wa.me link from an Israeli phone/whatsapp number with a prefilled message. */
export function whatsappLink(number: string | null, message: string): string | null {
  return whatsappHref(number, message);
}

// Subtle row/card tint by worst aging bucket, so the riskiest debts stand out.
export function severityTint(group: CollectionCustomerGroup): string {
  if (group.aging.d90plus > 0.009) return "bg-destructive/5";
  if (group.aging.d90 > 0.009 || group.aging.d60 > 0.009) return "bg-warning/5";
  return "";
}

export type OverdueByDays = { daysLate: number; amount: number };

/** This customer's overdue money grouped by its EXACT days-late (not a
 *  1-30/31-60/… bucket range — "1-30 יום" is still too vague to tell a 3-day
 *  debt from a 29-day one apart). Empty when nothing is overdue, a single
 *  entry when every late source shares the same day count (the common case,
 *  where "X ימים באיחור" alone is accurate). More than one entry means the
 *  debt genuinely spans different ages — e.g. one source 3 days late and
 *  another 34 days late — so a single "34 ימים באיחור" headline would
 *  misrepresent the money that's barely late as if all of it were that old.
 *  Sorted oldest first. */
export function overdueAgingBreakdown(group: CollectionCustomerGroup): OverdueByDays[] {
  const byDays = new Map<number, number>();
  for (const source of group.sources) {
    if (!(source.overdue_amount > 0.009) || !(source.days_late > 0)) continue;
    byDays.set(source.days_late, (byDays.get(source.days_late) ?? 0) + source.overdue_amount);
  }
  return Array.from(byDays, ([daysLate, amount]) => ({ daysLate, amount })).sort(
    (a, b) => b.daysLate - a.daysLate
  );
}

export function buildWaMessage(group: CollectionCustomerGroup): string {
  return `שלום, נותרה יתרה לתשלום בסך ${formatCurrency(group.actionable_amount)}. נשמח להסדרת התשלום. תודה!`;
}

/** Does this debtor have an expected payment that's a check? (so: no cash to chase) */
export function groupHasPendingCheck(group: CollectionCustomerGroup): boolean {
  return group.sources.some((s) => s.pending_payments.some((p) => p.payment_method === "check"));
}

/** Flatten every customer's future-dated / not-yet-due receivables into one
 *  list, earliest due date first. Loans are repaid on the loans page, and rent
 *  (property) checks are managed on the property's own page — both are
 *  skipped (and both carry an empty pending_payments list anyway, so this loop
 *  never runs for them).
 *
 *  Two kinds of row: a REAL registered payment (a post-dated check, a
 *  scheduled transfer — one per source.pending_payments entry), and an
 *  UNSCHEDULED remainder — money that's genuinely not due yet but has nothing
 *  registered at all (a brand-new order on שוטף+30 with no deposit logged).
 *  Without the second kind, that money only ever showed up inside the totals
 *  — it contributed to pending_amount but had no row anywhere naming whose it
 *  was. `isScheduled: false` marks it so the UI can skip "סמן כנגבה" (there's
 *  no payment id to mark collected) and label its method "לא נקבע". */
export function flattenExpectedReceipts(customers: CollectionCustomerGroup[]): ExpectedReceipt[] {
  const out: ExpectedReceipt[] = [];
  for (const group of customers) {
    for (const source of group.sources) {
      if (source.source_type === "loan" || source.source_type === "property") continue;
      let registeredTotal = 0;
      for (const p of source.pending_payments) {
        registeredTotal += p.amount;
        out.push({
          paymentId: p.id,
          amount: p.amount,
          dueDate: p.due_date,
          methodKey: normalizePaymentMethodValue(p.payment_method),
          methodRaw: p.payment_method,
          checkNumber: p.check_number,
          overdue: p.overdue,
          customerId: group.customer_id,
          customerName: group.customer_name,
          customerPhone: group.customer_phone,
          sourceType: source.source_type,
          sourceId: source.source_id,
          isScheduled: true,
        });
      }
      const unscheduled = Math.max(source.pending_amount - registeredTotal, 0);
      if (unscheduled > 0.009) {
        out.push({
          paymentId: `unscheduled:${source.collection_key}`,
          amount: unscheduled,
          dueDate: source.due_date ?? source.next_due_date,
          methodKey: "unscheduled",
          methodRaw: null,
          checkNumber: null,
          overdue: false,
          customerId: group.customer_id,
          customerName: group.customer_name,
          customerPhone: group.customer_phone,
          sourceType: source.source_type,
          sourceId: source.source_id,
          isScheduled: false,
        });
      }
    }
  }
  return out.sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"));
}

/** Distinct business domains present across all debtors, with Hebrew labels. */
export function buildDomainOptions(
  customers: CollectionCustomerGroup[]
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const group of customers) {
    for (const source of group.sources) {
      const key = source.business_domain ?? "";
      if (key && !seen.has(key)) seen.set(key, getBusinessDomainLabel(source.business_domain));
    }
  }
  return Array.from(seen, ([value, label]) => ({ value, label }));
}

/** Of the canonical method chips, only those actually present in the data (+ "הכל"). */
export function presentReceiptMethodChips(receipts: ExpectedReceipt[]) {
  const present = new Set(receipts.map((r) => r.methodKey).filter(Boolean));
  return RECEIPT_METHODS.filter((m) => m.key === "all" || present.has(m.key));
}

const VIEWS: View[] = ["debtors", "reminders", "activity"];
const FILTERS: FilterKey[] = ["all", "overdue", "uncontacted"];

/** Deep-link ?view= parsing; unknown values land on the call log. */
export function parseInitialView(value: string | null | undefined): View {
  return VIEWS.includes(value as View) ? (value as View) : "activity";
}

/** Deep-link ?filter= parsing; unknown values mean no filter. */
export function parseInitialFilter(value: string | null | undefined): FilterKey {
  return FILTERS.includes(value as FilterKey) ? (value as FilterKey) : "all";
}

/** The חייבים worklist engine: an ACTION LIST of who owes money right now — a
 *  customer whose whole balance is future/not-yet-due (post-dated checks, next
 *  months' rent or loan installments) doesn't belong here at all, no matter which
 *  status filter is picked; that money lives in the תקבולים צפויים sub-view
 *  instead. Filters by status/domain/search within that, then sorts. */
export function filterAndSortDebtors(
  customers: CollectionCustomerGroup[],
  opts: { filter: FilterKey; search: string; domain: string; sort: SortKey }
): CollectionCustomerGroup[] {
  const q = opts.search.trim().toLowerCase();
  const list = customers.filter((c) => {
    if (!(c.actionable_amount > 0.009)) return false;
    if (opts.filter === "overdue" && !(c.overdue_amount > 0.009)) return false;
    if (opts.filter === "uncontacted" && c.last_contact_at) return false;
    if (opts.domain !== "all" && !c.sources.some((s) => s.business_domain === opts.domain)) return false;
    if (q) {
      const haystack = `${c.customer_name} ${c.customer_phone ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const sorted = [...list];
  switch (opts.sort) {
    case "oldest":
      sorted.sort(
        (a, b) => b.oldest_days_late - a.oldest_days_late || b.actionable_amount - a.actionable_amount
      );
      break;
    case "name":
      sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name, "he"));
      break;
    case "due":
      sorted.sort((a, b) => (a.next_due_date ?? "9999").localeCompare(b.next_due_date ?? "9999"));
      break;
    default:
      sorted.sort((a, b) => b.actionable_amount - a.actionable_amount);
  }
  return sorted;
}

/** Split reminders into overdue / today / upcoming buckets by their remind_at day. */
export function groupReminders(
  reminders: Reminder[],
  today: string = todayIso()
): { overdue: Reminder[]; today: Reminder[]; upcoming: Reminder[] } {
  const overdue: Reminder[] = [];
  const todayList: Reminder[] = [];
  const upcoming: Reminder[] = [];
  for (const r of reminders) {
    const day = r.remind_at.slice(0, 10);
    if (day < today) overdue.push(r);
    else if (day === today) todayList.push(r);
    else upcoming.push(r);
  }
  return { overdue, today: todayList, upcoming };
}

/** Filter the flat expected-receipts list by method, due-date range and search. */
export function filterExpectedReceipts(
  receipts: ExpectedReceipt[],
  opts: { method: string; from: string; to: string; search: string }
): ExpectedReceipt[] {
  const q = opts.search.trim().toLowerCase();
  return receipts.filter((r) => {
    if (opts.method !== "all" && r.methodKey !== opts.method) return false;
    const day = r.dueDate ? r.dueDate.slice(0, 10) : null;
    if (opts.from && (!day || day < opts.from)) return false;
    if (opts.to && (!day || day > opts.to)) return false;
    if (q) {
      const haystack = `${r.customerName} ${r.customerPhone ?? ""} ${r.checkNumber ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

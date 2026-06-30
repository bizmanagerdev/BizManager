// Pure, framework-free logic extracted from CollectionsClient.tsx so it can be
// unit-tested (characterization) and the client stays presentational. Date-aware
// helpers take an optional reference date so tests are deterministic; callers omit
// it and get "now", preserving the original behavior.

import { formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { normalizePaymentMethodValue } from "@/lib/orders/paymentStatus";
import type { CollectionCustomerGroup } from "@/lib/collections";
import type { Reminder } from "@/lib/communications";

export type View = "debtors" | "reminders" | "activity";
export type FilterKey = "all" | "overdue" | "due_soon" | "expected" | "uncontacted";
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

/** Due within the next 14 days (inclusive of today's window). */
export function isDueSoon(dateIso: string | null, today: Date = new Date()) {
  if (!dateIso) return false;
  const due = new Date(dateIso);
  if (Number.isNaN(due.getTime())) return false;
  const in14 = new Date(today);
  in14.setDate(in14.getDate() + 14);
  return due <= in14;
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
  if (!number) return null;
  let digits = number.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  else if (!digits.startsWith("972")) digits = `972${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// Subtle row/card tint by worst aging bucket, so the riskiest debts stand out.
export function severityTint(group: CollectionCustomerGroup): string {
  if (group.aging.d90plus > 0.009) return "bg-destructive/5";
  if (group.aging.d90 > 0.009 || group.aging.d60 > 0.009) return "bg-warning/5";
  return "";
}

export function buildWaMessage(group: CollectionCustomerGroup): string {
  return `שלום, נותרה יתרה לתשלום בסך ${formatCurrency(group.outstanding_amount)}. נשמח להסדרת התשלום. תודה!`;
}

/** Does this debtor have an expected payment that's a check? (so: no cash to chase) */
export function groupHasPendingCheck(group: CollectionCustomerGroup): boolean {
  return group.sources.some((s) => s.pending_payments.some((p) => p.payment_method === "check"));
}

/** Flatten every customer's future-dated / uncleared receivables into one list,
 *  earliest due date first. Loans are repaid on the loans page, so they're skipped. */
export function flattenExpectedReceipts(customers: CollectionCustomerGroup[]): ExpectedReceipt[] {
  const out: ExpectedReceipt[] = [];
  for (const group of customers) {
    for (const source of group.sources) {
      if (source.source_type === "loan") continue;
      for (const p of source.pending_payments) {
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
const FILTERS: FilterKey[] = ["all", "overdue", "due_soon", "expected", "uncontacted"];

/** Deep-link ?view= parsing; unknown values land on the call log. */
export function parseInitialView(value: string | null | undefined): View {
  return VIEWS.includes(value as View) ? (value as View) : "activity";
}

/** Deep-link ?filter= parsing; unknown values mean no filter. */
export function parseInitialFilter(value: string | null | undefined): FilterKey {
  return FILTERS.includes(value as FilterKey) ? (value as FilterKey) : "all";
}

/** The חייבים worklist engine: filter by status/domain/search, then sort. */
export function filterAndSortDebtors(
  customers: CollectionCustomerGroup[],
  opts: { filter: FilterKey; search: string; domain: string; sort: SortKey; now?: Date }
): CollectionCustomerGroup[] {
  const q = opts.search.trim().toLowerCase();
  const today = opts.now ?? new Date();
  const list = customers.filter((c) => {
    if (opts.filter === "overdue" && !(c.overdue_amount > 0.009)) return false;
    if (opts.filter === "due_soon" && !(isDueSoon(c.next_due_date, today) || c.overdue_amount > 0.009)) {
      return false;
    }
    if (opts.filter === "expected" && !(c.pending_amount > 0.009)) return false;
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
        (a, b) => b.oldest_days_late - a.oldest_days_late || b.outstanding_amount - a.outstanding_amount
      );
      break;
    case "name":
      sorted.sort((a, b) => a.customer_name.localeCompare(b.customer_name, "he"));
      break;
    case "due":
      sorted.sort((a, b) => (a.next_due_date ?? "9999").localeCompare(b.next_due_date ?? "9999"));
      break;
    default:
      sorted.sort((a, b) => b.outstanding_amount - a.outstanding_amount);
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

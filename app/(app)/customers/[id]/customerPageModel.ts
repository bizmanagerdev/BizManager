import { applyProjectVatToBase } from "@/lib/projects/vat";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { ordersHe, pluralHe, projectsHe } from "@/lib/i18n/pluralHe";
import type { CustomerReceivable } from "@/lib/collections";
import type { CounterpartyBalance } from "@/lib/customers/counterpartyBalance";
import type { CommunicationLog, Reminder } from "@/lib/communications";
import type { PaymentPromise } from "@/lib/promises";
import type { MorningLocalDocument } from "@/lib/morning/types";
import type { DeliveryPin } from "@/lib/delivery-location";
import type { AuditFeedItem } from "@/lib/audit";

// A customer's page as data: what the server reads for it (loadCustomerPage.ts)
// and the plain helpers both sides use — the money summary (the same figures
// the page always showed, moved here so the server works them out once), the
// delete rules, and the counted words ("הזמנה אחת", never "1 הזמנות").
// No server-only imports, so the page's client parts can share the types.

export type Row = Record<string, unknown>;

export function str(row: Row | null | undefined, key: string): string {
  const v = row?.[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

export function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function rowDateValue(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function laterDate(a: string | null, b: string | null) {
  return rowDateValue(a) >= rowDateValue(b) ? a : b;
}

// ── shapes ───────────────────────────────────────────────────────────────────

export type CustomerProfile = {
  id: string;
  name: string;
  invoiceName: string | null;
  registrationNumber: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  deliveryInstructions: string | null;
  deliveryPin: DeliveryPin | null;
  notes: string | null;
  active: boolean;
  requiresPrepayment: boolean;
  linkedUserId: string | null;
  morningClientId: string | null;
  morningMatchStatus: string | null;
  morningSyncedAt: string | null;
  morningLastSyncError: string | null;
};

export type CustomerOrderRow = {
  id: string;
  date: string | null;
  status: string;
  total: number;
  collected: number;
  pending: number;
  overdue: number;
  remaining: number;
  paymentCount: number;
};

export type CustomerProjectRow = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  totalPrice: number;
  collected: number;
  pending: number;
  overdue: number;
};

export type CustomerLeaseRow = {
  id: string;
  propertyId: string;
  label: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  monthlyRentAmount: number;
  depositType: string | null;
  depositAmount: number | null;
};

export type CustomerContactRow = {
  id: string;
  fullName: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  isPrimary: boolean;
  active: boolean;
  notes: string | null;
  /** Saved on this device, still on its way to the server. */
  waiting?: boolean;
};

export type CustomerBranchRow = { id: string; name: string; address: string | null; phone: string | null };

export type CustomerTag = { id: string; name: string; color?: string | null };

export type CustomerTaskItem = {
  id: string;
  subject: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assigned_user_name: string | null;
  has_open_reminder: boolean;
  is_private: boolean;
};

export type TaskUserOption = { id: string; label: string; color: string | null };

export type CustomerMoney = {
  totalSales: number;
  totalPaid: number;
  /** Still due on future-dated / uncleared payments (not yet collected). */
  totalExpected: number;
  totalOverdueExpected: number;
  openBalance: number;
  paidPct: number;
  /** Worst lateness across the receivables, its payment terms, the earliest due date. */
  maxDaysLate: number;
  terms: string | null;
  dueDate: string | null;
  lastOrderAt: string | null;
};

export type CustomerPaymentRow = {
  id: string;
  date: string | null;
  method: string | null;
  status: string;
  dueDate: string | null;
  checkNumber: string | null;
  /** When it was typed in (payments.created_at) — a real moment, unlike `date`. */
  createdAt: string | null;
  amount: number;
  source: { type: "order" | "project" | "property"; id: string; label: string } | null;
};

export type CustomerPaymentsResult = {
  /** Newest first, every one of them (the section shows the first few). */
  payments: CustomerPaymentRow[];
  /** Newest cleared payment — with the newest order, the page's "פעילות אחרונה". */
  lastPaymentAt: string | null;
  error: string | null;
};

export type CustomerDocumentItem = {
  id: string;
  name: string;
  fileName: string | null;
  type: string | null;
  uploadedAt: string | null;
  url: string | null;
  sourceType: "customer" | "order" | "project";
  sourceId: string;
  /** Saved on this device, still on its way to the server. */
  waiting?: boolean;
};

export type CustomerDocumentsResult = {
  /** Newest first — only the first few carry a signed link. */
  documents: CustomerDocumentItem[];
  total: number;
  error: string | null;
};

export type CustomerCollectionData = {
  logs: CommunicationLog[];
  reminders: Reminder[];
  receivables: CustomerReceivable[];
};

/** What the page's top waits for: the customer, its money, and the light reads that land with it. */
export type CustomerPageTop = {
  customer: CustomerProfile;
  orders: CustomerOrderRow[];
  projects: CustomerProjectRow[];
  leases: CustomerLeaseRow[];
  money: CustomerMoney;
  /** מאזן מול העסק — null when there's nothing on either side to state. */
  balance: CounterpartyBalance | null;
  linkedWorker: { id: string; name: string } | null;
  contacts: CustomerContactRow[];
  branches: CustomerBranchRow[];
  tags: CustomerTag[];
  morningDocuments: MorningLocalDocument[];
  tasks: CustomerTaskItem[];
  taskUsers: TaskUserOption[];
  collection: CustomerCollectionData;
  promises: PaymentPromise[];
  errors: { orders: string | null; projects: string | null };
};

export type CustomerHistory = { items: AuditFeedItem[]; error: string | null };

// ── money ────────────────────────────────────────────────────────────────────
// The page's figures, as they were: orders straight from order_overview_view
// (so they always match the orders list), projects by the COLLECTION SPLIT
// (collected = money actually in; expected = future-dated / uncleared), and
// the lateness from the receivables — the same source as the גבייה panel, so
// the two never disagree.

export function buildProjectRows(projects: Row[], financials: Row[], payments: Row[]): CustomerProjectRow[] {
  const financialByProjectId = new Map<string, Row>();
  for (const row of financials) {
    const projectId = str(row, "id");
    if (projectId) financialByProjectId.set(projectId, row);
  }
  const paymentsByProjectId = new Map<string, Row[]>();
  for (const row of payments) {
    const projectId = str(row, "project_id");
    if (!projectId) continue;
    const list = paymentsByProjectId.get(projectId) ?? [];
    list.push(row);
    paymentsByProjectId.set(projectId, list);
  }

  return projects.map((row) => {
    const projectId = str(row, "id");
    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = num(row.actual_price);
    const agreedBasePrice = num(row.agreed_base_price);
    const expensesBilled = num(financialRow?.expenses_billed);
    // Phase 2: gross up the base for price-includes-VAT projects.
    const vatMode = { priceIncludesVat: row.price_includes_vat === true, vatRate: row.vat_rate as number | null };
    const baseNet = actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0;
    const fallbackTotal = applyProjectVatToBase(baseNet, vatMode) + expensesBilled;
    const totalPrice = Math.max(num(financialRow?.customer_total_price), fallbackTotal);
    const split = splitPaymentAmounts(
      (paymentsByProjectId.get(projectId) ?? []).map((payment) => ({
        amount_total: num(payment.amount_total),
        // Raw (not num()): null must stay null so the split falls back to gross
        // for legacy rows; num() would coerce null → 0 and undercount.
        net_amount: payment.net_amount as number | string | null,
        payment_status: str(payment, "payment_status") || null,
        due_date: str(payment, "due_date") || null,
      }))
    );
    return {
      id: projectId,
      name: str(row, "name") || "פרויקט",
      status: str(row, "status"),
      startDate: str(row, "start_date") || null,
      totalPrice,
      collected: split.collected,
      pending: split.pending,
      overdue: split.overdue,
    };
  });
}

export function buildOrderRows(rows: Row[]): CustomerOrderRow[] {
  return rows.map((order) => ({
    id: str(order, "order_id"),
    date: str(order, "order_date") || null,
    status: str(order, "status"),
    total: num(order.total_amount),
    collected: num(order.collected_amount),
    pending: num(order.pending_amount),
    overdue: num(order.overdue_amount),
    remaining: num(order.remaining_balance),
    paymentCount: num(order.payment_count),
  }));
}

export function summarizeCustomerMoney({
  orders,
  projects,
  receivables,
}: {
  orders: CustomerOrderRow[];
  projects: CustomerProjectRow[];
  receivables: CustomerReceivable[];
}): CustomerMoney {
  let ordersSales = 0;
  let ordersCollected = 0;
  let ordersPending = 0;
  let ordersOverdue = 0;
  for (const order of orders) {
    ordersSales += order.total;
    ordersCollected += order.collected;
    ordersPending += order.pending;
    ordersOverdue += order.overdue;
  }
  const lastOrderAt = orders.reduce<string | null>((latest, order) => laterDate(latest, order.date), null);

  const projectsSales = projects.reduce((sum, project) => sum + project.totalPrice, 0);
  const projectsCollected = projects.reduce((sum, project) => sum + project.collected, 0);
  const projectsPending = projects.reduce((sum, project) => sum + project.pending, 0);
  const projectsOverdue = projects.reduce((sum, project) => sum + project.overdue, 0);

  const totalSales = ordersSales + projectsSales;
  const totalPaid = ordersCollected + projectsCollected;
  const totalExpected = ordersPending + projectsPending;
  const totalOverdueExpected = ordersOverdue + projectsOverdue;
  const openBalance = Math.max(totalSales - totalPaid, 0);

  let maxDaysLate = 0;
  let terms: string | null = null;
  let dueDate: string | null = null;
  for (const receivable of receivables) {
    if (receivable.days_late >= maxDaysLate) {
      maxDaysLate = receivable.days_late;
      terms = receivable.payment_terms ?? terms;
    }
    const due = receivable.due_date ?? receivable.next_due_date;
    if (due && (!dueDate || due < dueDate)) dueDate = due;
  }
  const paidPct = totalSales > 0 ? Math.min((totalPaid / totalSales) * 100, 100) : 0;

  return {
    totalSales,
    totalPaid,
    totalExpected,
    totalOverdueExpected,
    openBalance,
    paidPct,
    maxDaysLate,
    terms,
    dueDate,
    lastOrderAt,
  };
}

/** Newest cleared payment date (a pending or bounced one isn't activity yet). */
export function lastClearedPaymentAt(payments: CustomerPaymentRow[]): string | null {
  return payments.reduce<string | null>((latest, payment) => {
    const status = (payment.status || "cleared").toLowerCase();
    if (status === "pending" || status === "rejected") return latest;
    return laterDate(latest, payment.date);
  }, null);
}

/** Payments newest first; the id breaks a tie so the order never shuffles between loads. */
export function comparePaymentsNewestFirst(a: CustomerPaymentRow, b: CustomerPaymentRow) {
  const diff = rowDateValue(b.date) - rowDateValue(a.date);
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Documents newest first (undated last), the id breaking a tie. */
export function compareDocumentsNewestFirst(a: { uploadedAt: string | null; id: string }, b: { uploadedAt: string | null; id: string }) {
  if (a.uploadedAt && !b.uploadedAt) return -1;
  if (!a.uploadedAt && b.uploadedAt) return 1;
  const diff = rowDateValue(b.uploadedAt) - rowDateValue(a.uploadedAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// ── counted words ────────────────────────────────────────────────────────────

// Orders and projects are counted on the customers list too — one wording.
export { ordersHe, projectsHe };
export const leasesHe = (n: number) => pluralHe(n, { one: "חוזה שכירות אחד", two: "2 חוזי שכירות", many: "חוזי שכירות" });
export const morningDocumentsHe = (n: number) =>
  pluralHe(n, { one: "מסמך Morning אחד", two: "2 מסמכי Morning", many: "מסמכי Morning" });
export const paymentsHe = (n: number) => pluralHe(n, { one: "תשלום אחד", two: "2 תשלומים", many: "תשלומים" });

/** "א, ב ו-3 ג" — Hebrew's "and" sticks to the word, with a hyphen before a numeral. */
export function joinHebrewAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1]!;
  const and = /^\d/.test(last) ? `ו-${last}` : `ו${last}`;
  return `${parts.slice(0, -1).join(", ")} ${and}`;
}

// ── delete rules ─────────────────────────────────────────────────────────────
// The database refuses to delete a customer that orders, projects or leases
// point at (ON DELETE RESTRICT), and Morning documents (a plain foreign key).
// Contacts, branches, the call log and payment promises go with the customer;
// reminders, tasks and loans just lose the link (supabase/migrations: every
// foreign key on customers.id).

export type CustomerDeleteCounts = { orders: number; projects: number; leases: number; morningDocuments: number };

/** Why this customer can't be deleted ("יש ללקוח 6 הזמנות ו-2 פרויקטים"), or null when it can. */
export function customerDeleteBlocker(counts: CustomerDeleteCounts): string | null {
  const parts: string[] = [];
  if (counts.orders > 0) parts.push(ordersHe(counts.orders));
  if (counts.projects > 0) parts.push(projectsHe(counts.projects));
  if (counts.leases > 0) parts.push(leasesHe(counts.leases));
  if (counts.morningDocuments > 0) parts.push(morningDocumentsHe(counts.morningDocuments));
  return parts.length > 0 ? `יש ללקוח ${joinHebrewAnd(parts)}` : null;
}

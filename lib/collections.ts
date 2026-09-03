import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { getCollectionActivityByCustomer } from "@/lib/communications";
import { fetchLoans, overdueInstallments } from "@/lib/loans";

// Data for the גבייה (collections) worklist. Reads collections_view — one row per
// open receivable source (order / project) that still has money not yet collected
// — and aggregates it per customer so an office worker can see, at a glance, who
// owes money, how much is overdue, and when the next payment is due. Open loans the
// business GAVE OUT (direction 'given') are folded in as an extra source type, so a
// borrower who still owes us money shows up in the same חייבים worklist.

export type CollectionStatus =
  | "overpaid"
  | "collected"
  | "partial"
  | "awaiting"
  | "overdue"
  | "unpaid";

export type CollectionSourceRow = {
  source_type: "order" | "project" | "loan" | "property";
  source_id: string;
  collection_key: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  business_domain: string | null;
  reference_date: string | null;
  total_amount: number;
  collected_amount: number;
  pending_amount: number;
  overdue_amount: number;
  outstanding_amount: number;
  /** Money actually due NOW (outstanding minus the not-yet-due/future portion) —
   *  the figure the חייבים action list filters and displays on. Excludes future-
   *  scheduled installments (post-dated checks, next months' rent/loan payments,
   *  שוטף+N money not yet due) even though those are still part of outstanding_amount. */
  actionable_amount: number;
  next_due_date: string | null;
  last_payment_date: string | null;
  /** Effective due date from the order/project payment term (or manual override). */
  due_date: string | null;
  /** Payment term key (immediate/eom/eom_30/...). */
  payment_terms: string | null;
  collection_status: CollectionStatus;
  /** Whole days the late portion is overdue (0 if nothing is late). */
  days_late: number;
  /** Pending (future-dated / uncleared) payments on this source, for inline "סמן כנגבה". */
  pending_payments: ReceivablePendingPayment[];
  /** What the debt is for — project name, or a summary of the order's items. */
  title: string | null;
  /** Per-line item labels for orders (e.g. "מארז שי ×20"). Empty for projects. */
  items: string[];
};

/** Accounts-receivable aging buckets (amounts in ILS). */
export type AgingBuckets = {
  current: number; // שוטף — not yet late
  d30: number; // 1-30 days late
  d60: number; // 31-60
  d90: number; // 61-90
  d90plus: number; // 90+
};

export type CollectionCustomerGroup = {
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  outstanding_amount: number;
  pending_amount: number;
  overdue_amount: number;
  /** Sum of sources' actionable_amount — what this customer owes NOW, excluding
   *  not-yet-due future money. Drives the חייבים action list (who's in it, and
   *  the "total debt" figure shown). */
  actionable_amount: number;
  next_due_date: string | null;
  sources: CollectionSourceRow[];
  /** Worst status across this customer's sources, for sorting/coloring. */
  status: CollectionStatus;
  /** AR aging of this customer's outstanding money. */
  aging: AgingBuckets;
  /** Most-overdue days across this customer's sources (for sorting). */
  oldest_days_late: number;
  /** Enriched from communication_logs / reminders (Phase 2). */
  last_contact_at: string | null;
  next_reminder_at: string | null;
};

export type CollectionsData = {
  rows: CollectionSourceRow[];
  customers: CollectionCustomerGroup[];
  totals: {
    outstanding: number;
    pending: number;
    overdue: number;
    /** Sum of every customer's actionable_amount. */
    actionable: number;
    /** Count of customers with actionable_amount > 0 — who's actually in the
     *  action list, not everyone who has any debt (incl. purely-future). */
    customerCount: number;
  };
  loadError: string | null;
};

/** A single future-dated / uncleared payment that can be flipped to collected. */
export type ReceivablePendingPayment = {
  id: string;
  amount: number;
  due_date: string | null;
  payment_method: string | null;
  check_number: string | null;
  overdue: boolean;
};

/** One open receivable for a customer, with its pending payments — powers the
 *  "what is owed" section inside the מעקב גבייה dialog. */
export type CustomerReceivable = {
  source_type: "order" | "project" | "loan" | "property";
  source_id: string;
  collection_key: string;
  title: string | null;
  business_domain: string | null;
  reference_date: string | null;
  total_amount: number;
  collected_amount: number;
  outstanding_amount: number;
  pending_amount: number;
  overdue_amount: number;
  next_due_date: string | null;
  due_date: string | null;
  payment_terms: string | null;
  days_late: number;
  collection_status: CollectionStatus;
  pending_payments: ReceivablePendingPayment[];
};

type Row = Record<string, unknown>;

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

// Higher = more urgent. Used to pick a customer's worst status and to sort.
const STATUS_RANK: Record<CollectionStatus, number> = {
  overdue: 4,
  awaiting: 3,
  partial: 2,
  unpaid: 1,
  collected: 0,
  overpaid: 0, // not a collection target — overpayment is a data issue, not a debt
};

const MS_PER_DAY = 86_400_000;
function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((from - to) / MS_PER_DAY);
}

export function emptyAging(): AgingBuckets {
  return { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
}

export function agingBucket(daysLate: number): keyof AgingBuckets {
  if (daysLate <= 0) return "current";
  if (daysLate <= 30) return "d30";
  if (daysLate <= 60) return "d60";
  if (daysLate <= 90) return "d90";
  return "d90plus";
}

export type SourceCollectionComputed = {
  expected: number; // future-scheduled pending (צפוי)
  late: number; // overdue total — pending past due + unscheduled money on a past-dated source
  daysLate: number;
  status: CollectionStatus;
};

/**
 * Late-payment rule: outstanding money with no future-dated payment, on a source
 * whose DUE DATE has already passed, counts as a LATE payment (overdue) — not
 * merely "unpaid". The due date comes from the order's payment terms (`dueDate`);
 * when absent it falls back to the reference date (= מיידי). Pending payments past
 * their own due_date are late too.
 *
 * "Expected" (צפוי) is money not yet due: a registered future-dated payment (e.g. a
 * post-dated check) OR unscheduled money on a genuinely FUTURE due date (שוטף+30/60
 * — a later date the customer agreed to). Money due NOW (מיידי / due today) is not
 * "expected": with nothing registered it reads unpaid until a payment is recorded.
 */
export function computeSourceCollection(p: {
  total: number;
  collected: number;
  pending: number;
  overdue: number;
  outstanding: number;
  nextDueDate: string | null;
  referenceDate: string | null;
  /** Effective due date from payment terms; falls back to referenceDate (מיידי). */
  dueDate?: string | null;
  /** Open orders aren't "late" — payment isn't forced until delivery/closing. */
  blockOverdue?: boolean;
  today: string;
}): SourceCollectionComputed {
  const futureScheduled = Math.max(p.pending - p.overdue, 0);
  const unscheduled = Math.max(p.outstanding - p.pending, 0);
  const refDay = p.referenceDate ? p.referenceDate.slice(0, 10) : null;
  const dueDay = p.dueDate ? p.dueDate.slice(0, 10) : refDay;
  const duePast = !!dueDay && dueDay < p.today;
  const dueFuture = !!dueDay && dueDay > p.today;
  const late = p.blockOverdue ? 0 : p.overdue + (duePast ? unscheduled : 0);
  // Expected (צפוי) = registered future-dated payments, PLUS unscheduled money on a
  // genuinely FUTURE due date (e.g. שוטף+60 — a later date the customer agreed to).
  // Money due NOW — מיידי terms or anything due today — is NOT "expected": with
  // nothing registered it reads unpaid until a payment is actually recorded.
  const expected = futureScheduled + (dueFuture ? unscheduled : 0);

  let daysLate = 0;
  if (late > 0.009) {
    const pendingDueDay =
      p.nextDueDate && p.nextDueDate.slice(0, 10) < p.today ? p.nextDueDate.slice(0, 10) : null;
    // Anchor the day-count on the earliest (most overdue) relevant past due date.
    const candidates = [duePast ? dueDay : null, pendingDueDay].filter(
      (x): x is string => Boolean(x)
    );
    const ageDay = candidates.sort()[0] ?? null;
    if (ageDay) daysLate = Math.max(daysBetweenIso(p.today, ageDay), 0);
  }

  let status: CollectionStatus;
  if (p.total > 0 && p.collected > p.total + 0.009) status = "overpaid";
  else if (p.total > 0 && p.collected + 0.009 >= p.total) status = "collected";
  else if (late > 0.009) status = "overdue";
  else if (p.collected > 0.009) status = "partial";
  else if (expected > 0.009) status = "awaiting";
  else status = "unpaid";

  return { expected, late, daysLate, status };
}

export type SourceTermInfo = {
  dueDate: string | null;
  paymentTerms: string | null;
  status: string | null;
};

const CLOSED_ORDER_STATUSES = new Set([
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
]);

/** An order is "open" (products not yet delivered/closed) — payment isn't forced,
 *  so it should never show as overdue. */
export function isOpenOrderStatus(status: string | null | undefined): boolean {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  return s.length > 0 && !CLOSED_ORDER_STATUSES.has(s);
}

async function fetchTermInfo(
  supabase: SupabaseClient,
  table: "orders" | "projects",
  ids: string[]
): Promise<Map<string, SourceTermInfo>> {
  const map = new Map<string, SourceTermInfo>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await supabase.from(table).select("id,due_date,payment_terms,status").in("id", unique);
  for (const row of (data ?? []) as Row[]) {
    const id = str(row, "id");
    if (id) {
      map.set(id, {
        dueDate: str(row, "due_date"),
        paymentTerms: str(row, "payment_terms"),
        status: str(row, "status"),
      });
    }
  }
  return map;
}

/** Effective due date + payment term per order, keyed by order id. */
export function fetchOrderDueDates(supabase: SupabaseClient, orderIds: string[]) {
  return fetchTermInfo(supabase, "orders", orderIds);
}

/** Effective due date + payment term per project, keyed by project id. */
export function fetchProjectDueDates(supabase: SupabaseClient, projectIds: string[]) {
  return fetchTermInfo(supabase, "projects", projectIds);
}

// Attach a human-readable "what for" to each row: project name for projects,
// ordered-item labels for orders. Best-effort — never throws.
async function enrichCollectionTitles(
  supabase: SupabaseClient,
  rows: CollectionSourceRow[]
): Promise<void> {
  const orderIds = Array.from(
    new Set(rows.filter((r) => r.source_type === "order").map((r) => r.source_id).filter(Boolean))
  );
  const projectIds = Array.from(
    new Set(rows.filter((r) => r.source_type === "project").map((r) => r.source_id).filter(Boolean))
  );

  const projectNameById = new Map<string, string>();
  const itemsByOrderId = new Map<string, string[]>();

  try {
    if (projectIds.length > 0) {
      const { data } = await supabase.from("projects").select("id,name").in("id", projectIds);
      for (const row of (data ?? []) as Row[]) {
        const id = str(row, "id");
        if (id) projectNameById.set(id, str(row, "name") ?? "");
      }
    }

    if (orderIds.length > 0) {
      const itemRows = await fetchAllPaged<Row>((lo, hi) =>
        supabase
          .from("order_items")
          .select("order_id,product_id,quantity_ordered,notes")
          .in("order_id", orderIds)
          .range(lo, hi)
      );

      const productIds = Array.from(
        new Set(itemRows.map((r) => str(r, "product_id")).filter((v): v is string => Boolean(v)))
      );
      const productNameById = new Map<string, string>();
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("id,name")
          .in("id", productIds);
        for (const row of (products ?? []) as Row[]) {
          const id = str(row, "id");
          if (id) productNameById.set(id, str(row, "name") ?? "");
        }
      }

      for (const item of itemRows) {
        const oid = str(item, "order_id");
        if (!oid) continue;
        const pid = str(item, "product_id");
        const name = (pid ? productNameById.get(pid) : null) || str(item, "notes") || "פריט";
        const qty = toNum(item.quantity_ordered);
        const list = itemsByOrderId.get(oid) ?? [];
        list.push(qty > 0 ? `${name} ×${qty}` : name);
        itemsByOrderId.set(oid, list);
      }
    }
  } catch {
    // tables/columns missing — leave titles null
    return;
  }

  for (const row of rows) {
    if (row.source_type === "project") {
      const name = projectNameById.get(row.source_id);
      row.title = name && name.trim() ? name.trim() : null;
    } else {
      const list = itemsByOrderId.get(row.source_id) ?? [];
      row.items = list;
      row.title = list.length > 0 ? list.join(", ") : null;
    }
  }
}

/**
 * Open loans the business GAVE OUT (direction 'given') that still have an
 * outstanding balance, shaped as collection sources so they fold into the חייבים
 * worklist. A loan with no due date never reads as "overdue" (referenceDate is
 * left null); past its due date the outstanding becomes the late amount, exactly
 * like an order/project. Best-effort — returns [] if loans are unavailable.
 */
async function buildLoanSourceRows(
  supabase: SupabaseClient,
  today: string
): Promise<CollectionSourceRow[]> {
  const loans = await fetchLoans(supabase);
  const open = loans.filter(
    (loan) => loan.direction === "given" && loan.derivedStatus !== "written_off" && loan.outstanding > 0.009
  );
  if (open.length === 0) return [];

  // Pull name/phone for loans linked to a customer so the row carries contact info.
  const customerIds = Array.from(
    new Set(open.map((l) => l.counterparty_customer_id).filter((v): v is string => Boolean(v)))
  );
  const customerById = new Map<string, { name: string; phone: string | null }>();
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone")
      .in("id", customerIds);
    for (const row of (data ?? []) as Row[]) {
      const id = str(row, "id");
      if (!id) continue;
      customerById.set(id, {
        name: str(row, "name") ?? str(row, "name_for_invoice") ?? "",
        phone: str(row, "phone"),
      });
    }
  }

  return open.map((loan) => {
    const cust = loan.counterparty_customer_id ? customerById.get(loan.counterparty_customer_id) : null;
    const name = cust?.name || loan.borrower || "הלוואה";
    // Installment-aware, same rule as rent: a planned installment already past its
    // due date is overdue; the rest of the plan (plus any un-planned remainder,
    // via the loan's own due_date) is expected/future — not "due now". Before
    // this, a loan repaid via a monthly installment plan compared its ENTIRE
    // outstanding balance against one loan-level due_date, so months of
    // not-yet-due installments could all read as overdue (or vice versa).
    const overdueList = overdueInstallments(loan, today);
    const overdueAmount = overdueList.reduce(
      (sum, r) => sum + Math.max(r.amount - r.interest_amount, 0),
      0
    );
    const sm = computeSourceCollection({
      total: loan.amount,
      collected: loan.repaidPrincipal,
      pending: loan.scheduledPrincipal,
      overdue: overdueAmount,
      outstanding: loan.outstanding,
      nextDueDate: overdueList[0]?.repayment_date ?? loan.due_date,
      // No reference-date fallback for loans — an undated, unscheduled loan isn't
      // automatically late.
      referenceDate: null,
      dueDate: loan.due_date,
      today,
    });
    return {
      source_type: "loan",
      source_id: loan.id,
      collection_key: `loan:${loan.id}`,
      customer_id: loan.counterparty_customer_id,
      customer_name: name,
      customer_phone: cust?.phone ?? null,
      customer_whatsapp: null,
      business_domain: loan.business_domain,
      reference_date: loan.loan_date,
      total_amount: loan.amount,
      collected_amount: loan.repaidPrincipal,
      pending_amount: sm.expected,
      overdue_amount: sm.late,
      outstanding_amount: loan.outstanding,
      actionable_amount: Math.max(loan.outstanding - sm.expected, 0),
      next_due_date: loan.due_date,
      last_payment_date: null,
      due_date: loan.due_date,
      payment_terms: null,
      collection_status: sm.status,
      days_late: sm.daysLate,
      pending_payments: [],
      title: loan.notes ?? null,
      items: [],
    };
  });
}

type RentLeaseCandidate = {
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
};

/** Same "which lease is current" rule as lib/properties.ts's pickCurrentLease,
 *  reimplemented locally on raw rows to avoid pulling in that module's full
 *  normalization/type surface for a handful of fields. */
function pickCurrentLeaseCandidate(candidates: RentLeaseCandidate[], today: string): RentLeaseCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  return sorted.find((l) => l.status === "active" && (!l.endDate || l.endDate >= today)) ?? sorted[0];
}

/**
 * Pending/overdue rent (property_management payments, pre-scheduled per-lease
 * checks) folded into the חייבים worklist as one row per property — coarse,
 * like loans (no per-check inline "mark collected" here; that lives on the
 * property's own page). Best-effort — returns [] if nothing owed or on error.
 */
async function buildRentSourceRows(supabase: SupabaseClient, today: string): Promise<CollectionSourceRow[]> {
  const { data: paymentRows } = await supabase
    .from("payments")
    .select("property_id,amount_total,due_date,payment_status")
    .eq("business_domain", "property_management")
    .not("property_id", "is", null);
  const rows = (paymentRows ?? []) as Row[];
  if (rows.length === 0) return [];

  type Agg = { collected: number; pending: number; overdue: number; nextDueDate: string | null };
  const byProperty = new Map<string, Agg>();
  for (const row of rows) {
    const propertyId = str(row, "property_id");
    if (!propertyId) continue;
    const agg = byProperty.get(propertyId) ?? { collected: 0, pending: 0, overdue: 0, nextDueDate: null };
    const amount = toNum(row.amount_total);
    const status = str(row, "payment_status");
    const dueDate = str(row, "due_date");
    if (status === "cleared") {
      agg.collected += amount;
    } else if (status === "pending") {
      if (dueDate && dueDate.slice(0, 10) < today) agg.overdue += amount;
      else agg.pending += amount;
      if (dueDate && (!agg.nextDueDate || dueDate < agg.nextDueDate)) agg.nextDueDate = dueDate;
    }
    byProperty.set(propertyId, agg);
  }

  const propertyIds = Array.from(byProperty.keys());
  if (propertyIds.length === 0) return [];

  const [{ data: propertyRows }, { data: leaseRows }] = await Promise.all([
    supabase.from("properties").select("id,name,address").in("id", propertyIds),
    supabase
      .from("lease_agreements")
      .select("property_id,customer_id,start_date,end_date,status,customer:customers(name,phone)")
      .in("property_id", propertyIds),
  ]);

  const addressByProperty = new Map<string, string>();
  for (const row of (propertyRows ?? []) as Row[]) {
    const id = str(row, "id");
    if (id) addressByProperty.set(id, str(row, "name") ?? str(row, "address") ?? "נכס");
  }

  const leasesByProperty = new Map<string, RentLeaseCandidate[]>();
  for (const row of (leaseRows ?? []) as Row[]) {
    const propertyId = str(row, "property_id");
    if (!propertyId) continue;
    const customer = (row.customer ?? {}) as Row | Row[];
    const customerRow = Array.isArray(customer) ? customer[0] : customer;
    const list = leasesByProperty.get(propertyId) ?? [];
    list.push({
      customerId: str(row, "customer_id"),
      customerName: customerRow ? str(customerRow, "name") : null,
      customerPhone: customerRow ? str(customerRow, "phone") : null,
      startDate: str(row, "start_date"),
      endDate: str(row, "end_date"),
      status: str(row, "status"),
    });
    leasesByProperty.set(propertyId, list);
  }

  const out: CollectionSourceRow[] = [];
  for (const [propertyId, agg] of byProperty) {
    const outstanding = agg.pending + agg.overdue;
    if (outstanding <= 0.009) continue;
    const total = agg.collected + outstanding;
    const lease = pickCurrentLeaseCandidate(leasesByProperty.get(propertyId) ?? [], today);
    const sm = computeSourceCollection({
      total,
      collected: agg.collected,
      pending: outstanding,
      overdue: agg.overdue,
      outstanding,
      nextDueDate: agg.nextDueDate,
      referenceDate: null,
      dueDate: agg.nextDueDate,
      today,
    });
    out.push({
      source_type: "property",
      source_id: propertyId,
      collection_key: `property:${propertyId}`,
      customer_id: lease?.customerId ?? null,
      customer_name: lease?.customerName || "שוכר",
      customer_phone: lease?.customerPhone ?? null,
      customer_whatsapp: null,
      business_domain: "property_management",
      reference_date: lease?.startDate ?? null,
      total_amount: total,
      collected_amount: agg.collected,
      pending_amount: sm.expected,
      overdue_amount: sm.late,
      outstanding_amount: outstanding,
      actionable_amount: Math.max(outstanding - sm.expected, 0),
      next_due_date: agg.nextDueDate,
      last_payment_date: null,
      due_date: agg.nextDueDate,
      payment_terms: null,
      collection_status: sm.status,
      days_late: sm.daysLate,
      pending_payments: [],
      title: addressByProperty.get(propertyId) ?? "נכס",
      items: [],
    });
  }
  return out;
}

export async function getCollectionsData(supabase: SupabaseClient): Promise<CollectionsData> {
  let rawRows: Row[];
  try {
    rawRows = await fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("collections_view")
        .select(
          "source_type,source_id,collection_key,customer_id,customer_name,customer_phone,customer_whatsapp,business_domain,reference_date,total_amount,collected_amount,pending_amount,overdue_amount,outstanding_amount,next_due_date,last_payment_date,collection_status"
        )
        .order("overdue_amount", { ascending: false })
        .range(lo, hi)
    );
  } catch (error) {
    return {
      rows: [],
      customers: [],
      totals: { outstanding: 0, pending: 0, overdue: 0, actionable: 0, customerCount: 0 },
      loadError: error instanceof Error ? error.message : "load failed",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  // Per-source effective due dates (from payment terms / override) drive the late calc.
  const [orderDueById, projectDueById] = await Promise.all([
    fetchOrderDueDates(
      supabase,
      rawRows.filter((r) => str(r, "source_type") !== "project").map((r) => str(r, "source_id") ?? "")
    ),
    fetchProjectDueDates(
      supabase,
      rawRows.filter((r) => str(r, "source_type") === "project").map((r) => str(r, "source_id") ?? "")
    ),
  ]);
  const rows: CollectionSourceRow[] = rawRows.map((row) => {
    const total = toNum(row.total_amount);
    const collected = toNum(row.collected_amount);
    const pending = toNum(row.pending_amount);
    const overdue = toNum(row.overdue_amount);
    const outstanding = toNum(row.outstanding_amount);
    const referenceDate = str(row, "reference_date");
    const nextDueDate = str(row, "next_due_date");
    const sourceType = str(row, "source_type") === "project" ? "project" : "order";
    const sourceId = str(row, "source_id") ?? "";
    const term = sourceType === "order" ? orderDueById.get(sourceId) : projectDueById.get(sourceId);
    const dueDate = term?.dueDate ?? null;
    const paymentTerms = term?.paymentTerms ?? null;
    const sm = computeSourceCollection({
      total,
      collected,
      pending,
      overdue,
      outstanding,
      nextDueDate,
      referenceDate,
      dueDate,
      blockOverdue: sourceType === "order" && isOpenOrderStatus(term?.status),
      today,
    });
    return {
      source_type: sourceType,
      source_id: sourceId,
      collection_key: str(row, "collection_key") ?? "",
      customer_id: str(row, "customer_id"),
      customer_name: str(row, "customer_name") ?? "לקוח",
      customer_phone: str(row, "customer_phone"),
      customer_whatsapp: str(row, "customer_whatsapp"),
      business_domain: str(row, "business_domain"),
      reference_date: referenceDate,
      total_amount: total,
      collected_amount: collected,
      // pending_amount = future-scheduled only (צפוי); overdue_amount = late total.
      pending_amount: sm.expected,
      overdue_amount: sm.late,
      outstanding_amount: outstanding,
      actionable_amount: Math.max(outstanding - sm.expected, 0),
      next_due_date: nextDueDate,
      last_payment_date: str(row, "last_payment_date"),
      due_date: dueDate,
      payment_terms: paymentTerms,
      collection_status: sm.status,
      days_late: sm.daysLate,
      pending_payments: [],
      title: null,
      items: [],
    };
  });

  // Enrich each source with WHAT the debt is for — so a caller has talking points.
  // Projects → project name; orders → list of ordered items ("מוצר ×כמות").
  await enrichCollectionTitles(supabase, rows);
  // Attach pending payments so each open debt can be marked collected inline.
  await attachPendingPayments(supabase, rows);

  // Fold in open loans we gave out (money still owed to us). Added after the
  // order/project enrichment so their titles aren't overwritten. Best-effort.
  const loanRows = await buildLoanSourceRows(supabase, today).catch(() => [] as CollectionSourceRow[]);
  if (loanRows.length > 0) rows.push(...loanRows);

  // Fold in pending/overdue rent (pre-scheduled per-lease checks). Best-effort.
  const rentRows = await buildRentSourceRows(supabase, today).catch(() => [] as CollectionSourceRow[]);
  if (rentRows.length > 0) rows.push(...rentRows);

  // Group by customer
  const groupMap = new Map<string, CollectionCustomerGroup>();
  for (const row of rows) {
    const key = row.customer_id ?? `__noid__${row.customer_name}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        customer_whatsapp: row.customer_whatsapp,
        outstanding_amount: 0,
        pending_amount: 0,
        overdue_amount: 0,
        actionable_amount: 0,
        next_due_date: null,
        sources: [],
        status: row.collection_status,
        aging: emptyAging(),
        oldest_days_late: 0,
        last_contact_at: null,
        next_reminder_at: null,
      };
      groupMap.set(key, group);
    }
    group.outstanding_amount += row.outstanding_amount;
    group.pending_amount += row.pending_amount;
    group.overdue_amount += row.overdue_amount;
    group.actionable_amount += row.actionable_amount;
    group.sources.push(row);
    if (row.next_due_date && (!group.next_due_date || row.next_due_date < group.next_due_date)) {
      group.next_due_date = row.next_due_date;
    }
    if (STATUS_RANK[row.collection_status] > STATUS_RANK[group.status]) {
      group.status = row.collection_status;
    }
    // Aging: the late portion (overdue_amount) goes to its day bucket; the rest
    // of the outstanding (future-scheduled / not-yet-late) is "current".
    group.aging.current += Math.max(row.outstanding_amount - row.overdue_amount, 0);
    group.aging[agingBucket(row.days_late)] += row.overdue_amount;
    if (row.days_late > group.oldest_days_late) group.oldest_days_late = row.days_late;
  }

  const customers = Array.from(groupMap.values()).sort((a, b) => {
    const rank = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    if (rank !== 0) return rank;
    return b.outstanding_amount - a.outstanding_amount;
  });

  // Enrich with last-contact / next-reminder (best-effort — ignore if the
  // communication_center tables don't exist yet).
  try {
    const customerIds = customers
      .map((c) => c.customer_id)
      .filter((id): id is string => Boolean(id));
    const activity = await getCollectionActivityByCustomer(supabase, customerIds);
    for (const group of customers) {
      if (!group.customer_id) continue;
      const a = activity.get(group.customer_id);
      if (a) {
        group.last_contact_at = a.lastContactAt;
        group.next_reminder_at = a.nextReminderAt;
      }
    }
  } catch {
    // tables not migrated yet — leave enrichment null
  }

  const totals = customers.reduce(
    (acc, group) => {
      acc.outstanding += group.outstanding_amount;
      acc.pending += group.pending_amount;
      acc.overdue += group.overdue_amount;
      acc.actionable += group.actionable_amount;
      return acc;
    },
    {
      outstanding: 0,
      pending: 0,
      overdue: 0,
      actionable: 0,
      // Who's actually in the action list — not everyone who has any debt,
      // including customers whose whole balance is future/not-yet-due.
      customerCount: customers.filter((c) => c.actionable_amount > 0.009).length,
    }
  );

  return { rows, customers, totals, loadError: null };
}

/**
 * Open receivables for a single customer, each with its pending (future-dated /
 * uncleared) payments so the caller can mark money as collected straight from
 * the מעקב גבייה dialog. Best-effort — returns [] if the view is missing.
 */
export async function getCustomerReceivables(
  supabase: SupabaseClient,
  customerId: string
): Promise<CustomerReceivable[]> {
  const { data, error } = await supabase
    .from("collections_view")
    .select(
      "source_type,source_id,collection_key,business_domain,reference_date,total_amount,collected_amount,pending_amount,overdue_amount,outstanding_amount,next_due_date,collection_status"
    )
    .eq("customer_id", customerId)
    .order("overdue_amount", { ascending: false });

  if (error || !data) return [];

  // Reuse the title-enrichment helper (project name / order item summary) by
  // shaping minimal CollectionSourceRow objects.
  const today = new Date().toISOString().slice(0, 10);
  const rawRows = data as Row[];
  const [orderDueById, projectDueById] = await Promise.all([
    fetchOrderDueDates(
      supabase,
      rawRows.filter((r) => str(r, "source_type") !== "project").map((r) => str(r, "source_id") ?? "")
    ),
    fetchProjectDueDates(
      supabase,
      rawRows.filter((r) => str(r, "source_type") === "project").map((r) => str(r, "source_id") ?? "")
    ),
  ]);
  const sourceRows: CollectionSourceRow[] = rawRows.map((row) => {
    const total = toNum(row.total_amount);
    const collected = toNum(row.collected_amount);
    const pending = toNum(row.pending_amount);
    const overdue = toNum(row.overdue_amount);
    const outstanding = toNum(row.outstanding_amount);
    const referenceDate = str(row, "reference_date");
    const nextDueDate = str(row, "next_due_date");
    const sourceType = str(row, "source_type") === "project" ? "project" : "order";
    const sourceId = str(row, "source_id") ?? "";
    const term = sourceType === "order" ? orderDueById.get(sourceId) : projectDueById.get(sourceId);
    const dueDate = term?.dueDate ?? null;
    const paymentTerms = term?.paymentTerms ?? null;
    const sm = computeSourceCollection({
      total,
      collected,
      pending,
      overdue,
      outstanding,
      nextDueDate,
      referenceDate,
      dueDate,
      blockOverdue: sourceType === "order" && isOpenOrderStatus(term?.status),
      today,
    });
    return {
      source_type: sourceType,
      source_id: sourceId,
      collection_key: str(row, "collection_key") ?? "",
      customer_id: customerId,
      customer_name: "",
      customer_phone: null,
      customer_whatsapp: null,
      business_domain: str(row, "business_domain"),
      reference_date: referenceDate,
      total_amount: total,
      collected_amount: collected,
      pending_amount: sm.expected,
      overdue_amount: sm.late,
      outstanding_amount: outstanding,
      actionable_amount: Math.max(outstanding - sm.expected, 0),
      next_due_date: nextDueDate,
      last_payment_date: null,
      due_date: dueDate,
      payment_terms: paymentTerms,
      collection_status: sm.status,
      days_late: sm.daysLate,
      pending_payments: [],
      title: null,
      items: [],
    };
  });

  await enrichCollectionTitles(supabase, sourceRows);

  // Pull the pending payments for every source so each can be marked collected.
  await attachPendingPayments(supabase, sourceRows);

  // Fold in this customer's open given-loans (added after enrichment so their
  // titles/pending-payments aren't overwritten). Best-effort.
  const loanRows = (await buildLoanSourceRows(supabase, today).catch(() => [] as CollectionSourceRow[]))
    .filter((r) => r.customer_id === customerId);
  if (loanRows.length > 0) sourceRows.push(...loanRows);

  const rentRows = (await buildRentSourceRows(supabase, today).catch(() => [] as CollectionSourceRow[]))
    .filter((r) => r.customer_id === customerId);
  if (rentRows.length > 0) sourceRows.push(...rentRows);

  return sourceRows.map((r) => ({
    source_type: r.source_type,
    source_id: r.source_id,
    collection_key: r.collection_key,
    title: r.title,
    business_domain: r.business_domain,
    reference_date: r.reference_date,
    total_amount: r.total_amount,
    collected_amount: r.collected_amount,
    outstanding_amount: r.outstanding_amount,
    pending_amount: r.pending_amount,
    overdue_amount: r.overdue_amount,
    next_due_date: r.next_due_date,
    due_date: r.due_date,
    payment_terms: r.payment_terms,
    days_late: r.days_late,
    collection_status: r.collection_status,
    pending_payments: r.pending_payments,
  }));
}

/**
 * Fetches the pending (future-dated / uncleared) payments for each source and
 * attaches them as `pending_payments`, so a row can be marked collected inline.
 */
async function attachPendingPayments(
  supabase: SupabaseClient,
  rows: CollectionSourceRow[]
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const orderIds = rows.filter((r) => r.source_type === "order").map((r) => r.source_id).filter(Boolean);
  const projectIds = rows.filter((r) => r.source_type === "project").map((r) => r.source_id).filter(Boolean);
  const byKey = new Map<string, ReceivablePendingPayment[]>();

  const collect = (prows: Row[], prefix: "order" | "project", idKey: string) => {
    for (const row of prows) {
      const sourceId = str(row, idKey);
      const id = str(row, "id");
      if (!sourceId || !id) continue;
      const key = `${prefix}:${sourceId}`;
      const due = str(row, "due_date");
      const list = byKey.get(key) ?? [];
      list.push({
        id,
        amount: toNum(row.amount_total),
        due_date: due,
        payment_method: str(row, "payment_method"),
        check_number: str(row, "check_number"),
        overdue: Boolean(due && due.slice(0, 10) <= today),
      });
      byKey.set(key, list);
    }
  };

  await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("payments")
          .select("id,amount_total,due_date,payment_method,check_number,order_id")
          .eq("payment_status", "pending")
          .in("order_id", orderIds)
          .then(({ data }) => collect((data ?? []) as Row[], "order", "order_id"))
      : Promise.resolve(),
    projectIds.length > 0
      ? supabase
          .from("payments")
          .select("id,amount_total,due_date,payment_method,check_number,project_id")
          .eq("payment_status", "pending")
          .in("project_id", projectIds)
          .then(({ data }) => collect((data ?? []) as Row[], "project", "project_id"))
      : Promise.resolve(),
  ]);

  for (const r of rows) {
    r.pending_payments = (byKey.get(r.collection_key) ?? []).sort((a, b) =>
      (a.due_date ?? "").localeCompare(b.due_date ?? "")
    );
  }
}

export type PaymentDueToday = {
  id: string;
  amount: number;
  due_date: string | null;
  payment_method: string | null;
  check_number: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  source_type: "order" | "project" | null;
  source_id: string | null;
};

/**
 * Pending payments whose due_date is today — money you should be collecting now.
 * Resolves each payment's customer through its order / project. Best-effort.
 */
export async function getPaymentsDueToday(
  supabase: SupabaseClient,
  todayIso?: string
): Promise<PaymentDueToday[]> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount_total,due_date,payment_method,check_number,order_id,project_id")
    .eq("payment_status", "pending")
    .eq("due_date", today);

  if (error || !data) return [];
  const rows = data as Row[];
  if (rows.length === 0) return [];

  const orderIds = Array.from(
    new Set(rows.map((r) => str(r, "order_id")).filter((v): v is string => Boolean(v)))
  );
  const projectIds = Array.from(
    new Set(rows.map((r) => str(r, "project_id")).filter((v): v is string => Boolean(v)))
  );

  const customerByOrder = new Map<string, string>();
  const customerByProject = new Map<string, string>();
  await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select("id,customer_id")
          .in("id", orderIds)
          .then(({ data: o }) => {
            for (const row of (o ?? []) as Row[]) {
              const id = str(row, "id");
              const cid = str(row, "customer_id");
              if (id && cid) customerByOrder.set(id, cid);
            }
          })
      : Promise.resolve(),
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id,customer_id")
          .in("id", projectIds)
          .then(({ data: p }) => {
            for (const row of (p ?? []) as Row[]) {
              const id = str(row, "id");
              const cid = str(row, "customer_id");
              if (id && cid) customerByProject.set(id, cid);
            }
          })
      : Promise.resolve(),
  ]);

  const customerIds = Array.from(
    new Set([...customerByOrder.values(), ...customerByProject.values()])
  );
  const customerById = new Map<string, { name: string; phone: string | null }>();
  if (customerIds.length > 0) {
    const { data: c } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone")
      .in("id", customerIds);
    for (const row of (c ?? []) as Row[]) {
      const id = str(row, "id");
      if (!id) continue;
      customerById.set(id, {
        name: str(row, "name") ?? str(row, "name_for_invoice") ?? "לקוח",
        phone: str(row, "phone"),
      });
    }
  }

  return rows.map((row) => {
    const orderId = str(row, "order_id");
    const projectId = str(row, "project_id");
    const customerId = orderId
      ? customerByOrder.get(orderId) ?? null
      : projectId
        ? customerByProject.get(projectId) ?? null
        : null;
    const cust = customerId ? customerById.get(customerId) : null;
    return {
      id: str(row, "id") ?? "",
      amount: toNum(row.amount_total),
      due_date: str(row, "due_date"),
      payment_method: str(row, "payment_method"),
      check_number: str(row, "check_number"),
      customer_id: customerId,
      customer_name: cust?.name ?? "לקוח",
      customer_phone: cust?.phone ?? null,
      source_type: orderId ? "order" : projectId ? "project" : null,
      source_id: orderId ?? projectId ?? null,
    };
  });
}

// ── The dashboard's גבייה card ───────────────────────────────────────────────

/** One customer's overdue debt, as the board's card lists it. */
export type CollectionsDebtor = {
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerWhatsapp: string | null;
  /** Sum across this customer's sources. */
  amount: number;
  /** Worst days-late across them; 0 when the date isn't knowable. */
  daysLate: number;
  /** How many separate debts are behind the number. */
  sources: number;
};

export type CollectionsSummary = {
  /** Dated payments landing TODAY — the only rows with a one-click action. */
  today: PaymentDueToday[];
  todayTotal: number;
  /** Money already past its date, worst first. */
  late: CollectionsDebtor[];
  lateCount: number;
  lateTotal: number;
  /** Dated money still to come — the quiet half of the switch. */
  upcoming: CollectionsDebtor[];
  upcomingCount: number;
  upcomingTotal: number;
};

/** Whole days between two ISO dates, or 0 when either is missing/unparseable. */
function daysBetween(fromIso: string | null, toIso: string): number {
  if (!fromIso) return 0;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * The גבייה card's data, in ONE query.
 *
 * Deliberately NOT getCollectionsData(): that walks every open receivable, pages
 * through the whole view and then resolves each source's payment term to an
 * effective due date — the right thing for the /collections worklist, far too
 * much for a card showing five rows. This reads only the sources that actually
 * have money late or dated, caps them, and groups by customer.
 *
 * The trade: days-late here comes from the view's `next_due_date` rather than
 * from the payment term, so a source whose term moved the date can read a few
 * days off. The card sorts by it and prints it as "45 יום"; the page is where
 * you go for the exact figure.
 */
export async function getCollectionsSummary(
  supabase: SupabaseClient,
  todayIso?: string,
  { limit = 200 }: { limit?: number } = {}
): Promise<CollectionsSummary> {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const empty: CollectionsSummary = {
    today: [],
    todayTotal: 0,
    late: [],
    lateCount: 0,
    lateTotal: 0,
    upcoming: [],
    upcomingCount: 0,
    upcomingTotal: 0,
  };

  const [dueToday, sourcesResult] = await Promise.all([
    getPaymentsDueToday(supabase, today).catch(() => [] as PaymentDueToday[]),
    supabase
      .from("collections_view")
      .select(
        "source_id,customer_id,customer_name,customer_phone,customer_whatsapp,overdue_amount,pending_amount,outstanding_amount,next_due_date"
      )
      .or("overdue_amount.gt.0.009,pending_amount.gt.0.009")
      .order("overdue_amount", { ascending: false })
      .range(0, limit - 1),
  ]);

  if (sourcesResult.error) return { ...empty, today: dueToday, todayTotal: sum(dueToday) };

  // Group by customer: one row per person to chase, not per invoice.
  const lateBy = new Map<string, CollectionsDebtor>();
  const soonBy = new Map<string, CollectionsDebtor>();

  for (const row of (sourcesResult.data ?? []) as Row[]) {
    const overdue = toNum(row.overdue_amount);
    const pending = toNum(row.pending_amount);
    const customerId = str(row, "customer_id");
    const key = customerId ?? str(row, "customer_name") ?? str(row, "source_id") ?? "";
    if (!key) continue;

    const into = overdue > 0.009 ? lateBy : pending > 0.009 ? soonBy : null;
    if (!into) continue;

    const existing = into.get(key);
    const debtor: CollectionsDebtor = existing ?? {
      customerId,
      customerName: str(row, "customer_name") ?? "לקוח",
      customerPhone: str(row, "customer_phone"),
      customerWhatsapp: str(row, "customer_whatsapp"),
      amount: 0,
      daysLate: 0,
      sources: 0,
    };
    debtor.amount += overdue > 0.009 ? overdue : pending;
    debtor.sources += 1;
    if (overdue > 0.009) {
      debtor.daysLate = Math.max(debtor.daysLate, daysBetween(str(row, "next_due_date"), today));
    }
    into.set(key, debtor);
  }

  // Worst first on both sides: the oldest debt is the one that stops being
  // collectable, and the nearest expected payment is the one to watch.
  const late = [...lateBy.values()].sort((a, b) => b.daysLate - a.daysLate || b.amount - a.amount);
  const upcoming = [...soonBy.values()].sort((a, b) => b.amount - a.amount);

  return {
    today: dueToday,
    todayTotal: sum(dueToday),
    late,
    lateCount: late.length,
    lateTotal: late.reduce((total, d) => total + d.amount, 0),
    upcoming,
    upcomingCount: upcoming.length,
    upcomingTotal: upcoming.reduce((total, d) => total + d.amount, 0),
  };
}

function sum(payments: PaymentDueToday[]): number {
  return payments.reduce((total, p) => total + p.amount, 0);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCollectionActivityByCustomer } from "@/lib/communications";

// Data for the גבייה (collections) worklist. Reads collections_view — one row per
// open receivable source (order / project) that still has money not yet collected
// — and aggregates it per customer so an office worker can see, at a glance, who
// owes money, how much is overdue, and when the next payment is due.

export type CollectionStatus = "collected" | "partial" | "awaiting" | "overdue" | "unpaid";

export type CollectionSourceRow = {
  source_type: "order" | "project";
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
  source_type: "order" | "project";
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
  if (p.total > 0 && p.collected + 0.009 >= p.total) status = "collected";
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
      const { data: items } = await supabase
        .from("order_items")
        .select("order_id,product_id,quantity_ordered,notes")
        .in("order_id", orderIds)
        .range(0, 4999);
      const itemRows = (items ?? []) as Row[];

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

export async function getCollectionsData(supabase: SupabaseClient): Promise<CollectionsData> {
  const { data, error } = await supabase
    .from("collections_view")
    .select(
      "source_type,source_id,collection_key,customer_id,customer_name,customer_phone,customer_whatsapp,business_domain,reference_date,total_amount,collected_amount,pending_amount,overdue_amount,outstanding_amount,next_due_date,last_payment_date,collection_status"
    )
    .order("overdue_amount", { ascending: false })
    .range(0, 999);

  if (error) {
    return {
      rows: [],
      customers: [],
      totals: { outstanding: 0, pending: 0, overdue: 0, customerCount: 0 },
      loadError: error.message,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const rawRows = (data ?? []) as Row[];
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
      return acc;
    },
    { outstanding: 0, pending: 0, overdue: 0, customerCount: customers.length }
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

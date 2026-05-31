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
  collection_status: CollectionStatus;
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

function normalizeStatus(value: string | null): CollectionStatus {
  switch (value) {
    case "collected":
    case "partial":
    case "awaiting":
    case "overdue":
      return value;
    default:
      return "unpaid";
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

  const rows: CollectionSourceRow[] = ((data ?? []) as Row[]).map((row) => ({
    source_type: str(row, "source_type") === "project" ? "project" : "order",
    source_id: str(row, "source_id") ?? "",
    collection_key: str(row, "collection_key") ?? "",
    customer_id: str(row, "customer_id"),
    customer_name: str(row, "customer_name") ?? "לקוח",
    customer_phone: str(row, "customer_phone"),
    customer_whatsapp: str(row, "customer_whatsapp"),
    business_domain: str(row, "business_domain"),
    reference_date: str(row, "reference_date"),
    total_amount: toNum(row.total_amount),
    collected_amount: toNum(row.collected_amount),
    pending_amount: toNum(row.pending_amount),
    overdue_amount: toNum(row.overdue_amount),
    outstanding_amount: toNum(row.outstanding_amount),
    next_due_date: str(row, "next_due_date"),
    last_payment_date: str(row, "last_payment_date"),
    collection_status: normalizeStatus(str(row, "collection_status")),
  }));

  // Group by customer
  const groupMap = new Map<string, CollectionCustomerGroup>();
  for (const row of rows) {
    const key = row.customer_id ?? `__noid__${row.customer_name}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.outstanding_amount += row.outstanding_amount;
      existing.pending_amount += row.pending_amount;
      existing.overdue_amount += row.overdue_amount;
      existing.sources.push(row);
      if (
        row.next_due_date &&
        (!existing.next_due_date || row.next_due_date < existing.next_due_date)
      ) {
        existing.next_due_date = row.next_due_date;
      }
      if (STATUS_RANK[row.collection_status] > STATUS_RANK[existing.status]) {
        existing.status = row.collection_status;
      }
    } else {
      groupMap.set(key, {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        customer_whatsapp: row.customer_whatsapp,
        outstanding_amount: row.outstanding_amount,
        pending_amount: row.pending_amount,
        overdue_amount: row.overdue_amount,
        next_due_date: row.next_due_date,
        sources: [row],
        status: row.collection_status,
        last_contact_at: null,
        next_reminder_at: null,
      });
    }
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

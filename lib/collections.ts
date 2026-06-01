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
  /** What the debt is for — project name, or a summary of the order's items. */
  title: string | null;
  /** Per-line item labels for orders (e.g. "מארז שי ×20"). Empty for projects. */
  items: string[];
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
    title: null,
    items: [],
  }));

  // Enrich each source with WHAT the debt is for — so a caller has talking points.
  // Projects → project name; orders → list of ordered items ("מוצר ×כמות").
  await enrichCollectionTitles(supabase, rows);

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

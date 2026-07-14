import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";

// ════════════════════════════════════════════════════════════════════════════
// Customer analytics for Reports → לקוחות: who's most valuable, and who's gone
// quiet. Everything is read from customer_overview_view (already de-duped across
// orders + projects), so the figures match the customer directory.
//
// The loader returns EVERY customer who did business (has orders/projects/sales),
// each enriched with its segment tags, plus the distinct tag list. The panel does
// the top/inactive ranking AND the tag filtering client-side, so filtering by a
// tag ranks within that segment (e.g. "top wholesale") rather than filtering an
// already-sliced top-N.
// ════════════════════════════════════════════════════════════════════════════

const OVERVIEW_SELECT =
  "customer_id,customer_name,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,active";

export type CustomerTag = { id: string; name: string };

export type CustomerRankingRow = {
  customerId: string;
  name: string;
  phone: string | null;
  ordersCount: number;
  projectsCount: number;
  totalSales: number;
  totalPaid: number;
  openBalance: number;
  lastActivityAt: string | null; // max(last_order_at, last_payment_at)
  active: boolean;
  tags: CustomerTag[];
};

export type CustomerRankingReport = {
  /** Every business-doing customer, enriched with tags. Panel ranks/filters this. */
  rows: CustomerRankingRow[];
  /** Distinct segment tags in use across the returned rows (for the filter). */
  allTags: CustomerTag[];
  inactiveDays: number;
  inactiveCutoff: string; // YYYY-MM-DD
  totalCustomers: number;
  activeCustomers: number; // did business at least once
};

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v ? v : null;
}
function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** The later of two nullable ISO dates (null-safe). */
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export async function loadCustomerRanking(
  supabase: SupabaseClient,
  opts?: { inactiveDays?: number }
): Promise<CustomerRankingReport> {
  const inactiveDays = opts?.inactiveDays ?? 90;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
  const inactiveCutoff = cutoffDate.toISOString().slice(0, 10);

  const [rawRows, tagLinks] = await Promise.all([
    fetchAllPaged<Row>((from, to) =>
      supabase.from("customer_overview_view").select(OVERVIEW_SELECT).range(from, to)
    ).catch(() => [] as Row[]),
    // Segment tags attached to customers, resolved to {id,name} in one join.
    fetchAllPaged<Row>((from, to) =>
      supabase
        .from("entity_tags")
        .select("entity_id,tag:tags(id,name)")
        .eq("entity_type", "customer")
        .range(from, to)
    ).catch(() => [] as Row[]),
  ]);

  // Build customerId → tags[] from the entity_tags join.
  const tagsByCustomer = new Map<string, CustomerTag[]>();
  for (const link of tagLinks) {
    const customerId = str(link, "entity_id");
    const tag = (link as { tag?: { id?: string; name?: string } }).tag;
    if (!customerId || !tag?.id || !tag?.name) continue;
    const list = tagsByCustomer.get(customerId) ?? [];
    list.push({ id: tag.id, name: tag.name });
    tagsByCustomer.set(customerId, list);
  }

  const allRows: CustomerRankingRow[] = rawRows
    .map((r) => {
      const customerId = str(r, "customer_id") ?? "";
      const lastActivityAt = laterDate(str(r, "last_order_at"), str(r, "last_payment_at"));
      return {
        customerId,
        name: str(r, "customer_name") ?? "לקוח",
        phone: str(r, "phone"),
        ordersCount: num(r, "orders_count"),
        projectsCount: num(r, "projects_count"),
        totalSales: num(r, "total_sales"),
        totalPaid: num(r, "total_paid"),
        openBalance: num(r, "open_balance"),
        lastActivityAt,
        active: r.active !== false,
        tags: tagsByCustomer.get(customerId) ?? [],
      };
    })
    .filter((r) => r.customerId);

  // A customer "did business" if they have any order/project or booked sales.
  const didBusiness = (r: CustomerRankingRow) =>
    r.ordersCount > 0 || r.projectsCount > 0 || r.totalSales > 0;

  const rows = allRows.filter(didBusiness);

  // Distinct tags across the returned (business-doing) rows, sorted by name.
  const tagById = new Map<string, CustomerTag>();
  for (const r of rows) for (const t of r.tags) if (!tagById.has(t.id)) tagById.set(t.id, t);
  const allTags = [...tagById.values()].sort((a, b) => a.name.localeCompare(b.name, "he"));

  return {
    rows,
    allTags,
    inactiveDays,
    inactiveCutoff,
    totalCustomers: allRows.length,
    activeCustomers: rows.length,
  };
}

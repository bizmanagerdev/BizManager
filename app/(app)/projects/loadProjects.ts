import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSourceCollection } from "@/lib/collections";
import { findMatchingCustomers } from "@/lib/search/findMatchingCustomers";

type Row = Record<string, unknown>;

export type ProjectsView = "projects" | "quotes" | "closed";
export type ProjectsSort = "recent" | "start_date" | "start_date_desc" | "profit_desc";

export type ProjectsFilters = {
  view: ProjectsView;
  status: string;
  customerId: string | null;
  sort: ProjectsSort;
  q: string;
};

export const PROJECTS_PAGE_SIZE = 50;
const CLOSED_STATUSES = ["quote", "completed"];

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type ProjectsPageResult = {
  rows: Row[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

/**
 * Load one page of the projects list (enriched with settings, financials and a
 * term-aware collection status). Shared by the initial server render (page 1)
 * and the fetch-on-scroll server action (page >= 2).
 */
export async function loadProjectsPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: ProjectsFilters }
): Promise<ProjectsPageResult> {
  const { view, status: statusFilter, customerId, sort, q: searchQuery } = filters;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * PROJECTS_PAGE_SIZE;
  const to = safePage * PROJECTS_PAGE_SIZE - 1;

  let query = supabase
    .from("project_dashboard_view")
    .select(
      "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks",
      { count: "estimated" }
    );

  if (view === "quotes") {
    query = query.eq("status", "quote");
  } else if (view === "closed") {
    query = query.eq("status", "completed");
  } else {
    query = query.not("status", "in", `(${CLOSED_STATUSES.join(",")})`);
  }

  if (statusFilter !== "all") query = query.eq("status", statusFilter);
  if (customerId) query = query.eq("customer_id", customerId);
  if (searchQuery) {
    const escaped = searchQuery.replace(/[%,]/g, " ");
    // Match the project name directly; match the customer through the shared
    // matcher (fuzzy names, phone↔whatsapp cross-match) by customer id.
    const { customerIds } = await findMatchingCustomers(supabase, searchQuery, { limit: 300, idsOnly: true });
    const conditions = [`name.ilike.%${escaped}%`, `customer_name.ilike.%${escaped}%`];
    if (customerIds.length > 0) {
      conditions.push(`customer_id.in.(${customerIds.join(",")})`);
    }
    query = query.or(conditions.join(","));
  }

  if (sort === "profit_desc") {
    query = query.order("gross_profit", { ascending: false, nullsFirst: false });
  } else if (sort === "start_date_desc") {
    query = query.order("start_date", { ascending: false, nullsFirst: false });
  } else if (sort === "start_date") {
    query = query.order("start_date", { ascending: true, nullsFirst: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);

  const rows = (data ?? []) as Row[];
  const projectIds = rows
    .map((row) => (typeof row?.id === "string" ? row.id : ""))
    .filter(Boolean);

  const [{ data: projectSettingsRows }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("projects").select("id,expenses_billed_separately,payment_terms,due_date").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const [{ data: financialRows }] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("project_financials_view")
          .select("id,total_expenses,gross_profit,customer_total_price,expenses_billed,collected_amount,pending_amount,overdue_amount,outstanding_amount,next_due_date")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const expensesSeparatelyByProjectId = new Map<string, boolean>();
  const paymentTermsByProjectId = new Map<string, string | null>();
  const dueDateByProjectId = new Map<string, string | null>();
  ((projectSettingsRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    if (!projectId) return;
    expensesSeparatelyByProjectId.set(projectId, row?.expenses_billed_separately === true);
    paymentTermsByProjectId.set(projectId, typeof row?.payment_terms === "string" ? row.payment_terms : null);
    dueDateByProjectId.set(projectId, typeof row?.due_date === "string" ? row.due_date.slice(0, 10) : null);
  });

  const financialByProjectId = new Map<string, Row>();
  ((financialRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    if (!projectId) return;
    financialByProjectId.set(projectId, row);
  });

  const rowsWithPaymentStatus = rows.map((row) => {
    const projectId = typeof row?.id === "string" ? row.id : "";
    const financialRow = financialByProjectId.get(projectId) ?? null;
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const totalExpenses =
      toNumber(financialRow?.total_expenses) ?? toNumber(row?.total_expenses) ?? 0;
    const grossProfit =
      toNumber(financialRow?.gross_profit) ?? toNumber(row?.gross_profit) ?? null;
    const expensesBilled = toNumber(financialRow?.expenses_billed) ?? 0;
    const baseProjectPrice = agreedBasePrice ?? actualPrice ?? 0;
    const derivedCustomerTotalPrice = baseProjectPrice + expensesBilled;
    const customerTotalPrice =
      derivedCustomerTotalPrice > 0
        ? derivedCustomerTotalPrice
        : toNumber(financialRow?.customer_total_price) ?? 0;
    const paidTotal = toNumber(financialRow?.collected_amount) ?? 0;
    const expensesBilledSeparately = expensesSeparatelyByProjectId.get(projectId) ?? false;
    const amountDue = customerTotalPrice;
    const priceUnset = baseProjectPrice <= 0;

    const paymentStatus =
      priceUnset
        ? "unpriced"
        : amountDue <= 0 || paidTotal >= amountDue
        ? "paid"
        : paidTotal > 0
          ? "partial"
          : "unpaid";

    return {
      ...row,
      total_expenses: totalExpenses,
      gross_profit: grossProfit,
      customer_total_price: customerTotalPrice,
      // The view's effective price (מחיר בפועל = GREATEST(base+billed add-ons, received)),
      // matching what the project details page shows. Used for the list's price column;
      // the derived customer_total_price above stays the base for payment/collection math.
      effective_customer_price: toNumber(financialRow?.customer_total_price),
      expenses_billed_separately: expensesBilledSeparately,
      paid_total: paidTotal,
      amount_due: amountDue,
      payment_status_list: paymentStatus,
      payment_terms: paymentTermsByProjectId.get(projectId) ?? null,
      due_date: dueDateByProjectId.get(projectId) ?? null,
      // Term-aware collection status (תשלום צפוי / באיחור …) for the status badge.
      collection_status: priceUnset
        ? "unpriced"
        : computeSourceCollection({
            total: customerTotalPrice,
            collected: paidTotal,
            pending: toNumber(financialRow?.pending_amount) ?? 0,
            overdue: toNumber(financialRow?.overdue_amount) ?? 0,
            outstanding:
              toNumber(financialRow?.outstanding_amount) ?? Math.max(customerTotalPrice - paidTotal, 0),
            nextDueDate: typeof financialRow?.next_due_date === "string" ? financialRow.next_due_date : null,
            referenceDate: typeof row?.start_date === "string" ? row.start_date : null,
            dueDate: dueDateByProjectId.get(projectId) ?? null,
            today: new Date().toISOString().slice(0, 10),
          }).status,
    };
  });

  const totalCount = typeof count === "number" ? count : rows.length;
  // Drive "has more" off page fullness, not the estimated count (estimates for a
  // view can be wildly off, which would either stall the scroll or loop).
  const hasMore = rows.length === PROJECTS_PAGE_SIZE;

  return { rows: rowsWithPaymentStatus, totalCount, hasMore, error: error?.message ?? null };
}

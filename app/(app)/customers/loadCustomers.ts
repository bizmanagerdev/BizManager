import type { SupabaseClient } from "@supabase/supabase-js";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { applyProjectVatToBase } from "@/lib/projects/vat";
import { withLinkColumn } from "@/lib/customers/workerLink";

type Row = Record<string, unknown>;

export type CustomerFilterMode = "all" | "yes" | "no";

export type CustomersFilters = {
  withProjects: CustomerFilterMode;
  withOrders: CustomerFilterMode;
  withDebt: CustomerFilterMode;
  activeOnly: CustomerFilterMode;
};

export const CUSTOMERS_PAGE_SIZE = 50;

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowId(row: Row) {
  const customerId = typeof row?.customer_id === "string" ? row.customer_id : null;
  if (customerId && customerId.trim()) return customerId.trim();
  const id = typeof row?.id === "string" ? row.id : null;
  if (id && id.trim()) return id.trim();
  return "";
}

export type CustomersPageResult = {
  rows: Row[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

const OVERVIEW_SELECT =
  "customer_id,customer_name,email,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,address,active,notes,name_for_invoice,registration_number";

/**
 * Enrich customer_overview_view rows with contacts, Morning data and money
 * totals computed from the same sources the detail pages use:
 * - order money from order_overview_view (falls back to items-derived totals
 *   when orders.total_amount is 0)
 * - project money from project_financials_view + the collection split on
 *   payments (collected vs pending), so a future-dated check never counts as paid.
 * The view's own total_sales/total_paid already include projects, so we never
 * add on top of them — we replace them with the recomputed figures.
 */
async function enrichCustomerOverviewRows(
  supabase: SupabaseClient,
  overviewRows: Row[]
): Promise<{ rows: Row[]; error: string | null }> {
  const customerIds = overviewRows.map((row) => rowId(row)).filter(Boolean);

  const [
    { data: customerRows, error: customerRowsError },
    { data: morningDocumentRows, error: morningDocumentsError },
    { data: projectRows, error: projectRowsError },
    { data: orderRows, error: orderRowsError },
    { data: contactRows, error: contactsError },
  ] = customerIds.length
    ? await Promise.all([
        withLinkColumn<Row[]>(
          "id,whatsapp,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error,requires_prepayment",
          (select) => supabase.from("customers").select(select).in("id", customerIds)
        ),
        supabase
          .from("morning_documents")
          .select(
            "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
          )
          .in("customer_id", customerIds)
          .order("issued_at", { ascending: false }),
        supabase
          .from("projects")
          .select("id,customer_id,agreed_base_price,actual_price,price_includes_vat,vat_rate")
          .in("customer_id", customerIds),
        supabase
          .from("order_overview_view")
          .select("order_id,customer_id,total_amount,collected_amount,pending_amount")
          .in("customer_id", customerIds),
        supabase
          .from("contacts")
          .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
          .in("customer_id", customerIds)
          .order("is_primary", { ascending: false })
          .order("full_name", { ascending: true }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  const projectIds = ((projectRows ?? []) as Row[])
    .map((row) => (typeof row?.id === "string" ? row.id : ""))
    .filter(Boolean);

  const [{ data: projectFinancialRows, error: projectFinancialError }, { data: projectPaymentRows, error: projectPaymentError }] =
    projectIds.length
      ? await Promise.all([
          supabase
            .from("project_financials_view")
            .select("id,customer_total_price,expenses_billed")
            .in("id", projectIds),
          supabase
            .from("payments")
            .select("project_id,amount_total,net_amount,payment_date,payment_status,due_date")
            .in("project_id", projectIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  const customerById = new Map<string, Row>();
  ((customerRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    customerById.set(id, row);
  });

  const morningDocumentsByCustomerId = new Map<string, Row[]>();
  ((morningDocumentRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const list = morningDocumentsByCustomerId.get(customerId) ?? [];
    list.push(row);
    morningDocumentsByCustomerId.set(customerId, list);
  });

  // Order money aggregated per customer from the per-order overview rows.
  const orderTotalsByCustomerId = new Map<
    string,
    { totalSales: number; totalPaid: number; expected: number }
  >();
  ((orderRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const current = orderTotalsByCustomerId.get(customerId) ?? {
      totalSales: 0,
      totalPaid: 0,
      expected: 0,
    };
    orderTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + toNumber(row?.total_amount),
      totalPaid: current.totalPaid + toNumber(row?.collected_amount),
      expected: current.expected + toNumber(row?.pending_amount),
    });
  });

  const financialByProjectId = new Map<string, Row>();
  ((projectFinancialRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    financialByProjectId.set(id, row);
  });

  const projectPaymentsByProjectId = new Map<string, Row[]>();
  const projectLastPaymentByProjectId = new Map<string, string>();
  ((projectPaymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.project_id === "string" ? row.project_id.trim() : "";
    if (!projectId) return;
    const list = projectPaymentsByProjectId.get(projectId) ?? [];
    list.push(row);
    projectPaymentsByProjectId.set(projectId, list);
    const status = typeof row?.payment_status === "string" ? row.payment_status.toLowerCase() : "";
    if (status === "pending" || status === "rejected") return;
    const paymentDate = typeof row?.payment_date === "string" ? row.payment_date.trim() : "";
    if (!paymentDate) return;
    const current = projectLastPaymentByProjectId.get(projectId) ?? "";
    if (!current || paymentDate > current) {
      projectLastPaymentByProjectId.set(projectId, paymentDate);
    }
  });

  const projectTotalsByCustomerId = new Map<
    string,
    { totalSales: number; totalPaid: number; expected: number; lastPaymentAt: string | null }
  >();
  ((projectRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    const projectId = typeof row?.id === "string" ? row.id.trim() : "";
    if (!customerId || !projectId) return;

    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const expensesBilled = toNumber(financialRow?.expenses_billed);
    // Phase 2: gross up the base for price-includes-VAT projects.
    const vatMode = { priceIncludesVat: row?.price_includes_vat === true, vatRate: row?.vat_rate as number | null };
    const baseNet = actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0;
    const fallbackTotal = applyProjectVatToBase(baseNet, vatMode) + expensesBilled;
    const customerTotalPrice = Math.max(
      toNumber(financialRow?.customer_total_price),
      fallbackTotal
    );
    const split = splitPaymentAmounts(
      (projectPaymentsByProjectId.get(projectId) ?? []).map((payment) => ({
        amount_total: toNumber(payment?.amount_total),
        // Raw (not toNumber): null must stay null so the split falls back to
        // gross for legacy rows; toNumber would coerce null → 0 and undercount.
        net_amount: payment?.net_amount as number | string | null,
        payment_status: typeof payment?.payment_status === "string" ? payment.payment_status : null,
        due_date: typeof payment?.due_date === "string" ? payment.due_date : null,
      }))
    );
    const lastPaymentAt = projectLastPaymentByProjectId.get(projectId) ?? null;

    const current = projectTotalsByCustomerId.get(customerId) ?? {
      totalSales: 0,
      totalPaid: 0,
      expected: 0,
      lastPaymentAt: null,
    };

    const nextLastPaymentAt =
      lastPaymentAt && (!current.lastPaymentAt || toDateValue(lastPaymentAt) > toDateValue(current.lastPaymentAt))
        ? lastPaymentAt
        : current.lastPaymentAt;

    projectTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + customerTotalPrice,
      totalPaid: current.totalPaid + split.collected,
      expected: current.expected + split.pending,
      lastPaymentAt: nextLastPaymentAt,
    });
  });

  const contactsByCustomerId = new Map<string, Row[]>();
  ((contactRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const list = contactsByCustomerId.get(customerId) ?? [];
    list.push(row);
    contactsByCustomerId.set(customerId, list);
  });

  const rows = overviewRows.map((row) => {
    const id = rowId(row);
    const customer = customerById.get(id);
    const orderTotals = orderTotalsByCustomerId.get(id);
    const projectTotals = projectTotalsByCustomerId.get(id);
    const totalSales = (orderTotals?.totalSales ?? 0) + (projectTotals?.totalSales ?? 0);
    const totalPaid = (orderTotals?.totalPaid ?? 0) + (projectTotals?.totalPaid ?? 0);
    const expectedAmount = (orderTotals?.expected ?? 0) + (projectTotals?.expected ?? 0);
    const overviewLastPaymentAt = typeof row?.last_payment_at === "string" ? row.last_payment_at : null;
    const projectLastPaymentAt = projectTotals?.lastPaymentAt ?? null;
    const lastPaymentAt =
      projectLastPaymentAt && (!overviewLastPaymentAt || toDateValue(projectLastPaymentAt) > toDateValue(overviewLastPaymentAt))
        ? projectLastPaymentAt
        : overviewLastPaymentAt;

    return {
      ...row,
      total_sales: totalSales,
      total_paid: totalPaid,
      expected_amount: expectedAmount,
      open_balance: Math.max(totalSales - totalPaid, 0),
      last_payment_at: lastPaymentAt,
      whatsapp: typeof customer?.whatsapp === "string" ? customer.whatsapp : null,
      morning_client_id: typeof customer?.morning_client_id === "string" ? customer.morning_client_id : null,
      morning_synced_at: typeof customer?.morning_synced_at === "string" ? customer.morning_synced_at : null,
      morning_match_status:
        typeof customer?.morning_match_status === "string" ? customer.morning_match_status : null,
      morning_last_sync_error:
        typeof customer?.morning_last_sync_error === "string" ? customer.morning_last_sync_error : null,
      requires_prepayment: customer?.requires_prepayment === true,
      linked_user_id: typeof customer?.linked_user_id === "string" ? customer.linked_user_id : null,
      morning_documents: morningDocumentsByCustomerId.get(id) ?? [],
      contacts: contactsByCustomerId.get(id) ?? [],
    };
  });

  const error =
    contactsError?.message ??
    customerRowsError?.message ??
    morningDocumentsError?.message ??
    projectRowsError?.message ??
    orderRowsError?.message ??
    projectFinancialError?.message ??
    projectPaymentError?.message ??
    null;

  return { rows, error };
}

/**
 * Load one page of the customers list, enriched with contacts, Morning
 * documents and recomputed money totals. Shared by the initial server render
 * (page 1) and the fetch-on-scroll server action (page >= 2).
 */
export async function loadCustomersPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: CustomersFilters }
): Promise<CustomersPageResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * CUSTOMERS_PAGE_SIZE;
  const to = safePage * CUSTOMERS_PAGE_SIZE - 1;

  let overviewQuery = supabase
    .from("customer_overview_view")
    .select(OVERVIEW_SELECT, { count: "estimated" })
    .order("customer_name", { ascending: true });

  if (filters.withProjects === "yes") overviewQuery = overviewQuery.gt("projects_count", 0);
  if (filters.withProjects === "no") overviewQuery = overviewQuery.lte("projects_count", 0);
  if (filters.withOrders === "yes") overviewQuery = overviewQuery.gt("orders_count", 0);
  if (filters.withOrders === "no") overviewQuery = overviewQuery.lte("orders_count", 0);
  if (filters.withDebt === "yes") overviewQuery = overviewQuery.gt("open_balance", 0);
  if (filters.withDebt === "no") overviewQuery = overviewQuery.lte("open_balance", 0);
  if (filters.activeOnly === "yes") overviewQuery = overviewQuery.eq("active", true);
  if (filters.activeOnly === "no") overviewQuery = overviewQuery.eq("active", false);

  const { data: overviewRows, error: overviewError, count } = await overviewQuery.range(from, to);

  const { rows, error: enrichError } = await enrichCustomerOverviewRows(
    supabase,
    (overviewRows ?? []) as Row[]
  );

  const error = overviewError?.message ?? enrichError ?? null;
  const totalCount = typeof count === "number" ? count : rows.length;
  // Drive "has more" off page fullness, not the estimated count — the estimate
  // for a view can be wildly off, which would either stall the scroll or loop.
  const hasMore = rows.length === CUSTOMERS_PAGE_SIZE;

  return { rows, totalCount, hasMore, error };
}

/** A lightweight customer row for the in-memory client search index. */
export type CustomerSearchIndexEntry = {
  id: string;
  name: string;
  name_for_invoice: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  requires_prepayment: boolean;
  contacts: Array<{ full_name: string; phone: string | null; email: string | null; whatsapp: string | null }>;
};

const SEARCH_INDEX_CUSTOMER_CAP = 10000;
const SEARCH_INDEX_CONTACT_CAP = 20000;

/**
 * Load EVERY customer (lightweight, with contacts) for the client-side search
 * index. Fetched once per session and searched in memory so customer
 * type-ahead is instant instead of a network round-trip per keystroke.
 */
export async function loadCustomerSearchIndexRows(
  supabase: SupabaseClient
): Promise<CustomerSearchIndexEntry[]> {
  const [{ data: customerRows }, { data: contactRows }] = await Promise.all([
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,whatsapp,email,address,active,requires_prepayment")
      .order("name", { ascending: true })
      .range(0, SEARCH_INDEX_CUSTOMER_CAP - 1),
    supabase
      .from("contacts")
      .select("customer_id,full_name,phone,email,whatsapp")
      .eq("active", true)
      .range(0, SEARCH_INDEX_CONTACT_CAP - 1),
  ]);

  const contactsByCustomer = new Map<string, CustomerSearchIndexEntry["contacts"]>();
  for (const contact of (contactRows ?? []) as Row[]) {
    const customerId = typeof contact?.customer_id === "string" ? contact.customer_id : "";
    if (!customerId) continue;
    const list = contactsByCustomer.get(customerId) ?? [];
    list.push({
      full_name: typeof contact?.full_name === "string" ? contact.full_name : "",
      phone: (contact?.phone as string | null) ?? null,
      email: (contact?.email as string | null) ?? null,
      whatsapp: (contact?.whatsapp as string | null) ?? null,
    });
    contactsByCustomer.set(customerId, list);
  }

  return ((customerRows ?? []) as Row[]).map((row) => {
    const id = typeof row?.id === "string" ? row.id : "";
    return {
      id,
      name: typeof row?.name === "string" ? row.name : "",
      name_for_invoice: (row?.name_for_invoice as string | null) ?? null,
      phone: (row?.phone as string | null) ?? null,
      whatsapp: (row?.whatsapp as string | null) ?? null,
      email: (row?.email as string | null) ?? null,
      address: (row?.address as string | null) ?? null,
      active: row?.active !== false,
      requires_prepayment: row?.requires_prepayment === true,
      contacts: contactsByCustomer.get(id) ?? [],
    };
  });
}

/**
 * Load fully-enriched list rows for a specific set of customers (used by the
 * client search so results carry real counts and totals instead of zeros).
 */
export async function loadCustomersByIds(
  supabase: SupabaseClient,
  customerIds: string[]
): Promise<{ rows: Row[]; error: string | null }> {
  const ids = Array.from(new Set(customerIds.filter((value) => value && value.trim())));
  if (ids.length === 0) return { rows: [], error: null };

  const { data: overviewRows, error: overviewError } = await supabase
    .from("customer_overview_view")
    .select(OVERVIEW_SELECT)
    .in("customer_id", ids)
    .order("customer_name", { ascending: true });

  const { rows, error: enrichError } = await enrichCustomerOverviewRows(
    supabase,
    (overviewRows ?? []) as Row[]
  );

  return { rows, error: overviewError?.message ?? enrichError ?? null };
}

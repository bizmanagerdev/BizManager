import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Load one page of the customers list, enriched with contacts, Morning
 * documents and project financials. Shared by the initial server render
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
    .select(
      "customer_id,customer_name,email,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,address,active,notes,name_for_invoice,registration_number",
      { count: "estimated" }
    )
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

  const customerIds = ((overviewRows ?? []) as Row[])
    .map((row) => rowId(row))
    .filter(Boolean);

  const { data: customerRows, error: customerRowsError } = customerIds.length
    ? await supabase
      .from("customers")
      .select(
          "id,whatsapp,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error,requires_prepayment"
        )
        .in("id", customerIds)
    : { data: [], error: null };

  const { data: morningDocumentRows, error: morningDocumentsError } = customerIds.length
    ? await supabase
        .from("morning_documents")
        .select(
          "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
        )
        .in("customer_id", customerIds)
        .order("issued_at", { ascending: false })
    : { data: [], error: null };

  const { data: projectRows, error: projectRowsError } = customerIds.length
    ? await supabase
        .from("projects")
        .select("id,customer_id,agreed_base_price,actual_price")
        .in("customer_id", customerIds)
    : { data: [], error: null };

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
            .select("project_id,amount_total,payment_date")
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

  const financialByProjectId = new Map<string, Row>();
  ((projectFinancialRows ?? []) as Row[]).forEach((row) => {
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    if (!id) return;
    financialByProjectId.set(id, row);
  });

  const projectPaidTotalsByProjectId = new Map<string, number>();
  const projectLastPaymentByProjectId = new Map<string, string>();
  ((projectPaymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = typeof row?.project_id === "string" ? row.project_id.trim() : "";
    if (!projectId) return;
    const amount = toNumber(row?.amount_total);
    projectPaidTotalsByProjectId.set(projectId, (projectPaidTotalsByProjectId.get(projectId) ?? 0) + amount);
    const paymentDate = typeof row?.payment_date === "string" ? row.payment_date.trim() : "";
    if (!paymentDate) return;
    const current = projectLastPaymentByProjectId.get(projectId) ?? "";
    if (!current || paymentDate > current) {
      projectLastPaymentByProjectId.set(projectId, paymentDate);
    }
  });

  const projectTotalsByCustomerId = new Map<string, { totalSales: number; totalPaid: number; lastPaymentAt: string | null }>();
  ((projectRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    const projectId = typeof row?.id === "string" ? row.id.trim() : "";
    if (!customerId || !projectId) return;

    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const expensesBilled = toNumber(financialRow?.expenses_billed);
    const fallbackTotal =
      (actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0) + expensesBilled;
    const customerTotalPrice = Math.max(
      toNumber(financialRow?.customer_total_price),
      fallbackTotal
    );
    const paidTotal = projectPaidTotalsByProjectId.get(projectId) ?? 0;
    const lastPaymentAt = projectLastPaymentByProjectId.get(projectId) ?? null;

    const current = projectTotalsByCustomerId.get(customerId) ?? {
      totalSales: 0,
      totalPaid: 0,
      lastPaymentAt: null,
    };

    const nextLastPaymentAt =
      lastPaymentAt && (!current.lastPaymentAt || toDateValue(lastPaymentAt) > toDateValue(current.lastPaymentAt))
        ? lastPaymentAt
        : current.lastPaymentAt;

    projectTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + customerTotalPrice,
      totalPaid: current.totalPaid + paidTotal,
      lastPaymentAt: nextLastPaymentAt,
    });
  });

  const { data: contactRows, error: contactsError } = customerIds.length
    ? await supabase
        .from("contacts")
        .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
        .in("customer_id", customerIds)
        .order("is_primary", { ascending: false })
        .order("full_name", { ascending: true })
    : { data: [], error: null };

  const contactsByCustomerId = new Map<string, Row[]>();
  ((contactRows ?? []) as Row[]).forEach((row) => {
    const customerId = typeof row?.customer_id === "string" ? row.customer_id.trim() : "";
    if (!customerId) return;
    const list = contactsByCustomerId.get(customerId) ?? [];
    list.push(row);
    contactsByCustomerId.set(customerId, list);
  });

  const rowsWithContacts = ((overviewRows ?? []) as Row[]).map((row) => {
    const id = rowId(row);
    const customer = customerById.get(id);
    const projectTotals = projectTotalsByCustomerId.get(id);
    const totalSales = toNumber(row.total_sales) + (projectTotals?.totalSales ?? 0);
    const totalPaid = toNumber(row.total_paid) + (projectTotals?.totalPaid ?? 0);
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
      morning_documents: morningDocumentsByCustomerId.get(id) ?? [],
      contacts: contactsByCustomerId.get(id) ?? [],
    };
  });

  const error =
    overviewError?.message ??
    contactsError?.message ??
    customerRowsError?.message ??
    morningDocumentsError?.message ??
    projectRowsError?.message ??
    projectFinancialError?.message ??
    projectPaymentError?.message ??
    null;
  const totalCount = typeof count === "number" ? count : rowsWithContacts.length;
  const hasMore = typeof count === "number" ? to + 1 < count : rowsWithContacts.length === CUSTOMERS_PAGE_SIZE;

  return { rows: rowsWithContacts, totalCount, hasMore, error };
}

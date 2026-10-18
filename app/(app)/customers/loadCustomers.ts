import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { applyProjectVatToBase } from "@/lib/projects/vat";
import { withLinkColumn } from "@/lib/customers/workerLink";
import { chunkStrings } from "@/lib/financial/utils";
import { toHebrewError } from "@/lib/error-messages";
import type { CustomersFilters } from "@/app/(app)/customers/customersFilters";

export type { CustomerFilterMode, CustomersFilters } from "@/app/(app)/customers/customersFilters";

type Row = Record<string, unknown>;

export const CUSTOMERS_PAGE_SIZE = 50;

/**
 * Ids per `.in()` read. A list much longer than this makes an address too long
 * to send, and the read fails (the export's WhatsApp column came out empty
 * that way, 2026-10-11) — a search can hand over every customer.
 */
export const CUSTOMER_ID_BATCH = 150;

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function rowId(row: Row) {
  return text(row, "customer_id") || text(row, "id");
}

export type CustomersPageResult = {
  rows: Row[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

// What the list draws and the edit dialog starts from. Not the view's
// total_sales / total_paid / open_balance: those are worked out again below
// (enrichCustomerOverviewRows), and the last order / payment dates fed only a
// details dialog the list no longer has.
const OVERVIEW_SELECT =
  "customer_id,customer_name,email,phone,orders_count,projects_count,address,active,notes,name_for_invoice,registration_number";

// From the customers table: WhatsApp (the edit dialog's), the Morning link
// (the Morning column) and the two flags the rows badge — plus the worker
// link, through withLinkColumn.
// The saved drop-off point too: the address column's Waze goes there first.
const CUSTOMER_SELECT = "id,whatsapp,morning_client_id,requires_prepayment,delivery_lat,delivery_lng,addr_place_id";

type ReadResult = { data: Row[]; error: string | null };

/**
 * Every row of a read keyed by a list of ids: in batches of CUSTOMER_ID_BATCH
 * ids, each paged past the database's 1000-row answer — a customer with many
 * orders or payments must have all of them counted, not the first thousand.
 * `read` builds one page's query (it must apply `.range(from, to)` over a
 * unique order).
 */
async function readByIds(
  ids: string[],
  read: (batch: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<ReadResult> {
  if (ids.length === 0) return { data: [], error: null };
  const results = await Promise.all(
    chunkStrings(ids, CUSTOMER_ID_BATCH).map((batch) => fetchAllPagedResult<Row>((from, to) => read(batch, from, to)))
  );
  const data: Row[] = [];
  let error: string | null = null;
  for (const result of results) {
    if (result.error) error ??= result.error.message;
    else data.push(...result.data);
  }
  return { data, error };
}

async function readCustomers(supabase: SupabaseClient, ids: string[]): Promise<ReadResult> {
  if (ids.length === 0) return { data: [], error: null };
  // One row per id, so a batch never reaches 1000 rows — no paging needed.
  const results = await Promise.all(
    chunkStrings(ids, CUSTOMER_ID_BATCH).map((batch) =>
      withLinkColumn<Row[]>(CUSTOMER_SELECT, (select) => supabase.from("customers").select(select).in("id", batch))
    )
  );
  const data: Row[] = [];
  let error: string | null = null;
  for (const result of results) {
    if (result.error) error ??= result.error.message ?? "query failed";
    else data.push(...(result.data ?? []));
  }
  return { data, error };
}

/** A project row and the two money reads that need its id. */
async function readProjectMoney(supabase: SupabaseClient, customerIds: string[]) {
  const projects = await readByIds(customerIds, (batch, from, to) =>
    supabase
      .from("projects")
      .select("id,customer_id,agreed_base_price,actual_price,price_includes_vat,vat_rate")
      .in("customer_id", batch)
      .order("id")
      .range(from, to)
  );
  const projectIds = projects.data.map((row) => text(row, "id")).filter(Boolean);
  const [financials, payments] = await Promise.all([
    readByIds(projectIds, (batch, from, to) =>
      supabase
        .from("project_financials_view")
        .select("id,customer_total_price,expenses_billed")
        .in("id", batch)
        .order("id")
        .range(from, to)
    ),
    readByIds(projectIds, (batch, from, to) =>
      supabase
        .from("payments")
        .select("project_id,amount_total,net_amount,payment_status,due_date")
        .in("project_id", batch)
        .order("id")
        .range(from, to)
    ),
  ]);
  return { projects, financials, payments };
}

/**
 * Enrich customer_overview_view rows with the Morning link, the row flags and
 * money totals computed from the same sources the detail pages use:
 * - order money from order_overview_view (falls back to items-derived totals
 *   when orders.total_amount is 0)
 * - project money from project_financials_view + the collection split on
 *   payments (collected vs pending), so a future-dated check never counts as paid.
 * The view's own total_sales/total_paid already include projects, so we never
 * add on top of them — we replace them with the recomputed figures.
 *
 * The reads go out together; only the project money waits — for the project
 * ids, and for nothing else.
 */
async function enrichCustomerOverviewRows(
  supabase: SupabaseClient,
  overviewRows: Row[]
): Promise<{ rows: Row[]; error: string | null }> {
  const customerIds = Array.from(new Set(overviewRows.map(rowId).filter(Boolean)));

  const [customers, orders, projectMoney] = await Promise.all([
    readCustomers(supabase, customerIds),
    readByIds(customerIds, (batch, from, to) =>
      supabase
        .from("order_overview_view")
        .select("order_id,customer_id,total_amount,collected_amount,pending_amount")
        .in("customer_id", batch)
        .order("order_id")
        .range(from, to)
    ),
    readProjectMoney(supabase, customerIds),
  ]);

  const customerById = new Map<string, Row>();
  customers.data.forEach((row) => {
    const id = text(row, "id");
    if (id) customerById.set(id, row);
  });

  // Order money aggregated per customer from the per-order overview rows.
  const orderTotalsByCustomerId = new Map<string, { totalSales: number; totalPaid: number; expected: number }>();
  orders.data.forEach((row) => {
    const customerId = text(row, "customer_id");
    if (!customerId) return;
    const current = orderTotalsByCustomerId.get(customerId) ?? { totalSales: 0, totalPaid: 0, expected: 0 };
    orderTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + toNumber(row?.total_amount),
      totalPaid: current.totalPaid + toNumber(row?.collected_amount),
      expected: current.expected + toNumber(row?.pending_amount),
    });
  });

  const financialByProjectId = new Map<string, Row>();
  projectMoney.financials.data.forEach((row) => {
    const id = text(row, "id");
    if (id) financialByProjectId.set(id, row);
  });

  const projectPaymentsByProjectId = new Map<string, Row[]>();
  projectMoney.payments.data.forEach((row) => {
    const projectId = text(row, "project_id");
    if (!projectId) return;
    const list = projectPaymentsByProjectId.get(projectId) ?? [];
    list.push(row);
    projectPaymentsByProjectId.set(projectId, list);
  });

  const projectTotalsByCustomerId = new Map<string, { totalSales: number; totalPaid: number; expected: number }>();
  projectMoney.projects.data.forEach((row) => {
    const customerId = text(row, "customer_id");
    const projectId = text(row, "id");
    if (!customerId || !projectId) return;

    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = toNumber(row?.actual_price);
    const agreedBasePrice = toNumber(row?.agreed_base_price);
    const expensesBilled = toNumber(financialRow?.expenses_billed);
    // Phase 2: gross up the base for price-includes-VAT projects.
    const vatMode = { priceIncludesVat: row?.price_includes_vat === true, vatRate: row?.vat_rate as number | null };
    const baseNet = actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0;
    const fallbackTotal = applyProjectVatToBase(baseNet, vatMode) + expensesBilled;
    const customerTotalPrice = Math.max(toNumber(financialRow?.customer_total_price), fallbackTotal);
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

    const current = projectTotalsByCustomerId.get(customerId) ?? { totalSales: 0, totalPaid: 0, expected: 0 };
    projectTotalsByCustomerId.set(customerId, {
      totalSales: current.totalSales + customerTotalPrice,
      totalPaid: current.totalPaid + split.collected,
      expected: current.expected + split.pending,
    });
  });

  const rows = overviewRows.map((row) => {
    const id = rowId(row);
    const customer = customerById.get(id);
    const orderTotals = orderTotalsByCustomerId.get(id);
    const projectTotals = projectTotalsByCustomerId.get(id);
    const totalSales = (orderTotals?.totalSales ?? 0) + (projectTotals?.totalSales ?? 0);
    const totalPaid = (orderTotals?.totalPaid ?? 0) + (projectTotals?.totalPaid ?? 0);
    const expectedAmount = (orderTotals?.expected ?? 0) + (projectTotals?.expected ?? 0);

    return {
      ...row,
      total_sales: totalSales,
      total_paid: totalPaid,
      expected_amount: expectedAmount,
      open_balance: Math.max(totalSales - totalPaid, 0),
      whatsapp: typeof customer?.whatsapp === "string" ? customer.whatsapp : null,
      morning_client_id: typeof customer?.morning_client_id === "string" ? customer.morning_client_id : null,
      requires_prepayment: customer?.requires_prepayment === true,
      linked_user_id: typeof customer?.linked_user_id === "string" ? customer.linked_user_id : null,
      delivery_lat: customer?.delivery_lat ?? null,
      delivery_lng: customer?.delivery_lng ?? null,
      addr_place_id: customer?.addr_place_id ?? null,
    };
  });

  const error =
    customers.error ??
    projectMoney.projects.error ??
    orders.error ??
    projectMoney.financials.error ??
    projectMoney.payments.error ??
    null;

  return { rows, error: error ? toHebrewError(error) : null };
}

/** The slice of a query builder the filters use (each call answers the same builder). */
type FilterableQuery = {
  gt(column: string, value: number): FilterableQuery;
  lte(column: string, value: number): FilterableQuery;
  eq(column: string, value: boolean): FilterableQuery;
};

/**
 * The list's four filters on a customer_overview_view query — the page, a
 * search and the export alike. Typed loosely on purpose: matching supabase-js's
 * own filter types structurally is too deep for the compiler.
 */
export function applyCustomersFilters<Q>(query: Q, filters: CustomersFilters): Q {
  let next = query as unknown as FilterableQuery;
  if (filters.withProjects === "yes") next = next.gt("projects_count", 0);
  if (filters.withProjects === "no") next = next.lte("projects_count", 0);
  if (filters.withOrders === "yes") next = next.gt("orders_count", 0);
  if (filters.withOrders === "no") next = next.lte("orders_count", 0);
  if (filters.withDebt === "yes") next = next.gt("open_balance", 0);
  if (filters.withDebt === "no") next = next.lte("open_balance", 0);
  if (filters.activeOnly === "yes") next = next.eq("active", true);
  if (filters.activeOnly === "no") next = next.eq("active", false);
  return next as unknown as Q;
}

/**
 * Load one page of the customers list, enriched with the Morning link, the row
 * flags and recomputed money totals. Shared by the initial server render
 * (page 1) and the fetch-on-scroll server action (page >= 2).
 */
export async function loadCustomersPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: CustomersFilters }
): Promise<CustomersPageResult> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * CUSTOMERS_PAGE_SIZE;
  const to = safePage * CUSTOMERS_PAGE_SIZE - 1;

  // Ties broken by id: customers who share a name otherwise come back in any
  // order, so a page could repeat one and skip another.
  const overviewQuery = applyCustomersFilters(
    supabase.from("customer_overview_view").select(OVERVIEW_SELECT, { count: "estimated" }),
    filters
  )
    .order("customer_name", { ascending: true })
    .order("customer_id", { ascending: true });

  const { data: overviewRows, error: overviewError, count } = await overviewQuery.range(from, to);

  const { rows, error: enrichError } = await enrichCustomerOverviewRows(supabase, (overviewRows ?? []) as Row[]);

  const error = overviewError ? toHebrewError(overviewError.message) : enrichError;
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
  /** The saved drop-off point, for the wizards' Waze (lib/delivery-location.ts). */
  delivery_lat: number | null;
  delivery_lng: number | null;
  /** "not_found" when the saved address wasn't found on Google Maps (lib/address/columns.ts). */
  addr_place_id: string | null;
  contacts: Array<{ full_name: string; phone: string | null; email: string | null; whatsapp: string | null }>;
  branches: Array<{ id: string; name: string; address: string | null; phone: string | null }>;
};


/**
 * Load EVERY customer (lightweight, with contacts) for the client-side search
 * index. Fetched once per session and searched in memory so customer
 * type-ahead is instant instead of a network round-trip per keystroke.
 */
export async function loadCustomerSearchIndexRows(
  supabase: SupabaseClient
): Promise<CustomerSearchIndexEntry[]> {
  // Paged: the database answers at most 1000 rows and drops the rest without
  // a word — past 1000 customers the ones later in the alphabet couldn't be
  // found or picked in the order form (scale study, 2026-10-11).
  const [{ data: customerRows }, { data: contactRows }, { data: branchRows }] = await Promise.all([
    fetchAllPagedResult((from, to) =>
      supabase
        .from("customers")
        .select("id,name,name_for_invoice,phone,whatsapp,email,address,active,requires_prepayment,delivery_lat,delivery_lng,addr_place_id")
        .order("name", { ascending: true })
        .order("id")
        .range(from, to)
    ),
    fetchAllPagedResult((from, to) =>
      supabase
        .from("contacts")
        .select("customer_id,full_name,phone,email,whatsapp")
        .eq("active", true)
        .order("id")
        .range(from, to)
    ),
    fetchAllPagedResult((from, to) =>
      supabase
        .from("customer_branches")
        .select("id,customer_id,name,address,phone")
        .eq("active", true)
        .order("id")
        .range(from, to)
    ),
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

  const branchesByCustomer = new Map<string, CustomerSearchIndexEntry["branches"]>();
  for (const branch of (branchRows ?? []) as Row[]) {
    const customerId = typeof branch?.customer_id === "string" ? branch.customer_id : "";
    const id = typeof branch?.id === "string" ? branch.id : "";
    if (!customerId || !id) continue;
    const list = branchesByCustomer.get(customerId) ?? [];
    list.push({
      id,
      name: typeof branch?.name === "string" ? branch.name : "",
      address: (branch?.address as string | null) ?? null,
      phone: (branch?.phone as string | null) ?? null,
    });
    branchesByCustomer.set(customerId, list);
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
      addr_place_id: (row?.addr_place_id as string | null) ?? null,
      delivery_lat: row?.delivery_lat == null ? null : Number(row.delivery_lat),
      delivery_lng: row?.delivery_lng == null ? null : Number(row.delivery_lng),
      contacts: contactsByCustomer.get(id) ?? [],
      branches: branchesByCustomer.get(id) ?? [],
    };
  });
}

function uniqueIds(customerIds: string[]) {
  return Array.from(new Set(customerIds.filter((value) => typeof value === "string" && value.trim())));
}

/**
 * Load fully-enriched list rows for a specific set of customers (used by the
 * client search, so results carry real counts and totals instead of zeros,
 * and by the list for a customer created while it's open). With `filters`,
 * only the customers that pass them come back.
 */
export async function loadCustomersByIds(
  supabase: SupabaseClient,
  customerIds: string[],
  filters?: CustomersFilters
): Promise<{ rows: Row[]; error: string | null }> {
  const ids = uniqueIds(customerIds);
  if (ids.length === 0) return { rows: [], error: null };

  const overview = await readByIds(ids, (batch, from, to) => {
    const query = supabase.from("customer_overview_view").select(OVERVIEW_SELECT).in("customer_id", batch);
    return (filters ? applyCustomersFilters(query, filters) : query)
      .order("customer_name", { ascending: true })
      .order("customer_id", { ascending: true })
      .range(from, to);
  });

  const { rows, error: enrichError } = await enrichCustomerOverviewRows(supabase, overview.data);

  return { rows, error: overview.error ? toHebrewError(overview.error) : enrichError };
}

/**
 * Which of these customers pass the list's filters — in the order given (a
 * search's, best match first). Reads only the ids: the search pages through
 * the answer and enriches a page at a time.
 */
export async function loadCustomerIdsPassingFilters(
  supabase: SupabaseClient,
  customerIds: string[],
  filters: CustomersFilters
): Promise<{ ids: string[]; error: string | null }> {
  const ids = uniqueIds(customerIds);
  if (ids.length === 0) return { ids: [], error: null };

  const passing = await readByIds(ids, (batch, from, to) =>
    applyCustomersFilters(
      supabase.from("customer_overview_view").select("customer_id").in("customer_id", batch),
      filters
    )
      .order("customer_id", { ascending: true })
      .range(from, to)
  );
  if (passing.error) return { ids: [], error: toHebrewError(passing.error) };

  const passed = new Set(passing.data.map(rowId));
  return { ids: ids.filter((id) => passed.has(id)), error: null };
}

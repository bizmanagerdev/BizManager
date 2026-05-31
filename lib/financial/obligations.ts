import type { SupabaseClient } from "@supabase/supabase-js";

export type UnpaidExpenseItem = {
  id: string;
  amount: number;
  paid_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  category: string | null;
  description: string | null;
  expense_date: string | null;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  notes: string | null;
  source_label: string | null;
};

export type WorkerDebtItem = {
  user_id: string;
  worker_name: string | null;
  earned_amount: number;
  paid_amount: number;
  owed_amount: number;
};

export type UnpaidOrderItem = {
  order_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_amount: number;
  remaining_balance: number;
  payment_status: string | null;
  order_date: string | null;
};

export type ProjectBalanceItem = {
  id: string;
  name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_total_price: number;
  total_paid: number;
  outstanding: number;
  status: string | null;
};

export type ObligationsData = {
  unpaidExpenses: UnpaidExpenseItem[];
  workerDebts: WorkerDebtItem[];
  unpaidOrders: UnpaidOrderItem[];
  projectBalances: ProjectBalanceItem[];
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

function str(row: Row | null | undefined, key: string): string | null {
  const v = row?.[key];
  return typeof v === "string" ? v : null;
}

export async function getObligationsData(supabase: SupabaseClient): Promise<ObligationsData> {
  const [
    expensesResult,
    workerDebtResult,
    ordersResult,
    projectFinancialsResult,
    projectDashboardResult,
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,amount,paid_amount,payment_status,payment_method,category,description,expense_date,project_id,order_id,property_id,notes")
      .or("payment_status.is.null,payment_status.neq.paid")
      .order("expense_date", { ascending: false })
      .range(0, 499),

    supabase
      .from("worker_balance_summary_view")
      .select("user_id,earned_amount,paid_amount,owed_amount")
      .gt("owed_amount", 0.009)
      .range(0, 199),

    supabase
      .from("order_overview_view")
      .select("order_id,customer_name,customer_phone,total_amount,total_paid,remaining_balance,payment_status,order_date")
      .neq("payment_status", "paid")
      .gt("remaining_balance", 0.009)
      .order("order_date", { ascending: false })
      .range(0, 199),

    supabase
      .from("project_financials_view")
      .select("id,customer_total_price")
      .gt("customer_total_price", 0.009)
      .range(0, 499),

    supabase
      .from("project_dashboard_view")
      .select("id,name,status,customer_name,customer_id")
      .range(0, 499),
  ]);

  // Unpaid expenses — resolve source labels
  const rawExpenses = (expensesResult.data ?? []) as Row[];

  const projectIds = Array.from(new Set(rawExpenses.map((r) => str(r, "project_id")).filter(Boolean) as string[]));
  const orderIds = Array.from(new Set(rawExpenses.map((r) => str(r, "order_id")).filter(Boolean) as string[]));
  const propertyIds = Array.from(new Set(rawExpenses.map((r) => str(r, "property_id")).filter(Boolean) as string[]));

  const [projectLabelsResult, orderLabelsResult, propertyLabelsResult] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("project_dashboard_view").select("id,name,customer_name").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    orderIds.length > 0
      ? supabase.from("order_overview_view").select("order_id,customer_name,order_date").in("order_id", orderIds)
      : Promise.resolve({ data: [] as Row[] }),
    propertyIds.length > 0
      ? supabase.from("properties").select("id,address").in("id", propertyIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const projectLabelById = new Map<string, string>();
  for (const row of (projectLabelsResult.data ?? []) as Row[]) {
    const id = str(row, "id");
    if (!id) continue;
    const name = str(row, "name") ?? "";
    const customer = str(row, "customer_name");
    projectLabelById.set(id, customer ? `${name} (${customer})` : name);
  }

  const orderLabelById = new Map<string, string>();
  for (const row of (orderLabelsResult.data ?? []) as Row[]) {
    const id = str(row, "order_id");
    if (!id) continue;
    const customer = str(row, "customer_name");
    const date = str(row, "order_date");
    orderLabelById.set(id, customer ? `הזמנה — ${customer}${date ? ` (${date})` : ""}` : `הזמנה ${id.slice(0, 8)}`);
  }

  const propertyLabelById = new Map<string, string>();
  for (const row of (propertyLabelsResult.data ?? []) as Row[]) {
    const id = str(row, "id");
    if (!id) continue;
    propertyLabelById.set(id, str(row, "address") ?? `נכס ${id.slice(0, 8)}`);
  }

  const unpaidExpenses: UnpaidExpenseItem[] = rawExpenses
    .filter((r) => typeof r.id === "string")
    .map((r) => {
      const projectId = str(r, "project_id");
      const orderId = str(r, "order_id");
      const propertyId = str(r, "property_id");
      const sourceLabel = projectId
        ? projectLabelById.get(projectId) ?? `פרויקט ${projectId.slice(0, 8)}`
        : orderId
          ? orderLabelById.get(orderId) ?? `הזמנה ${orderId.slice(0, 8)}`
          : propertyId
            ? propertyLabelById.get(propertyId) ?? `נכס ${propertyId.slice(0, 8)}`
            : null;
      const paidRaw = r.paid_amount != null ? toNum(r.paid_amount) : null;
      return {
        id: r.id as string,
        amount: toNum(r.amount),
        paid_amount: paidRaw != null && paidRaw > 0 ? paidRaw : null,
        payment_status: str(r, "payment_status"),
        payment_method: str(r, "payment_method"),
        category: str(r, "category"),
        description: str(r, "description"),
        expense_date: str(r, "expense_date"),
        project_id: projectId,
        order_id: orderId,
        property_id: propertyId,
        notes: str(r, "notes"),
        source_label: sourceLabel,
      };
    });

  // Worker debts — need worker names
  const rawWorkerDebts = (workerDebtResult.data ?? []) as Row[];
  const workerUserIds = rawWorkerDebts
    .map((r) => str(r, "user_id"))
    .filter((id): id is string => Boolean(id));

  const workerNamesResult = workerUserIds.length > 0
    ? await supabase.from("users").select("id,full_name,email").in("id", workerUserIds)
    : { data: [] as Row[] };

  const workerNameById = new Map<string, string>();
  for (const row of (workerNamesResult.data ?? []) as Row[]) {
    const id = str(row, "id");
    if (!id) continue;
    const name = str(row, "full_name") ?? str(row, "email") ?? id.slice(0, 8);
    workerNameById.set(id, name);
  }

  const workerDebts: WorkerDebtItem[] = rawWorkerDebts
    .filter((r) => typeof r.user_id === "string")
    .map((r) => ({
      user_id: r.user_id as string,
      worker_name: workerNameById.get(r.user_id as string) ?? null,
      earned_amount: toNum(r.earned_amount),
      paid_amount: toNum(r.paid_amount),
      owed_amount: toNum(r.owed_amount),
    }));

  // Unpaid orders
  const unpaidOrders: UnpaidOrderItem[] = ((ordersResult.data ?? []) as Row[])
    .filter((r) => typeof r.order_id === "string")
    .map((r) => ({
      order_id: r.order_id as string,
      customer_name: str(r, "customer_name"),
      customer_phone: str(r, "customer_phone"),
      total_amount: toNum(r.total_amount),
      remaining_balance: toNum(r.remaining_balance),
      payment_status: str(r, "payment_status"),
      order_date: str(r, "order_date"),
    }));

  // Project balances — join financials with dashboard info, subtract payments
  const projectFinancials = (projectFinancialsResult.data ?? []) as Row[];
  const projectDashboard = (projectDashboardResult.data ?? []) as Row[];

  const dashboardById = new Map<string, Row>();
  for (const row of projectDashboard) {
    const id = str(row, "id");
    if (id) dashboardById.set(id, row);
  }

  const projectsWithPrice = projectFinancials
    .filter((r) => typeof r.id === "string" && toNum(r.customer_total_price) > 0.009)
    .map((r) => ({ id: r.id as string, customerTotalPrice: toNum(r.customer_total_price) }));

  let projectBalances: ProjectBalanceItem[] = [];

  if (projectsWithPrice.length > 0) {
    const projectIdsWithPrice = projectsWithPrice.map((p) => p.id);

    // Batch: payments + customer phones in parallel
    const customerIds = Array.from(new Set(
      projectIdsWithPrice
        .map((pid) => str(dashboardById.get(pid) ?? null, "customer_id"))
        .filter(Boolean) as string[]
    ));

    const [paymentsResult, customerPhonesResult] = await Promise.all([
      supabase
        .from("payments")
        .select("project_id,amount_total,payment_status")
        .in("project_id", projectIdsWithPrice)
        .range(0, 4999),
      customerIds.length > 0
        ? supabase.from("customers").select("id,phone").in("id", customerIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);

    // Outstanding is measured against COLLECTED money only — a future-dated /
    // uncleared payment (payment_status='pending') is not money in hand, so the
    // project still counts as owing it.
    const totalPaidByProjectId = new Map<string, number>();
    for (const row of (paymentsResult.data ?? []) as Row[]) {
      const pid = str(row, "project_id");
      if (!pid) continue;
      const status = (str(row, "payment_status") ?? "").trim().toLowerCase();
      if (status === "pending" || status === "rejected") continue;
      totalPaidByProjectId.set(pid, (totalPaidByProjectId.get(pid) ?? 0) + toNum(row.amount_total));
    }

    const phoneByCustomerId = new Map<string, string>();
    for (const row of (customerPhonesResult.data ?? []) as Row[]) {
      const id = str(row, "id");
      const phone = str(row, "phone");
      if (id && phone) phoneByCustomerId.set(id, phone);
    }

    projectBalances = projectsWithPrice
      .map(({ id, customerTotalPrice }) => {
        const totalPaid = totalPaidByProjectId.get(id) ?? 0;
        const outstanding = Math.max(0, customerTotalPrice - totalPaid);
        const dashRow = dashboardById.get(id);
        const customerId = str(dashRow ?? null, "customer_id");
        return {
          id,
          name: str(dashRow ?? null, "name"),
          customer_name: str(dashRow ?? null, "customer_name"),
          customer_phone: customerId ? (phoneByCustomerId.get(customerId) ?? null) : null,
          customer_total_price: customerTotalPrice,
          total_paid: totalPaid,
          outstanding,
          status: str(dashRow ?? null, "status"),
        };
      })
      .filter((p) => p.outstanding > 0.009)
      .sort((a, b) => b.outstanding - a.outstanding);
  }

  return { unpaidExpenses, workerDebts, unpaidOrders, projectBalances };
}

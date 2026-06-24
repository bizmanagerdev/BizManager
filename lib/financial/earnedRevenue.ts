import type { SupabaseClient } from "@supabase/supabase-js";
import { getBusinessDomainLabel } from "@/lib/expenses";

// ════════════════════════════════════════════════════════════════════════════
// Earned (booked) revenue, expenses and net per month, per business domain.
//
// ACCRUAL view — money is attributed to the month the work BELONGS to, not the
// month its cash cleared (that's what the cash-flow ledger / מגמה חודשית show).
//   INCOME
//     • מכירות (orders)        — whole order total in its order_date month.
//     • פרויקטים (projects)     — gross customer price split EVENLY across every
//                                month the project spans (start → end).
//     • שוטף / ספייסיט / נכסים  — collected income payments tagged to that domain,
//                                by payment date (these have no booking event).
//   EXPENSES (all business domains) — by expense_date (incurred), every expense.
//   NET = income − expenses, per domain and per month.
// Amounts are GROSS (incl. VAT). Personal domains (בית/צדקה) are excluded.
// ════════════════════════════════════════════════════════════════════════════

// Fixed display order; only domains with activity are returned.
const BUSINESS_DOMAIN_ORDER = [
  "sales",
  "logistics_projects",
  "general_business",
  "spaceit",
  "property_management",
] as const;
const BUSINESS_DOMAINS = new Set<string>(BUSINESS_DOMAIN_ORDER);
// Domains whose income comes from standalone payments (not orders/projects).
const OTHER_INCOME_DOMAINS = new Set<string>([
  "general_business",
  "spaceit",
  "property_management",
]);

const EXCLUDED_ORDER_STATUSES = new Set(["cancelled", "בוטלה"]);
const EXCLUDED_PROJECT_STATUSES = new Set(["quote", "cancelled", "בוטל", "בוטלה"]);

export type EarnedDomainCell = {
  count: number;
  income: number;
  expense: number;
  net: number;
};

export type EarnedRevenueMonth = {
  month: string; // YYYY-MM
  byDomain: Record<string, EarnedDomainCell>;
  total: EarnedDomainCell;
};

export type EarnedRevenueReport = {
  months: EarnedRevenueMonth[];
  domains: Array<{ key: string; label: string }>;
  totals: { byDomain: Record<string, EarnedDomainCell>; grand: EarnedDomainCell };
};

export type EarnedOrderInput = { orderDate: string | null; amount: number; status: string | null };
export type EarnedProjectInput = {
  startDate: string | null;
  endDate: string | null;
  createdAt: string | null;
  amount: number;
  status: string | null;
};
export type EarnedExpenseInput = { date: string | null; amount: number; domain: string };
export type EarnedIncomeInput = { date: string | null; amount: number; domain: string };

type Row = Record<string, unknown>;

function toNum(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" ? value : null;
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

/** Inclusive list of YYYY-MM keys from startKey to endKey (capped for safety). */
export function monthKeysBetween(startKey: string, endKey: string): string[] {
  if (!startKey) return [];
  if (!endKey || endKey < startKey) return [startKey];
  const out: string[] = [];
  let [y, m] = startKey.split("-").map(Number);
  const [ey, em] = endKey.split("-").map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y += 1;
    }
    guard++;
  }
  return out.length ? out : [startKey];
}

/**
 * Build the month × domain matrix of count/income/expense/net. `from`/`to`
 * (YYYY-MM-DD or YYYY-MM) trim which months are RETURNED, but each project is
 * still prorated across its full span first so per-month shares stay correct.
 */
export function buildEarnedRevenueByMonth(
  orders: EarnedOrderInput[],
  projects: EarnedProjectInput[],
  expenses: EarnedExpenseInput[],
  otherIncome: EarnedIncomeInput[],
  options: { from?: string | null; to?: string | null } = {}
): EarnedRevenueReport {
  const fromMonth = options.from ? options.from.slice(0, 7) : null;
  const toMonth = options.to ? options.to.slice(0, 7) : null;

  // month -> domain -> raw {count, income, expense}
  const acc = new Map<string, Map<string, { count: number; income: number; expense: number }>>();
  const cell = (month: string, domain: string) => {
    let byDomain = acc.get(month);
    if (!byDomain) {
      byDomain = new Map();
      acc.set(month, byDomain);
    }
    let c = byDomain.get(domain);
    if (!c) {
      c = { count: 0, income: 0, expense: 0 };
      byDomain.set(domain, c);
    }
    return c;
  };

  for (const order of orders) {
    if (EXCLUDED_ORDER_STATUSES.has((order.status ?? "").trim().toLowerCase())) continue;
    if (!order.orderDate) continue;
    const c = cell(monthKey(order.orderDate), "sales");
    c.income += order.amount;
    c.count += 1;
  }

  for (const project of projects) {
    if (EXCLUDED_PROJECT_STATUSES.has((project.status ?? "").trim().toLowerCase())) continue;
    if (!project.amount) continue;
    const start = project.startDate ?? project.createdAt;
    if (!start) continue;
    const months = monthKeysBetween(monthKey(start), monthKey(project.endDate ?? start));
    const share = project.amount / months.length;
    for (const m of months) {
      const c = cell(m, "logistics_projects");
      c.income += share;
      c.count += 1; // a project counts once in every month it is active
    }
  }

  for (const expense of expenses) {
    if (!expense.date) continue;
    if (!BUSINESS_DOMAINS.has(expense.domain)) continue; // skip personal/unknown domains
    cell(monthKey(expense.date), expense.domain).expense += expense.amount;
  }

  for (const income of otherIncome) {
    if (!income.date) continue;
    if (!OTHER_INCOME_DOMAINS.has(income.domain)) continue;
    const c = cell(monthKey(income.date), income.domain);
    c.income += income.amount;
    c.count += 1;
  }

  // Which domains have any activity at all (across the full set)?
  const activeDomains = new Set<string>();
  for (const byDomain of acc.values()) {
    for (const [domain, c] of byDomain) {
      if (c.count || c.income || c.expense) activeDomains.add(domain);
    }
  }
  const domains = BUSINESS_DOMAIN_ORDER.filter((d) => activeDomains.has(d)).map((key) => ({
    key,
    label: getBusinessDomainLabel(key),
  }));
  const domainKeys = domains.map((d) => d.key);

  const monthList = Array.from(acc.keys())
    .filter((m) => (!fromMonth || m >= fromMonth) && (!toMonth || m <= toMonth))
    .sort();

  const months: EarnedRevenueMonth[] = monthList.map((month) => {
    const raw = acc.get(month) ?? new Map();
    const byDomain: Record<string, EarnedDomainCell> = {};
    let tCount = 0;
    let tIncome = 0;
    let tExpense = 0;
    for (const key of domainKeys) {
      const c = raw.get(key) ?? { count: 0, income: 0, expense: 0 };
      byDomain[key] = { count: c.count, income: c.income, expense: c.expense, net: c.income - c.expense };
      tCount += c.count;
      tIncome += c.income;
      tExpense += c.expense;
    }
    return { month, byDomain, total: { count: tCount, income: tIncome, expense: tExpense, net: tIncome - tExpense } };
  });

  const byDomainTotal: Record<string, EarnedDomainCell> = {};
  let gCount = 0;
  let gIncome = 0;
  let gExpense = 0;
  for (const key of domainKeys) {
    let count = 0;
    let income = 0;
    let expense = 0;
    for (const m of months) {
      const c = m.byDomain[key];
      count += c.count;
      income += c.income;
      expense += c.expense;
    }
    byDomainTotal[key] = { count, income, expense, net: income - expense };
    gCount += count;
    gIncome += income;
    gExpense += expense;
  }

  return {
    months,
    domains,
    totals: {
      byDomain: byDomainTotal,
      grand: { count: gCount, income: gIncome, expense: gExpense, net: gIncome - gExpense },
    },
  };
}

/**
 * Load the earned-revenue report from the database. Orders come from
 * order_overview_view; projects join the projects table (dates/status) with
 * project_financials_view (gross customer_total_price); expenses and
 * other-domain income come from the expenses/payments tables.
 */
export async function loadEarnedRevenueByMonth(
  supabase: SupabaseClient,
  { from, to }: { from?: string | null; to?: string | null } = {}
): Promise<EarnedRevenueReport> {
  const [ordersResult, projectsResult, financialsResult, expensesResult, paymentsResult] =
    await Promise.all([
      supabase
        .from("order_overview_view")
        .select("order_id,order_date,total_amount,status")
        .range(0, 20000),
      supabase
        .from("projects")
        .select("id,start_date,end_date,created_at,status")
        .range(0, 20000),
      supabase.from("project_financials_view").select("id,customer_total_price").range(0, 20000),
      supabase.from("expenses").select("expense_date,amount,business_domain").range(0, 50000),
      supabase
        .from("payments")
        .select("payment_date,amount_total,business_domain,payment_status")
        .range(0, 50000),
    ]);

  const priceById = new Map<string, number>();
  for (const row of (financialsResult.data ?? []) as Row[]) {
    const id = str(row.id);
    if (id) priceById.set(id, toNum(row.customer_total_price));
  }

  const orders: EarnedOrderInput[] = ((ordersResult.data ?? []) as Row[]).map((row) => ({
    orderDate: str(row.order_date),
    amount: toNum(row.total_amount),
    status: str(row.status),
  }));

  const projects: EarnedProjectInput[] = ((projectsResult.data ?? []) as Row[]).map((row) => ({
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    createdAt: str(row.created_at),
    amount: priceById.get(str(row.id) ?? "") ?? 0,
    status: str(row.status),
  }));

  const expenses: EarnedExpenseInput[] = ((expensesResult.data ?? []) as Row[]).map((row) => ({
    date: str(row.expense_date),
    amount: Math.abs(toNum(row.amount)),
    domain: str(row.business_domain) ?? "",
  }));

  // Other-domain income = collected payments tagged to a non-order/project domain.
  const otherIncome: EarnedIncomeInput[] = ((paymentsResult.data ?? []) as Row[])
    .filter((row) => {
      const domain = str(row.business_domain) ?? "";
      if (!OTHER_INCOME_DOMAINS.has(domain)) return false;
      const status = (str(row.payment_status) ?? "").trim().toLowerCase();
      return status !== "pending" && status !== "rejected"; // collected only
    })
    .map((row) => ({
      date: str(row.payment_date),
      amount: toNum(row.amount_total),
      domain: str(row.business_domain) ?? "",
    }));

  return buildEarnedRevenueByMonth(orders, projects, expenses, otherIncome, { from, to });
}

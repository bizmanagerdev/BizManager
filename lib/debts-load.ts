import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExpenseDebts,
  buildLoanDebts,
  buildWageDebts,
  sortDebts,
  type DebtItem,
  type DebtSourceNames,
  type ExpenseDebtRow,
  type WageBalanceRow,
  type WageItemRow,
} from "@/lib/debts";
import type { Loan } from "@/lib/loans";
import { propertyDisplayName } from "@/lib/properties";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";
import { israelDateKey } from "@/lib/timezone";

// Reads everything the חובות page shows. Two waves of parallel reads: the rows
// themselves, then the names of the projects / properties / orders they belong
// to. A read that fails doesn't take the page down — its section is reported
// in `errors` and the rest still shows (a debts page that silently drops a
// whole kind of debt would be worse than one that says so).

type Row = Record<string, unknown>;

export type DebtsData = {
  items: DebtItem[];
  todayIso: string;
  /** One line per part of the page that couldn't be loaded (Hebrew, for display). */
  errors: string[];
};

const EXPENSE_COLUMNS =
  "id,expense_date,amount,paid_amount,payment_status,payment_method,paid_date,category,description,notes,business_domain,account_id,order_id,property_id,installment_group_id,installment_index,installment_count,project_expenses(project_id)";

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function uniq(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/**
 * `loans` are passed in: the page loads them once for both the loans tab and
 * this list, instead of reading them twice. A promise is fine — it's only
 * awaited at the end, so the loans and these reads load side by side.
 */
export async function loadDebts(
  supabase: SupabaseClient,
  { loans, todayIso = israelDateKey() }: { loans: Loan[] | Promise<Loan[]>; todayIso?: string }
): Promise<DebtsData> {
  const errors: string[] = [];

  const [expensesResult, balancesResult, wageItemsResult, usersResult] = await Promise.all([
    // Every unpaid / partly-paid expense, any date — no scan window: a debt from
    // two years ago is still a debt.
    fetchAllPagedResult<Row>((from, to) =>
      supabase
        .from("expenses")
        .select(EXPENSE_COLUMNS)
        .in("payment_status", ["not_paid", "partial"])
        .order("expense_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Every worker's net balance (not only the positive ones: an overpaid
    // worker's open shifts must not read as debt).
    fetchAllPagedResult<Row>((from, to) =>
      supabase.from("worker_balance_summary_view").select("user_id,owed_amount").range(from, to)
    ),
    fetchAllPagedResult<Row>((from, to) =>
      supabase
        .from("worker_debt_items_view")
        .select("source_type,source_id,user_id,project_id,source_date,due_date,period_month,owed_amount")
        .gt("owed_amount", 0.009)
        .range(from, to)
    ),
    fetchAllPagedResult<Row>((from, to) => supabase.from("users").select("id,full_name,email").range(from, to)),
  ]);

  if (expensesResult.error) errors.push("לא ניתן היה לטעון את ההוצאות שלא שולמו.");
  if (balancesResult.error || wageItemsResult.error) errors.push("לא ניתן היה לטעון את השכר שמגיע לעובדים.");

  const expenseRows: ExpenseDebtRow[] = ((expensesResult.data ?? []) as Row[]).map((row) => {
    const links = Array.isArray(row.project_expenses) ? (row.project_expenses as Row[]) : [];
    return {
      id: str(row.id) ?? "",
      expense_date: str(row.expense_date),
      amount: row.amount as number | string | null,
      paid_amount: row.paid_amount as number | string | null,
      payment_status: str(row.payment_status),
      payment_method: str(row.payment_method),
      paid_date: str(row.paid_date),
      category: str(row.category),
      description: str(row.description),
      notes: str(row.notes),
      business_domain: str(row.business_domain),
      account_id: str(row.account_id),
      order_id: str(row.order_id),
      property_id: str(row.property_id),
      project_id: str(links[0]?.project_id),
      installment_group_id: str(row.installment_group_id),
      installment_index: row.installment_index as number | string | null,
      installment_count: row.installment_count as number | string | null,
    };
  });
  const wageBalances = (balancesResult.error ? [] : balancesResult.data ?? []) as WageBalanceRow[];
  // Without the balances, open items alone would overstate what's owed — show
  // no wages rather than a wrong figure (the error line above says why).
  const wageItems = (balancesResult.error || wageItemsResult.error ? [] : wageItemsResult.data ?? []) as WageItemRow[];

  const userNames = new Map<string, string>();
  for (const row of (usersResult.data ?? []) as Row[]) {
    const id = str(row.id);
    if (id) userNames.set(id, str(row.full_name)?.trim() || str(row.email)?.trim() || "עובד");
  }

  // ── Wave 2: names of what the debts belong to ──
  const projectIds = uniq([...expenseRows.map((r) => r.project_id), ...wageItems.map((r) => str(r.project_id))]);
  const propertyIds = uniq(expenseRows.map((r) => r.property_id));
  const orderIds = uniq(expenseRows.map((r) => r.order_id));
  const [projectsResult, propertiesResult, ordersResult] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id,name").in("id", projectIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    propertyIds.length
      ? supabase.from("properties").select("id,name,address").in("id", propertyIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    orderIds.length
      ? supabase.from("order_overview_view").select("order_id,customer_name").in("order_id", orderIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  // Names are cosmetic: a failed lookup falls back to "פרויקט"/"נכס"/"הזמנה".
  const names: DebtSourceNames = { projects: new Map(), properties: new Map(), orders: new Map() };
  for (const row of (projectsResult.data ?? []) as Row[]) {
    const id = str(row.id);
    const name = str(row.name)?.trim();
    if (id && name) names.projects.set(id, name);
  }
  for (const row of (propertiesResult.data ?? []) as Row[]) {
    const id = str(row.id);
    if (id) names.properties.set(id, propertyDisplayName({ name: str(row.name), address: str(row.address) ?? "נכס" }));
  }
  for (const row of (ordersResult.data ?? []) as Row[]) {
    const id = str(row.order_id);
    const name = str(row.customer_name)?.trim();
    if (id && name) names.orders.set(id, name);
  }

  const items = sortDebts([
    ...buildExpenseDebts(expenseRows, names, todayIso),
    ...buildWageDebts(wageBalances, wageItems, userNames, names.projects, todayIso),
    ...buildLoanDebts(await loans, todayIso),
  ]);

  return { items, todayIso, errors };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { monthKeysBetween } from "@/lib/financial/earnedRevenue";

// ════════════════════════════════════════════════════════════════════════════
// Per-PROJECT breakdown for a period — the "prove it" detail behind the פרויקטים
// domain numbers on the reports. Each project active in [from,to] shows FOUR money
// figures, so nothing is hidden and nothing is spread that shouldn't be:
//   INCOME
//     • fullPrice   = gross customer price (same as the project page).
//     • earnedShare = fullPrice ÷ span-months × months-in-period — the slice of
//                     the price that belongs to this period (income is earned over
//                     the project's life). Σ earnedShare == the פרויקטים income.
//   EXPENSES (kept on their REAL date — NOT spread)
//     • fullExpenses   = the project's total cost (same as the project page).
//     • periodExpenses = what was actually spent on it THIS period (project-tagged
//                        expenses + worker labor earned on it, by real date).
//                        Σ periodExpenses == the פרויקטים expenses.
//   net = earnedShare − periodExpenses  (matches the domain row).
// ════════════════════════════════════════════════════════════════════════════

const PROJECTS_DOMAIN = "logistics_projects";
const EXCLUDED_PROJECT_STATUSES = new Set(["quote", "cancelled", "בוטל", "בוטלה"]);

export type ProjectBreakdownRow = {
  projectId: string;
  name: string;
  status: string | null;
  fullPrice: number;
  earnedShare: number;
  monthsInSpan: number;
  monthsInPeriod: number;
  fullExpenses: number;
  periodExpenses: number;
  net: number;
};

export type ProjectBreakdown = {
  rows: ProjectBreakdownRow[];
  totals: { earnedShare: number; periodExpenses: number; net: number };
  domainIncome: number;
  domainExpense: number;
  unassignedExpense: number; // domain expenses this period not tied to a specific project
};

type Row = Record<string, unknown>;

function toNum(v: unknown) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function str(v: unknown) {
  return typeof v === "string" ? v : null;
}
function mk(iso: string | null) {
  return iso ? iso.slice(0, 7) : null;
}

/**
 * Build the per-project breakdown for the period. `from`/`to` (YYYY-MM-DD or
 * YYYY-MM) bound which months count; when both are null every month counts.
 */
export async function loadProjectPeriodBreakdown(
  supabase: SupabaseClient,
  { from, to }: { from?: string | null; to?: string | null } = {}
): Promise<ProjectBreakdown> {
  const fromMonth = from ? from.slice(0, 7) : null;
  const toMonth = to ? to.slice(0, 7) : null;
  const inPeriod = (month: string) => (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);

  const [projectRows, financialRows, expenseRows, debtRows] = await Promise.all([
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("projects").select("id,name,start_date,end_date,created_at,status").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("project_financials_view").select("id,customer_total_price,total_expenses").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("expenses")
        .select("project_id,business_domain,amount,expense_date,transaction_date,payment_method")
        .range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("worker_debt_items_view").select("project_id,business_domain,period_month,earned_amount").range(lo, hi)
    ).catch(() => [] as Row[]),
  ]);

  const finById = new Map<string, { price: number; expenses: number }>();
  for (const r of financialRows) {
    const id = str(r.id);
    if (id) finById.set(id, { price: toNum(r.customer_total_price), expenses: toNum(r.total_expenses) });
  }

  // Actual THIS-PERIOD project expenses, by real date (card by purchase date), keyed
  // by project. Everything in the פרויקטים domain is counted so the sum equals the
  // domain expense; project-linked rows attach to their project, the rest are unassigned.
  const periodExpenseByProject = new Map<string, number>();
  let domainExpense = 0;
  const add = (pid: string | null, amount: number) => {
    domainExpense += amount;
    if (pid) periodExpenseByProject.set(pid, (periodExpenseByProject.get(pid) ?? 0) + amount);
  };
  for (const e of expenseRows) {
    if (str(e.business_domain) !== PROJECTS_DOMAIN) continue;
    const method = (str(e.payment_method) ?? "").trim().toLowerCase();
    const isCard = method === "credit_card" || method.includes("אשראי");
    const date = isCard && str(e.transaction_date) ? str(e.transaction_date) : str(e.expense_date);
    const month = mk(date);
    if (!month || !inPeriod(month)) continue;
    add(str(e.project_id), Math.abs(toNum(e.amount)));
  }
  for (const d of debtRows) {
    if (str(d.business_domain) !== PROJECTS_DOMAIN) continue;
    const month = str(d.period_month);
    if (!month || !inPeriod(month)) continue;
    add(str(d.project_id), Math.abs(toNum(d.earned_amount)));
  }

  const rows: ProjectBreakdownRow[] = [];
  let totalEarned = 0;
  let totalPeriodExpense = 0;
  for (const p of projectRows) {
    const id = str(p.id);
    if (!id) continue;
    if (EXCLUDED_PROJECT_STATUSES.has((str(p.status) ?? "").trim().toLowerCase())) continue;
    const fin = finById.get(id);
    const fullPrice = fin?.price ?? 0;
    const fullExpenses = fin?.expenses ?? 0;
    const start = mk(str(p.start_date) ?? str(p.created_at));
    if (!start) continue;
    const spanMonths = monthKeysBetween(start, mk(str(p.end_date) ?? str(p.start_date) ?? start) ?? start);
    const monthsInPeriod = spanMonths.filter(inPeriod).length;
    const periodExpenses = periodExpenseByProject.get(id) ?? 0;
    if (monthsInPeriod === 0 && periodExpenses === 0) continue;
    const earnedShare = fullPrice > 0 && spanMonths.length > 0 ? (fullPrice / spanMonths.length) * monthsInPeriod : 0;
    if (earnedShare === 0 && periodExpenses === 0) continue;
    rows.push({
      projectId: id,
      name: str(p.name) ?? "פרויקט",
      status: str(p.status),
      fullPrice,
      earnedShare,
      monthsInSpan: spanMonths.length,
      monthsInPeriod,
      fullExpenses,
      periodExpenses,
      net: earnedShare - periodExpenses,
    });
    totalEarned += earnedShare;
    totalPeriodExpense += periodExpenses;
  }

  rows.sort((a, b) => b.earnedShare - a.earnedShare);

  return {
    rows,
    totals: { earnedShare: totalEarned, periodExpenses: totalPeriodExpense, net: totalEarned - totalPeriodExpense },
    domainIncome: totalEarned,
    domainExpense,
    unassignedExpense: Math.max(0, domainExpense - totalPeriodExpense),
  };
}

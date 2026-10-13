import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { loadEarnedLaborItems } from "@/lib/financial/laborSplit";
import { israelDateKey } from "@/lib/timezone";

// ════════════════════════════════════════════════════════════════════════════
// Per-DOMAIN transaction proof (everything EXCEPT projects, which has its own
// prorated breakdown). For the selected domain in the לפי תחום tab, list the raw
// items that make up its earned income and expenses for the period — so the
// domain number is provable line-by-line, exactly like the project detail.
//   INCOME  • מכירות (sales)  → each order, in its order-date month (whole order).
//           • שוטף/ספייסיט/נכסים/בית/צדקה → payments tagged to that domain, by date,
//             received or still expected (a bounced one is left out).
//   EXPENSES (every domain) → each expense (card by purchase date) + one grouped
//           "שכר עובדים {month}" line for worker labor earned that month.
// Mirrors lib/financial/earnedRevenue so the totals match the domain row.
// ════════════════════════════════════════════════════════════════════════════

const PROJECTS_DOMAIN = "logistics_projects";
const OTHER_INCOME_DOMAINS = new Set(["general_business", "spaceit", "property_management", "home", "charity"]);
const EXCLUDED_ORDER_STATUSES = new Set(["cancelled", "בוטלה"]);

export type DomainProofItem = { date: string | null; label: string; amount: number };
export type DomainProof = {
  income: DomainProofItem[];
  expenses: DomainProofItem[];
  incomeTotal: number;
  expenseTotal: number;
};
export type DomainProofMap = Record<string, DomainProof>;

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

export async function loadDomainProof(
  supabase: SupabaseClient,
  { from, to }: { from?: string | null; to?: string | null } = {}
): Promise<DomainProofMap> {
  const fromMonth = from ? from.slice(0, 7) : null;
  const toMonth = to ? to.slice(0, 7) : null;
  const inPeriod = (month: string | null) =>
    !!month && (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth);

  const map: DomainProofMap = {};
  const thisMonth = israelDateKey().slice(0, 7);
  const bucket = (domain: string) => {
    let b = map[domain];
    if (!b) {
      b = { income: [], expenses: [], incomeTotal: 0, expenseTotal: 0 };
      map[domain] = b;
    }
    return b;
  };

  const [orderRows, paymentRows, expenseRows, laborItems] = await Promise.all([
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("order_overview_view").select("order_id,order_date,total_amount,status,customer_name").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("payments")
        .select("payment_date,amount_total,business_domain,payment_status,notes,reference_number,order_id,project_id")
        .range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("expenses")
        .select("expense_date,transaction_date,amount,business_domain,payment_method,description,category")
        .range(lo, hi)
    ),
    // Same labour split as the domain totals (lib/financial/laborSplit).
    loadEarnedLaborItems(supabase),
  ]);

  // Sales income = each order in its order-date month.
  for (const o of orderRows) {
    if (EXCLUDED_ORDER_STATUSES.has((str(o.status) ?? "").trim().toLowerCase())) continue;
    const date = str(o.order_date);
    if (!inPeriod(mk(date))) continue;
    const amount = toNum(o.total_amount);
    if (amount === 0) continue;
    const b = bucket("sales");
    b.income.push({ date, label: str(o.customer_name)?.trim() || "הזמנה", amount });
    b.incomeTotal += amount;
  }

  // Other-domain income = payments tagged to that domain, received or still
  // expected (same rule as lib/financial/earnedRevenue). Order/project payments
  // are inside those totals already.
  for (const p of paymentRows) {
    const domain = str(p.business_domain) ?? "";
    if (!OTHER_INCOME_DOMAINS.has(domain)) continue;
    if (str(p.order_id) || str(p.project_id)) continue;
    const status = (str(p.payment_status) ?? "").trim().toLowerCase();
    if (status === "rejected") continue;
    const expected = status === "pending";
    // Expected money for a month still to come waits for it (as in earnedRevenue).
    if (expected && (str(p.payment_date) ?? "").slice(0, 7) > thisMonth) continue;
    const date = str(p.payment_date);
    if (!inPeriod(mk(date))) continue;
    const amount = toNum(p.amount_total);
    if (amount === 0) continue;
    const b = bucket(domain);
    const label = str(p.notes)?.trim() || str(p.reference_number)?.trim() || "תקבול";
    b.income.push({ date, label: expected ? `${label} (צפוי)` : label, amount });
    b.incomeTotal += amount;
  }

  // Expenses (every domain except projects). Card charges by purchase date.
  for (const e of expenseRows) {
    const domain = str(e.business_domain) ?? "";
    if (!domain || domain === PROJECTS_DOMAIN) continue;
    const method = (str(e.payment_method) ?? "").trim().toLowerCase();
    const isCard = method === "credit_card" || method.includes("אשראי");
    const date = isCard && str(e.transaction_date) ? str(e.transaction_date) : str(e.expense_date);
    if (!inPeriod(mk(date))) continue;
    const amount = Math.abs(toNum(e.amount));
    if (amount === 0) continue;
    const b = bucket(domain);
    b.expenses.push({ date, label: str(e.description)?.trim() || str(e.category)?.trim() || "הוצאה", amount });
    b.expenseTotal += amount;
  }

  // Worker labor — one line PER WORKER per domain per month (excluding projects),
  // so the wage number is provable by name: which worker earned how much, when.
  // Sessions of the same worker in a month collapse into that worker's line; its
  // date is the latest work/pay date in the group (falls back to the month start).
  const laborByWorker = new Map<string, { domain: string; month: string; userId: string; amount: number; date: string | null }>();
  for (const item of laborItems) {
    const domain = item.domain;
    if (domain === PROJECTS_DOMAIN) continue;
    const month = item.month;
    if (!month || !inPeriod(month)) continue;
    const amount = item.amount;
    if (amount === 0) continue;
    const userId = item.userId ?? "__unknown__";
    const sourceDate = item.date;
    const key = `${domain}|${month}|${userId}`;
    const existing = laborByWorker.get(key);
    if (existing) {
      existing.amount += amount;
      if (sourceDate && (!existing.date || sourceDate > existing.date)) existing.date = sourceDate;
    } else {
      laborByWorker.set(key, { domain, month, userId, amount, date: sourceDate });
    }
  }

  // Resolve worker ids → names for the labels (one query for the whole set).
  const workerIds = Array.from(new Set(Array.from(laborByWorker.values()).map((w) => w.userId).filter((id) => id !== "__unknown__")));
  const nameById = new Map<string, string>();
  if (workerIds.length > 0) {
    const { data: userRows } = await supabase.from("users").select("id,full_name").in("id", workerIds);
    for (const u of (userRows ?? []) as Row[]) {
      const id = str(u.id);
      const name = str(u.full_name)?.trim();
      if (id && name) nameById.set(id, name);
    }
  }

  for (const w of laborByWorker.values()) {
    const b = bucket(w.domain);
    const name = nameById.get(w.userId) || "עובד";
    b.expenses.push({ date: w.date ?? `${w.month}-01`, label: `שכר — ${name} (${w.month})`, amount: w.amount });
    b.expenseTotal += w.amount;
  }

  // Newest first within each list.
  for (const b of Object.values(map)) {
    b.income.sort((a, c) => (c.date ?? "").localeCompare(a.date ?? ""));
    b.expenses.sort((a, c) => (c.date ?? "").localeCompare(a.date ?? ""));
  }

  return map;
}

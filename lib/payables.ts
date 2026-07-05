import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadFinancialEntries,
  type FinancialEntry,
  type FinancialEntryStage,
  type FinancialEntryOrigin,
} from "@/lib/financial";

// ── Payments calendar item ─────────────────────────────────────────────────────
// One outgoing obligation placed on a calendar day. Sourced from the single
// financial engine (loadFinancialEntries → outflow entries), so totals always
// agree with /financial. Only `origin === "expense"` items carry an `expenseId`
// and are actionable (mark-paid / edit / split); everything else (worker wages,
// loan repayments) is display-only and links to its own page via `sourceHref`.

export type PaymentCalendarItem = {
  id: string;
  date: string; // YYYY-MM-DD (the flow date the money leaves)
  amount: number;
  label: string;
  sourceLabel: string;
  sourceHref: string | null;
  stage: FinancialEntryStage; // scheduled (צפוי) | pending (ממתין) | posted (בפועל)
  paymentStatus: string | null;
  origin: FinancialEntryOrigin;
  domainName: string;
  // Expense-only fields (present ⇒ actionable):
  expenseId: string | null;
  category: string | null;
  businessDomain: string | null;
  accountId: string | null;
  paidAmount: number | null;
  descriptionRaw: string | null;
  notes: string | null;
  overdue: boolean; // pending AND past its date
  installmentGroupId: string | null;
  installmentIndex: number | null;
  installmentCount: number | null;
  workerUserId: string | null; // set on wage items + projected salaries
};

/**
 * Map the full financial ledger to outgoing calendar items. Keeps only outflow
 * entries; an entry is `overdue` when it's still pending and its flow date has
 * already passed.
 */
export function toPaymentCalendarItems(entries: FinancialEntry[], todayIso: string): PaymentCalendarItem[] {
  return entries
    .filter((entry) => entry.type === "outflow")
    .map((entry) => ({
      id: entry.id,
      date: entry.flowDate,
      amount: entry.amount,
      label: entry.description,
      sourceLabel: entry.sourceLabel,
      sourceHref: entry.sourceHref,
      stage: entry.stage,
      paymentStatus: entry.paymentStatus,
      origin: entry.origin,
      domainName: entry.domainName,
      expenseId: entry.expenseId ?? null,
      category: entry.expenseCategory ?? null,
      businessDomain: entry.businessDomain,
      accountId: entry.expenseAccountId ?? null,
      paidAmount: entry.expensePaidAmount ?? null,
      descriptionRaw: entry.expenseDescriptionRaw ?? null,
      notes: entry.expenseNotes ?? null,
      overdue: entry.stage === "pending" && entry.flowDate < todayIso,
      installmentGroupId: entry.expenseInstallmentGroupId ?? null,
      installmentIndex: entry.expenseInstallmentIndex ?? null,
      installmentCount: entry.expenseInstallmentCount ?? null,
      workerUserId: entry.workerUserId ?? null,
    }));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// The next `count` occurrences of day-of-month `dueDay` that are on/after `todayIso`.
export function upcomingDueDates(todayIso: string, dueDay: number, count: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(todayIso);
  if (!m) return [];
  let year = Number(m[1]);
  let month = Number(m[2]) - 1; // 0-based
  const out: string[] = [];
  let guard = 0;
  while (out.length < count && guard < count + 14) {
    guard += 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(Math.max(1, dueDay), lastDay);
    const candidate = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    if (candidate >= todayIso) out.push(candidate);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}

/**
 * Calendar-only forecast of monthly salaries: for each active monthly worker,
 * emit scheduled (צפוי) payment items on the upcoming salary due date(s), computed
 * from the salary agreement — WITHOUT touching payroll accounting. De-duped against
 * real wage items (worker_owed / worker_payment) already present for that
 * worker+month, so a generated payslip supersedes the projection.
 */
export async function loadProjectedSalaries(
  supabase: SupabaseClient,
  { referenceDate, existingItems, months = 2 }: {
    referenceDate: string;
    existingItems: PaymentCalendarItem[];
    months?: number;
  }
): Promise<PaymentCalendarItem[]> {
  const { data: agrRows, error } = await supabase
    .from("salary_agreements")
    .select("id,user_id,salary_type,monthly_salary,valid_from,valid_to,due_day_of_next_month")
    .eq("salary_type", "monthly");
  if (error || !agrRows?.length) return [];

  type AgrRow = {
    user_id: string | null;
    monthly_salary: number | string | null;
    valid_from: string | null;
    valid_to: string | null;
    due_day_of_next_month: number | string | null;
  };
  const byUser = new Map<string, AgrRow[]>();
  for (const raw of agrRows as AgrRow[]) {
    if (!raw.user_id) continue;
    const list = byUser.get(raw.user_id) ?? [];
    list.push(raw);
    byUser.set(raw.user_id, list);
  }
  const userIds = [...byUser.keys()];
  if (userIds.length === 0) return [];

  const { data: userRows } = await supabase
    .from("users")
    .select("id,full_name,email,active")
    .in("id", userIds);
  const userById = new Map(
    ((userRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null; active: boolean | null }>)
      .map((u) => [u.id, u] as const)
  );

  // Months already covered by a real (visible) wage item for a worker.
  const realWageMonths = new Set<string>();
  for (const item of existingItems) {
    if ((item.origin === "worker_owed" || item.origin === "worker_payment") && item.workerUserId) {
      realWageMonths.add(`${item.workerUserId}:${item.date.slice(0, 7)}`);
    }
  }

  const refPoint = new Date(referenceDate);
  const items: PaymentCalendarItem[] = [];
  for (const [userId, list] of byUser) {
    const user = userById.get(userId);
    if (user && user.active === false) continue;
    const active = list.find((a) => {
      if (!a.valid_from) return false;
      const from = new Date(a.valid_from);
      const to = a.valid_to ? new Date(`${a.valid_to}T23:59:59.999`) : null;
      if (Number.isNaN(from.getTime()) || from > refPoint) return false;
      if (to && to < refPoint) return false;
      return true;
    });
    if (!active) continue;
    const monthly = Number(active.monthly_salary);
    if (!Number.isFinite(monthly) || monthly <= 0) continue;
    const dueDay = Number(active.due_day_of_next_month) || 10;
    const name = user?.full_name?.trim() || user?.email?.trim() || "עובד";

    for (const due of upcomingDueDates(referenceDate, dueDay, months)) {
      const ym = due.slice(0, 7);
      if (realWageMonths.has(`${userId}:${ym}`)) continue;
      items.push({
        id: `salary_proj:${userId}:${ym}`,
        date: due,
        amount: monthly,
        label: `משכורת ${name}`,
        sourceLabel: "שכר צפוי",
        sourceHref: "/payroll",
        stage: "scheduled",
        paymentStatus: null,
        origin: "worker_owed",
        domainName: "שכר עובדים",
        expenseId: null,
        category: null,
        businessDomain: null,
        accountId: null,
        paidAmount: null,
        descriptionRaw: null,
        notes: null,
        overdue: false,
        installmentGroupId: null,
        installmentIndex: null,
        installmentCount: null,
        workerUserId: userId,
      });
    }
  }
  return items;
}

/**
 * Load all outgoing payments for the calendar. `monthsBack` widens the scan
 * window so unpaid items from earlier still show (default 13 months, matching the
 * financial page); future-dated scheduled items are always included.
 */
export async function loadPaymentCalendarItems(
  supabase: SupabaseClient,
  { monthsBack = 13 }: { monthsBack?: number } = {}
): Promise<{ items: PaymentCalendarItem[]; todayIso: string }> {
  const since = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.toISOString().slice(0, 10);
  })();
  const { entries, referenceDate } = await loadFinancialEntries(supabase, { from: since });
  const items = toPaymentCalendarItems(entries, referenceDate);
  // Forecast upcoming monthly salaries onto the calendar (calendar-only; never
  // breaks the page if payroll data is unreadable).
  const projected = await loadProjectedSalaries(supabase, { referenceDate, existingItems: items }).catch(() => []);
  return { items: [...items, ...projected], todayIso: referenceDate };
}

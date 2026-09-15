import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLoans } from "@/lib/loans";
import {
  DEFAULT_REMINDER_WORK_DAYS,
  effectiveReminderWorkDays,
  isMonthlyPlan,
  isOutflowSourceKind,
  sourceSettingKey,
  type OutflowSourceRow,
  type OutflowSourceSettings,
} from "@/lib/outflow-source-settings";

// ════════════════════════════════════════════════════════════════════════════
// "מקורות נוספים" — the money that reaches the payments calendar from OTHER
// parts of the system (not from a recurring-expense template):
//
//   salary  one row per worker on a monthly salary agreement (payroll owns the
//           amount and the pay day — due_day_of_next_month)
//   loan    one row per loan the business is repaying (the loan page owns the
//           instalment plan)
//   card    one row per credit card with a statement history (statements own
//           the charges; the calendar marks the card's usual day)
//
// The amounts and dates are read from their owners and never copied. What the
// user sets HERE — and only here — is the planning layer around each source:
// active or not (off = not on the board, never alerts), how many WORK days
// before its date to be alerted (Fri+Sat don't count, same as recurring
// bills), and which bank account it leaves from (so the board's account filter
// and the cash calculator can scope it). Stored in outflow_source_settings,
// keyed by (kind, key) — the worker's user id, the loan id, or the card label.
// The pure pieces (types, defaults, key helpers) live in
// lib/outflow-source-settings.ts so the client can share them.
// ════════════════════════════════════════════════════════════════════════════

export * from "@/lib/outflow-source-settings";

export async function loadOutflowSourceSettings(supabase: SupabaseClient): Promise<OutflowSourceSettings> {
  const settings: OutflowSourceSettings = new Map();
  try {
    const { data, error } = await supabase
      .from("outflow_source_settings")
      .select("source_kind,source_key,reminder_work_days_before,account_id,is_active");
    // Table not migrated yet / no access → no settings, never a failed page.
    if (error) return settings;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const kind = row.source_kind;
      const key = row.source_key;
      if (!isOutflowSourceKind(kind) || typeof key !== "string" || !key) continue;
      const n = row.reminder_work_days_before;
      settings.set(sourceSettingKey(kind, key), {
        reminderWorkDaysBefore: typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : null,
        accountId: typeof row.account_id === "string" && row.account_id ? row.account_id : null,
        isActive: row.is_active !== false,
      });
    }
  } catch {
    // same as above
  }
  return settings;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** The next calendar date with day-of-month `day` on/after `todayIso` (clamped to month length). */
export function nextOccurrenceOfDay(todayIso: string, day: number): string {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7)); // 1-based
  for (let i = 0; i < 3; i++) {
    const d = new Date(year, month - 1 + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const last = new Date(y, m, 0).getDate();
    const candidate = `${y}-${pad2(m)}-${pad2(Math.min(Math.max(1, day), last))}`;
    if (candidate >= todayIso) return candidate;
  }
  return todayIso;
}

type AgreementRow = {
  user_id: string | null;
  salary_type: string | null;
  monthly_salary: number | string | null;
  valid_from: string | null;
  valid_to: string | null;
  due_day_of_next_month: number | string | null;
};

async function loadSalarySources(supabase: SupabaseClient, todayIso: string, throwOnError: boolean): Promise<OutflowSourceRow[]> {
  // Every worker with an agreement in force: a monthly wage is a known amount;
  // an hourly worker still gets paid on the same due day, just an amount that
  // depends on hours — listed as משתנה so it can be planned and alerted.
  const { data: agrRows, error } = await supabase
    .from("salary_agreements")
    .select("id,user_id,salary_type,monthly_salary,valid_from,valid_to,due_day_of_next_month");
  if (error) {
    if (throwOnError) throw new Error(`salary_agreements: ${error.message}`);
    return [];
  }
  if (!agrRows?.length) return [];

  const byUser = new Map<string, AgreementRow[]>();
  for (const raw of agrRows as AgreementRow[]) {
    if (!raw.user_id) continue;
    byUser.set(raw.user_id, [...(byUser.get(raw.user_id) ?? []), raw]);
  }
  const userIds = [...byUser.keys()];
  if (userIds.length === 0) return [];

  const { data: userRows } = await supabase.from("users").select("id,full_name,email,active").in("id", userIds);
  const userById = new Map(
    ((userRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null; active: boolean | null }>).map(
      (u) => [u.id, u] as const
    )
  );

  const rows: OutflowSourceRow[] = [];
  // Months already paid: a wage payment dated inside the pay month covers that
  // month's salary (the board de-dupes its projection the same way) — no alert.
  const paidMonths = new Set<string>();
  {
    const { data: payRows } = await supabase
      .from("worker_payments")
      .select("user_id,payment_date")
      .in("user_id", userIds)
      .gte("payment_date", `${todayIso.slice(0, 7)}-01`);
    for (const row of (payRows ?? []) as Array<{ user_id: string | null; payment_date: string | null }>) {
      if (row.user_id && row.payment_date) paidMonths.add(`${row.user_id}:${row.payment_date.slice(0, 7)}`);
    }
  }
  for (const [userId, list] of byUser) {
    const user = userById.get(userId);
    if (user && user.active === false) continue;
    // The agreement in force today (same selection as the calendar's projection).
    const active = list.find((a) => {
      if (!a.valid_from) return false;
      if (a.valid_from > todayIso) return false;
      if (a.valid_to && a.valid_to < todayIso) return false;
      return true;
    });
    if (!active) continue;
    const isHourly = active.salary_type === "hourly";
    const monthlyWage = Number(active.monthly_salary);
    if (!isHourly && !(Number.isFinite(monthlyWage) && monthlyWage > 0)) continue;
    const dueDay = Number(active.due_day_of_next_month) || 10;
    const nextDate = nextOccurrenceOfDay(todayIso, dueDay);
    rows.push({
      kind: "salary",
      key: userId,
      name: `משכורת ${user?.full_name?.trim() || user?.email?.trim() || "עובד"}`,
      scheduleLabel: isHourly ? `${dueDay} לכל חודש · לפי שעות` : `${dueDay} לכל חודש`,
      nextDate,
      focusId: `salary_proj:${userId}:${nextDate.slice(0, 7)}`,
      amount: isHourly ? null : monthlyWage,
      href: "/payroll",
      reminderWorkDaysBefore: null,
      effectiveReminderDays: 0,
      accountId: null,
      isActive: true,
      settled: paidMonths.has(`${userId}:${nextDate.slice(0, 7)}`),
      monthly: !isHourly,
    });
  }
  return rows;
}

async function loadLoanSources(supabase: SupabaseClient, todayIso: string): Promise<OutflowSourceRow[]> {
  const loans = await fetchLoans(supabase);
  const rows: OutflowSourceRow[] = [];
  for (const loan of loans) {
    // Money going OUT: loans the business took and still repays.
    if (loan.direction !== "taken") continue;
    if (loan.status === "repaid" || loan.status === "written_off") continue;
    if (loan.plannedInstallments.length === 0) continue;
    const upcoming = loan.plannedInstallments.find((i) => i.repayment_date >= todayIso) ?? null;
    const overdue = loan.plannedInstallments.filter((i) => i.repayment_date < todayIso).length;
    const name = loan.lender?.trim() || loan.borrower?.trim() || "הלוואה";
    const remaining = loan.plannedInstallments.filter((i) => i.repayment_date >= todayIso);
    const monthly = isMonthlyPlan(remaining.map((i) => i.repayment_date));
    const overdueNote = overdue ? ` · ${overdue} באיחור` : "";
    const scheduleLabel =
      remaining.length === 1
        ? `תשלום חד-פעמי${overdueNote}`
        : upcoming?.installment_index && upcoming.installment_count
          ? `תשלום ${upcoming.installment_index} מתוך ${upcoming.installment_count}${monthly ? " · חודשי" : ""}${overdueNote}`
          : `${remaining.length} תשלומים מתוכננים${monthly ? " · חודשי" : ""}${overdueNote}`;
    rows.push({
      kind: "loan",
      key: loan.id,
      name: `החזר הלוואה — ${name}`,
      scheduleLabel,
      nextDate: upcoming?.repayment_date ?? null,
      focusId: upcoming ? `loan_planned:${upcoming.id}` : null,
      amount: upcoming?.amount ?? null,
      href: `/financial/loans/${loan.id}`,
      reminderWorkDaysBefore: null,
      effectiveReminderDays: 0,
      accountId: loan.account_id ?? null,
      isActive: true,
      settled: false,
      monthly,
    });
  }
  return rows;
}

type ChargeRow = { id: string; card_label: string | null; account_id: string | null; amount: number | string | null; charge_date: string | null };

async function loadCardSources(supabase: SupabaseClient, todayIso: string, throwOnError: boolean): Promise<OutflowSourceRow[]> {
  const { data, error } = await supabase.from("card_statement_charges").select("id,card_label,account_id,amount,charge_date");
  if (error) {
    if (throwOnError) throw new Error(`card_statement_charges: ${error.message}`);
    return [];
  }
  if (!data?.length) return [];
  // Latest real charge per card = its usual day of month (and its account).
  const latest = new Map<string, ChargeRow>();
  for (const row of data as ChargeRow[]) {
    if (!row.charge_date) continue;
    const label = (row.card_label ?? "").trim() || "כרטיס אשראי";
    const cur = latest.get(label);
    if (!cur || row.charge_date > cur.charge_date!) latest.set(label, { ...row, card_label: label });
  }
  const rows: OutflowSourceRow[] = [];
  for (const [label, last] of latest) {
    const lastDate = last.charge_date!.slice(0, 10);
    const day = Number(lastDate.slice(8, 10));
    // A real charge already recorded for a future date IS the next one; else
    // the card's usual day (the same forecast the calendar draws).
    const real = lastDate >= todayIso;
    const nextDate = real ? lastDate : nextOccurrenceOfDay(todayIso, day);
    rows.push({
      kind: "card",
      key: label,
      name: `חיוב כרטיס: ${label}`,
      scheduleLabel: `${day} לכל חודש · לפי הדף האחרון`,
      nextDate,
      focusId: real ? `ccharge:${last.id}` : `ccharge_proj:${label}:${nextDate.slice(0, 7)}`,
      // A recorded future charge has a real amount; a forecast deliberately none.
      amount: real && Number(last.amount) > 0 ? Number(last.amount) : null,
      href: "/financial/statements",
      reminderWorkDaysBefore: null,
      effectiveReminderDays: DEFAULT_REMINDER_WORK_DAYS.card,
      accountId: last.account_id,
      isActive: true,
      settled: false,
      monthly: false,
    });
  }
  return rows;
}

/**
 * Every non-template outflow source with its stored settings merged in.
 * For the tab (default) each loader swallows its own read errors — a missing
 * table must never take the page down, a source that can't be read is simply
 * absent. The alert rules pass `throwOnError`: the engine must NOT be handed
 * an empty list on a transient failure, or it would auto-close every open
 * reminder and re-ping them all an hour later.
 */
export async function loadOutflowSources(
  supabase: SupabaseClient,
  { todayIso, throwOnError = false }: { todayIso: string; throwOnError?: boolean }
): Promise<OutflowSourceRow[]> {
  const swallow = (p: Promise<OutflowSourceRow[]>) => (throwOnError ? p : p.catch(() => [] as OutflowSourceRow[]));
  const [salaries, loans, cards, settings] = await Promise.all([
    swallow(loadSalarySources(supabase, todayIso, throwOnError)),
    swallow(loadLoanSources(supabase, todayIso)),
    swallow(loadCardSources(supabase, todayIso, throwOnError)),
    loadOutflowSourceSettings(supabase),
  ]);
  return [...salaries, ...loans, ...cards].map((row) => {
    const setting = settings.get(sourceSettingKey(row.kind, row.key)) ?? null;
    return {
      ...row,
      reminderWorkDaysBefore: setting?.reminderWorkDaysBefore ?? null,
      effectiveReminderDays: effectiveReminderWorkDays(row.kind, setting),
      // Once a row is stored, its account is the answer — including "none"
      // (an explicit empty must not snap back to the loan's / card's own account).
      accountId: setting ? setting.accountId : row.accountId,
      isActive: setting?.isActive ?? true,
    };
  });
}

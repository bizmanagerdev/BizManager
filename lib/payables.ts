import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadFinancialEntries,
  type FinancialEntry,
  type FinancialEntryStage,
  type FinancialEntryOrigin,
} from "@/lib/financial";
import { getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";

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
  // The expense's linked target (if any) — needed to delete it via /api/expenses/delete.
  expenseProjectId: string | null;
  expenseOrderId: string | null;
  expensePropertyId: string | null;
  workerUserId: string | null; // set on wage items + projected salaries
  // Recurring-template FORECAST fields. Present ⇒ this is an upcoming recurring
  // occurrence that hasn't been generated yet. It has no expenseId; "mark paid"
  // materializes the concrete expense for this period (see the materialize-paid API).
  recurringTemplateId: string | null;
  recurrenceKey: string | null;
  // A variable-amount forecast (e.g. taxes): amount is unknown until paid. Shown as
  // "סכום משתנה"; mark-paid asks for the actual amount.
  variableAmount: boolean;
  // True for a bank standing-order (הוראת קבע) occurrence: it auto-creates as PAID
  // on its date, so it's shown for cash flow but is NOT something "to pay" (no
  // manual action / no due-payment alert).
  autoPaid: boolean;
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
      expenseProjectId: entry.expenseProjectId ?? null,
      expenseOrderId: entry.expenseOrderId ?? null,
      expensePropertyId: entry.expensePropertyId ?? null,
      workerUserId: entry.workerUserId ?? null,
      // Generated-from-a-recurring-template expenses carry the template id (has an
      // expenseId, so it's NOT a forecast — the "recurring only" filter still catches it).
      recurringTemplateId: entry.expenseRecurringTemplateId ?? null,
      recurrenceKey: null,
      variableAmount: false,
      autoPaid: false,
    }));
}

function applyRecurringTokens(value: string | null, periodKey: string, expenseDate: string): string | null {
  if (!value) return null;
  return value
    .split("{{period_key}}").join(periodKey)
    .split("{{expense_date}}").join(expenseDate)
    .split("{{expense_month}}").join(expenseDate.slice(0, 7));
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
        expenseProjectId: null,
        expenseOrderId: null,
        expensePropertyId: null,
        workerUserId: userId,
        recurringTemplateId: null,
        recurrenceKey: null,
        variableAmount: false,
        autoPaid: false,
      });
    }
  }
  return items;
}

/**
 * Calendar forecast of upcoming recurring bills. The generator only materializes
 * an expense once its create-day arrives, so future months' recurring payments are
 * invisible until then. This projects the next `months` occurrences of each active
 * template as scheduled (צפוי) items — de-duped against periods already generated —
 * so they show ahead of time. Each carries `recurringTemplateId` + `recurrenceKey`
 * so "mark paid" can materialize the concrete expense (materialize-paid API).
 */
export async function loadProjectedRecurringExpenses(
  supabase: SupabaseClient,
  { referenceDate, months = 12 }: { referenceDate: string; months?: number }
): Promise<PaymentCalendarItem[]> {
  const { data: tplRows, error } = await supabase
    .from("recurring_expense_templates")
    .select("id,template_name,category,amount,is_variable_amount,auto_paid,description_template,notes_template,business_domain,account_id,frequency,interval_months,expense_day_of_month,expense_month_of_year,start_date,end_date,created_at,is_active")
    .eq("is_active", true);
  if (error || !tplRows?.length) return [];

  type Tpl = {
    id: string;
    template_name: string | null;
    category: string | null;
    amount: number | string | null;
    is_variable_amount: boolean | null;
    auto_paid: boolean | null;
    description_template: string | null;
    notes_template: string | null;
    business_domain: string | null;
    account_id: string | null;
    frequency: string | null;
    interval_months: number | string | null;
    expense_day_of_month: number | string | null;
    expense_month_of_year: number | string | null;
    start_date: string | null;
    end_date: string | null;
    created_at: string | null;
  };
  const templates = tplRows as Tpl[];

  const monthIndex = (iso: string) => {
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    return y * 12 + (m - 1);
  };

  // Which template+period pairs already exist as real expense rows → skip those.
  const { data: existingRows } = await supabase
    .from("expenses")
    .select("recurring_expense_template_id,recurrence_key")
    .in("recurring_expense_template_id", templates.map((t) => t.id));
  const materialized = new Set<string>();
  for (const row of (existingRows ?? []) as Array<{ recurring_expense_template_id: string | null; recurrence_key: string | null }>) {
    if (row.recurring_expense_template_id && row.recurrence_key) {
      materialized.add(`${row.recurring_expense_template_id}:${row.recurrence_key}`);
    }
  }

  // Look back a few months so a due-but-not-yet-generated recurring occurrence
  // (variable OR fixed) still shows as pending/overdue instead of vanishing.
  const LOOKBACK_MONTHS = 3;
  const refYear = Number(referenceDate.slice(0, 4));
  const refMonth = Number(referenceDate.slice(5, 7));

  const items: PaymentCalendarItem[] = [];
  for (const tpl of templates) {
    const isVar = tpl.is_variable_amount === true;
    // For a variable bill the stored amount is an ESTIMATE (e.g. ~mortgage) used
    // for cash planning — carry it so the forecast/total isn't blind to it.
    const amount = Number(tpl.amount) || 0;
    if (!isVar && !(Number.isFinite(amount) && amount > 0)) continue;
    const expenseDay = Number(tpl.expense_day_of_month) || 1;

    // Occurrence dates within the forecast horizon.
    const occurrences: Array<{ date: string; key: string }> = [];
    if (tpl.frequency === "yearly") {
      const expMonth = Number(tpl.expense_month_of_year) || 1;
      for (const year of [refYear, refYear + 1]) {
        const lastDay = new Date(year, expMonth, 0).getDate();
        const day = Math.min(Math.max(1, expenseDay), lastDay);
        const date = `${year}-${pad2(expMonth)}-${pad2(day)}`;
        if (date >= referenceDate) { occurrences.push({ date, key: String(year) }); break; }
        if (isVar) { occurrences.push({ date, key: String(year) }); break; } // past annual variable — still show
      }
    } else {
      // Monthly, possibly every N months. Only keep occurrence months on the
      // interval phase, counted from the anchor (start_date, else created_at).
      const interval = Math.max(1, Number(tpl.interval_months) || 1);
      const anchorIso = tpl.start_date || tpl.created_at?.slice(0, 10) || referenceDate;
      const anchorIdx = monthIndex(anchorIso);
      // Look back a few months for EVERY recurring template (not just variable): a
      // due-but-not-yet-generated occurrence earlier this month would otherwise be
      // invisible. Anything already generated is removed by the de-dup below.
      for (let i = -LOOKBACK_MONTHS; i < months; i++) {
        const d = new Date(refYear, refMonth - 1 + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const diff = y * 12 + (m - 1) - anchorIdx;
        if (diff < 0 || diff % interval !== 0) continue;
        const lastDay = new Date(y, m, 0).getDate();
        const day = Math.min(Math.max(1, expenseDay), lastDay);
        const date = `${y}-${pad2(m)}-${pad2(day)}`;
        occurrences.push({ date, key: date.slice(0, 7) });
      }
    }

    for (const occ of occurrences) {
      if (materialized.has(`${tpl.id}:${occ.key}`)) continue;
      if (tpl.start_date && occ.date < tpl.start_date) continue;
      if (tpl.end_date && occ.date > tpl.end_date) continue;
      const desc = applyRecurringTokens(tpl.description_template, occ.key, occ.date);
      // The template NAME is the human-facing title (matches the recurring
      // manager list) — lead with it, not the free-text description/category.
      const label = tpl.template_name || desc || tpl.category || "הוצאה קבועה";
      const isPast = occ.date < referenceDate;
      items.push({
        id: `recur_proj:${tpl.id}:${occ.key}`,
        date: occ.date,
        amount,
        label,
        sourceLabel: "הוצאה קבועה",
        sourceHref: null,
        stage: isPast ? "pending" : "scheduled",
        paymentStatus: "not_paid",
        origin: "expense",
        domainName: tpl.business_domain ? getBusinessDomainLabel(tpl.business_domain) : "",
        expenseId: null,
        category: tpl.category,
        businessDomain: tpl.business_domain,
        accountId: tpl.account_id,
        paidAmount: null,
        descriptionRaw: desc,
        notes: applyRecurringTokens(tpl.notes_template, occ.key, occ.date),
        overdue: isPast,
        installmentGroupId: null,
        installmentIndex: null,
        installmentCount: null,
        expenseProjectId: null,
        expenseOrderId: null,
        expensePropertyId: null,
        workerUserId: null,
        recurringTemplateId: tpl.id,
        recurrenceKey: occ.key,
        variableAmount: isVar,
        autoPaid: tpl.auto_paid === true,
      });
    }
  }
  return items;
}

/**
 * Credit-card statement lump charges (card_statement_charges — the one
 * account-ledger line per card per statement, see lib/accounts.ts) shown on
 * the payments calendar: every REAL recorded charge on its charge_date, plus
 * a forecast for the next period(s) that don't have a real charge yet —
 * estimated from that card's most recent real charge (amount + day of
 * month) — so a card due for its monthly statement shows up ahead of time,
 * like a bank standing order (הוראת קבע). A forecast disappears the moment a
 * real charge is recorded for that period (same "materialized wins" pattern
 * as loadProjectedRecurringExpenses). Both kinds are `autoPaid: true` — the
 * amount already left (or will leave) the account on its own; there is no
 * "mark paid" action for a lump card charge, only editing it from the
 * statement it came from (real) or waiting for the real one (forecast).
 * Independent of lib/financial — this table is deliberately never read
 * there, so it can't double the P&L (the statement's itemized, domain-tagged
 * expenses already carry that cost).
 */
export async function loadCardChargeItems(
  supabase: SupabaseClient,
  { referenceDate }: { referenceDate: string }
): Promise<PaymentCalendarItem[]> {
  const { data: chargeRows, error } = await supabase
    .from("card_statement_charges")
    .select("id,statement_id,card_label,account_id,amount,charge_date,notes");
  if (error || !chargeRows?.length) return [];

  type ChargeRow = {
    id: string;
    statement_id: string | null;
    card_label: string | null;
    account_id: string | null;
    amount: number | string | null;
    charge_date: string | null;
    notes: string | null;
  };
  const charges = (chargeRows as ChargeRow[]).filter(
    (r) => r.charge_date && Number(r.amount) > 0
  );

  const items: PaymentCalendarItem[] = [];
  const coveredMonths = new Set<string>(); // "cardLabel:YYYY-MM" — already has a real charge
  const latestByCard = new Map<string, ChargeRow>();

  for (const row of charges) {
    const cardLabel = (row.card_label ?? "").trim() || "כרטיס אשראי";
    const date = row.charge_date!.slice(0, 10);
    const amount = Number(row.amount);
    coveredMonths.add(`${cardLabel}:${date.slice(0, 7)}`);
    items.push({
      id: `ccharge:${row.id}`,
      date,
      amount,
      label: `חיוב כרטיס: ${cardLabel}`,
      sourceLabel: "חיוב כרטיס אשראי",
      sourceHref: row.statement_id ? `/financial/statements/${row.statement_id}` : "/financial/statements",
      stage: date <= referenceDate ? "posted" : "scheduled",
      paymentStatus: null,
      origin: "expense",
      domainName: "",
      expenseId: null,
      category: cardLabel,
      businessDomain: null,
      accountId: row.account_id,
      paidAmount: date <= referenceDate ? amount : null,
      descriptionRaw: null,
      notes: row.notes,
      overdue: false,
      installmentGroupId: null,
      installmentIndex: null,
      installmentCount: null,
      expenseProjectId: null,
      expenseOrderId: null,
      expensePropertyId: null,
      workerUserId: null,
      recurringTemplateId: null,
      recurrenceKey: null,
      variableAmount: false,
      autoPaid: true,
    });
    const cur = latestByCard.get(cardLabel);
    if (!cur || date > cur.charge_date!.slice(0, 10)) latestByCard.set(cardLabel, row);
  }

  // Forecast: for each card with history, project every month from right
  // after its last real charge through one month past today that doesn't
  // already have a real charge — so a statement that's overdue for
  // processing keeps showing (not just next month's).
  const refIdx = Number(referenceDate.slice(0, 4)) * 12 + (Number(referenceDate.slice(5, 7)) - 1);
  for (const [cardLabel, last] of latestByCard) {
    const lastDate = last.charge_date!.slice(0, 10);
    const dueDay = Number(lastDate.slice(8, 10));
    const amount = Number(last.amount);
    const lastIdx = Number(lastDate.slice(0, 4)) * 12 + (Number(lastDate.slice(5, 7)) - 1);
    const endIdx = refIdx + 1; // through one month ahead of today
    for (let idx = lastIdx + 1; idx <= endIdx; idx++) {
      const y = Math.floor(idx / 12);
      const m = (idx % 12) + 1;
      const ym = `${y}-${pad2(m)}`;
      if (coveredMonths.has(`${cardLabel}:${ym}`)) continue;
      const lastDayOfMonth = new Date(y, m, 0).getDate();
      const day = Math.min(dueDay, lastDayOfMonth);
      const date = `${y}-${pad2(m)}-${pad2(day)}`;
      items.push({
        id: `ccharge_proj:${cardLabel}:${ym}`,
        date,
        amount,
        label: `חיוב כרטיס: ${cardLabel}`,
        sourceLabel: "חיוב כרטיס אשראי — צפוי",
        sourceHref: "/financial/statements",
        stage: date < referenceDate ? "pending" : "scheduled",
        paymentStatus: "not_paid",
        origin: "expense",
        domainName: "",
        expenseId: null,
        category: cardLabel,
        businessDomain: null,
        accountId: last.account_id,
        paidAmount: null,
        descriptionRaw: null,
        notes: null,
        overdue: date < referenceDate,
        installmentGroupId: null,
        installmentIndex: null,
        installmentCount: null,
        expenseProjectId: null,
        expenseOrderId: null,
        expensePropertyId: null,
        workerUserId: null,
        recurringTemplateId: null,
        recurrenceKey: null,
        variableAmount: true, // estimated from the last real charge — shown as "משוער"
        autoPaid: true,
      });
    }
  }

  return items;
}

// Convert a projected outflow calendar item into a FinancialEntry so the money
// engine can fold the forecast into its FUTURE/forecast views (never actual/P&L).
function projectedItemToEntry(item: PaymentCalendarItem): FinancialEntry {
  return {
    id: item.id,
    type: "outflow",
    amount: item.amount,
    signedAmount: -item.amount,
    businessDomain: (item.businessDomain as ExpenseBusinessDomain | null) ?? null,
    domainName: item.domainName,
    flowDate: item.date,
    recordedDate: item.date,
    dueDate: item.date,
    stage: item.stage,
    sourceKind: "general",
    sourceId: null,
    sourceLabel: item.sourceLabel,
    sourceHref: item.sourceHref,
    description: item.label,
    origin: item.origin,
    reference: null,
    paymentMethod: null,
    paymentMethodLabel: null,
    paymentStatus: item.paymentStatus,
    recordedByName: null,
    customerId: null,
    searchText: item.label,
    workerUserId: item.workerUserId,
    expenseRecurringTemplateId: item.recurringTemplateId,
  };
}

/**
 * Projected OUTFLOW forecasts (upcoming monthly salaries + recurring bills) as
 * FinancialEntry[], for the /financial future/forecast views — so expected money
 * going OUT shows there too, symmetric with expected income (receivables). All
 * stage `scheduled`/`pending`, so they never count as actual cash or hit the P&L.
 * Bounded to `months` (6). Recurring self-de-dupes against materialized rows;
 * salaries are de-duped later (the engine drops months with a real wage entry).
 */
export async function loadProjectedOutflowEntries(
  supabase: SupabaseClient,
  { referenceDate, months = 6 }: { referenceDate: string; months?: number }
): Promise<FinancialEntry[]> {
  const [salaries, recurring] = await Promise.all([
    loadProjectedSalaries(supabase, { referenceDate, existingItems: [], months }).catch(() => []),
    loadProjectedRecurringExpenses(supabase, { referenceDate, months }).catch(() => []),
  ]);
  return [...salaries, ...recurring].map(projectedItemToEntry);
}

/**
 * Which itemized card-purchase expenses (from card_statement_rows) already
 * have their card+statement superseded by a single recorded lump charge
 * (card_statement_charges) — see loadCardChargeItems. The calendar must show
 * EITHER the lump sum OR the itemized detail for a given card+period, never
 * both, or the same money reads as leaving the account twice on that day.
 * P&L/domain reports are untouched — they still read every itemized expense
 * individually; this set only trims what the CALENDAR displays.
 */
export async function loadCardChargedExpenseIds(supabase: SupabaseClient): Promise<Set<string>> {
  try {
    const [{ data: rowData, error: rowError }, { data: chargeData, error: chargeError }] = await Promise.all([
      supabase.from("card_statement_rows").select("expense_id,statement_id,card_label,category").not("expense_id", "is", null),
      supabase.from("card_statement_charges").select("statement_id,card_label"),
    ]);
    if (rowError || chargeError) return new Set();

    const charged = new Set(
      ((chargeData ?? []) as Array<{ statement_id: string | null; card_label: string | null }>).map(
        (c) => `${c.statement_id}:${(c.card_label ?? "").trim()}`
      )
    );
    const excluded = new Set<string>();
    for (const row of (rowData ?? []) as Array<{
      expense_id: string | null;
      statement_id: string | null;
      card_label: string | null;
      category: string | null;
    }>) {
      if (!row.expense_id) continue;
      // card_label is the stable card identity (see the card_label migration)
      // — falls back to category only for a pre-migration row that hasn't
      // been backfilled yet.
      const identity = (row.card_label ?? row.category ?? "").trim();
      const key = `${row.statement_id}:${identity}`;
      if (charged.has(key)) excluded.add(row.expense_id);
    }
    return excluded;
  } catch {
    return new Set();
  }
}

/**
 * Load all outgoing payments for the calendar. `monthsBack` widens the scan
 * window so unpaid items from earlier still show (default 13 months, matching the
 * financial page); future-dated scheduled items are always included.
 *
 * `preloaded` lets a caller that already ran `loadFinancialEntries` over an
 * equal-or-wider window (e.g. the dashboard, sharing one scan across the
 * payments card and the domain chart) skip a second full scan.
 */
export async function loadPaymentCalendarItems(
  supabase: SupabaseClient,
  {
    monthsBack = 13,
    preloaded,
  }: { monthsBack?: number; preloaded?: { entries: FinancialEntry[]; referenceDate: string } } = {}
): Promise<{ items: PaymentCalendarItem[]; todayIso: string }> {
  const { entries, referenceDate } = preloaded
    ? preloaded
    : await loadFinancialEntries(supabase, {
        from: (() => {
          const d = new Date();
          d.setMonth(d.getMonth() - monthsBack);
          return d.toISOString().slice(0, 10);
        })(),
      });
  const allItems = toPaymentCalendarItems(entries, referenceDate);
  // Forecast upcoming monthly salaries + recurring bills onto the calendar
  // (calendar-only; never breaks the page if a source is unreadable). Card
  // statement charges (real + forecast) are a separate, independent source —
  // see loadCardChargeItems — since card_statement_charges is deliberately
  // outside loadFinancialEntries.
  const [projectedSalaries, projectedRecurring, cardCharges, chargedExpenseIds] = await Promise.all([
    loadProjectedSalaries(supabase, { referenceDate, existingItems: allItems }).catch(() => []),
    loadProjectedRecurringExpenses(supabase, { referenceDate }).catch(() => []),
    loadCardChargeItems(supabase, { referenceDate }).catch(() => []),
    loadCardChargedExpenseIds(supabase),
  ]);
  // Drop the itemized card-purchase expenses whose card+period already has a
  // recorded lump charge — the lump sum (in cardCharges) replaces them here,
  // so the calendar doesn't show a day's spend twice.
  const items = chargedExpenseIds.size
    ? allItems.filter((i) => !(i.expenseId && chargedExpenseIds.has(i.expenseId)))
    : allItems;
  return { items: [...items, ...projectedSalaries, ...projectedRecurring, ...cardCharges], todayIso: referenceDate };
}

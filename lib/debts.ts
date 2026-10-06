import { formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { expenseOpenAmount, expensePaidSoFar, normalizeExpensePaymentState } from "@/lib/financial/expenseOpen";
import type { Loan } from "@/lib/loans";

// ════════════════════════════════════════════════════════════════════════════
// חובות — every shekel the business still owes, in one list.
//
// Three kinds, each read from where it already lives (nothing new is stored):
//   expense — an expense marked לא שולם / שולם חלקית (a supplier invoice, a bill,
//             an installment). Its open amount is expenseOpenAmount — the one rule.
//   wages   — what a worker is still owed, per worker, from the payroll views
//             (the same balance the salary centre shows for that worker).
//   loan    — the unpaid principal of a loan we TOOK.
//
// An item can owe on more than one date (an installment series, a worker's
// several unpaid shifts, a loan's repayment plan), so its money is kept as
// dated `parts` — that is what every total, the timing buckets and the report
// are built from. This module is pure (no Supabase): lib/debts-load.ts reads
// the rows and hands them to the builders below.
// ════════════════════════════════════════════════════════════════════════════

export type DebtKind = "expense" | "wages" | "loan";
export const DEBT_KINDS: DebtKind[] = ["expense", "wages", "loan"];

export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  expense: "הוצאות שלא שולמו",
  wages: "שכר עובדים",
  loan: "הלוואות",
};

/** When the money is due, relative to today. */
export type DebtTiming = "overdue" | "soon" | "later" | "undated";
export const DEBT_TIMINGS: DebtTiming[] = ["overdue", "soon", "later", "undated"];
/** "Soon" = due today or within this many days. */
export const DEBT_SOON_DAYS = 7;

export const DEBT_TIMING_LABEL: Record<DebtTiming, string> = {
  overdue: "באיחור",
  soon: `ב-${DEBT_SOON_DAYS} הימים הקרובים`,
  later: "בהמשך",
  undated: "ללא תאריך",
};

/** Part of an item's debt that falls due on one date (null = no date was ever set). */
export type DebtPart = { date: string | null; amount: number };

export type DebtLink = { label: string; href: string };

/** One unpaid / partly-paid expense row. An installment series is several of these. */
export type ExpenseDebtLine = {
  expenseId: string;
  /** expense_date — the day the bill is due. */
  date: string;
  /** The whole bill. */
  amount: number;
  paid: number;
  open: number;
  paymentStatus: "not_paid" | "partial";
  /** The stored paid_amount, untouched — the edit dialog seeds from it. */
  paidAmount: number | null;
  paymentMethod: string | null;
  paidDate: string | null;
  accountId: string | null;
  category: string | null;
  description: string | null;
  notes: string | null;
  businessDomain: string | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
  installmentIndex: number | null;
  installmentCount: number | null;
  timing: DebtTiming;
};

/** One shift / payslip a worker hasn't been fully paid for. */
export type WageDebtLine = {
  key: string;
  label: string;
  /** The day it was due to be paid. */
  date: string | null;
  open: number;
  projectId: string | null;
  projectName: string | null;
};

export type DebtItem = {
  key: string;
  kind: DebtKind;
  title: string;
  subtitle: string | null;
  /** Where the debt lives (its project / property / order, the worker, the loan). */
  link: DebtLink | null;
  /** The nearest date money is due (null when no part has a date). */
  dueDate: string | null;
  /** The most urgent timing among the item's parts. */
  timing: DebtTiming;
  /** Days since the oldest overdue part fell due (0 unless overdue). */
  daysLate: number;
  /** The whole obligation … */
  total: number;
  /** … what's already been paid against it … */
  paid: number;
  /** … and what's still owed (= Σ parts). */
  open: number;
  businessDomain: string | null;
  domainName: string;
  /** The account the money leaves from, when the item has one. */
  accountId: string | null;
  parts: DebtPart[];
  expenseLines?: ExpenseDebtLine[];
  wageLines?: WageDebtLine[];
  /** Wages only: payments made to the worker but not tied to a specific shift
   *  or payslip yet. Already taken off `open` (from the oldest items first). */
  unallocatedCredit?: number;
  loanId?: string;
  searchText: string;
};

// ── Small utilities ─────────────────────────────────────────────────────────

const EPSILON = 0.009;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toNum(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toDay(value: unknown): string | null {
  const s = toStr(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function toIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const to = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

export function debtTimingFor(date: string | null, todayIso: string): DebtTiming {
  if (!date) return "undated";
  const day = date.slice(0, 10);
  if (day < todayIso) return "overdue";
  if (day <= addDaysIso(todayIso, DEBT_SOON_DAYS)) return "soon";
  return "later";
}

const TIMING_RANK: Record<DebtTiming, number> = { overdue: 0, soon: 1, later: 2, undated: 3 };

function sortPartsByDate(parts: DebtPart[]): DebtPart[] {
  return parts.slice().sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
}

/** The headline timing / date / lateness of an item, from its open parts. */
export function summarizeParts(parts: DebtPart[], todayIso: string): Pick<DebtItem, "dueDate" | "timing" | "daysLate"> {
  const open = sortPartsByDate(parts.filter((p) => p.amount > EPSILON));
  let timing: DebtTiming = "undated";
  for (const part of open) {
    const t = debtTimingFor(part.date, todayIso);
    if (TIMING_RANK[t] < TIMING_RANK[timing]) timing = t;
  }
  const dueDate = open.find((p) => p.date !== null)?.date ?? null;
  const daysLate = timing === "overdue" && dueDate ? Math.max(daysBetween(dueDate, todayIso), 0) : 0;
  return { dueDate, timing, daysLate };
}

/** Takes `credit` off the oldest parts first (an unassigned payment pays the oldest debt). */
export function applyCreditToOldest(parts: DebtPart[], credit: number): DebtPart[] {
  let remaining = Math.max(credit, 0);
  const result: DebtPart[] = [];
  for (const part of sortPartsByDate(parts)) {
    const take = Math.min(part.amount, remaining);
    remaining -= take;
    const left = round2(part.amount - take);
    if (left > EPSILON) result.push({ date: part.date, amount: left });
  }
  return result;
}

// ── Expenses ────────────────────────────────────────────────────────────────

/** An `expenses` row as lib/debts-load.ts reads it (plus its project link, resolved). */
export type ExpenseDebtRow = {
  id: string;
  expense_date: string | null;
  amount: number | string | null;
  paid_amount: number | string | null;
  payment_status: string | null;
  payment_method: string | null;
  paid_date: string | null;
  category: string | null;
  description: string | null;
  notes: string | null;
  business_domain: string | null;
  account_id: string | null;
  order_id: string | null;
  property_id: string | null;
  project_id: string | null;
  installment_group_id: string | null;
  installment_index: number | string | null;
  installment_count: number | string | null;
};

/** Display names for the places a debt can belong to. */
export type DebtSourceNames = {
  projects: Map<string, string>;
  properties: Map<string, string>;
  orders: Map<string, string>;
};

function toExpenseLine(row: ExpenseDebtRow, todayIso: string): ExpenseDebtLine | null {
  const state = normalizeExpensePaymentState(row.payment_status);
  if (state !== "not_paid" && state !== "partial") return null;
  const date = toDay(row.expense_date);
  if (!row.id || !date) return null;
  const input = { amount: row.amount, paid_amount: row.paid_amount, payment_status: state };
  const open = expenseOpenAmount(input);
  if (open <= EPSILON) return null;
  return {
    expenseId: row.id,
    date,
    amount: round2(Math.max(toNum(row.amount), 0)),
    paid: expensePaidSoFar(input),
    open,
    paymentStatus: state,
    paidAmount: row.paid_amount === null || row.paid_amount === undefined ? null : toNum(row.paid_amount),
    paymentMethod: toStr(row.payment_method),
    paidDate: toDay(row.paid_date),
    accountId: toStr(row.account_id),
    category: toStr(row.category)?.trim() ?? null,
    description: toStr(row.description)?.trim() ?? null,
    notes: toStr(row.notes)?.trim() ?? null,
    businessDomain: toStr(row.business_domain),
    projectId: toStr(row.project_id),
    orderId: toStr(row.order_id),
    propertyId: toStr(row.property_id),
    installmentIndex: toIntOrNull(row.installment_index),
    installmentCount: toIntOrNull(row.installment_count),
    timing: debtTimingFor(date, todayIso),
  };
}

/**
 * Where an expense debt lives. A project or property page marks its expense
 * rows with `expense:<id>`, so `?focus=` lands on the row itself; an order or an
 * unlinked expense opens in the ledger, which opens the expense.
 */
function expenseLink(line: ExpenseDebtLine, names: DebtSourceNames): DebtLink {
  const focus = `?focus=${encodeURIComponent(`expense:${line.expenseId}`)}`;
  if (line.projectId) {
    return { label: names.projects.get(line.projectId) ?? "פרויקט", href: `/projects/${line.projectId}${focus}` };
  }
  if (line.propertyId) {
    return { label: names.properties.get(line.propertyId) ?? "נכס", href: `/properties/${line.propertyId}${focus}` };
  }
  if (line.orderId) {
    const who = names.orders.get(line.orderId);
    return { label: who ? `הזמנה — ${who}` : "הזמנה", href: `/sales/orders/${line.orderId}` };
  }
  return { label: "בתזרים", href: `/financial${focus}` };
}

export function installmentLabel(line: Pick<ExpenseDebtLine, "installmentIndex" | "installmentCount">): string | null {
  return line.installmentIndex && line.installmentCount
    ? `תשלום ${line.installmentIndex} מתוך ${line.installmentCount}`
    : null;
}

/**
 * Unpaid / partly-paid expenses → debt items. An installment series (rows that
 * share an installment_group_id) is ONE item — "יציקה לחצר · 11 תשלומים" — with
 * each installment kept as its own line, instead of eleven identical rows.
 */
export function buildExpenseDebts(rows: ExpenseDebtRow[], names: DebtSourceNames, todayIso: string): DebtItem[] {
  const groups = new Map<string, ExpenseDebtLine[]>();
  for (const row of rows) {
    const line = toExpenseLine(row, todayIso);
    if (!line) continue;
    const key = row.installment_group_id ? `expense_group:${row.installment_group_id}` : `expense:${line.expenseId}`;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const items: DebtItem[] = [];
  for (const [key, unsorted] of groups) {
    const lines = unsorted.slice().sort((a, b) => a.date.localeCompare(b.date) || a.expenseId.localeCompare(b.expenseId));
    const first = lines[0];
    const title = first.description || first.category || "הוצאה";
    const series = lines.length > 1
      ? `${lines.length} תשלומים פתוחים`
      : installmentLabel(first);
    const subtitle = [first.description ? first.category : null, series].filter(Boolean).join(" · ") || null;
    const parts = lines.map((l) => ({ date: l.date, amount: l.open }));
    const link = expenseLink(first, names);
    const accountIds = new Set(lines.map((l) => l.accountId));
    items.push({
      key,
      kind: "expense",
      title,
      subtitle,
      link,
      ...summarizeParts(parts, todayIso),
      total: round2(lines.reduce((s, l) => s + l.amount, 0)),
      paid: round2(lines.reduce((s, l) => s + l.paid, 0)),
      open: round2(lines.reduce((s, l) => s + l.open, 0)),
      businessDomain: first.businessDomain,
      domainName: getBusinessDomainLabel(first.businessDomain),
      accountId: accountIds.size === 1 ? first.accountId : null,
      parts,
      expenseLines: lines,
      searchText: [title, first.category, first.description, first.notes, link.label, getBusinessDomainLabel(first.businessDomain)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    });
  }
  return items;
}

// ── Wages ───────────────────────────────────────────────────────────────────

/** worker_balance_summary_view: one row per worker, net of every payment made to them. */
export type WageBalanceRow = { user_id: string | null; owed_amount: number | string | null };

/** worker_debt_items_view: one row per shift / payslip. */
export type WageItemRow = {
  source_type: string | null;
  source_id: string | null;
  user_id: string | null;
  project_id: string | null;
  source_date: string | null;
  due_date: string | null;
  period_month: string | null;
  owed_amount: number | string | null;
};

function wageLineLabel(row: WageItemRow): string {
  if (row.source_type === "payslip") {
    const month = toDay(row.period_month) ?? toDay(row.source_date);
    return month ? `משכורת ${month.slice(5, 7)}/${month.slice(0, 4)}` : "משכורת";
  }
  const day = toDay(row.source_date);
  return day ? `משמרת ${formatShortDate(day)}` : "משמרת";
}

/**
 * What each worker is still owed. The amount is the worker's own balance from
 * worker_balance_summary_view — the figure the salary centre shows for them —
 * which already takes off payments not yet tied to a specific shift/payslip.
 * Those unassigned payments are taken off the OLDEST open items first, so the
 * dates left on the item are the ones still actually unpaid. A worker who is
 * overpaid overall owes nothing here (their credit is not netted against what
 * other workers are owed).
 */
export function buildWageDebts(
  balances: WageBalanceRow[],
  itemRows: WageItemRow[],
  userNames: Map<string, string>,
  projectNames: Map<string, string>,
  todayIso: string
): DebtItem[] {
  const balanceByUser = new Map<string, number>();
  for (const row of balances) {
    if (row.user_id) balanceByUser.set(row.user_id, toNum(row.owed_amount));
  }
  const linesByUser = new Map<string, WageDebtLine[]>();
  for (const row of itemRows) {
    const owed = round2(toNum(row.owed_amount));
    if (!row.user_id || owed <= EPSILON) continue;
    const projectId = toStr(row.project_id);
    const list = linesByUser.get(row.user_id) ?? [];
    list.push({
      key: `${row.source_type ?? "item"}:${row.source_id ?? list.length}`,
      label: wageLineLabel(row),
      date: toDay(row.due_date) ?? toDay(row.source_date),
      open: owed,
      projectId,
      projectName: projectId ? projectNames.get(projectId) ?? null : null,
    });
    linesByUser.set(row.user_id, list);
  }

  const userIds = new Set<string>([...linesByUser.keys(), ...[...balanceByUser].filter(([, v]) => v > EPSILON).map(([k]) => k)]);
  const items: DebtItem[] = [];
  for (const userId of userIds) {
    const lines = (linesByUser.get(userId) ?? []).slice().sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    const itemsSum = round2(lines.reduce((s, l) => s + l.open, 0));
    const net = round2(balanceByUser.has(userId) ? balanceByUser.get(userId)! : itemsSum);
    if (net <= EPSILON) continue;
    const credit = round2(Math.max(itemsSum - net, 0));
    let parts = applyCreditToOldest(lines.map((l) => ({ date: l.date, amount: l.open })), credit);
    // The balance says more is owed than the open items explain — keep it, undated.
    const explained = round2(parts.reduce((s, p) => s + p.amount, 0));
    if (net - explained > EPSILON) parts = [...parts, { date: null, amount: round2(net - explained) }];
    const name = userNames.get(userId) ?? "עובד";
    items.push({
      key: `wages:${userId}`,
      kind: "wages",
      title: name,
      subtitle: lines.length === 1 ? lines[0].label : lines.length > 1 ? `${lines.length} פריטים פתוחים` : null,
      link: { label: "לכרטיס העובד", href: `/payroll/workers/${userId}` },
      ...summarizeParts(parts, todayIso),
      // A worker's balance has no "out of" — earnings and payments run on
      // continuously — so total = what's owed and nothing reads as "שולם X
      // מתוך Y". The unassigned payment is spelled out in the item's detail.
      total: net,
      paid: 0,
      open: net,
      businessDomain: null,
      domainName: "שכר עובדים",
      accountId: null,
      parts,
      wageLines: lines,
      unallocatedCredit: credit,
      searchText: [name, "שכר", ...lines.map((l) => l.projectName ?? "")].join(" ").toLowerCase(),
    });
  }
  return items;
}

// ── Loans ───────────────────────────────────────────────────────────────────

/**
 * Loans we TOOK that aren't repaid. The unpaid principal is spread over the
 * repayment plan (each planned installment's principal, oldest first), and
 * whatever the plan doesn't cover falls on the loan's due date — or has no date
 * at all, which is exactly the loan that otherwise never shows as owed.
 */
export function buildLoanDebts(loans: Loan[], todayIso: string): DebtItem[] {
  const items: DebtItem[] = [];
  for (const loan of loans) {
    if (loan.direction !== "taken") continue;
    if (loan.derivedStatus === "repaid" || loan.derivedStatus === "written_off") continue;
    const outstanding = round2(loan.outstanding);
    if (outstanding <= EPSILON) continue;

    const parts: DebtPart[] = [];
    let remaining = outstanding;
    for (const installment of loan.plannedInstallments) {
      if (remaining <= EPSILON) break;
      const principal = Math.max(installment.amount - installment.interest_amount, 0);
      const take = round2(Math.min(principal, remaining));
      if (take > EPSILON) parts.push({ date: toDay(installment.repayment_date), amount: take });
      remaining = round2(remaining - take);
    }
    if (remaining > EPSILON) parts.push({ date: toDay(loan.due_date), amount: remaining });

    const lender = loan.lender?.trim() || "הלוואה";
    const planned = loan.plannedInstallments.length;
    const schedule = planned > 0
      ? planned === 1 ? "החזר מתוכנן" : `${planned} החזרים מתוכננים`
      : loan.due_date ? "פירעון" : "ללא מועד פירעון";
    items.push({
      key: `loan:${loan.id}`,
      kind: "loan",
      title: lender,
      subtitle: [schedule, loan.notes?.trim() || null].filter(Boolean).join(" · "),
      link: { label: "לפרטי ההלוואה", href: `/financial/loans/${loan.id}` },
      ...summarizeParts(parts, todayIso),
      total: round2(loan.amount),
      paid: round2(loan.repaidPrincipal),
      open: outstanding,
      businessDomain: loan.business_domain,
      domainName: getBusinessDomainLabel(loan.business_domain),
      accountId: loan.account_id,
      parts,
      loanId: loan.id,
      searchText: [lender, loan.notes ?? "", loan.documentation ?? "", "הלוואה"].join(" ").toLowerCase(),
    });
  }
  return items;
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/** Most urgent first: by timing, then the oldest date, then the bigger debt. */
export function sortDebts(items: DebtItem[]): DebtItem[] {
  return items.slice().sort(
    (a, b) =>
      TIMING_RANK[a.timing] - TIMING_RANK[b.timing] ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.open - a.open ||
      a.title.localeCompare(b.title, "he")
  );
}

// ── Totals & the report ─────────────────────────────────────────────────────

export type DebtTotals = Record<DebtTiming, number> & { open: number; count: number };

export function emptyDebtTotals(): DebtTotals {
  return { open: 0, overdue: 0, soon: 0, later: 0, undated: 0, count: 0 };
}

function addItem(totals: DebtTotals, item: DebtItem, todayIso: string) {
  for (const part of item.parts) {
    if (!(part.amount > EPSILON)) continue;
    const timing = debtTimingFor(part.date, todayIso);
    totals[timing] = round2(totals[timing] + part.amount);
    totals.open = round2(totals.open + part.amount);
  }
  totals.count += 1;
}

export function totalDebts(items: DebtItem[], todayIso: string): DebtTotals {
  const totals = emptyDebtTotals();
  for (const item of items) addItem(totals, item, todayIso);
  return totals;
}

export function totalDebtsByKind(items: DebtItem[], todayIso: string): Record<DebtKind, DebtTotals> {
  const byKind = { expense: emptyDebtTotals(), wages: emptyDebtTotals(), loan: emptyDebtTotals() };
  for (const item of items) addItem(byKind[item.kind], item, todayIso);
  return byKind;
}

export type DebtBreakdownRow = { key: string; label: string; totals: DebtTotals };

function breakdown(
  items: DebtItem[],
  todayIso: string,
  keyOf: (item: DebtItem) => { key: string; label: string }
): DebtBreakdownRow[] {
  const rows = new Map<string, DebtBreakdownRow>();
  for (const item of items) {
    const { key, label } = keyOf(item);
    const row = rows.get(key) ?? { key, label, totals: emptyDebtTotals() };
    addItem(row.totals, item, todayIso);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.totals.open - a.totals.open);
}

export const NO_ACCOUNT_KEY = "none";

/** Which account the money will leave from. Wages carry none — they're paid per worker. */
export function debtsByAccount(items: DebtItem[], accountNames: Map<string, string>, todayIso: string): DebtBreakdownRow[] {
  return breakdown(items, todayIso, (item) =>
    item.accountId
      ? { key: item.accountId, label: accountNames.get(item.accountId) ?? "חשבון שנמחק" }
      : { key: NO_ACCOUNT_KEY, label: "ללא חשבון" }
  );
}

export function debtsByDomain(items: DebtItem[], todayIso: string): DebtBreakdownRow[] {
  return breakdown(items, todayIso, (item) => ({ key: item.kind === "wages" ? "wages" : item.businessDomain ?? "general_business", label: item.domainName }));
}

/**
 * By the month each payment falls due, oldest first — late months included, so
 * "late" reads as how late (August, September…) rather than one lump. Months
 * more than `monthsAhead` ahead are one "אחר כך" row; no date is "ללא תאריך".
 * Only months with money in them. A debt counts once in every month it has a
 * payment in.
 */
export function debtsByDueMonth(items: DebtItem[], todayIso: string, monthsAhead = 6): DebtBreakdownRow[] {
  const start = new Date(`${todayIso.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + monthsAhead - 1);
  const lastKey = start.toISOString().slice(0, 7);
  const monthLabel = (key: string) =>
    new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));

  const rows = new Map<string, DebtBreakdownRow>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const part of item.parts) {
      if (!(part.amount > EPSILON)) continue;
      const month = part.date ? part.date.slice(0, 7) : null;
      const key = month === null ? "undated" : month > lastKey ? "later" : month;
      const label = key === "undated" ? "ללא תאריך" : key === "later" ? "אחר כך" : monthLabel(key);
      const row = rows.get(key) ?? { key, label, totals: emptyDebtTotals() };
      const timing = debtTimingFor(part.date, todayIso);
      row.totals[timing] = round2(row.totals[timing] + part.amount);
      row.totals.open = round2(row.totals.open + part.amount);
      if (!seen.has(key)) {
        row.totals.count += 1;
        seen.add(key);
      }
      rows.set(key, row);
    }
  }
  // Months in calendar order ("YYYY-MM" sorts as plain text), then אחר כך,
  // then ללא תאריך ("~" sorts after every digit by code unit — not localeCompare).
  const rank = (key: string) => (key === "undated" ? "~2" : key === "later" ? "~1" : key);
  return [...rows.values()].sort((a, b) => {
    const left = rank(a.key);
    const right = rank(b.key);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

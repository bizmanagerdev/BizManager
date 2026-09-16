// Pure helpers of the payments board — no React. Everything the grid, the day
// panel, the alerts chip and the cash calculator compute from a list of
// PaymentCalendarItem lives here so it can be tested in node and reused by an
// incoming-money view unchanged.
import { isoLocal, toDateOnly } from "@/components/ui/month-calendar";
import type { CalendarDirection, PaymentCalendarItem } from "@/lib/payables";

export type Option = { id: string; label: string };

// The income dialog wants more than {id,label} for its pickers (a project shows
// its customer, an order its date). The page builds these from the same queries
// that produce `Option`, and the board just carries them through.
export type IncomeOptions = {
  projects: Array<{ id: string; name: string; customerName: string }>;
  orders: Array<{ id: string; name: string; subtitle?: string }>;
  properties: Array<{ id: string; name: string; subtitle?: string }>;
};

// ── Direction (יוצא / נכנס / הכל) ──────────────────────────────────────────────
// The board shows money going out, money coming in, or both. "Both" is the
// reason this is a switch on one board rather than a second page: only there
// can a day be read as a net figure.
export type DirectionFilter = CalendarDirection | "all";
export const DIRECTION_PARAM = "dir";
export const DIRECTION_OPTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: "out", label: "יוצא" },
  { value: "in", label: "נכנס" },
  { value: "all", label: "הכל" },
];
// Outgoing is the default and writes nothing to the URL, so the board people
// have been using for months keeps its clean address.
export function directionFromParam(value: string | null): DirectionFilter {
  return value === "in" || value === "all" ? value : "out";
}
export function filterByDirection(items: PaymentCalendarItem[], dir: DirectionFilter): PaymentCalendarItem[] {
  return dir === "all" ? items : items.filter((i) => i.direction === dir);
}

// What the money is called in each direction. An incoming row is never
// "שולם"/"לתשלום" — it is collected, and it is owed TO us.
export const DIRECTION_WORDS: Record<CalendarDirection, {
  markAction: string; settled: string; dayTotal: string; allSettled: string; empty: string; add: string; late: string;
}> = {
  out: {
    markAction: "סמן כשולם",
    settled: "שולם",
    dayTotal: "לתשלום ביום זה",
    allSettled: "כל התשלומים ביום זה שולמו",
    empty: "אין תשלומים ביום זה",
    add: "הוסף תשלום ליום זה",
    late: "תשלומים באיחור",
  },
  in: {
    markAction: "סמן כנגבה",
    settled: "נגבה",
    dayTotal: "לגבייה ביום זה",
    allSettled: "כל התקבולים ביום זה נגבו",
    empty: "אין תקבולים ביום זה",
    add: "הוסף תקבול ליום זה",
    late: "תקבולים באיחור",
  },
};

// What a mutation wants shown afterwards: the item by calendar id, or the
// expense row it created/changed (the calendar id of a real row is `expense:<uuid>`).
export type ItemFocus = { id?: string | null; expenseId?: string | null };
// Resolves only once the board has re-rendered with fresh server data.
export type MutateFn = (focus?: ItemFocus) => Promise<void>;

// The per-item actions a card can offer (absent = not offered for that item).
export type ItemActions = {
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  editLabel?: string;
};

export function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

// How an amount reads on a row: a variable bill shows its ESTIMATE as "~₪X"
// (or "משתנה" when no estimate was given); everything else is the exact amount.
export function amountLabel(item: PaymentCalendarItem): string {
  if (item.variableAmount) return item.amount > 0 ? `~${fmtIls(item.amount)}` : "משתנה";
  return fmtIls(item.amount);
}

export function addDaysIso(iso: string, n: number): string {
  const d = toDateOnly(iso) ?? new Date();
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

// A pre-filled note for a reminder created from a payment.
export function reminderNoteFor(item: PaymentCalendarItem): string {
  return `תשלום: ${item.label} — ${amountLabel(item)}`;
}

// The same, for money we are waiting to receive — a collection reminder names
// who it is from, since that is who has to be called.
export function incomeReminderNoteFor(item: PaymentCalendarItem): string {
  const who = item.customerName ? ` מ${item.customerName}` : "";
  return `גבייה${who}: ${item.label} — ${amountLabel(item)}`;
}

// ── What can be done to a row ───────────────────────────────────────────────────
// Kept pure (and out of the dialogs' hook) because it is the one place the
// board decides what a row IS: money going out that can be paid, split and
// sometimes deleted, versus money coming in that can only be confirmed and
// corrected. Tested directly; the menu that renders it is not.
export type ItemCapabilities = {
  canMark: boolean;
  canEdit: boolean;
  canSplit: boolean;
  canDelete: boolean;
  /** The forecast's template, when "edit" means editing the rule instead of a row. */
  editsTemplateId: string | null;
};

export function itemCapabilities(
  item: PaymentCalendarItem,
  liveTemplateIds: ReadonlySet<string>
): ItemCapabilities {
  if (item.direction === "in") {
    // A receipt is confirmed, not paid, and only a real payments row can be:
    // a customer balance is a number derived from an order, with nothing to
    // collect against until money is actually recorded. Nothing incoming is an
    // expense row, so there is no split and no delete.
    const hasRow = Boolean(item.paymentId);
    return { canMark: hasRow, canEdit: hasRow, canSplit: false, canDelete: false, editsTemplateId: null };
  }
  const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
  // Auto-paid (הוראת קבע) needs no approval once the row exists, but a forecast
  // always needs a way in: until the generator runs there is nothing in the
  // ledger and no other way to record it.
  const canMark = Boolean(item.expenseId) || isForecast;
  // No delete for a bill that belongs to a live recurring template: the
  // generator walks every period and would just create it again, and a monthly
  // bill isn't something to delete one month of. An orphan — its template
  // already deleted — still gets מחיקה, since nothing will recreate it.
  const fromLiveTemplate = Boolean(item.recurringTemplateId && liveTemplateIds.has(item.recurringTemplateId));
  return {
    canMark,
    canEdit: Boolean(item.expenseId) || (isForecast && fromLiveTemplate),
    canSplit: Boolean(item.expenseId),
    canDelete: Boolean(item.expenseId) && !fromLiveTemplate,
    editsTemplateId: !item.expenseId && isForecast && fromLiveTemplate ? item.recurringTemplateId : null,
  };
}

// ── Stage presentation ──────────────────────────────────────────────────────────
export type StageKey = "overdue" | "pending" | "scheduled" | "posted";
export function itemStageKey(item: PaymentCalendarItem): StageKey {
  if (item.stage === "posted") return "posted";
  if (item.overdue) return "overdue";
  if (item.stage === "pending") return "pending";
  return "scheduled";
}
export const STAGE_LABEL: Record<StageKey, string> = {
  overdue: "באיחור",
  pending: "ממתין",
  scheduled: "צפוי",
  posted: "שולם",
};
/** The same four stages, worded for the direction the row belongs to. */
export function stageLabelFor(item: PaymentCalendarItem, stage: StageKey): string {
  return stage === "posted" ? DIRECTION_WORDS[item.direction].settled : STAGE_LABEL[stage];
}
// Status is NEVER blue (design rule): צפוי is slate/gray, not info-blue.
export const STAGE_DOT: Record<StageKey, string> = {
  overdue: "bg-destructive",
  pending: "bg-warning",
  scheduled: "bg-muted-foreground/60",
  posted: "bg-success",
};
export const STAGE_BADGE: Record<StageKey, "destructive" | "warning" | "neutral" | "success"> = {
  overdue: "destructive",
  pending: "warning",
  scheduled: "neutral",
  posted: "success",
};
export const STAGE_ORDER: StageKey[] = ["overdue", "pending", "scheduled", "posted"];

// ── The month in the URL ────────────────────────────────────────────────────────
// The month in view lives in the URL (`?month=YYYY-MM`; the current month is
// the default and writes nothing) so a refresh, or Back from a source page,
// lands on the same month.
export const MONTH_PARAM = "month";
export function monthFromParam(value: string | null): Date | null {
  const m = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}
export function monthToParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Grouping ────────────────────────────────────────────────────────────────────
export function groupByDay(items: PaymentCalendarItem[]): Map<string, PaymentCalendarItem[]> {
  const map = new Map<string, PaymentCalendarItem[]>();
  for (const item of items) {
    const key = item.date.slice(0, 10);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

// A day's still-open money (scheduled + pending), per direction. `net` is what
// the day actually does to the bank: in minus out.
export type DayTotals = { out: number; in: number; net: number };
export function openTotals(items: PaymentCalendarItem[]): DayTotals {
  let out = 0;
  let incoming = 0;
  for (const i of items) {
    if (i.stage === "posted") continue;
    if (i.direction === "in") incoming += i.amount;
    else out += i.amount;
  }
  return { out, in: incoming, net: incoming - out };
}

// "To pay" total for a day = amounts not yet paid (scheduled + pending).
export function unpaidTotal(items: PaymentCalendarItem[]): number {
  return items.reduce((sum, i) => (i.stage === "posted" ? sum : sum + i.amount), 0);
}

// What a grid cell shows for a day: one line per stage present. A variable
// bill's estimate counts toward the total (marked "~" so it reads as
// approximate); only mark `variable` when it actually has an estimate. One with
// NO estimate (a coming card charge) still has to leave a mark on the day, so
// the cell can't go blank just because the sum is 0.
export type DayStageSummary = { amount: number; variable: boolean; unknown: boolean };
export function summarizeDayByStage(items: PaymentCalendarItem[]): Map<StageKey, DayStageSummary> {
  const byStage = new Map<StageKey, DayStageSummary>();
  for (const item of items) {
    const st = itemStageKey(item);
    const cur = byStage.get(st) ?? { amount: 0, variable: false, unknown: false };
    cur.amount += item.amount;
    if (item.variableAmount && item.amount > 0) cur.variable = true;
    if (item.variableAmount && item.amount <= 0) cur.unknown = true;
    byStage.set(st, cur);
  }
  return byStage;
}
export function dayStageText(s: DayStageSummary): string | null {
  return s.amount > 0 ? `${s.variable ? "~" : ""}${fmtIls(s.amount)}` : s.unknown ? "משתנה" : null;
}

// ── Late payments (the header chip) ─────────────────────────────────────────────
// Only payments past their date and still unpaid. Auto-paid (הוראת קבע) bills
// need no action, so they're never "late". Planned loan installments (origin
// "loan" + not_paid) ARE payments to make. Amber while everything is under a
// week late, red once a bill is more than a week late.
export const OVERDUE_RED_AFTER_DAYS = 7;
export type AlertSeverity = "danger" | "warning";
export function lateItems(
  items: PaymentCalendarItem[],
  todayIso: string
): { late: PaymentCalendarItem[]; severity: AlertSeverity } {
  const t = toDateOnly(todayIso) ?? new Date();
  const todayStr = isoLocal(t);
  const redLine = isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() - OVERDUE_RED_AFTER_DAYS));
  const late = items
    .filter(
      (i) =>
        // Outgoing: a bill to pay. Auto-paid (הוראת קבע) needs no action, and a
        // planned loan instalment (origin "loan" + not_paid) does.
        // Incoming: anything still owed whose day has passed — the receivable
        // mapper has already refused to call an undelivered order late.
        (i.direction === "in" ||
          (i.origin === "expense" && !i.autoPaid) ||
          (i.origin === "loan" && i.paymentStatus === "not_paid")) &&
        i.stage !== "posted" &&
        i.date.slice(0, 10) < todayStr
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    late,
    severity: late.some((i) => i.date.slice(0, 10) < redLine) ? "danger" : "warning",
  };
}

// ── Cash needs ("how much will I need between X and Y?") ────────────────────────
// Sums every not-yet-paid outflow in a date range. Variable bills contribute
// their estimate, and the total is marked "~" when any estimate is in it.
export type CashNeedsFilter = { from: string; to: string; recurringOnly: boolean; accountFilter: string };
export function cashNeeds(
  items: PaymentCalendarItem[],
  { from, to, recurringOnly, accountFilter }: CashNeedsFilter
): { total: number; incoming: number; net: number; rows: PaymentCalendarItem[]; hasEstimate: boolean } {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const rows = items
    .filter(
      (i) =>
        i.stage !== "posted" &&
        i.date.slice(0, 10) >= lo &&
        i.date.slice(0, 10) <= hi &&
        (!recurringOnly || Boolean(i.recurringTemplateId)) &&
        (!accountFilter || i.accountId === accountFilter)
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const totals = openTotals(rows);
  const hasEstimate = rows.some((i) => i.variableAmount && i.amount > 0);
  // `total` stays "what has to go out" — the question the calculator was built
  // to answer. With money coming in too, `net` is what you really need to find.
  return { total: totals.out, incoming: totals.in, net: totals.net, rows, hasEstimate };
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Check, Split, ExternalLink, Calendar as CalendarIcon, List as ListIcon, BellPlus, AlertTriangle, ChevronDown, ChevronLeft, Trash2 } from "lucide-react";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { Account } from "@/lib/accounts";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import MonthCalendar, {
  MonthNav,
  fmtFullDay,
  isoLocal,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { SplitPaymentDialog } from "./SplitPaymentDialog";

function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

// How an amount reads on a row: a variable bill shows its ESTIMATE as "~₪X"
// (or "משתנה" when no estimate was given); everything else is the exact amount.
function amountLabel(item: PaymentCalendarItem): string {
  if (item.variableAmount) return item.amount > 0 ? `~${fmtIls(item.amount)}` : "משתנה";
  return fmtIls(item.amount);
}

function addDaysIso(iso: string, n: number): string {
  const d = toDateOnly(iso) ?? new Date();
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

// Delete an expense-origin payment row (e.g. an orphaned recurring bill left
// behind after its template was deleted). Real expenses only.
async function deleteExpenseItem(item: PaymentCalendarItem): Promise<boolean> {
  if (!item.expenseId) return false;
  try {
    const res = await fetch("/api/expenses/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: item.expenseId,
        project_id: item.expenseProjectId,
        order_id: item.expenseOrderId,
        property_id: item.expensePropertyId,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(toHebrewError(json.error, "מחיקת התשלום נכשלה."));
      return false;
    }
    toast.success("התשלום נמחק");
    return true;
  } catch (err) {
    toast.error(toHebrewError(err, "מחיקת התשלום נכשלה."));
    return false;
  }
}

// A pre-filled note for a reminder created from a payment.
function reminderNoteFor(item: PaymentCalendarItem): string {
  const amt = amountLabel(item);
  return `תשלום: ${item.label} — ${amt}`;
}

// ── Stage presentation ──────────────────────────────────────────────────────────
type StageKey = "overdue" | "pending" | "scheduled" | "posted";
function itemStageKey(item: PaymentCalendarItem): StageKey {
  if (item.stage === "posted") return "posted";
  if (item.overdue) return "overdue";
  if (item.stage === "pending") return "pending";
  return "scheduled";
}
const STAGE_LABEL: Record<StageKey, string> = {
  overdue: "באיחור",
  pending: "ממתין",
  scheduled: "צפוי",
  posted: "שולם",
};
// Status is NEVER blue (design rule): צפוי is slate/gray, not info-blue.
const STAGE_DOT: Record<StageKey, string> = {
  overdue: "bg-destructive",
  pending: "bg-warning",
  scheduled: "bg-muted-foreground/60",
  posted: "bg-success",
};
const STAGE_BADGE: Record<StageKey, "destructive" | "warning" | "neutral" | "success"> = {
  overdue: "destructive",
  pending: "warning",
  scheduled: "neutral",
  posted: "success",
};

type Option = { id: string; label: string };

type Props = {
  items: PaymentCalendarItem[];
  todayIso: string;
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accounts: Account[];
};

export default function PaymentsCalendar({ items, todayIso, projects, properties, orders, accounts }: Props) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const [layout, setLayout] = useState<"calendar" | "list">("calendar");
  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name] as const)), [accounts]);
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  // Month + selected day owned here so the calendar, the list and the
  // due-payments banner (which jumps to a day) all stay in sync.
  const [monthDate, setMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);

  // Jump to a specific day (from the due-payments banner): show the calendar,
  // move to that month, and select the day so its panel opens.
  const jumpToDay = (dateIso: string) => {
    const d = toDateOnly(dateIso);
    if (!d) return;
    setLayout("calendar");
    setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(d);
  };

  // Bank-account scope applies to the whole view (calendar, list, total, banner).
  const accountScopedItems = useMemo(
    () => (accountFilter ? items.filter((i) => i.accountId === accountFilter) : items),
    [items, accountFilter]
  );

  const visibleItems = useMemo(() => {
    let list = showPaid ? accountScopedItems : accountScopedItems.filter((i) => i.stage !== "posted");
    if (recurringOnly) list = list.filter((i) => i.recurringTemplateId);
    return list;
  }, [accountScopedItems, showPaid, recurringOnly]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, PaymentCalendarItem[]>();
    for (const item of visibleItems) {
      const key = item.date.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [visibleItems]);

  const itemsOnDay = (day: Date) => itemsByDay.get(isoLocal(day)) ?? [];
  // "To pay" total for a day = amounts not yet paid (scheduled + pending).
  const unpaidTotalOnDay = (day: Date) =>
    itemsOnDay(day).reduce((sum, i) => (i.stage === "posted" ? sum : sum + i.amount), 0);

  const monthUnpaidTotal = (monthDate: Date) =>
    visibleItems.reduce((sum, i) => {
      const d = toDateOnly(i.date);
      if (!d || d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) return sum;
      return i.stage === "posted" ? sum : sum + i.amount;
    }, 0);

  const afterMutation = () => router.refresh();

  // Dark "total to pay this month" pill shown in the month-nav row (both views).
  const totalPill = (m: Date) => (
    <div className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-background">
      <span className="text-sm font-bold tabular-nums">{fmtIls(monthUnpaidTotal(m))}</span>
      <span className="text-[11px] opacity-70">סה״כ לתשלום החודש</span>
    </div>
  );

  function renderSelectedPanel({ day, holiday, isToday }: SelectedContext) {
    return (
      <PaymentsDayPanel
        day={day}
        holiday={holiday}
        isToday={isToday}
        items={itemsOnDay(day)}
        total={unpaidTotalOnDay(day)}
        projects={projects}
        properties={properties}
        orders={orders}
        accountNameById={accountNameById}
        onMutate={afterMutation}
      />
    );
  }

  function renderDayContent({ day, holiday }: DayContext) {
    const dayItems = itemsOnDay(day);
    // Aggregate per stage → each shows as "<colored dot> <amount>" on one row.
    const byStage = new Map<StageKey, { amount: number; variable: boolean }>();
    for (const item of dayItems) {
      const st = itemStageKey(item);
      const cur = byStage.get(st) ?? { amount: 0, variable: false };
      // A variable bill's estimate counts toward the total (marked "~" so it reads
      // as approximate); only mark `variable` when it actually has an estimate.
      cur.amount += item.amount;
      if (item.variableAmount && item.amount > 0) cur.variable = true;
      byStage.set(st, cur);
    }
    return (
      <>
        {holiday ? (
          <span className="max-w-full truncate text-[9px] leading-tight text-secondary">{holiday}</span>
        ) : null}
        {(["overdue", "pending", "scheduled", "posted"] as StageKey[])
          .filter((s) => byStage.has(s))
          .map((s) => {
            const { amount, variable } = byStage.get(s)!;
            const text = amount > 0 ? `${variable ? "~" : ""}${fmtIls(amount)}` : null;
            if (!text) return null;
            return (
              <span key={s} className="flex max-w-full items-center gap-1 text-[10px] font-semibold leading-tight text-foreground">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[s]}`} />
                <span className="truncate">{text}</span>
              </span>
            );
          })}
      </>
    );
  }

  function renderDayHover({ day }: DayContext) {
    const dayItems = itemsOnDay(day);
    if (dayItems.length === 0) return null;
    const total = unpaidTotalOnDay(day);
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1.5">
          <span className="text-sm font-semibold">{fmtFullDay(day)}</span>
          {total > 0 ? <span className="text-xs font-semibold">{fmtIls(total)}</span> : null}
        </div>
        <ul className="space-y-1">
          {dayItems.map((item) => {
            const stage = itemStageKey(item);
            return (
              <li key={item.id} className="flex items-center gap-1.5 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="shrink-0 font-medium">{amountLabel(item)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const legend = (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />באיחור</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />ממתין</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/60" />צפוי</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />שולם</span>
    </div>
  );

  // Order in the toolbar (RTL, right→left): month nav first, then the two toggles,
  // then the total pill last.
  const viewToggle = (
    <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
      {([
        { key: "calendar" as const, label: "לוח", icon: <CalendarIcon className="h-3.5 w-3.5" /> },
        { key: "list" as const, label: "רשימה", icon: <ListIcon className="h-3.5 w-3.5" /> },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => setLayout(opt.key)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            layout === opt.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
  const toggle = (on: boolean, set: () => void, label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={set}
      className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "right-[18px]"}`} />
      </span>
      {label}
    </button>
  );
  const showPaidToggle = toggle(showPaid, () => setShowPaid((v) => !v), "הצג ששולמו");
  const recurringOnlyToggle = toggle(recurringOnly, () => setRecurringOnly((v) => !v), "רק קבועות");
  const accountFilterControl =
    accounts.length > 0 ? (
      <select
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        aria-label="סינון לפי חשבון"
        className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground"
      >
        <option value="">כל החשבונות</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    ) : null;

  // Compact toolbar: month nav (right) · toggles (middle) · total pill (far left).
  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2">
      <MonthNav month={monthDate} todayDate={today} onChange={setMonthDate} />
      <div className="flex flex-wrap items-center gap-3">
        {viewToggle}
        {accountFilterControl}
        {recurringOnlyToggle}
        {showPaidToggle}
      </div>
      {totalPill(monthDate)}
    </div>
  );

  return (
    <div className="space-y-3">
      <DuePaymentsBanner items={accountScopedItems} todayIso={todayIso} onJump={jumpToDay} />
      {/* Full-width toolbar (above both views) — one row, spans the whole page. */}
      {toolbar}
      {layout === "calendar" ? (
        <MonthCalendar
          todayIso={todayIso}
          month={monthDate}
          onMonthChange={setMonthDate}
          selected={selectedDate}
          onSelect={setSelectedDate}
          hideNav
          fixedPanel
          renderSelectedPanel={renderSelectedPanel}
          renderDayContent={renderDayContent}
          renderDayHover={renderDayHover}
          legend={legend}
        />
      ) : (
        <PaymentsMonthList
          items={visibleItems}
          month={monthDate}
          accountNameById={accountNameById}
          onMutate={afterMutation}
          legend={legend}
        />
      )}
    </div>
  );
}

// ── Cash-needs calculator — "how much will I need between X and Y?" ──────────────
// Sums every not-yet-paid outflow in a date range (honoring the page's account
// filter via the passed items, plus its own recurring-only toggle). Variable bills
// contribute their estimate, and the total is marked "~" when any estimate is in it.
export function CashNeedsDialog({
  open,
  onOpenChange,
  items,
  accounts,
  todayIso,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: PaymentCalendarItem[];
  accounts: Account[];
  todayIso: string;
}) {
  // Parent remounts this on open (via key), so the range initializes fresh each time.
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(() => addDaysIso(todayIso, 7));
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");

  const result = useMemo(() => {
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
    const total = rows.reduce((sum, i) => sum + i.amount, 0);
    const hasEstimate = rows.some((i) => i.variableAmount && i.amount > 0);
    return { total, rows, hasEstimate };
  }, [items, from, to, recurringOnly, accountFilter]);

  const quickRanges: Array<[string, number]> = [["היום", 0], ["יומיים", 2], ["שבוע", 7], ["חודש", 30]];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>כמה כסף צריך?</DialogTitle>
          <DialogDescription>סכום כל התשלומים לתשלום בטווח שנבחר.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">מתאריך</div>
              <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">עד תאריך</div>
              <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickRanges.map(([label, days]) => (
              <button
                key={label}
                type="button"
                onClick={() => { setFrom(todayIso); setTo(addDaysIso(todayIso, days)); }}
                className="rounded-full border border-input bg-background px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={recurringOnly}
              onClick={() => setRecurringOnly((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
            >
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${recurringOnly ? "bg-primary" : "bg-muted-foreground/30"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${recurringOnly ? "right-0.5" : "right-[18px]"}`} />
              </span>
              רק הוצאות קבועות
            </button>
            {accounts.length > 0 ? (
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                aria-label="סינון לפי חשבון"
                className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground"
              >
                <option value="">כל החשבונות</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-foreground px-4 py-3 text-background">
            <div>
              <div className="text-xs opacity-70">סה״כ נדרש</div>
              <div className="text-2xl font-bold tabular-nums">{result.hasEstimate ? "~" : ""}{fmtIls(result.total)}</div>
            </div>
            <div className="text-xs opacity-70">{result.rows.length} תשלומים{result.hasEstimate ? " · כולל הערכות" : ""}</div>
          </div>

          {/* Narrow rundown of exactly what's in the total */}
          {result.rows.length > 0 ? (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
              {result.rows.map((i) => {
                const d = toDateOnly(i.date) ?? new Date(i.date);
                return (
                  <li key={i.id} className="flex items-center gap-2 px-2.5 py-1">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(i)]}`} />
                    <span className="w-9 shrink-0 text-xs tabular-nums text-muted-foreground">{d.getDate()}/{d.getMonth() + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {i.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
                    <span className="shrink-0 tabular-nums">{amountLabel(i)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">אין תשלומים בטווח שנבחר.</div>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>סגור</Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}

// ── Due-payments banner — lists every bill due now (overdue / today / next 3
//    days) with a link that jumps to its day on the calendar. Mirrors the
//    `payment_outflow_due` alert rule (expense-origin, unpaid, date ≤ today+3),
//    so the count matches the nav badge — but here it's expandable + per-item. ──
const DUE_HEADS_UP_DAYS = 3;
const BANNER_TONE: Record<"danger" | "warning" | "info", { wrap: string; head: string }> = {
  danger: { wrap: "border-destructive/30 bg-destructive/[0.04]", head: "text-destructive" },
  warning: { wrap: "border-warning/40 bg-warning/[0.05]", head: "text-warning-strong" },
  info: { wrap: "border-border bg-muted/40", head: "text-foreground" },
};

function DuePaymentsBanner({
  items,
  todayIso,
  onJump,
}: {
  items: PaymentCalendarItem[];
  todayIso: string;
  onJump: (dateIso: string) => void;
}) {
  // Collapsed by default — a quiet header you expand when you want the list.
  const [open, setOpen] = useState(false);

  const { due, severity } = useMemo(() => {
    const t = toDateOnly(todayIso) ?? new Date();
    const todayStr = isoLocal(t);
    const horizon = isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() + DUE_HEADS_UP_DAYS));
    const list = items
      // Auto-paid (הוראת קבע) bills need no action, so they're not "to pay".
      // Planned loan installments (origin "loan" + not_paid) ARE payments to make.
      .filter(
        (i) =>
          ((i.origin === "expense" && !i.autoPaid) ||
            (i.origin === "loan" && i.paymentStatus === "not_paid")) &&
          i.stage !== "posted" &&
          i.date.slice(0, 10) <= horizon
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const hasOverdue = list.some((i) => i.date.slice(0, 10) < todayStr);
    const hasToday = list.some((i) => i.date.slice(0, 10) === todayStr);
    return { due: list, severity: (hasOverdue ? "danger" : hasToday ? "warning" : "info") as "danger" | "warning" | "info" };
  }, [items, todayIso]);

  if (due.length === 0) return null;
  const tone = BANNER_TONE[severity];

  return (
    <div className={`rounded-xl border ${tone.wrap}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold ${tone.head}`}
        aria-expanded={open}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-right">תשלומים לתשלום: {due.length}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul className="max-h-72 divide-y overflow-y-auto border-t">
          {due.map((item) => {
            const stage = itemStageKey(item);
            const day = toDateOnly(item.date) ?? new Date(item.date);
            const amountText = amountLabel(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onJump(item.date.slice(0, 10))}
                  className="flex w-full items-center gap-2 px-3 py-2 text-right transition-colors hover:bg-background/60"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                  <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {day.getDate()}/{day.getMonth() + 1}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{amountText}</span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ── Shared item card (used by both the day panel and the list view) ──────────────
function PaymentItemCard({
  item,
  onMarkPaid,
  onSplit,
  onRemind,
  onDelete,
  compact = false,
  accountName,
}: {
  item: PaymentCalendarItem;
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  onDelete: () => void;
  compact?: boolean;
  accountName?: string;
}) {
  const stage = itemStageKey(item);
  const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
  // Auto-paid (הוראת קבע) needs no approval → no mark-paid button.
  const canMarkPaid = (Boolean(item.expenseId) || isForecast) && !item.autoPaid;
  const canSplit = Boolean(item.expenseId);
  const canDelete = Boolean(item.expenseId);
  // Drop the source label from the meta when a type badge (הוראת קבע / קבועה) already
  // says the same thing — no info twice.
  const showsTypeBadge = item.autoPaid || isForecast;
  const metaLine = [item.domainName, showsTypeBadge ? null : item.sourceLabel, accountName ? `מחשבון ${accountName}` : null]
    .filter(Boolean)
    .join(" • ");
  const amountText = amountLabel(item);
  const noteText = item.notes?.trim() || "";

  // Compact single-block row for the list view: title + amount on one line,
  // source + icon actions on the next. Icon-only buttons keep rows narrow.
  if (compact) {
    return (
      <div className="rounded-lg border bg-background px-2.5 py-1.5" data-focus-id={item.id}>
        {/* Row 1: name (wraps) + amount. Badges get their own row so nothing crams. */}
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2">{item.label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{amountText}</span>
        </div>
        {item.autoPaid || isForecast || item.variableAmount ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
            {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
          </div>
        ) : null}
        {noteText ? (
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">הערה: {noteText}</div>
        ) : null}
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {metaLine}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {canMarkPaid && item.stage !== "posted" ? (
              <Button type="button" size="icon-sm" variant="secondary" onClick={onMarkPaid} title="סמן כשולם" aria-label="סמן כשולם">
                <Check className="h-4 w-4" />
              </Button>
            ) : null}
            {canSplit && item.stage !== "posted" ? (
              <Button type="button" size="icon-sm" variant="secondary" onClick={onSplit} title="פיצול לתשלומים" aria-label="פיצול לתשלומים">
                <Split className="h-4 w-4" />
              </Button>
            ) : null}
            {item.sourceHref ? (
              <Button asChild type="button" size="icon-sm" variant="secondary" title="למקור" aria-label="למקור">
                <Link href={item.sourceHref}><ExternalLink className="h-4 w-4" /></Link>
              </Button>
            ) : null}
            <Button type="button" size="icon-sm" variant="secondary" onClick={onRemind} title="תזכורת" aria-label="תזכורת">
              <BellPlus className="h-4 w-4" />
            </Button>
            {canDelete ? (
              <Button type="button" size="icon-sm" variant="destructive" onClick={onDelete} title="מחיקה" aria-label="מחיקה">
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.label}</span>
        <span className="font-semibold">{amountText}</span>
        <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
        {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">הוצאה קבועה</Badge> : null}
        {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
        {item.installmentGroupId && item.installmentIndex && item.installmentCount ? (
          <Badge variant="neutral">
            תשלום {item.installmentIndex}/{item.installmentCount}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        {metaLine}
      </div>
      {noteText ? (
        <div className="mt-0.5 text-sm text-muted-foreground">הערה: {noteText}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {canMarkPaid && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onMarkPaid}>
            <Check className="ml-1 h-3.5 w-3.5" />
            סמן כשולם
          </Button>
        ) : null}
        {canSplit && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSplit}>
            <Split className="ml-1 h-3.5 w-3.5" />
            פיצול לתשלומים
          </Button>
        ) : null}
        {item.sourceHref ? (
          <Button asChild type="button" size="sm" variant="secondary">
            <Link href={item.sourceHref}>
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
              למקור
            </Link>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onRemind}>
          <BellPlus className="ml-1 h-3.5 w-3.5" />
          תזכורת
        </Button>
        {canDelete ? (
          <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="ml-1 h-3.5 w-3.5" />
            מחיקה
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ── List view — the selected month's payments as a table ─────────────────────────
function PaymentsMonthList({
  items,
  month,
  accountNameById,
  onMutate,
  legend,
}: {
  items: PaymentCalendarItem[];
  month: Date;
  accountNameById: Map<string, string>;
  onMutate: () => void;
  legend: ReactNode;
}) {
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PaymentCalendarItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Only this month's payments, sorted by date ascending.
  const monthItems = useMemo(() => {
    return items
      .filter((i) => {
        const d = toDateOnly(i.date);
        return d && d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
      })
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [items, month]);

  const monthName = useMemo(() => new Intl.DateTimeFormat("he-IL", { month: "long" }).format(month), [month]);

  return (
    <div className="space-y-3">
      {monthItems.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">אין תשלומים בחודש זה.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table dir="rtl" className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right font-medium">תאריך</th>
                <th className="px-3 py-2 text-right font-medium">תשלום</th>
                <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                <th className="px-3 py-2 text-right font-medium">סכום</th>
                <th className="px-3 py-2 text-right font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {monthItems.map((item) => {
                const stage = itemStageKey(item);
                const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
                // Auto-paid (הוראת קבע) needs no approval → no mark-paid button.
  const canMarkPaid = (Boolean(item.expenseId) || isForecast) && !item.autoPaid;
                const canSplit = Boolean(item.expenseId);
                const canDelete = Boolean(item.expenseId);
                const day = toDateOnly(item.date) ?? new Date(item.date);
                const accountName = item.accountId ? accountNameById.get(item.accountId) : undefined;
                const meta = [item.domainName, item.sourceLabel, accountName ? `מחשבון ${accountName}` : null]
                  .filter(Boolean)
                  .join(" • ");
                return (
                  <tr key={item.id} data-focus-id={item.id} className="align-top hover:bg-secondary/10">
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold tabular-nums">{day.getDate()}</span>
                        <span className="text-xs text-muted-foreground">{monthName}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{hebrewFullDate(day)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.label}</div>
                      {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
                      {item.notes?.trim() ? <div className="text-xs text-muted-foreground">הערה: {item.notes.trim()}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>
                        {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
                        {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
                      </div>
                    </td>
                    <td dir="ltr" className="whitespace-nowrap px-3 py-2 text-left font-semibold tabular-nums">
                      {amountLabel(item)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-1">
                        {canMarkPaid && item.stage !== "posted" ? (
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => setMarkItem(item)} title="סמן כשולם" aria-label="סמן כשולם">
                            <Check className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {canSplit && item.stage !== "posted" ? (
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => { setSplitItem(item); setSplitOpen(true); }} title="פיצול לתשלומים" aria-label="פיצול לתשלומים">
                            <Split className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {item.sourceHref ? (
                          <Button asChild type="button" size="icon-sm" variant="secondary" title="למקור" aria-label="למקור">
                            <Link href={item.sourceHref}><ExternalLink className="h-4 w-4" /></Link>
                          </Button>
                        ) : null}
                        <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindItem(item)} title="תזכורת" aria-label="תזכורת">
                          <BellPlus className="h-4 w-4" />
                        </Button>
                        {canDelete ? (
                          <Button type="button" size="icon-sm" variant="destructive" onClick={() => setDeleteItem(item)} title="מחיקה" aria-label="מחיקה">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {legend}

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => { if (!o) setRemindItem(null); }}
        category="task"
        links={remindItem?.expenseId ? { expense_id: remindItem.expenseId } : {}}
        defaultNote={remindItem ? reminderNoteFor(remindItem) : undefined}
        onSaved={() => setRemindItem(null)}
      />

      <SplitPaymentDialog
        open={splitOpen}
        onOpenChange={(o) => {
          setSplitOpen(o);
          if (!o) setSplitItem(null);
        }}
        sourceItem={splitItem}
        onSaved={() => {
          setSplitOpen(false);
          setSplitItem(null);
          onMutate();
        }}
      />

      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={() => {
          setMarkItem(null);
          onMutate();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteItem)}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteItem(null); }}
        title="מחיקת תשלום"
        description={deleteItem ? `למחוק את "${deleteItem.label}"? הפעולה אינה הפיכה.` : ""}
        confirmLabel="מחיקה"
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (!deleteItem) return;
          setDeleting(true);
          const ok = await deleteExpenseItem(deleteItem);
          setDeleting(false);
          if (ok) {
            setDeleteItem(null);
            onMutate();
          }
        }}
      />
    </div>
  );
}

// ── Selected-day panel (owns its own add/mark/split dialog state) ─────────────────
function PaymentsDayPanel({
  day,
  holiday,
  isToday,
  items,
  total,
  projects,
  properties,
  orders,
  accountNameById,
  onMutate,
}: {
  day: Date;
  holiday: string | null;
  isToday: boolean;
  items: PaymentCalendarItem[];
  total: number;
  projects: Option[];
  properties: Option[];
  orders: Option[];
  accountNameById: Map<string, string>;
  onMutate: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PaymentCalendarItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dayIso = isoLocal(day);

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-4">
      <div>
        <div className="text-xs font-semibold text-primary">{isToday ? "היום · נבחר" : "נבחר"}</div>
        <div className="text-lg font-bold leading-tight">{fmtFullDay(day)}</div>
        <div className="text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
        {holiday ? (
          <div className="mt-0.5 text-sm font-medium text-secondary">{holiday}</div>
        ) : null}
        <div className="mt-1 text-sm text-muted-foreground">
          {total > 0 ? (
            <>
              לתשלום ביום זה: <span className="font-semibold text-foreground">{fmtIls(total)}</span>
            </>
          ) : items.length > 0 ? (
            "כל התשלומים ביום זה שולמו"
          ) : null}
        </div>
      </div>

      {/* Body — fills the panel and scrolls when there are many payments, so the
          panel keeps a fixed height and the add button stays pinned at the bottom */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {items.length > 0 ? (
          <div className="space-y-1.5">
            {items.map((item) => (
              <PaymentItemCard
                key={item.id}
                item={item}
                compact
                accountName={item.accountId ? accountNameById.get(item.accountId) : undefined}
                onMarkPaid={() => setMarkItem(item)}
                onSplit={() => {
                  setSplitItem(item);
                  setSplitOpen(true);
                }}
                onRemind={() => setRemindItem(item)}
                onDelete={() => setDeleteItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium">אין תשלומים ביום זה</div>
            <div className="text-xs text-muted-foreground">לא נקבעו הוצאות קבועות לתאריך שנבחר.</div>
          </div>
        )}
      </div>

      {/* Add — pinned to the bottom, full width */}
      <div className="mt-3">
        <Button type="button" className="w-full" onClick={() => setAddOpen(true)}>
          <Plus className="ml-1 h-4 w-4" />
          הוסף תשלום ליום זה
        </Button>
        <div className="mt-2 text-center text-xs text-muted-foreground">
          לחצו על יום כדי לראות את התשלומים, או הוסיפו תשלום חדש.
        </div>
      </div>

      {/* Add expense/payment — the full shared expense dialog (one-time or
          recurring), prefilled to this day. No `users` prop, so the worker-session
          category is omitted on the payments calendar. */}
      <ExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={dayIso}
        showAttachments
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={() => {
          setAddOpen(false);
          onMutate();
        }}
      />

      {/* Split */}
      <SplitPaymentDialog
        open={splitOpen}
        onOpenChange={(o) => {
          setSplitOpen(o);
          if (!o) setSplitItem(null);
        }}
        sourceItem={splitItem}
        onSaved={() => {
          setSplitOpen(false);
          setSplitItem(null);
          onMutate();
        }}
      />

      {/* Mark paid */}
      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={() => {
          setMarkItem(null);
          onMutate();
        }}
      />

      {/* Reminder for this payment */}
      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => { if (!o) setRemindItem(null); }}
        category="task"
        links={remindItem?.expenseId ? { expense_id: remindItem.expenseId } : {}}
        defaultNote={remindItem ? reminderNoteFor(remindItem) : undefined}
        onSaved={() => setRemindItem(null)}
      />

      {/* Delete this expense (e.g. an orphaned recurring bill) */}
      <ConfirmDialog
        open={Boolean(deleteItem)}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteItem(null); }}
        title="מחיקת תשלום"
        description={deleteItem ? `למחוק את "${deleteItem.label}"? הפעולה אינה הפיכה.` : ""}
        confirmLabel="מחיקה"
        destructive
        loading={deleting}
        onConfirm={async () => {
          if (!deleteItem) return;
          setDeleting(true);
          const ok = await deleteExpenseItem(deleteItem);
          setDeleting(false);
          if (ok) {
            setDeleteItem(null);
            onMutate();
          }
        }}
      />
    </div>
  );
}

// ── Inline mark-paid dialog (account required) ──────────────────────────────────
function MarkPaidDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PaymentCalendarItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");

  const open = Boolean(item);
  const isVariable = Boolean(item?.variableAmount);

  // On open, seed the amount with the bill's estimate (variable bills) so you can
  // just tweak it to the real charge instead of typing from scratch.
  useEffect(() => { setPayAmount(item?.variableAmount && item.amount > 0 ? String(item.amount) : ""); setError(""); }, [item?.id, item?.variableAmount, item?.amount]);

  async function submit() {
    if (!item) return;
    const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
    if (!item.expenseId && !isForecast) return;
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    const amountNum = Number(payAmount);
    if (isVariable && !(Number.isFinite(amountNum) && amountNum > 0)) {
      setError("יש להזין את סכום התשלום.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // A forecast (upcoming recurring occurrence) has no expense row yet →
      // materialize it and mark paid in one step; otherwise flip the existing row.
      const res = isForecast
        ? await fetch("/api/recurring-expenses/materialize-paid", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              template_id: item.recurringTemplateId,
              recurrence_key: item.recurrenceKey,
              expense_date: item.date.slice(0, 10),
              amount: isVariable ? amountNum : null,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          })
        : await fetch("/api/expenses/mark-paid", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: item.expenseId,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "סימון התשלום נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום סומן כשולם");
      onSaved();
    } catch (err) {
      const msg = toHebrewError(err, "סימון התשלום נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <AdaptiveDialog size="formMd">
        <DialogHeader>
          <DialogTitle>סימון תשלום כשולם</DialogTitle>
          <DialogDescription>
            {item ? `${item.label} — ${isVariable ? "סכום משתנה" : fmtIls(item.amount)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {isVariable ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">כמה שולם? *</div>
              <CurrencyInput value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-sm font-medium">תאריך תשלום</div>
            <DateInput value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">אמצעי תשלום</div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">בחר אמצעי</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <AccountSelect
            required
            value={accountId}
            onChange={setAccountId}
            onLoaded={setAccountsList}
          />
          {error ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </div>
          ) : null}
        </div>
        <DialogFooter className="mt-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />שומר...</>) : "סמן כשולם"}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}

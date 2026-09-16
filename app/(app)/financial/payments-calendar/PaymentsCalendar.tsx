"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AddIcon, AddReminderIcon, CalendarIcon, CheckIcon, ChevronDownIcon, DeleteIcon, EditIcon, ExternalLinkIcon, MoreIcon, SplitIcon, WarningIcon } from "@/components/ui/icons";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FOCUS_PARAM, flashFocusTarget } from "@/components/layout/FocusHighlighter";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/meta-row";
import { FormDialog } from "@/components/ui/form-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { Account } from "@/lib/accounts";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { toHebrewError } from "@/lib/error-messages";
import { replaceSearchParams } from "@/lib/ui/url-state";
import type { PaymentCalendarItem } from "@/lib/payables";
import MonthCalendar, {
  MonthNav,
  fmtFullDay,
  isoLocal,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";
import { SplitPaymentDialog } from "./SplitPaymentDialog";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete } from "@/lib/undo-engine";

const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((mod) => mod.ExpenseDialog),
  { loading: () => null }
);

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
// behind after its template was deleted). Real expenses only. Deferred: the
// row hides immediately (via the "payment-calendar-item" undo scope) and the
// real delete only fires if the toast's "בטל" isn't clicked in time.
function scheduleExpenseItemDelete(item: PaymentCalendarItem, onMutate: () => void) {
  if (!item.expenseId) return;
  scheduleDeferredDelete({
    scope: "payment-calendar-item",
    id: item.id,
    message: "התשלום נמחק",
    onCommit: async () => {
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
          return { ok: false, error: toHebrewError(json.error, "מחיקת התשלום נכשלה.") };
        }
        onMutate();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: toHebrewError(err, "מחיקת התשלום נכשלה.") };
      }
    },
  });
}

// A pre-filled note for a reminder created from a payment.
function reminderNoteFor(item: PaymentCalendarItem): string {
  const amt = amountLabel(item);
  return `תשלום: ${item.label} — ${amt}`;
}

// A filter chip — the app's control for an on/off filter, `aria-pressed`. ON
// fills solid sky and OFF is a plain outline: the board's contents depend on
// these, so their state has to read at a glance, not from a tint.
// Box = TOOLBAR_CONTROL, the shared size of every control in the toolbar row.
const TOOLBAR_CONTROL = "h-[34px] rounded-lg border";
function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center px-3 text-xs font-semibold transition-colors ${TOOLBAR_CONTROL} ${
        active
          ? "border-secondary bg-secondary text-secondary-foreground hover:bg-secondary/90"
          : "border-input bg-background text-muted-foreground hover:bg-secondary/5 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
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
  // The recurring rules behind forecast items — "edit" on a forecast (no row
  // yet) opens its template.
  templates: RecurringExpenseTemplateItem[];
  // Page-header element the alerts chip is portaled into (PaymentsHubClient),
  // beside the tabs. Null until that header mounts — the chip waits for it
  // rather than flashing above the calendar first.
  alertsSlot?: HTMLElement | null;
};

// What a mutation wants shown afterwards: the item by calendar id, or the
// expense row it created/changed (the calendar id of a real row is `expense:<uuid>`).
type ItemFocus = { id?: string | null; expenseId?: string | null };
// Resolves only once the board has re-rendered with fresh server data.
type MutateFn = (focus?: ItemFocus) => Promise<void>;

// A refresh that never completes (offline, server error) must not hold a dialog
// hostage — after this long the promise resolves regardless, and the user is
// told the board didn't catch up.
const REFRESH_WAIT_CAP_MS = 6_000;
const EMPTY_IDS: ReadonlySet<string> = new Set();

// The month in view lives in the URL (`?month=YYYY-MM`; the current month is
// the default and writes nothing) so a refresh, or Back from a source page,
// lands on the same month.
const MONTH_PARAM = "month";
function monthFromParam(value: string | null): Date | null {
  const m = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}
function monthToParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function PaymentsCalendar({ items: itemsProp, todayIso, projects, properties, orders, accounts, templates, alertsSlot }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRefreshing, startTransition] = useTransition();
  const items = useUndoOverlay(itemsProp, (i) => i.id, "payment-calendar-item");
  const [showPaid, setShowPaid] = useState(false);
  // A `?focus=<item id>` deep link (an alert, the מקורות נוספים "next" link)
  // must land ON the item: its month, its day selected — the day panel is the
  // only place a card carrying data-focus-id renders, so without selecting the
  // day FocusHighlighter would find nothing to flash — and revealed if paid.
  const focusParam = searchParams.get(FOCUS_PARAM);
  const focusedItem = focusParam ? itemsProp.find((i) => i.id === focusParam) ?? null : null;
  const focusedDate = focusedItem ? toDateOnly(focusedItem.date) : null;
  // The focus link has done its job once the flash has played — drop it from
  // the URL so a later refresh doesn't jump back to that item.
  useEffect(() => {
    if (!focusParam) return;
    const timer = setTimeout(() => replaceSearchParams({ [FOCUS_PARAM]: null }), 5000);
    return () => clearTimeout(timer);
  }, [focusParam]);
  // Paid items shown DESPITE the paid filter — the ones the user just changed,
  // so a bill marked paid is seen landing on its pay day instead of vanishing.
  // Cleared when the paid filter is toggled or the month is changed by hand.
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() =>
    focusedItem && focusedItem.stage === "posted" ? new Set([focusedItem.id]) : EMPTY_IDS
  );
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");
  const accountNameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name] as const)), [accounts]);
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  // Month + selected day owned here so the calendar, the list and the
  // due-payments banner (which jumps to a day) all stay in sync.
  const [monthDate, setMonthDate] = useState(
    () =>
      monthFromParam(searchParams.get(MONTH_PARAM)) ??
      (focusedDate
        ? new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1)
        : new Date(today.getFullYear(), today.getMonth(), 1))
  );
  const [selectedDate, setSelectedDate] = useState(focusedDate ?? today);

  // Mirror the month into the URL (no server round trip) so it survives a
  // refresh and Back. This month is the default and keeps the URL clean.
  useEffect(() => {
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    replaceSearchParams({
      [MONTH_PARAM]: monthDate.getTime() === thisMonth.getTime() ? null : monthToParam(monthDate),
    });
  }, [monthDate, today]);

  // Jump to a specific day (from the alerts bar): move to that month and
  // select the day so its panel opens.
  const jumpToDay = (dateIso: string) => {
    const d = toDateOnly(dateIso);
    if (!d) return;
    setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(d);
  };
  // Month changed by hand (nav arrows / swipe): the one-off reveals are over.
  const changeMonth = (next: Date) => {
    setMonthDate(next);
    setRevealedIds(EMPTY_IDS);
  };

  // ── A refresh that RESOLVES when the fresh data is on screen ──────────────
  // `router.refresh()` inside a transition keeps `isRefreshing` true until the
  // new server payload has been committed, so "went from refreshing to not"
  // is exactly the moment the board shows the new rows. Dialogs await this so
  // they close only once their item has visibly moved (or gone).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const refreshWaiters = useRef<Array<() => void>>([]);
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (wasRefreshing.current && !isRefreshing) {
      const waiters = refreshWaiters.current;
      refreshWaiters.current = [];
      for (const resolve of waiters) resolve();
    }
    wasRefreshing.current = isRefreshing;
  }, [isRefreshing]);

  const refreshAndWait = () =>
    new Promise<void>((resolve) => {
      // Offline: the save (if it went through the offline queue) will replay
      // later; nothing to wait for now, so say so and let the dialog close.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast.warning("אין חיבור — הלוח יתעדכן כשהחיבור יחזור");
        resolve();
        return;
      }
      const cap = setTimeout(() => {
        toast.warning("הלוח לא התרענן — רעננו את הדף כדי לראות את השינוי");
        resolve();
      }, REFRESH_WAIT_CAP_MS);
      refreshWaiters.current.push(() => {
        clearTimeout(cap);
        resolve();
      });
      startTransition(() => router.refresh());
    });

  // Show WHERE an item landed after a change: its month, its day, and a flash
  // on its card/row (same effect as the app-wide ?focus= deep link). A paid item
  // is revealed through the paid filter so the move is visible, not a vanish.
  const revealItem = (item: PaymentCalendarItem) => {
    const d = toDateOnly(item.date);
    if (!d) return;
    if (item.stage === "posted") setRevealedIds((prev) => new Set(prev).add(item.id));
    setMonthDate(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(d);
    flashFocusTarget(item.id, { timeoutMs: 4000 });
  };

  const afterMutation: MutateFn = async (focus) => {
    await refreshAndWait();
    const wantedId = focus?.id ?? (focus?.expenseId ? `expense:${focus.expenseId}` : null);
    if (!wantedId) return;
    const landed = itemsRef.current.find((i) => i.id === wantedId);
    if (landed) revealItem(landed);
  };

  // Bank-account scope applies to the whole view (calendar, list, total, banner).
  const accountScopedItems = useMemo(
    () => (accountFilter ? items.filter((i) => i.accountId === accountFilter) : items),
    [items, accountFilter]
  );

  const visibleItems = useMemo(() => {
    let list = showPaid
      ? accountScopedItems
      : accountScopedItems.filter((i) => i.stage !== "posted" || revealedIds.has(i.id));
    if (recurringOnly) list = list.filter((i) => i.recurringTemplateId);
    return list;
  }, [accountScopedItems, showPaid, recurringOnly, revealedIds]);

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
        templates={templates}
        accountNameById={accountNameById}
        onMutate={afterMutation}
      />
    );
  }

  function renderDayContent({ day, holiday }: DayContext) {
    const dayItems = itemsOnDay(day);
    // Aggregate per stage → each shows as "<colored dot> <amount>" on one row.
    const byStage = new Map<StageKey, { amount: number; variable: boolean; unknown: boolean }>();
    for (const item of dayItems) {
      const st = itemStageKey(item);
      const cur = byStage.get(st) ?? { amount: 0, variable: false, unknown: false };
      // A variable bill's estimate counts toward the total (marked "~" so it reads
      // as approximate); only mark `variable` when it actually has an estimate.
      // One with NO estimate (a coming card charge) still has to leave a mark on
      // the day, so the cell can't go blank just because the sum is 0.
      cur.amount += item.amount;
      if (item.variableAmount && item.amount > 0) cur.variable = true;
      if (item.variableAmount && item.amount <= 0) cur.unknown = true;
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
            const { amount, variable, unknown } = byStage.get(s)!;
            const text = amount > 0 ? `${variable ? "~" : ""}${fmtIls(amount)}` : unknown ? "משתנה" : null;
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
                <span className="min-w-0 flex-1">{item.label}</span>
                <span className="shrink-0 font-medium">{amountLabel(item)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // A key to the grid, not a control — so it sits right on the weekday header
  // (MonthCalendar legendPlacement="above"), not among the toolbar's buttons,
  // and not under six weeks of the dots it explains.
  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="מקרא">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" />באיחור</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />ממתין</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/60" />צפוי</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />שולם</span>
    </div>
  );

  // Order in the toolbar (RTL, right→left): month nav first, then the filters,
  // then the total pill last. The two filters are CHIPS (aria-pressed), the
  // same control the rest of the app uses for a filter — a switch reads as a
  // setting and is slower to scan.
  const showPaidToggle = (
    <FilterChip
      active={showPaid}
      label="הצג ששולמו"
      onClick={() => {
        setShowPaid((v) => !v);
        setRevealedIds(EMPTY_IDS);
      }}
    />
  );
  const recurringOnlyToggle = <FilterChip active={recurringOnly} label="רק קבועות" onClick={() => setRecurringOnly((v) => !v)} />;
  const accountFilterControl =
    accounts.length > 0 ? (
      <NativeSelect dense
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        aria-label="סינון לפי חשבון" className={`w-auto border-input text-xs text-foreground shadow-none ${TOOLBAR_CONTROL}`}
      >
        <option value="">כל החשבונות</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </NativeSelect>
    ) : null;

  // The alerts chip lives in the page header (portaled into `alertsSlot`, next
  // to כמה צריך?), not over the grid — but it's built here, since it follows
  // the calendar's account filter. No month-total pill anywhere: a "how much
  // do I need" figure is the calculator's job, and two different totals on
  // one screen read as a contradiction.
  const alertsChip = alertsSlot
    ? createPortal(
        <PaymentsAlertsChip
          items={accountScopedItems}
          todayIso={todayIso}
          onJump={jumpToDay}
        />,
        alertsSlot
      )
    : null;

  // The month is the grid's title — centered in the calendar's own header
  // strip, bold, between the filters and the legend.
  const monthSwitcher = (
    <MonthNav month={monthDate} todayDate={today} onChange={changeMonth} labelClassName="text-base font-bold" />
  );

  // The filters change what the grid shows, so they live inside its border,
  // on the strip above the weekday header, opposite the legend.
  const gridFilters = (
    <>
      {accountFilterControl}
      {recurringOnlyToggle}
      {showPaidToggle}
    </>
  );

  return (
    <div className="space-y-3">
      {alertsChip}
      <MonthCalendar
        todayIso={todayIso}
        month={monthDate}
        onMonthChange={changeMonth}
        selected={selectedDate}
        onSelect={setSelectedDate}
        hideNav
        fixedPanel
        renderSelectedPanel={renderSelectedPanel}
        renderDayContent={renderDayContent}
        renderDayHover={renderDayHover}
        legend={legend}
        legendPlacement="above"
        gridHeader={gridFilters}
        gridHeaderCenter={monthSwitcher}
      />
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
    <ViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title="כמה כסף צריך?"
      description="סכום כל התשלומים לתשלום בטווח שנבחר."
      size="formMd"
    >
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
          {/* The two filters share one row: the chip on the right, the account on the left. */}
          <div className="flex items-center justify-between gap-3">
            <FilterChip active={recurringOnly} label="רק הוצאות קבועות" onClick={() => setRecurringOnly((v) => !v)} />
            {accounts.length > 0 ? (
              <NativeSelect dense
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                aria-label="סינון לפי חשבון" className="w-auto min-w-[10rem] text-foreground"
              >
                <option value="">כל החשבונות</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            ) : null}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-foreground px-4 py-3 text-background">
            <div>
              <div className="text-xs opacity-70">סה״כ נדרש</div>
              <div className="text-2xl font-bold tabular-nums">{result.hasEstimate ? "~" : ""}{fmtIls(result.total)}</div>
            </div>
            <div className="text-xs opacity-70">{result.rows.length} תשלומים{result.hasEstimate ? " · כולל הערכות" : ""}</div>
          </div>

          {/* Narrow rundown of exactly what's in the total — small type, one line each */}
          {result.rows.length > 0 ? (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-xs">
              {result.rows.map((i) => {
                const d = toDateOnly(i.date) ?? new Date(i.date);
                return (
                  <li key={i.id} className="flex items-center gap-2 px-2 py-1 leading-snug">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(i)]}`} />
                    <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{d.getDate()}/{d.getMonth() + 1}</span>
                    <span className="min-w-0 flex-1 break-words">{i.label}</span>
                    {i.variableAmount ? <span className="shrink-0 text-warning-strong">משתנה</span> : null}
                    <span className="shrink-0 font-medium tabular-nums">{amountLabel(i)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">אין תשלומים בטווח שנבחר.</div>
          )}
        </div>
    </ViewDialog>
  );
}

// ── Late-payments chip — in the page header, beside כמה צריך?. It lists ONLY
//    payments that are past their date and still unpaid: what's coming up is
//    already on the calendar itself, so repeating it here just buried the late
//    ones. Each row jumps to its day.
//
//    A chip, not a strip: a handful of overdue bills is this business's
//    standing state, and a permanent red band across every visit stops being
//    read within a week. Amber while everything is under a week late, red once
//    a bill is more than a week late; hidden when nothing is late.
const OVERDUE_RED_AFTER_DAYS = 7;
const CHIP_TONE: Record<"danger" | "warning", string> = {
  danger: "border-destructive/40 bg-destructive/[0.06] text-destructive",
  warning: "border-warning/50 bg-warning/[0.08] text-warning-strong",
};

function PaymentsAlertsChip({
  items,
  todayIso,
  onJump,
}: {
  items: PaymentCalendarItem[];
  todayIso: string;
  onJump: (dateIso: string) => void;
}) {
  const { late, severity } = useMemo(() => {
    const t = toDateOnly(todayIso) ?? new Date();
    const todayStr = isoLocal(t);
    const redLine = isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() - OVERDUE_RED_AFTER_DAYS));
    const lateList = items
      // Auto-paid (הוראת קבע) bills need no action, so they're never "late".
      // Planned loan installments (origin "loan" + not_paid) ARE payments to make.
      .filter(
        (i) =>
          ((i.origin === "expense" && !i.autoPaid) ||
            (i.origin === "loan" && i.paymentStatus === "not_paid")) &&
          i.stage !== "posted" &&
          i.date.slice(0, 10) < todayStr
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      late: lateList,
      severity: (lateList.some((i) => i.date.slice(0, 10) < redLine) ? "danger" : "warning") as "danger" | "warning",
    };
  }, [items, todayIso]);

  if (late.length === 0) return null;
  const label = `באיחור ${late.length}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 px-3 text-xs font-semibold transition-colors ${TOOLBAR_CONTROL} ${CHIP_TONE[severity]}`}
          aria-label={`תשלומים באיחור: ${late.length}`}
        >
          <WarningIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      {/* align="end": the chip sits at the page's left edge (RTL), so the menu
          grows inward instead of past the screen. */}
      <DropdownMenuContent align="end" className="max-h-80 w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
        {/* One row = dot · name · date · amount. */}
        {late.map((item) => {
          const day = toDateOnly(item.date) ?? new Date(item.date);
          return (
            <DropdownMenuItem key={item.id} onSelect={() => onJump(item.date.slice(0, 10))} className="gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(item)]}`} />
              <span className="min-w-0 flex-1 break-words text-sm">{item.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {day.getDate()}/{day.getMonth() + 1}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{amountLabel(item)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Shared item card (used by both the day panel and the list view) ──────────────
function PaymentItemCard({
  item,
  onMarkPaid,
  onSplit,
  onRemind,
  onDelete,
  onEdit,
  editLabel = "עריכה",
  compact = false,
  accountName,
}: {
  item: PaymentCalendarItem;
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  onDelete: () => void;
  // Absent on items that have no editable record here (wages, loans, card charges).
  onEdit?: () => void;
  editLabel?: string;
  compact?: boolean;
  accountName?: string;
}) {
  const stage = itemStageKey(item);
  const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
  // Auto-paid (הוראת קבע) needs no approval → no mark-paid button.
  // A forecast is a period that has no expense row yet, so it always needs a way
  // to be recorded — INCLUDING a standing order. "Auto-paid" only means the
  // generator stamps it paid when it creates it; until then there is nothing in
  // the ledger, nothing to reconcile against the bank, and no other way in.
  // Rows that already exist and are paid are filtered by the stage check below.
  const canMarkPaid = Boolean(item.expenseId) || isForecast;
  const canSplit = Boolean(item.expenseId);
  const canDelete = Boolean(item.expenseId);
  // Drop the source label from the meta when a type badge (הוראת קבע / קבועה) already
  // says the same thing — no info twice.
  const showsTypeBadge = item.autoPaid || isForecast;
  const metaItems = [item.domainName, showsTypeBadge ? null : item.sourceLabel, accountName ? `מחשבון ${accountName}` : null];
  const metaLine = metaItems.filter(Boolean).join(" • ");
  const amountText = amountLabel(item);
  const noteText = item.notes?.trim() || "";

  // Compact single-block row for the list view: title + amount on one line,
  // source + icon actions on the next. Icon-only buttons keep rows narrow.
  if (compact) {
    // The day panel is a narrow column: text gets the full width and wraps
    // (never clipped), the ONE action people take here — סמן כשולם — stays a
    // visible button, and everything else lives behind ⋯ (same pattern as the
    // dense tables). Six icon buttons beside the meta line squeezed it into a
    // one-word-per-line sliver.
    const showMarkPaid = canMarkPaid && item.stage !== "posted";
    return (
      <div className="rounded-lg border bg-background px-3 py-2.5" data-focus-id={item.id}>
        {/* Row 1: name (wraps) + amount. Badges get their own row so nothing crams. */}
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage]}`} />
          <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">{item.label}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{amountText}</span>
        </div>
        {item.autoPaid || isForecast || item.variableAmount ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : isForecast ? <Badge variant="neutral">קבועה</Badge> : null}
            {item.variableAmount ? <Badge variant="warning">משתנה</Badge> : null}
          </div>
        ) : null}
        {noteText ? (
          <div className="mt-1.5 break-words text-xs text-muted-foreground">הערה: {noteText}</div>
        ) : null}
        <MetaRow className="mt-1.5 text-xs text-muted-foreground" items={metaItems} />
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          {showMarkPaid ? (
            <Button type="button" size="sm" variant="secondary" onClick={onMarkPaid}>
              <CheckIcon className="h-3.5 w-3.5" />
              סמן כשולם
            </Button>
          ) : (
            <span />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                title="פעולות"
                aria-label={`פעולות — ${item.label}`}
              >
                <MoreIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {onEdit ? (
                <DropdownMenuItem onClick={onEdit}>
                  <EditIcon className="me-2 h-4 w-4" />
                  {editLabel}
                </DropdownMenuItem>
              ) : null}
              {canSplit && item.stage !== "posted" ? (
                <DropdownMenuItem onClick={onSplit}>
                  <SplitIcon className="me-2 h-4 w-4" />
                  פיצול לתשלומים
                </DropdownMenuItem>
              ) : null}
              {item.sourceHref ? (
                <DropdownMenuItem asChild>
                  <Link href={item.sourceHref}>
                    <ExternalLinkIcon className="me-2 h-4 w-4" />
                    למקור
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onRemind}>
                <AddReminderIcon className="me-2 h-4 w-4" />
                תזכורת
              </DropdownMenuItem>
              {canDelete ? (
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <DeleteIcon className="me-2 h-4 w-4" />
                  מחיקה
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
            <CheckIcon className="h-3.5 w-3.5" />
            סמן כשולם
          </Button>
        ) : null}
        {canSplit && item.stage !== "posted" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSplit}>
            <SplitIcon className="h-3.5 w-3.5" />
            פיצול לתשלומים
          </Button>
        ) : null}
        {onEdit ? <EditButton onClick={onEdit} label={editLabel} /> : null}
        {item.sourceHref ? (
          <Button asChild type="button" size="sm" variant="secondary">
            <Link href={item.sourceHref}>
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              למקור
            </Link>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={onRemind}>
          <AddReminderIcon className="h-3.5 w-3.5" />
          תזכורת
        </Button>
        {canDelete ? (
          <DeleteButton onClick={onDelete} />
        ) : null}
      </div>
    </div>
  );
}

// ── Per-item actions + their dialogs (shared by the day panel and the list) ──────
// Every action that changes data goes through `onMutate`, which resolves only
// once the board has re-rendered with fresh server data — so a dialog stays
// busy until its item has visibly moved (or gone), and the board then selects
// and flashes it wherever it landed.
type ItemActions = {
  onMarkPaid: () => void;
  onSplit: () => void;
  onRemind: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  editLabel?: string;
};

function usePaymentItemActions({
  onMutate,
  templates,
  projects,
  properties,
  orders,
}: {
  onMutate: MutateFn;
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
}) {
  const [splitItem, setSplitItem] = useState<PaymentCalendarItem | null>(null);
  const [markItem, setMarkItem] = useState<PaymentCalendarItem | null>(null);
  const [remindItem, setRemindItem] = useState<PaymentCalendarItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PaymentCalendarItem | null>(null);
  const [editItem, setEditItem] = useState<PaymentCalendarItem | null>(null);
  const [editTemplate, setEditTemplate] = useState<RecurringExpenseTemplateItem | null>(null);

  const actionsFor = (item: PaymentCalendarItem): ItemActions => {
    const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
    const template = isForecast ? templates.find((t) => t.id === item.recurringTemplateId) ?? null : null;
    return {
      onMarkPaid: () => setMarkItem(item),
      onSplit: () => setSplitItem(item),
      onRemind: () => setRemindItem(item),
      onDelete: () => setDeleteItem(item),
      // A real expense row edits in place (the shared dialog, same as the
      // ledger). A forecast has no row yet, so "edit" is the recurring rule it
      // came from. Wages / loans / card charges edit on their own pages (למקור).
      ...(item.expenseId
        ? { onEdit: () => setEditItem(item), editLabel: "עריכה" }
        : template
          ? { onEdit: () => setEditTemplate(template), editLabel: "עריכת ההוצאה הקבועה" }
          : {}),
    };
  };

  const dialogs = (
    <>
      {/* Edit a real expense — the shared dialog, seeded exactly as the ledger
          seeds it. `dueDate` (expense_date), not `date`: a paid row's `date` is
          its paid_date, and saving that back would overwrite the schedule. */}
      <ExpenseDialog
        open={Boolean(editItem)}
        onOpenChange={(o) => {
          if (!o) setEditItem(null);
        }}
        editingExpense={
          editItem?.expenseId
            ? {
                id: editItem.expenseId,
                amount: editItem.amount,
                category: editItem.category,
                description: editItem.descriptionRaw,
                notes: editItem.notes,
                expense_date: editItem.dueDate,
                business_domain: editItem.businessDomain,
                payment_status: editItem.paymentStatus,
                paid_amount: editItem.paidAmount,
                payment_method: editItem.paymentMethod,
                paid_date: editItem.paidDate,
                account_id: editItem.accountId,
                project_id: editItem.expenseProjectId,
                order_id: editItem.expenseOrderId,
                property_id: editItem.expensePropertyId,
              }
            : null
        }
        editingSourceLabel={editItem?.sourceLabel ?? null}
        lockedProjectId={editItem?.expenseProjectId}
        lockedOrderId={editItem?.expenseOrderId}
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        // The dialog awaits this before closing, so it stays busy until the
        // board shows the row on its (possibly new) day.
        onSaved={(data) => onMutate({ expenseId: data.expenseId || editItem?.expenseId })}
      />

      {/* Edit the recurring rule behind a forecast item */}
      <ExpenseDialog
        open={Boolean(editTemplate)}
        onOpenChange={(o) => {
          if (!o) setEditTemplate(null);
        }}
        editingRecurringTemplate={editTemplate}
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={() => onMutate()}
      />

      <SplitPaymentDialog
        open={Boolean(splitItem)}
        onOpenChange={(o) => {
          if (!o) setSplitItem(null);
        }}
        sourceItem={splitItem}
        onSaved={async () => {
          await onMutate({ id: splitItem?.id });
          setSplitItem(null);
        }}
      />

      <MarkPaidDialog
        item={markItem}
        onClose={() => setMarkItem(null)}
        onSaved={async ({ expenseId }) => {
          await onMutate({ expenseId });
          setMarkItem(null);
        }}
      />

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindItem)}
        onOpenChange={(o) => {
          if (!o) setRemindItem(null);
        }}
        category="task"
        links={remindItem?.expenseId ? { expense_id: remindItem.expenseId } : {}}
        defaultNote={remindItem ? reminderNoteFor(remindItem) : undefined}
        onSaved={() => setRemindItem(null)}
      />

      {/* Delete this expense (e.g. an orphaned recurring bill) — deferred with undo */}
      <ConfirmDialog
        open={Boolean(deleteItem)}
        onOpenChange={(o) => {
          if (!o) setDeleteItem(null);
        }}
        title="מחיקת תשלום"
        description={deleteItem ? `למחוק את "${deleteItem.label}"?` : ""}
        confirmLabel="מחיקה"
        destructive
        onConfirm={() => {
          if (!deleteItem) return;
          const target = deleteItem;
          setDeleteItem(null);
          scheduleExpenseItemDelete(target, () => {
            void onMutate();
          });
        }}
      />
    </>
  );

  return { actionsFor, dialogs };
}

// ── Selected-day panel (owns its own add dialog; item dialogs come from the hook) ─
function PaymentsDayPanel({
  day,
  holiday,
  isToday,
  items,
  total,
  projects,
  properties,
  orders,
  templates,
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
  templates: RecurringExpenseTemplateItem[];
  accountNameById: Map<string, string>;
  onMutate: MutateFn;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const { actionsFor, dialogs } = usePaymentItemActions({ onMutate, templates, projects, properties, orders });

  const dayIso = isoLocal(day);

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-4">
      {/* Header — a header: eyebrow, the date large, its Hebrew date and holiday
          small, the day's total on its own line, and a rule before the list. */}
      <div className="border-b pb-3">
        {isToday ? <div className="text-[11px] font-semibold text-primary">היום</div> : null}
        <div className="mt-0.5 text-xl font-bold leading-tight">{fmtFullDay(day)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
        {holiday ? <div className="mt-0.5 text-xs font-medium text-secondary">{holiday}</div> : null}
        {total > 0 ? (
          <div className="mt-3 flex items-baseline justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">לתשלום ביום זה</span>
            <span className="text-base font-bold tabular-nums">{fmtIls(total)}</span>
          </div>
        ) : items.length > 0 ? (
          <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">כל התשלומים ביום זה שולמו</div>
        ) : null}
      </div>

      {/* Body — fills the panel and scrolls when there are many payments, so the
          panel keeps a fixed height and the add button stays pinned at the bottom */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {items.length > 0 ? (
          <div className="space-y-2.5">
            {items.map((item) => (
              <PaymentItemCard
                key={item.id}
                item={item}
                compact
                accountName={item.accountId ? accountNameById.get(item.accountId) : undefined}
                {...actionsFor(item)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarIcon className="h-6 w-6" />
            </div>
            <div className="text-sm font-medium">אין תשלומים ביום זה</div>
          </div>
        )}
      </div>

      {/* Add — pinned to the bottom, full width */}
      <div className="mt-3">
        <Button type="button" variant="outline" className="w-full" onClick={() => setAddOpen(true)}>
          <AddIcon className="h-4 w-4" />
          הוסף תשלום ליום זה
        </Button>
      </div>

      {/* Add expense/payment — the full shared expense dialog (one-time or
          recurring), prefilled to this day. No `users` prop, so the worker-session
          category is omitted on the payments calendar. The dialog awaits onSaved
          and closes itself once the new payment is on the board. */}
      <ExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultDate={dayIso}
        showAttachments
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        onSaved={(data) => onMutate({ expenseId: data.expenseId || null })}
      />

      {dialogs}
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
  // Given the expense row that now holds the payment (a forecast gets one on
  // the spot). Awaited: the dialog stays busy until the board has caught up.
  onSaved: (saved: { expenseId: string | null }) => void | Promise<void>;
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
              // A row from a variable-amount template holds only the estimate
              // until now — this is the real figure.
              amount: isVariable ? amountNum : null,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        expense?: { id?: string };
      };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "סימון התשלום נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום סומן כשולם");
      // A paid bill flows on its paid_date, so it usually MOVES — stay busy
      // until the board shows it on its new day.
      await onSaved({ expenseId: json.id ?? json.expense?.id ?? item.expenseId ?? null });
    } catch (err) {
      const msg = toHebrewError(err, "סימון התשלום נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="סימון תשלום כשולם"
      description={item ? `${item.label} — ${isVariable ? "סכום משתנה" : fmtIls(item.amount)}` : undefined}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel="סמן כשולם"
      busyLabel="שומר..."
      busy={saving}
      error={error || undefined}
    >
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
            <NativeSelect
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">בחר אמצעי</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>
          </div>
          <AccountSelect
            required
            value={accountId}
            onChange={setAccountId}
            onLoaded={setAccountsList}
          />
        </div>
    </FormDialog>
  );
}

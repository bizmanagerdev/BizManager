"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { FOCUS_PARAM, flashFocusTarget } from "@/components/layout/FocusHighlighter";
import { NativeSelect } from "@/components/ui/native-select";
import { FilterChip, TOOLBAR_CONTROL } from "@/components/ui/filter-chip";
import type { Account } from "@/lib/accounts";
import { replaceSearchParams } from "@/lib/ui/url-state";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import MonthCalendar, {
  MonthNav,
  fmtFullDay,
  isoLocal,
  toDateOnly,
  type DayContext,
  type SelectedContext,
} from "@/components/ui/month-calendar";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import PaymentsAlertsChip from "./PaymentsAlertsChip";
import PaymentsDayPanel from "./PaymentsDayPanel";
import { useRefreshAndWait } from "./useRefreshAndWait";
import {
  MONTH_PARAM,
  STAGE_DOT,
  STAGE_ORDER,
  amountLabel,
  dayStageText,
  fmtIls,
  groupByDay,
  itemStageKey,
  monthFromParam,
  monthToParam,
  summarizeDayByStage,
  unpaidTotal,
  type MutateFn,
  type Option,
} from "./calendar.helpers";

// The cash calculator is opened from the page header, so the hub imports it
// from here — kept as a re-export so that import doesn't have to move.
export { default as CashNeedsDialog } from "./CashNeedsDialog";

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

const EMPTY_IDS: ReadonlySet<string> = new Set();

export default function PaymentsCalendar({ items: itemsProp, todayIso, projects, properties, orders, accounts, templates, alertsSlot }: Props) {
  const searchParams = useSearchParams();
  const { refreshAndWait } = useRefreshAndWait();
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
  // Month + selected day owned here so the calendar, the day panel and the
  // alerts chip (which jumps to a day) all stay in sync.
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

  // Jump to a specific day (from the alerts chip): move to that month and
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

  // Show WHERE an item landed after a change: its month, its day, and a flash
  // on its card (same effect as the app-wide ?focus= deep link). A paid item
  // is revealed through the paid filter so the move is visible, not a vanish.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  // Bank-account scope applies to the whole view (calendar, day panel, chip).
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

  const itemsByDay = useMemo(() => groupByDay(visibleItems), [visibleItems]);
  const itemsOnDay = (day: Date) => itemsByDay.get(isoLocal(day)) ?? [];

  function renderSelectedPanel({ day, holiday, isToday }: SelectedContext) {
    return (
      <PaymentsDayPanel
        day={day}
        holiday={holiday}
        isToday={isToday}
        items={itemsOnDay(day)}
        total={unpaidTotal(itemsOnDay(day))}
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
    // Aggregate per stage → each shows as "<colored dot> <amount>" on one row.
    const byStage = summarizeDayByStage(itemsOnDay(day));
    return (
      <>
        {holiday ? (
          <span className="max-w-full truncate text-[9px] leading-tight text-secondary">{holiday}</span>
        ) : null}
        {STAGE_ORDER.filter((s) => byStage.has(s)).map((s) => {
          const text = dayStageText(byStage.get(s)!);
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
    const total = unpaidTotal(dayItems);
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1.5">
          <span className="text-sm font-semibold">{fmtFullDay(day)}</span>
          {total > 0 ? <span className="text-xs font-semibold">{fmtIls(total)}</span> : null}
        </div>
        <ul className="space-y-1">
          {dayItems.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 text-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(item)]}`} />
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className="shrink-0 font-medium">{amountLabel(item)}</span>
            </li>
          ))}
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

  // The two filters are CHIPS (aria-pressed), the same control the rest of the
  // app uses for a filter — a switch reads as a setting and is slower to scan.
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

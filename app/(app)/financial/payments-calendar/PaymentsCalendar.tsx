"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { FOCUS_PARAM, flashFocusTarget } from "@/components/layout/FocusHighlighter";
import { NativeSelect } from "@/components/ui/native-select";
import { FilterChip, TOOLBAR_CONTROL } from "@/components/ui/filter-chip";
import type { Account } from "@/lib/accounts";
import { idFromParam, replaceSearchParams } from "@/lib/ui/url-state";
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
  MONEY_SIGN,
  MONTH_PARAM,
  SHOW_PAID_PARAM,
  RECURRING_ONLY_PARAM,
  ACCOUNT_PARAM,
  STAGE_DOT,
  STAGE_ORDER,
  amountLabel,
  dayStageText,
  filterByDirection,
  fmtIls,
  groupByDay,
  itemStageKey,
  monthFromParam,
  monthToParam,
  openTotals,
  settledWordFor,
  summarizeDayByStage,
  type DirectionFilter,
  type IncomeOptions,
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
  // Pickers for the day panel's "add a receipt" dialog.
  incomeOptions: IncomeOptions;
  // Page-header element the alerts chip is portaled into (PaymentsHubClient),
  // beside the tabs. Null until that header mounts — the chip waits for it
  // rather than flashing above the calendar first.
  alertsSlot?: HTMLElement | null;
  // Same trick for the data filters. They scope the day panel and the cash
  // calculator as well as the grid, so sitting on the grid's own toolbar
  // implied a narrower reach than they have. State stays here (it is the
  // board's), only the controls are rendered up there.
  filtersSlot?: HTMLElement | null;
  // Which way the money goes: owned by the hub (it draws the switch beside the
  // tabs) and pushed down here, so the board, the day panel and the alerts chip
  // all answer about the same side of the ledger.
  direction: DirectionFilter;
};

const EMPTY_IDS: ReadonlySet<string> = new Set();

export default function PaymentsCalendar({ items: allItems, todayIso, projects, properties, orders, accounts, templates, incomeOptions, alertsSlot, filtersSlot, direction }: Props) {
  const searchParams = useSearchParams();
  const { refreshAndWait } = useRefreshAndWait();
  const itemsProp = useMemo(() => filterByDirection(allItems, direction), [allItems, direction]);
  const items = useUndoOverlay(itemsProp, (i) => i.id, "payment-calendar-item");
  // The filters are seeded from the URL and written back (below), so a refresh keeps them.
  const [showPaid, setShowPaid] = useState(() => searchParams.get(SHOW_PAID_PARAM) === "1");
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
  const [recurringOnly, setRecurringOnly] = useState(() => searchParams.get(RECURRING_ONLY_PARAM) === "1");
  const [accountFilter, setAccountFilter] = useState(() => idFromParam(searchParams.get(ACCOUNT_PARAM), accounts));
  useEffect(() => {
    replaceSearchParams({
      [SHOW_PAID_PARAM]: showPaid ? "1" : null,
      [RECURRING_ONLY_PARAM]: recurringOnly ? "1" : null,
      [ACCOUNT_PARAM]: accountFilter || null,
    });
  }, [showPaid, recurringOnly, accountFilter]);
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
    // Not in נכנס, where the chip isn't shown: a kept "רק קבועות" would empty
    // the incoming board with no visible reason.
    if (recurringOnly && direction !== "in") list = list.filter((i) => i.recurringTemplateId);
    return list;
  }, [accountScopedItems, showPaid, recurringOnly, revealedIds, direction]);

  const itemsByDay = useMemo(() => groupByDay(visibleItems), [visibleItems]);
  const itemsOnDay = (day: Date) => itemsByDay.get(isoLocal(day)) ?? [];

  function renderSelectedPanel({ day, holiday, isToday }: SelectedContext) {
    return (
      <PaymentsDayPanel
        day={day}
        holiday={holiday}
        isToday={isToday}
        items={itemsOnDay(day)}
        direction={direction}
        projects={projects}
        properties={properties}
        orders={orders}
        templates={templates}
        incomeOptions={incomeOptions}
        accountNameById={accountNameById}
        onMutate={afterMutation}
      />
    );
  }

  function renderDayContent({ day, holiday }: DayContext) {
    const dayItems = itemsOnDay(day);
    const holidayLabel = holiday ? (
      <span className="max-w-full truncate text-[9px] leading-tight text-secondary">{holiday}</span>
    ) : null;
    // With both directions on the board, a day's stage breakdown would need
    // eight rows in a cell that fits two. Show the two sides instead, signed —
    // the day panel still has the full detail.
    if (direction === "all") {
      const t = openTotals(dayItems);
      // Everything on this day, settled or not — the cell must equal the list
      // it opens. (With "הצג ששולמו" off there is nothing settled to add.)
      const totals = { in: t.in + t.settledIn, out: t.out + t.settledOut };
      return (
        <>
          {holidayLabel}
          {totals.in > 0 ? (
            <span className="flex max-w-full items-center gap-1 text-[10px] font-semibold leading-tight text-foreground">
              <span className={`${MONEY_SIGN} text-success`}>+</span>
              <span className="truncate">{fmtIls(totals.in)}</span>
            </span>
          ) : null}
          {totals.out > 0 ? (
            <span className="flex max-w-full items-center gap-1 text-[10px] font-semibold leading-tight text-foreground">
              <span className={`${MONEY_SIGN} text-destructive`}>−</span>
              <span className="truncate">{fmtIls(totals.out)}</span>
            </span>
          ) : null}
        </>
      );
    }
    // Aggregate per stage → each shows as "<colored dot> <amount>" on one row.
    const byStage = summarizeDayByStage(dayItems);
    return (
      <>
        {holidayLabel}
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

  // Hovering a day previews it without selecting it: the day's headline figure,
  // then one row per item — who it is from, what it is for underneath, and the
  // amount. Signed per row when both directions share the board.
  function renderDayHover({ day }: DayContext) {
    const dayItems = itemsOnDay(day);
    if (dayItems.length === 0) return null;
    const t = openTotals(dayItems);
    // Same rule as the grid cell: the header adds up the rows listed below it.
    const headline =
      direction === "all"
        ? t.in + t.settledIn - (t.out + t.settledOut)
        : direction === "in"
          ? t.in + t.settledIn
          : t.out + t.settledOut;
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1.5">
          <span className="text-sm font-semibold">{fmtFullDay(day)}</span>
          {headline !== 0 ? (
            <span className="text-xs font-semibold">
              {direction === "all" ? (
                <span className={`${MONEY_SIGN} ${headline >= 0 ? "text-success" : "text-destructive"}`}>{headline >= 0 ? "+" : "\u2212"}</span>
              ) : null}
              {fmtIls(Math.abs(headline))}
            </span>
          ) : null}
        </div>
        <ul className="space-y-1">
          {dayItems.map((item) => (
            <li key={item.id} className="flex items-start gap-1.5 text-xs">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(item)]}`} />
              <span className="min-w-0 flex-1">
                <span className="break-words">{item.label}</span>
                {item.sourceLabel ? (
                  <span className="block break-words text-[11px] leading-tight text-muted-foreground">{item.sourceLabel}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-medium">
                {direction === "all" ? (
                  <span className={`${MONEY_SIGN} ${item.direction === "in" ? "text-success" : "text-destructive"}`}>
                    {item.direction === "in" ? "+" : "\u2212"}
                  </span>
                ) : null}
                {amountLabel(item)}
              </span>
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
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />{settledWordFor(direction)}</span>
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
  // Recurring bills only exist on the outgoing side (there is no recurring
  // income rule yet), so the chip would filter every incoming row away.
  const recurringOnlyToggle =
    direction === "in" ? null : (
      <FilterChip active={recurringOnly} label="רק קבועות" onClick={() => setRecurringOnly((v) => !v)} />
    );
  const accountFilterControl =
    accounts.length > 0 ? (
      <NativeSelect dense
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        aria-label="סינון לפי חשבון"
        className={`w-auto min-w-0 max-w-[10rem] shrink border-input text-xs text-foreground shadow-none ${TOOLBAR_CONTROL}`}
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
          direction={direction}
          onJump={jumpToDay}
        />,
        alertsSlot
      )
    : null;

  // Month navigation sits at the START of the grid's toolbar, grouped with
  // היום: it navigates the grid and nothing else, and "where am I" reads
  // before "what am I looking at".
  const monthSwitcher = (
    <MonthNav month={monthDate} todayDate={today} onChange={changeMonth} labelClassName="text-base font-bold" />
  );

  // The three data filters, portaled into the page header beside the mode
  // switcher: all four change WHAT DATA is on the page, so they belong
  // together. What stays on the grid's own toolbar is only what is about the
  // grid — month navigation and the legend.
  const filterControls = filtersSlot
    ? createPortal(
        <>
          {accountFilterControl}
          {recurringOnlyToggle}
          {showPaidToggle}
        </>,
        filtersSlot
      )
    : null;

  return (
    <div className="space-y-3">
      {alertsChip}
      {filterControls}
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
        // "Where am I" at the start, "what am I looking at" at the end.
        gridHeader={monthSwitcher}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { AddIcon, CalendarIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { fmtFullDay, isoLocal } from "@/components/ui/month-calendar";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import { ExpenseDialog } from "./LazyExpenseDialog";
import { IncomeDialog } from "./LazyIncomeDialog";
import PaymentItemCard from "./PaymentItemCard";
import usePaymentItemActions from "./usePaymentItemActions";
import { DIRECTION_WORDS, MONEY_SIGN, fmtIls, openTotals, type DirectionFilter, type IncomeOptions, type MutateFn, type Option } from "./calendar.helpers";

// ── Selected-day panel (owns its own add dialog; item dialogs come from the hook) ─
export default function PaymentsDayPanel({
  day,
  holiday,
  isToday,
  items,
  direction,
  projects,
  properties,
  orders,
  templates,
  incomeOptions,
  accountNameById,
  onMutate,
}: {
  day: Date;
  holiday: string | null;
  isToday: boolean;
  items: PaymentCalendarItem[];
  /** Which direction the board is showing — decides the wording and whether
   *  the header shows one figure or the day's two sides and their net. */
  direction: DirectionFilter;
  projects: Option[];
  properties: Option[];
  orders: Option[];
  templates: RecurringExpenseTemplateItem[];
  /** The richer pickers the income dialog needs (see calendar.helpers). */
  incomeOptions: IncomeOptions;
  accountNameById: Map<string, string>;
  onMutate: MutateFn;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const { actionsFor, dialogs } = usePaymentItemActions({ onMutate, templates, projects, properties, orders, accountNameById });

  const dayIso = isoLocal(day);
  const totals = openTotals(items);
  const showBoth = direction === "all";
  // In a single direction the panel speaks that direction's language; in "הכל"
  // it stays neutral and lets the two figures say which is which.
  const words = DIRECTION_WORDS[direction === "in" ? "in" : "out"];
  // In הכל the "everything here is done" line must not claim they were paid.
  const allSettledText = direction === "all" ? `כל התנועות ביום זה בוצעו` : words.allSettled;
  const singleTotal = direction === "in" ? totals.in : totals.out;

  return (
    <div className="flex h-full flex-col rounded-2xl border bg-card p-4">
      {/* Header — a header: eyebrow, the date large, its Hebrew date and holiday
          small, the day's total on its own line, and a rule before the list. */}
      <div className="border-b pb-3">
        {isToday ? <div className="text-[11px] font-semibold text-primary">היום</div> : null}
        <div className="mt-0.5 text-xl font-bold leading-tight">{fmtFullDay(day)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hebrewFullDate(day)}</div>
        {holiday ? <div className="mt-0.5 text-xs font-medium text-secondary">{holiday}</div> : null}
        {showBoth && (totals.in > 0 || totals.out > 0) ? (
          // Both sides of the day. The net counts only money with a payment
          // instrument behind it; an open debt that happens to fall due today
          // is listed under it, not added into it.
          <div className="mt-3 space-y-1.5 rounded-lg bg-muted/40 px-3 py-2">
            {/* Each line appears only when it has a figure. A day whose only
                money is a customer balance used to render +0 / −0 / 0. */}
            {totals.inCommitted > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{DIRECTION_WORDS.in.dayTotal}</span>
                <span className="text-sm font-semibold tabular-nums">
                  <span className={`${MONEY_SIGN} text-success`}>+</span>{fmtIls(totals.inCommitted)}
                </span>
              </div>
            ) : null}
            {totals.out > 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{DIRECTION_WORDS.out.dayTotal}</span>
                <span className="text-sm font-semibold tabular-nums">
                  <span className={`${MONEY_SIGN} text-destructive`}>−</span>{fmtIls(totals.out)}
                </span>
              </div>
            ) : null}
            {totals.inCommitted > 0 && totals.out > 0 ? (
              <div className="flex items-baseline justify-between gap-3 border-t pt-1.5">
                <span className="text-xs font-semibold">נטו</span>
                <span className="text-base font-bold tabular-nums">
                  <span className={`${MONEY_SIGN} ${totals.net >= 0 ? "text-success" : "text-destructive"}`}>{totals.net >= 0 ? "+" : "−"}</span>
                  {fmtIls(Math.abs(totals.net))}
                </span>
              </div>
            ) : null}
            {totals.inOwed > 0 ? (
              <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 text-xs text-muted-foreground">
                <span>תלוי בגבייה · לא נכלל בנטו</span>
                <span className="font-semibold tabular-nums">{fmtIls(totals.inOwed)}</span>
              </div>
            ) : null}
            {/* Already moved. Listed because the rows are on screen, apart
                because it is not something still to do. */}
            {totals.settledIn > 0 || totals.settledOut > 0 ? (
              <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 text-xs text-muted-foreground">
                <span>כבר בוצע ביום זה</span>
                <span className="font-semibold tabular-nums">
                  {totals.settledIn > 0 ? `+${fmtIls(totals.settledIn)}` : ""}
                  {totals.settledIn > 0 && totals.settledOut > 0 ? " · " : ""}
                  {totals.settledOut > 0 ? `−${fmtIls(totals.settledOut)}` : ""}
                </span>
              </div>
            ) : null}
          </div>
        ) : !showBoth && singleTotal > 0 ? (
          <div className="mt-3 space-y-1.5 rounded-lg bg-muted/40 px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">{words.dayTotal}</span>
              <span className="text-base font-bold tabular-nums">{fmtIls(singleTotal)}</span>
            </div>
            {direction === "in" && totals.inOwed > 0 ? (
              // Of that, how much is a debt rather than a payment on its way.
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>מתוך זה תלוי בגבייה</span>
                <span className="font-semibold tabular-nums">{fmtIls(totals.inOwed)}</span>
              </div>
            ) : null}
          </div>
        ) : items.length > 0 ? (
          <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">{allSettledText}</div>
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
            <div className="text-sm font-medium">{words.empty}</div>
          </div>
        )}
      </div>

      {/* Add — pinned to the bottom, and only when the board is showing ONE
          direction, where the button is unambiguous and carries the day you
          clicked. In הכל two buttons side by side crowded the panel and
          collided with the app's own + (which creates either kind), so there
          the + is the way in. */}
      {direction === "all" ? null : (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => (direction === "in" ? setAddIncomeOpen(true) : setAddOpen(true))}
          >
            <AddIcon className="h-4 w-4" />
            {direction === "in" ? DIRECTION_WORDS.in.add : DIRECTION_WORDS.out.add}
          </Button>
        </div>
      )}

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
        onSaved={(data: { expenseId?: string | null }) => onMutate({ expenseId: data.expenseId || null })}
      />

      {/* Record money received on this day — the app's one income dialog,
          prefilled to the day that was clicked. It closes itself on save, so
          the board simply refreshes behind it. */}
      <IncomeDialog
        open={addIncomeOpen}
        onOpenChange={setAddIncomeOpen}
        defaultDate={dayIso}
        projects={incomeOptions.projects}
        orders={incomeOptions.orders}
        properties={incomeOptions.properties}
        onSaved={() => {
          setAddIncomeOpen(false);
          void onMutate();
        }}
      />

      {dialogs}
    </div>
  );
}

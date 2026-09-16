"use client";

import { useState } from "react";
import { AddIcon, CalendarIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { hebrewFullDate } from "@/lib/hebrew-calendar";
import { fmtFullDay, isoLocal } from "@/components/ui/month-calendar";
import type { PaymentCalendarItem } from "@/lib/payables";
import type { RecurringExpenseTemplateItem } from "@/app/(app)/financial/RecurringExpensesManager";
import { ExpenseDialog } from "./LazyExpenseDialog";
import PaymentItemCard from "./PaymentItemCard";
import usePaymentItemActions from "./usePaymentItemActions";
import { fmtIls, type MutateFn, type Option } from "./calendar.helpers";

// ── Selected-day panel (owns its own add dialog; item dialogs come from the hook) ─
export default function PaymentsDayPanel({
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
        onSaved={(data: { expenseId?: string | null }) => onMutate({ expenseId: data.expenseId || null })}
      />

      {dialogs}
    </div>
  );
}

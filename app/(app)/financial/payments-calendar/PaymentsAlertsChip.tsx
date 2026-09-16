"use client";

import { useMemo } from "react";
import { ChevronDownIcon, WarningIcon } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TOOLBAR_CONTROL } from "@/components/ui/filter-chip";
import { toDateOnly } from "@/components/ui/month-calendar";
import type { PaymentCalendarItem } from "@/lib/payables";
import { STAGE_DOT, amountLabel, itemStageKey, lateItems, type AlertSeverity } from "./calendar.helpers";

// ── Late-payments chip — in the page header, beside כמה צריך?. It lists ONLY
//    payments that are past their date and still unpaid: what's coming up is
//    already on the calendar itself, so repeating it here just buried the late
//    ones. Each row jumps to its day.
//
//    A chip, not a strip: a handful of overdue bills is this business's
//    standing state, and a permanent red band across every visit stops being
//    read within a week.
const CHIP_TONE: Record<AlertSeverity, string> = {
  danger: "border-destructive/40 bg-destructive/[0.06] text-destructive",
  warning: "border-warning/50 bg-warning/[0.08] text-warning-strong",
};

export default function PaymentsAlertsChip({
  items,
  todayIso,
  onJump,
}: {
  items: PaymentCalendarItem[];
  todayIso: string;
  onJump: (dateIso: string) => void;
}) {
  const { late, severity } = useMemo(() => lateItems(items, todayIso), [items, todayIso]);

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

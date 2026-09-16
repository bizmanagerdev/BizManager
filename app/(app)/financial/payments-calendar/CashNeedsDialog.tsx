"use client";

import { useMemo, useState } from "react";
import { ViewDialog } from "@/components/ui/view-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { FilterChip } from "@/components/ui/filter-chip";
import { toDateOnly } from "@/components/ui/month-calendar";
import type { Account } from "@/lib/accounts";
import type { PaymentCalendarItem } from "@/lib/payables";
import { STAGE_DOT, addDaysIso, amountLabel, cashNeeds, fmtIls, itemStageKey, type DirectionFilter } from "./calendar.helpers";

// ── Cash-needs calculator — "how much will I need between X and Y?" ─────────────
// Sums every not-yet-paid outflow in a date range (honoring the page's account
// filter via the passed items, plus its own recurring-only toggle). Variable bills
// contribute their estimate, and the total is marked "~" when any estimate is in it.
export default function CashNeedsDialog({
  open,
  onOpenChange,
  items,
  accounts,
  todayIso,
  direction = "out",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: PaymentCalendarItem[];
  accounts: Account[];
  todayIso: string;
  /** Scopes the rundown; the totals always show both sides when money comes in. */
  direction?: DirectionFilter;
}) {
  // Parent remounts this on open (via key), so the range initializes fresh each time.
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(() => addDaysIso(todayIso, 7));
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [accountFilter, setAccountFilter] = useState("");

  const result = useMemo(
    () => cashNeeds(items, { from, to, recurringOnly, accountFilter }),
    [items, from, to, recurringOnly, accountFilter]
  );
  // The calculator was built to answer "how much has to go out?". Once money
  // comes in too, the honest answer is the net — so it leads, with both sides
  // under it. With nothing incoming in range, it stays the single figure.
  const showNet = result.incoming > 0;

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
            {direction === "in" ? <span /> : (
              <FilterChip active={recurringOnly} label="רק הוצאות קבועות" onClick={() => setRecurringOnly((v) => !v)} />
            )}
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

          <div className="rounded-xl bg-foreground px-4 py-3 text-background">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs opacity-70">{showNet ? "כמה חסר" : "סה״כ נדרש"}</div>
                <div className="text-2xl font-bold tabular-nums">
                  {result.hasEstimate ? "~" : ""}
                  {showNet ? fmtIls(Math.abs(Math.min(result.net, 0))) : fmtIls(result.total)}
                </div>
              </div>
              <div className="text-xs opacity-70">
                {result.rows.length} שורות{result.hasEstimate ? " · כולל הערכות" : ""}
              </div>
            </div>
            {showNet ? (
              // The two sides behind that figure, so it can be checked.
              <div className="mt-2 flex items-center gap-4 border-t border-background/20 pt-2 text-xs">
                <span className="opacity-70">צפוי להיכנס <span className="font-semibold tabular-nums opacity-100">{fmtIls(result.incoming)}</span></span>
                <span className="opacity-70">צפוי לצאת <span className="font-semibold tabular-nums opacity-100">{fmtIls(result.total)}</span></span>
              </div>
            ) : null}
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
                    <span className="shrink-0 font-medium tabular-nums">
                      {showNet ? (
                        <span className={i.direction === "in" ? "text-success" : "text-destructive"}>
                          {i.direction === "in" ? "+" : "−"}
                        </span>
                      ) : null}
                      {amountLabel(i)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">אין תנועות בטווח שנבחר.</div>
          )}
        </div>
    </ViewDialog>
  );
}

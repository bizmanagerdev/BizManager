"use client";

import { useMemo, useState } from "react";
import { ViewDialog } from "@/components/ui/view-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { FilterChip } from "@/components/ui/filter-chip";
import { toDateOnly } from "@/components/ui/month-calendar";
import type { Account } from "@/lib/accounts";
import type { PaymentCalendarItem } from "@/lib/payables";
import { MONEY_SIGN, STAGE_DOT, addDaysIso, amountLabel, cashNeeds, fmtIls, itemCertainty, itemStageKey, type DirectionFilter } from "./calendar.helpers";

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

  const outRows = result.rows.filter((i) => i.direction !== "in");
  const incomingRows = result.rows.filter((i) => i.direction === "in");
  const certainRows = incomingRows.filter((i) => itemCertainty(i) === "committed");
  const owedRows = incomingRows.filter((i) => itemCertainty(i) === "owed");

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

          {/* Read it downwards: what goes out, what is certain to come in, the
              balance of those two — then the money that depends on collection
              and what the balance becomes if it all lands. Every step carries
              its own total, and nothing is left off the page. */}
          {result.rows.length === 0 ? (
            <div className="rounded-lg border p-4 text-center text-sm text-muted-foreground">אין תנועות בטווח שנבחר.</div>
          ) : (
            <div className="space-y-2">
              <Section title="יוצא" total={result.total} rows={outRows} sign="−" />
              <Section title="נכנס" total={result.incoming} rows={certainRows} sign="+" />
              {/* Not "missing" — nothing is missing yet. This is the amount that
                  has to BE there to cover the range, which is what the user
                  then goes and checks the accounts against. */}
              <Running
                label={result.net >= 0 ? "עודף" : "צריך"}
                value={result.net}
                strong={result.owed === 0}
                hasEstimate={result.hasEstimate}
              />
              {result.owed > 0 ? (
                <>
                  <Section title="נכנס · תלוי בגבייה" total={result.owed} rows={owedRows} sign="+" />
                  <Running
                    label={result.netIfAll >= 0 ? "עודף אחרי גבייה" : "צריך גם אחרי גבייה"}
                    value={result.netIfAll}
                    strong
                    hasEstimate={result.hasEstimate}
                  />
                </>
              ) : null}
            </div>
          )}
        </div>
    </ViewDialog>
  );
}

// One step of the statement: a heading with its own total, then its rows.
function Section({
  title,
  total,
  rows,
  sign,
}: {
  title: string;
  total: number;
  rows: PaymentCalendarItem[];
  sign: "+" | "−";
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-baseline justify-between gap-3 bg-muted/40 px-3 py-1.5">
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-sm font-bold tabular-nums">
          <span className={`${MONEY_SIGN} ${sign === "+" ? "text-success" : "text-destructive"}`}>{sign}</span>
          {fmtIls(total)}
        </span>
      </div>
      <ul className="max-h-[16vh] min-h-0 divide-y overflow-y-auto text-xs">
        {rows.map((i) => {
          const d = toDateOnly(i.date) ?? new Date(i.date);
          return (
            <li key={i.id} className="flex items-center gap-2 px-2 py-1 leading-snug">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[itemStageKey(i)]}`} />
              <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                {d.getDate()}/{d.getMonth() + 1}
              </span>
              <span className="min-w-0 flex-1 break-words">{i.label}</span>
              {i.variableAmount && i.amount > 0 ? (
                <span className="shrink-0 text-warning-strong">משתנה</span>
              ) : null}
              <span className="shrink-0 font-medium tabular-nums">{amountLabel(i)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A running total between the steps. The last one is the answer, so it is the
// one that gets the dark bar.
function Running({
  label,
  value,
  strong,
  hasEstimate,
}: {
  label: string;
  value: number;
  strong: boolean;
  hasEstimate: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-baseline justify-between gap-3 rounded-lg bg-foreground px-3 py-2 text-background"
          : "flex items-baseline justify-between gap-3 px-3 py-1"
      }
    >
      <span className={strong ? "text-xs font-semibold" : "text-xs font-medium text-muted-foreground"}>{label}</span>
      <span className={strong ? "text-xl font-bold tabular-nums" : "text-sm font-semibold tabular-nums"}>
        {hasEstimate ? "~" : ""}
        {fmtIls(Math.abs(value))}
      </span>
    </div>
  );
}

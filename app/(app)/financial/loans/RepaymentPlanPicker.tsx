"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { buildInstallmentSchedule, type LoanRepayment } from "@/lib/loans";
import { Field, SELECT_CLASS, formatIls } from "./shared";

// ════════════════════════════════════════════════════════════════════════════
// "איך מחזירים?" — the repayment structure of a loan: one payment on a date, or
// N payments on N dates. Used BOTH on the loan create/edit form (so the plan is
// set when the loan is created) and inside the repayments dialog (to change it
// later). Controlled: the parent owns the state and decides when to save.
// ════════════════════════════════════════════════════════════════════════════

export type PlanMode = "single" | "installments";
export type PlanRow = { date: string; amount: string };

export type RepaymentPlanState = {
  mode: PlanMode;
  /** "בתשלום אחד" — the one date the whole amount comes back on. */
  singleDate: string;
  count: string;
  firstDate: string;
  interval: string;
  /** Rows were hand-edited ⇒ stop regenerating them from count/date/interval. */
  custom: boolean;
  rows: PlanRow[];
};

export const PLAN_INTERVALS = [
  { value: "m1", label: "כל חודש" },
  { value: "m2", label: "כל חודשיים" },
  { value: "m3", label: "כל 3 חודשים" },
  { value: "m6", label: "כל חצי שנה" },
  { value: "m12", label: "כל שנה" },
  { value: "w1", label: "כל שבוע" },
  { value: "w2", label: "כל שבועיים" },
];

function generate(state: RepaymentPlanState, amount: number): PlanRow[] {
  const isWeeks = state.interval.startsWith("w");
  const step = Number(state.interval.slice(1)) || 1;
  return buildInstallmentSchedule({
    total: amount,
    count: Number(state.count) || 0,
    firstDate: state.firstDate,
    intervalMonths: isWeeks ? 1 : step,
    intervalDays: isWeeks ? step * 7 : 0,
  }).map((row) => ({ date: row.date, amount: String(row.amount) }));
}

/** The installments this state describes, ready to render or save. */
export function planRows(state: RepaymentPlanState, amount: number): PlanRow[] {
  if (state.mode === "single") {
    return state.singleDate && amount > 0
      ? [{ date: state.singleDate, amount: String(amount) }]
      : [];
  }
  return state.custom ? state.rows : generate(state, amount);
}

export function planTotal(state: RepaymentPlanState, amount: number): number {
  return planRows(state, amount).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

/** The date the loan is fully paid back — used as the loan's תאריך פרעון. */
export function planLastDate(state: RepaymentPlanState, amount: number): string {
  const rows = planRows(state, amount);
  return rows.length ? rows[rows.length - 1].date : "";
}

/** A fresh plan for a new loan: one payment, date not chosen yet. */
export function emptyPlanState(dueDate?: string | null): RepaymentPlanState {
  return {
    mode: "single",
    singleDate: dueDate ?? "",
    count: "3",
    firstDate: dueDate ?? "",
    interval: "m1",
    custom: false,
    rows: [],
  };
}

/** Re-open an existing loan's plan for editing (seeded from its planned rows). */
export function planStateFromInstallments(
  planned: LoanRepayment[],
  { amount, dueDate }: { amount: number; dueDate?: string | null }
): RepaymentPlanState {
  if (planned.length === 0) return emptyPlanState(dueDate);
  const rows = planned.map((row) => ({ date: row.repayment_date, amount: String(row.amount) }));
  // A single installment for the full amount IS the "one payment" case.
  if (rows.length === 1 && Math.abs((Number(rows[0].amount) || 0) - amount) < 0.5) {
    return { ...emptyPlanState(rows[0].date), mode: "single", singleDate: rows[0].date };
  }
  return {
    mode: "installments",
    singleDate: rows[rows.length - 1].date,
    count: String(rows.length),
    firstDate: rows[0].date,
    interval: "m1",
    custom: true,
    rows,
  };
}

export default function RepaymentPlanPicker({
  state,
  onChange,
  amount,
  /** Label above the mode buttons; hidden when the parent already titles the block. */
  label = "איך מחזירים?",
}: {
  state: RepaymentPlanState;
  onChange: (next: RepaymentPlanState) => void;
  amount: number;
  label?: string;
}) {
  const rows = planRows(state, amount);
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const gap = Math.round(amount - total);

  function setMode(mode: PlanMode) {
    if (mode === state.mode) return;
    onChange(
      mode === "installments"
        ? {
            ...state,
            mode,
            custom: false,
            // Start the installments from the date already chosen, if any.
            firstDate: state.firstDate || state.singleDate,
          }
        : { ...state, mode, singleDate: state.singleDate || state.firstDate }
    );
  }

  // Changing a plan parameter regenerates the dates/amounts from scratch.
  function setParam(key: "count" | "firstDate" | "interval", value: string) {
    onChange({ ...state, [key]: value, custom: false });
  }

  function setRow(index: number, key: keyof PlanRow, value: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, [key]: value } : row));
    onChange({ ...state, custom: true, rows: next });
  }

  function removeRow(index: number) {
    onChange({ ...state, custom: true, rows: rows.filter((_, i) => i !== index) });
  }

  function addRow() {
    const last = rows[rows.length - 1];
    onChange({
      ...state,
      custom: true,
      rows: [...rows, { date: last?.date ?? state.firstDate, amount: last?.amount ?? "" }],
    });
  }

  return (
    <div className="space-y-3">
      {label ? <div className="text-sm font-semibold">{label}</div> : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={state.mode === "single" ? "default" : "secondary"}
          onClick={() => setMode("single")}
        >
          בתשלום אחד
        </Button>
        <Button
          type="button"
          variant={state.mode === "installments" ? "default" : "secondary"}
          onClick={() => setMode("installments")}
        >
          בכמה תשלומים
        </Button>
      </div>

      {state.mode === "single" ? (
        <Field label="תאריך ההחזר">
          <Input
            type="date"
            value={state.singleDate}
            onChange={(e) => onChange({ ...state, singleDate: e.target.value })}
          />
        </Field>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="כמה תשלומים">
              <Input
                inputMode="numeric"
                value={state.count}
                onChange={(e) => setParam("count", e.target.value.replace(/[^\d]/g, ""))}
              />
            </Field>
            <Field label="תאריך התשלום הראשון">
              <Input
                type="date"
                value={state.firstDate}
                onChange={(e) => setParam("firstDate", e.target.value)}
              />
            </Field>
            <Field label="כל כמה זמן">
              <select
                className={SELECT_CLASS}
                value={state.interval}
                onChange={(e) => setParam("interval", e.target.value)}
              >
                {PLAN_INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {rows.length > 0 ? (
            <div className="space-y-2">
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <span className="min-w-[4.5rem] pb-3 text-xs text-muted-foreground">
                    תשלום {index + 1}
                  </span>
                  <div className="min-w-[9rem] flex-1">
                    <Input
                      type="date"
                      value={row.date}
                      onChange={(e) => setRow(index, "date", e.target.value)}
                    />
                  </div>
                  <div className="min-w-[8rem] flex-1">
                    <CurrencyInput
                      value={row.amount}
                      onChange={(e) => setRow(index, "amount", e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    size="icon-sm"
                    onClick={() => removeRow(index)}
                    aria-label="הסר תשלום"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                  <Plus className="h-4 w-4" />
                  הוסף תשלום
                </Button>
                <span className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">סך הכל</span>
                  <span className="font-semibold tabular-nums" dir="ltr">
                    {formatIls(total)}
                  </span>
                  {amount > 0 && Math.abs(gap) >= 1 ? (
                    <span
                      className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses("warning")}
                    >
                      {gap > 0
                        ? `חסרים ${formatIls(gap)}`
                        : `עודף ${formatIls(Math.abs(gap))}`}
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              יש לבחור מספר תשלומים ותאריך ראשון.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

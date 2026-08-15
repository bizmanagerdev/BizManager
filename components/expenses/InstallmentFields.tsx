"use client";

import { AddIcon } from "@/components/ui/icons";
import { DeleteButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";

export type InstallmentRow = { date: string; amount: string; paid?: boolean };

export function installmentsPaidSum(rows: InstallmentRow[]) {
  return rows.reduce((s, r) => s + (r.paid ? Number(r.amount) || 0 : 0), 0);
}

function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

// Add `months` calendar months to an ISO date, clamping to the month's last day.
export function addMonthsIso(iso: string, months: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const target = new Date(year, month + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

// Even split of `total` across `count` rows (cents-accurate), remainder on row 1.
export function evenSplit(total: number, count: number): number[] {
  if (count <= 0) return [];
  const cents = Math.round(total * 100);
  const per = Math.floor(cents / count);
  const remainder = cents - per * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? per + remainder : per) / 100);
}

export function buildInstallmentRows(total: number, startDate: string, count: number): InstallmentRow[] {
  const amounts = evenSplit(total, count);
  return amounts.map((amt, i) => ({ date: addMonthsIso(startDate, i), amount: String(amt) }));
}

export function installmentsSum(rows: InstallmentRow[]) {
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

/**
 * Validate a schedule: at least 2 rows, each with a valid date + positive amount,
 * and (when `total` is given) the amounts summing to it. Returns a Hebrew error or null.
 */
export function validateInstallments(rows: InstallmentRow[], total?: number): string | null {
  if (rows.length < 2) return "יש להזין לפחות שני תשלומים.";
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return "לכל תשלום יש להזין תאריך תקין.";
    if (!Number.isFinite(Number(r.amount)) || Number(r.amount) <= 0) return "לכל תשלום יש להזין סכום גדול מאפס.";
  }
  if (total != null && Math.abs(total - installmentsSum(rows)) > 0.01) {
    return `סכום התשלומים (${fmtIls(installmentsSum(rows))}) אינו שווה לסכום הכולל (${fmtIls(total)}).`;
  }
  return null;
}

type Props = {
  /** Total the rows should add up to (for the even-split helper + diff readout). */
  total: number;
  /** Start date used when (re)building the even split and adding a first row. */
  startDate: string;
  rows: InstallmentRow[];
  onChange: (rows: InstallmentRow[]) => void;
};

/** Editable installment schedule — N dated amount rows with an even-split helper. */
export function InstallmentFields({ total, startDate, rows, onChange }: Props) {
  const sum = installmentsSum(rows);
  const paidSum = installmentsPaidSum(rows);
  const diff = Math.round((total - sum) * 100) / 100;
  const off = Math.abs(diff) > 0.01;

  const updateRow = (index: number, patch: Partial<InstallmentRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRow = () => {
    const last = rows[rows.length - 1];
    onChange([...rows, { date: last ? addMonthsIso(last.date, 1) : startDate, amount: "" }]);
  };
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const distributeEvenly = () => onChange(buildInstallmentRows(total, startDate, Math.max(2, rows.length)));

  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          סה״כ תשלומים: <span className={`font-semibold ${off ? "text-destructive" : "text-foreground"}`}>{fmtIls(sum)}</span>
          {off ? <span className="text-destructive"> (הפרש {fmtIls(diff)})</span> : null}
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={distributeEvenly}>
          חלק שווה בשווה
        </Button>
      </div>

      {paidSum > 0 ? (
        <div className="text-xs font-medium text-success">
          שולם כבר: {fmtIls(paidSum)} · נותר: {fmtIls(Math.max(0, sum - paidSum))}
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className={cn("rounded-lg border p-2 transition-colors", row.paid ? "border-success/50 bg-success/5" : "border-transparent")}>
            <div className="flex items-end gap-2">
              <div className="w-6 pb-2 text-center text-sm text-muted-foreground">{index + 1}</div>
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">תאריך</div>
                <DateInput value={row.date} onChange={(e) => updateRow(index, { date: e.target.value })} />
              </div>
              <div className="flex-1 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">סכום</div>
                <CurrencyInput type="number" min="0" step="0.01" value={row.amount} onChange={(e) => updateRow(index, { amount: e.target.value })} />
              </div>
              <DeleteButton
                label="הסרת תשלום"
                disabled={rows.length <= 2}
                onClick={() => removeRow(index)}
              />
            </div>
            <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 ps-8 text-xs font-medium">
              <input type="checkbox" checked={!!row.paid} onChange={(e) => updateRow(index, { paid: e.target.checked })} />
              <span className={row.paid ? "text-success" : "text-muted-foreground"}>שולם כבר</span>
            </label>
          </div>
        ))}
      </div>

      <Button type="button" size="sm" variant="secondary" onClick={addRow}>
        <AddIcon className="ml-1 h-4 w-4" />
        הוסף תשלום
      </Button>
    </div>
  );
}

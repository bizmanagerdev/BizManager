"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { MAX_CARD_INSTALLMENTS, parseInstallments, splitCardInstallments } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";

// "מספר תשלומים" for a card payment. With more than one, the form saves that
// many payments instead of one — each a share of the amount, dated a month
// apart, so each lands in its own month's deposit on the 10th (see
// splitCardInstallments). The line under the field says exactly what will be
// created, so nobody has to work it out.
export function CardInstallmentsField({
  value,
  onChange,
  amount,
  paymentDate,
  disabled,
  labelClassName = "text-sm font-medium",
}: {
  value: string;
  onChange: (value: string) => void;
  /** The payment's total, to show each installment's share. */
  amount: number;
  /** The payment's date — the first installment's. */
  paymentDate: string;
  disabled?: boolean;
  labelClassName?: string;
}) {
  const id = useId();
  const count = parseInstallments(value);
  const invalid = value.trim() !== "" && count === null;
  const parts =
    count && count > 1 && amount > 0 && paymentDate ? splitCardInstallments({ amount, paymentDate, count }) : [];
  const first = parts[0];
  const rest = parts[1];

  return (
    <div className="space-y-1">
      <label htmlFor={id} className={labelClassName}>
        מספר תשלומים
      </label>
      <Input
        id={id}
        inputMode="numeric"
        className="w-24"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid ? (
        <p className="text-xs text-destructive">מספר התשלומים צריך להיות בין 1 ל-{MAX_CARD_INSTALLMENTS}.</p>
      ) : first && rest ? (
        <p className="text-xs text-muted-foreground">
          יירשמו {parts.length} תשלומים של {formatCurrency(rest.amount)}
          {first.amount !== rest.amount ? ` (הראשון ${formatCurrency(first.amount)})` : ""}, אחד בכל חודש החל
          מ-{first.paymentDate.slice(8, 10)}/{first.paymentDate.slice(5, 7)}. כל אחד נכנס לחשבון ב-10 לחודש שאחריו.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">נכנס לחשבון ב-10 לחודש הבא, יחד עם שאר תשלומי האשראי של החודש.</p>
      )}
    </div>
  );
}

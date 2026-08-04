"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { toHebrewError } from "@/lib/error-messages";
import { isExpenseBusinessDomain } from "@/lib/expenses";
import type { PaymentCalendarItem } from "@/lib/payables";
import {
  InstallmentFields,
  buildInstallmentRows,
  validateInstallments,
  type InstallmentRow,
} from "@/components/expenses/InstallmentFields";

function fmtIls(value: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(value);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceItem: PaymentCalendarItem | null;
  onSaved: () => void;
};

export function SplitPaymentDialog({ open, onOpenChange, sourceItem, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<InstallmentRow[]>([]);

  const total = sourceItem?.amount ?? 0;
  const startDate = sourceItem?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open || !sourceItem) return;
    setRows(buildInstallmentRows(sourceItem.amount, sourceItem.date.slice(0, 10), 2));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceItem?.id]);

  async function submit() {
    setError("");
    if (!sourceItem?.expenseId) return;
    const validationError = validateInstallments(rows, total);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/expenses/split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_expense_id: sourceItem.expenseId,
          business_domain: isExpenseBusinessDomain(sourceItem.businessDomain) ? sourceItem.businessDomain : "general_business",
          category: sourceItem.category || "רכישה",
          description: sourceItem.descriptionRaw || sourceItem.label,
          notes: sourceItem.notes,
          installments: rows.map((r) => ({ expense_date: r.date, amount: Number(r.amount) })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "פיצול התשלום נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום פוצל לתשלומים");
      onSaved();
    } catch (err) {
      const msg = toHebrewError(err, "פיצול התשלום נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="פיצול לתשלומים"
      description={sourceItem ? `${sourceItem.label} — סכום מקורי ${fmtIls(total)}` : undefined}
      onSubmit={() => void submit()}
      submitLabel="פצל לתשלומים"
      busyLabel="שומר..."
      busy={saving}
      error={error || undefined}
    >
      <InstallmentFields total={total} startDate={startDate} rows={rows} onChange={setRows} />
    </FormDialog>
  );
}

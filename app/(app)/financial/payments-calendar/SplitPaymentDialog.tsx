"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
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
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>פיצול לתשלומים</DialogTitle>
          <DialogDescription>
            {sourceItem ? `${sourceItem.label} — סכום מקורי ${fmtIls(total)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <InstallmentFields total={total} startDate={startDate} rows={rows} onChange={setRows} />

          {error ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mt-6">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (<><Loader2 className="ml-2 h-4 w-4 animate-spin" />שומר...</>) : "פצל לתשלומים"}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}

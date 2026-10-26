"use client";

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { toHebrewError } from "@/lib/error-messages";
import { CANCELLED_MONTH_DEFAULT_REASON, recurrenceKeyLabel } from "@/lib/recurring/cancelMonth";

// "ביטול החודש" — one month of a recurring bill that didn't happen. The month
// stays on the list at ₪0 with the reason, and is never generated again; it
// can be put back from the payments calendar. See lib/recurring/cancelMonth.ts.

/** Only what the dialog reads — the payments calendar and the ledger each map their row to it. */
export type CancelMonthTarget = {
  /** The month's row; null for an upcoming month the board shows as a forecast. */
  expenseId: string | null;
  recurringTemplateId: string | null;
  recurrenceKey: string | null;
  /** The month's date (YYYY-MM-DD…) — names the month, and dates a forecast's new row. */
  date: string;
  label: string;
};

export default function CancelRecurringMonthDialog({
  target,
  onClose,
  onSaved,
  intro,
}: {
  target: CancelMonthTarget | null;
  onClose: () => void;
  // Given the row that now holds the cancelled month. Awaited: the dialog
  // stays busy until the page shows the change.
  onSaved: (saved: { expenseId: string | null }) => void | Promise<void>;
  /** Why this dialog opened instead of something else (the ledger's delete). */
  intro?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setReason("");
    setError("");
  }, [target?.expenseId, target?.recurrenceKey, target?.date]);

  const monthLabel = target ? recurrenceKeyLabel(target.recurrenceKey ?? target.date.slice(0, 7)) : "";

  async function submit() {
    if (!target) return;
    const isForecast = !target.expenseId;
    if (isForecast && !(target.recurringTemplateId && target.recurrenceKey)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/recurring-expenses/cancel-month", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isForecast
            ? {
                template_id: target.recurringTemplateId,
                recurrence_key: target.recurrenceKey,
                expense_date: target.date.slice(0, 10),
                reason: reason.trim() || null,
              }
            : { expense_id: target.expenseId, reason: reason.trim() || null }
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string | null };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "ביטול החודש נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`${monthLabel} בוטל`);
      await onSaved({ expenseId: json.id ?? target.expenseId ?? null });
    } catch (err) {
      const msg = toHebrewError(err, "ביטול החודש נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(target)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="ביטול החודש"
      description={target ? `${target.label} — ${monthLabel}` : undefined}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel="ביטול החודש"
      busyLabel="מבטל..."
      busy={saving}
      error={error || undefined}
    >
      <div className="mt-4 space-y-3">
        {intro ? <div className="text-sm text-muted-foreground">{intro}</div> : null}
        <p className="text-sm text-muted-foreground">
          החודש יישאר ברשימה ב-₪0 עם הסיבה, ולא ייווצר שוב. אפשר להחזיר אותו מלוח התשלומים.
        </p>
        <div className="space-y-1">
          <div className="text-sm font-medium">סיבה</div>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={CANCELLED_MONTH_DEFAULT_REASON}
          />
        </div>
      </div>
    </FormDialog>
  );
}

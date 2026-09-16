"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import { fmtIls } from "./calendar.helpers";

// ── "סמן כנגבה" — the incoming mirror of MarkPaidDialog ────────────────────────
// The outgoing side asks for a method, an account and a pay date, because
// marking a bill paid CREATES the money movement. Collecting is the opposite:
// the payment row already carries all of that (it was recorded when the check
// was taken in), and what changes is one thing — it cleared. So this confirms
// rather than collects a form, through the same /api/payments/mark-collected
// the גבייה page uses.
export default function MarkCollectedDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PaymentCalendarItem | null;
  onClose: () => void;
  // Awaited: the dialog stays busy until the board shows the row as collected.
  onSaved: (saved: { id: string | null }) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!item?.paymentId) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/payments/mark-collected", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.paymentId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "סימון התקבול נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התקבול סומן כנגבה");
      await onSaved({ id: item.id });
    } catch (err) {
      const msg = toHebrewError(err, "סימון התקבול נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={Boolean(item)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="סימון תקבול כנגבה"
      description={item ? `${item.label} — ${fmtIls(item.amount)}` : undefined}
      size="formSm"
      onSubmit={() => void submit()}
      submitLabel="סמן כנגבה"
      busyLabel="שומר..."
      busy={saving}
      error={error || undefined}
    >
      <div className="mt-4 space-y-2 text-sm">
        <p>הכסף התקבל בפועל?</p>
        {item?.sourceLabel ? <p className="text-muted-foreground">{item.sourceLabel}</p> : null}
        {item?.reference ? <p className="text-muted-foreground">אסמכתא {item.reference}</p> : null}
        <p className="text-xs text-muted-foreground">
          התנועה כבר רשומה עם אמצעי התשלום והחשבון שלה — הסימון רק מאשר שהיא נפרעה.
        </p>
      </div>
    </FormDialog>
  );
}

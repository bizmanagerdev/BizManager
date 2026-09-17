"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import { fmtIls } from "./calendar.helpers";

// ── "אישור הפקדה" — the credit-card clearing deposit actually landed ────────────
//
// A Grow deposit used to count as arrived automatically on its date. Now the
// user confirms it here, having seen what it is made of — the individual card
// payments, who each was from, and their total. Confirming is what puts it in
// the account's register and turns it from expected to arrived on this board.
//
// The same dialog serves an already-confirmed deposit: it shows the list and
// offers to undo the confirmation (wrong day, wrong account).
export default function ConfirmSettlementDialog({
  item,
  accountName,
  onClose,
  onSaved,
}: {
  item: PaymentCalendarItem | null;
  accountName?: string;
  onClose: () => void;
  onSaved: (saved: { id: string }) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const settlement = item?.settlement;
  const arrived = Boolean(settlement?.arrived);

  async function submit() {
    if (!item || !settlement) return;
    if (!settlement.accountId) {
      setError("להפקדה זו לא משויך חשבון, ולכן אין לאן לאשר אותה.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/payments/confirm-settlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: settlement.accountId,
          settlement_date: settlement.date,
          // An already-confirmed deposit opens this dialog to UNDO it.
          confirmed: !arrived,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = toHebrewError(json.error, arrived ? "ביטול האישור נכשל." : "אישור ההפקדה נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(arrived ? "אישור ההפקדה בוטל" : "ההפקדה אושרה");
      // Stay busy until the board shows it in its new state.
      await onSaved({ id: item.id });
    } catch (err) {
      const msg = toHebrewError(err, "אישור ההפקדה נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const payments = settlement?.payments ?? [];
  const total = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <FormDialog
      open={Boolean(item && settlement)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={arrived ? "פרטי ההפקדה" : "אישור הפקדה"}
      description={
        settlement
          ? `${settlement.date.slice(8, 10)}/${settlement.date.slice(5, 7)}/${settlement.date.slice(2, 4)}${
              accountName ? ` · ${accountName}` : ""
            }`
          : undefined
      }
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel={arrived ? "ביטול האישור" : "אישור — הכסף הגיע"}
      busyLabel="שומר..."
      busy={saving}
      error={error || undefined}
    >
      <div className="mt-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {payments.length} {payments.length === 1 ? "תקבול אשראי" : "תקבולי אשראי"}
          </span>
          <span className="text-lg font-bold tabular-nums">{fmtIls(total)}</span>
        </div>

        {payments.length > 0 ? (
          <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-lg border text-sm" aria-label="התקבולים בהפקדה">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                  {p.date.slice(8, 10)}/{p.date.slice(5, 7)}
                </span>
                <span className="min-w-0 flex-1 break-words">{p.label}</span>
                <span className="shrink-0 font-medium tabular-nums">{fmtIls(p.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {arrived
            ? "ההפקדה סומנה כהגיעה ומופיעה בחשבון. ביטול האישור יחזיר אותה לצפויה."
            : "הסכום הוא מה שהלקוחות שילמו. עמלת חברת הסליקה נרשמת בנפרד כהוצאה, לפי הקבלה שלה."}
        </p>
      </div>
    </FormDialog>
  );
}

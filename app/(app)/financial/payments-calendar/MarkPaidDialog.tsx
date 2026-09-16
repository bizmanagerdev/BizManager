"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { Account } from "@/lib/accounts";
import { toHebrewError } from "@/lib/error-messages";
import type { PaymentCalendarItem } from "@/lib/payables";
import { fmtIls } from "./calendar.helpers";

// ── Inline mark-paid dialog (account required) ──────────────────────────────────
export default function MarkPaidDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PaymentCalendarItem | null;
  onClose: () => void;
  // Given the expense row that now holds the payment (a forecast gets one on
  // the spot). Awaited: the dialog stays busy until the board has caught up.
  onSaved: (saved: { expenseId: string | null }) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payAmount, setPayAmount] = useState("");

  const open = Boolean(item);
  const isVariable = Boolean(item?.variableAmount);

  // On open, seed the amount with the bill's estimate (variable bills) so you can
  // just tweak it to the real charge instead of typing from scratch.
  useEffect(() => { setPayAmount(item?.variableAmount && item.amount > 0 ? String(item.amount) : ""); setError(""); }, [item?.id, item?.variableAmount, item?.amount]);

  async function submit() {
    if (!item) return;
    const isForecast = Boolean(item.recurringTemplateId) && !item.expenseId;
    if (!item.expenseId && !isForecast) return;
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    const amountNum = Number(payAmount);
    if (isVariable && !(Number.isFinite(amountNum) && amountNum > 0)) {
      setError("יש להזין את סכום התשלום.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // A forecast (upcoming recurring occurrence) has no expense row yet →
      // materialize it and mark paid in one step; otherwise flip the existing row.
      const res = isForecast
        ? await fetch("/api/recurring-expenses/materialize-paid", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              template_id: item.recurringTemplateId,
              recurrence_key: item.recurrenceKey,
              expense_date: item.date.slice(0, 10),
              amount: isVariable ? amountNum : null,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          })
        : await fetch("/api/expenses/mark-paid", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: item.expenseId,
              // A row from a variable-amount template holds only the estimate
              // until now — this is the real figure.
              amount: isVariable ? amountNum : null,
              payment_method: method || null,
              account_id: accountId || null,
              paid_date: paidDate,
            }),
          });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        expense?: { id?: string };
      };
      if (!res.ok) {
        const msg = toHebrewError(json.error, "סימון התשלום נכשל.");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("התשלום סומן כשולם");
      // A paid bill flows on its paid_date, so it usually MOVES — stay busy
      // until the board shows it on its new day.
      await onSaved({ expenseId: json.id ?? json.expense?.id ?? item.expenseId ?? null });
    } catch (err) {
      const msg = toHebrewError(err, "סימון התשלום נכשל.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="סימון תשלום כשולם"
      description={item ? `${item.label} — ${isVariable ? "סכום משתנה" : fmtIls(item.amount)}` : undefined}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel="סמן כשולם"
      busyLabel="שומר..."
      busy={saving}
      error={error || undefined}
    >
        <div className="mt-4 space-y-3">
          {isVariable ? (
            <div className="space-y-1">
              <div className="text-sm font-medium">כמה שולם? *</div>
              <CurrencyInput value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-sm font-medium">תאריך תשלום</div>
            <DateInput value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">אמצעי תשלום</div>
            <NativeSelect
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="">בחר אמצעי</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </NativeSelect>
          </div>
          <AccountSelect
            required
            value={accountId}
            onChange={setAccountId}
            onLoaded={setAccountsList}
          />
        </div>
    </FormDialog>
  );
}

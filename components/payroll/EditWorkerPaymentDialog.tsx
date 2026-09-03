"use client";

// Inline edit for a worker_payments row from the account register
// (app/(app)/financial/bank/BankClient.tsx) — logistics only (date, amount,
// method, account, reference, notes). NOT a step wizard like WorkerPaymentDialog
// (create) — this is a correction to an existing row, one screen is enough.
//
// The one real trap here (see accounts-layer memory): PATCH /api/payroll/worker-
// payments unconditionally REPLACES a payment's worker_payment_allocations with
// whatever `allocations` the request carries — omit the field and it silently
// wipes the payment's session/payslip debt-settlement links, making settled debt
// look unpaid again. This dialog fetches the existing allocations on open and
// resends them UNCHANGED on save; it never lets the user edit them (that stays
// SalaryCenterClient's job) — just shows a read-only summary so it's clear
// they're untouched.

import { useEffect, useState } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { registerReversibleAction } from "@/lib/undo-engine";
import { FormDialog } from "@/components/ui/form-dialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { NativeSelect } from "@/components/ui/native-select";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { SpinnerIcon } from "@/components/ui/icons";

type ExistingAllocation = {
  id: string;
  source_type: "session" | "payslip";
  attendance_session_id: string | null;
  payslip_id: string | null;
  amount: number | string | null;
};

export function EditWorkerPaymentDialog({
  paymentId,
  onOpenChange,
  onSaved,
}: {
  /** null closes the dialog. */
  paymentId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [workerName, setWorkerName] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<ExistingAllocation[]>([]);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pre-edit snapshot, captured once on load and never mutated by the form —
  // lets a save be undone by re-PATCHing these exact values back.
  const [original, setOriginal] = useState<{
    payment_date: string;
    amount: string;
    payment_method: string;
    account_id: string;
    reference_number: string;
    notes: string;
  } | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    setError(null);
    void fetch(`/api/payroll/worker-payments?payment_id=${encodeURIComponent(paymentId)}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          payment?: {
            id: string;
            user_id: string;
            payment_date: string | null;
            amount: number | string | null;
            payment_method: string | null;
            reference_number: string | null;
            notes: string | null;
            account_id: string | null;
          };
          allocations?: ExistingAllocation[];
          workerName?: string | null;
        };
        if (!active) return;
        if (!res.ok || !json.payment) {
          setLoadError(toHebrewError(json.error, "טעינת התשלום נכשלה."));
          return;
        }
        setUserId(json.payment.user_id);
        setWorkerName(json.workerName ?? null);
        setAllocations(json.allocations ?? []);
        const loadedDate = json.payment.payment_date ?? "";
        const loadedAmount = json.payment.amount != null ? String(json.payment.amount) : "";
        const loadedMethod = json.payment.payment_method ?? "";
        const loadedAccountId = json.payment.account_id ?? "";
        const loadedReference = json.payment.reference_number ?? "";
        const loadedNotes = json.payment.notes ?? "";
        setDate(loadedDate);
        setAmount(loadedAmount);
        setMethod(loadedMethod);
        setAccountId(loadedAccountId);
        setReference(loadedReference);
        setNotes(loadedNotes);
        setOriginal({
          payment_date: loadedDate,
          amount: loadedAmount,
          payment_method: loadedMethod,
          account_id: loadedAccountId,
          reference_number: loadedReference,
          notes: loadedNotes,
        });
      })
      .catch((err: unknown) => {
        if (active) setLoadError(toHebrewError(err, "טעינת התשלום נכשלה."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [paymentId]);

  const allocatedTotal = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

  async function save() {
    if (!paymentId) return;
    setError(null);
    const amountNumber = Number(amount);
    if (!date) {
      setError("יש לבחור תאריך.");
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("יש להזין סכום גדול מאפס.");
      return;
    }
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/payroll/worker-payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_id: paymentId,
          user_id: userId,
          payment_date: date,
          amount: amountNumber,
          payment_method: method.trim() || null,
          account_id: accountId || null,
          reference_number: reference.trim() || null,
          notes: notes.trim() || null,
          // Untouched round-trip — see the file header comment.
          allocations: allocations.map((a) => ({
            source_type: a.source_type,
            source_id: a.source_type === "session" ? a.attendance_session_id : a.payslip_id,
            amount: Number(a.amount) || 0,
          })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(toHebrewError(json.error, "עדכון התשלום נכשל."));
        return;
      }
      // The PATCH already committed (this dialog resends the untouched
      // allocations round-trip on every save, so it can't be safely deferred
      // — see the file header). Undo instead replays the same PATCH with the
      // pre-edit snapshot captured on load.
      const committedPaymentId = paymentId;
      const committedUserId = userId;
      const committedAllocations = allocations;
      const committedOriginal = original;
      registerReversibleAction({
        key: `worker-payment:edit:${committedPaymentId}`,
        message: "התשלום עודכן.",
        onUndo: async () => {
          if (!committedOriginal) return { ok: true };
          try {
            const undoRes = await fetch("/api/payroll/worker-payments", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payment_id: committedPaymentId,
                user_id: committedUserId,
                payment_date: committedOriginal.payment_date,
                amount: Number(committedOriginal.amount) || 0,
                payment_method: committedOriginal.payment_method || null,
                account_id: committedOriginal.account_id || null,
                reference_number: committedOriginal.reference_number || null,
                notes: committedOriginal.notes || null,
                allocations: committedAllocations.map((a) => ({
                  source_type: a.source_type,
                  source_id: a.source_type === "session" ? a.attendance_session_id : a.payslip_id,
                  amount: Number(a.amount) || 0,
                })),
              }),
            });
            const undoJson = (await undoRes.json().catch(() => ({}))) as { error?: string };
            if (!undoRes.ok) return { ok: false, error: toHebrewError(undoJson.error, "ביטול העדכון נכשל.") };
            onSaved();
            return { ok: true };
          } catch (undoErr: unknown) {
            return { ok: false, error: toHebrewError(undoErr, "ביטול העדכון נכשל.") };
          }
        },
      });
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      setError(toHebrewError(err, "עדכון התשלום נכשל."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={paymentId !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title="עריכת תשלום לעובד"
      description={workerName ? `עובד: ${workerName}` : undefined}
      onSubmit={() => void save()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={submitting}
      submitDisabled={loading || Boolean(loadError)}
      error={error || loadError || undefined}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          טוען...
        </div>
      ) : (
        <div className="space-y-3">
          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <label className="text-sm font-medium">סכום *</label>
              <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">תאריך *</label>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </AdaptiveGrid>

          <div className="space-y-1">
            <label className="text-sm font-medium">אמצעי תשלום</label>
            <NativeSelect
              value={method}
              onChange={(e) => {
                const m = e.target.value;
                setMethod(m);
                setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
              }}
            >
              <option value="">בחר אמצעי תשלום...</option>
              {PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <AccountSelect required value={accountId} onChange={setAccountId} onLoaded={setAccountsList} />

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <label className="text-sm font-medium">מספר אסמכתא</label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="אופציונלי" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <div className="relative min-w-0">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={1}
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </div>
          </AdaptiveGrid>

          {allocations.length > 0 && (
            <p className="text-xs text-muted-foreground">
              מוקצה לחובות פתוחים: {allocations.length} פריטים · ₪{Math.round(allocatedTotal).toLocaleString("he-IL")}{" "}
              (לא ניתן לעריכה כאן — נשאר כפי שהיה).
            </p>
          )}
        </div>
      )}
    </FormDialog>
  );
}

export default EditWorkerPaymentDialog;

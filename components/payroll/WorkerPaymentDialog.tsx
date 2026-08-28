"use client";

// "תשלום לעובד" — records a direct payment to a worker and auto-allocates it
// against their OPEN debt (payslips for hourly / monthly workers, sessions for
// contract workers), oldest first; anything left over stays an advance.
//
// Lifted out of the dashboard's quick-action grid when that grid was removed —
// the action now lives behind the + menu like every other create flow. The form
// shell and the state that drives it were two files before (a presentational
// dialog plus ~100 lines of state in the grid component); they're one here since
// the grid was the only thing keeping them apart. The validation and allocation
// MATH still lives in DashboardActions.forms, where it's unit-tested.
//
// Rebuilt 2026-08-25 onto the same atomic step-wizard architecture as
// IncomeDialog/CollectPaymentDialog (one question per screen, tap-a-card-to-
// advance) instead of a single-page FormDialog — part of converging every
// quick-action dialog onto one shared shape.

import { useEffect, useMemo, useState } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, DateQuickPicks, StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { loadAccounts } from "@/components/financial/AccountSelect";
import { BankIcon, CardIcon, CashIcon } from "@/components/ui/icons";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";
import type { UserRole } from "@/lib/auth/requireProfile";
import type { UserOption } from "@/app/(app)/dashboard/quick-actions-types";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";
import { getTodayDate, normalizeDateOnly } from "@/app/(app)/dashboard/DashboardActions.helpers";
import {
  buildWorkerPaymentAllocations,
  sortOpenWorkerDebt,
  sumOpenOwed,
  validateWorkerPaymentForm,
} from "@/app/(app)/dashboard/DashboardActions.forms";

type WorkerPaymentStepId = "worker" | "amount" | "date" | "method" | "account" | "reference" | "notes" | "summary";

const STEP_LABEL: Record<WorkerPaymentStepId, string> = {
  worker: "עובד",
  amount: "סכום",
  date: "תאריך",
  method: "תשלום",
  account: "חשבון",
  reference: "אסמכתא",
  notes: "הערות",
  summary: "סיכום",
};

function accountKindIcon(kind: string | null | undefined) {
  if (kind === "bank") return BankIcon;
  if (kind === "card") return CardIcon;
  return CashIcon;
}

export function WorkerPaymentDialog({
  open,
  onOpenChange,
  users,
  currentUserRole,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: UserOption[];
  currentUserRole?: UserRole;
  onSaved: () => void;
}) {
  const [stepId, setStepId] = useState<WorkerPaymentStepId>("worker");
  const [userId, setUserId] = useState("");
  const [workerQuery, setWorkerQuery] = useState("");
  const [date, setDate] = useState(getTodayDate());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [debtItems, setDebtItems] = useState<WorkerDebtItemRow[]>([]);
  const [debtLoading, setDebtLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin can pay anyone payroll-tracked; office may only pay workers below them
  // (matches the protected endpoint's own scoping).
  const payableWorkers = useMemo(() => {
    const adminPayable = currentUserRole === "admin";
    return users.filter((user) => {
      if (user.role === "worker" || user.role === "worker_no_access") return true;
      return adminPayable && (user.role === "admin" || user.role === "office");
    });
  }, [users, currentUserRole]);

  const filteredWorkers = useMemo(() => {
    const q = workerQuery.trim().toLowerCase();
    if (!q) return payableWorkers;
    return payableWorkers.filter((u) => u.label.toLowerCase().includes(q));
  }, [payableWorkers, workerQuery]);

  const openOwed = useMemo(() => sumOpenOwed(debtItems), [debtItems]);

  // Preload accounts on open so the "account" step can render one tappable
  // card per account (same technique as Income/CollectPayment/AccountTransfer).
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadAccounts().then((list) => {
      if (active) setAccountsList(list);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const stepIds = useMemo<WorkerPaymentStepId[]>(() => {
    const ids: WorkerPaymentStepId[] = ["worker", "amount", "date", "method"];
    if (accountsList.length > 0) ids.push("account");
    ids.push("reference", "notes", "summary");
    return ids;
  }, [accountsList.length]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  function reset() {
    setStepId("worker");
    setError(null);
    setUserId("");
    setWorkerQuery("");
    setDate(getTodayDate());
    setAmount("");
    setMethod("");
    setAccountId("");
    setReference("");
    setNotes("");
    setDebtItems([]);
    setDebtLoading(false);
  }

  // Load the chosen worker's OPEN debt items (so the payment can be allocated and
  // the open balance shown). Scoped server-side to this one worker.
  async function loadDebt(nextUserId: string) {
    if (!nextUserId) {
      setDebtItems([]);
      return;
    }
    setDebtLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payroll/center/protected?userId=${encodeURIComponent(nextUserId)}&fresh=1`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        workerDebtItems?: WorkerDebtItemRow[];
      };
      if (!res.ok) {
        setError(toHebrewError(json.error, "טעינת יתרת העובד נכשלה."));
        setDebtItems([]);
        return;
      }
      const openItems = sortOpenWorkerDebt(json.workerDebtItems ?? [], nextUserId);
      setDebtItems(openItems);
      const owed = sumOpenOwed(openItems);
      // Default to the full open balance — the common "pay them what they're owed" case.
      if (owed > 0) setAmount(String(Math.round(owed * 100) / 100));
    } catch (err: unknown) {
      setError(toHebrewError(err, "טעינת יתרת העובד נכשלה."));
      setDebtItems([]);
    } finally {
      setDebtLoading(false);
    }
  }

  function selectWorker(nextUserId: string) {
    setUserId(nextUserId);
    setAmount("");
    void loadDebt(nextUserId);
    advanceTo("amount");
  }

  function isSatisfied(id: WorkerPaymentStepId): boolean {
    switch (id) {
      case "worker":
        return Boolean(userId);
      case "amount":
        return Number.isFinite(Number(amount)) && Number(amount) > 0;
      case "date":
        return Boolean(date);
      case "account":
        return Boolean(accountId);
      case "method":
        return Boolean(method);
      case "reference":
      case "notes":
      case "summary":
        return true;
    }
  }

  const { stepIndex, isLastStep, canClickStep, goToStep, goBack, goNext, advanceTo } = useStepFlow<WorkerPaymentStepId>({
    stepId,
    setStepId,
    steps: stepIds,
    isSatisfied,
  });

  function pickMethod(next: string) {
    setMethod(next);
    setAccountId((prev) => prev || defaultAccountForMethod(accountsList, next));
    advanceTo(accountsList.length > 0 ? "account" : "reference");
  }

  function handleOpenChange(next: boolean) {
    // Mid-submit the request is already creating rows — closing would orphan it.
    if (!next && submitting) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function save() {
    setError(null);
    const validationError = validateWorkerPaymentForm({
      workerPaymentUserId: userId,
      workerPaymentDate: date,
      workerPaymentAmount: amount,
      accountsCount: accountsList.length,
      workerPaymentAccountId: accountId,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    const total = Number(amount);

    setSubmitting(true);
    try {
      const res = await fetch("/api/payroll/worker-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          payment_date: date,
          amount: total,
          payment_method: method.trim() || null,
          account_id: accountId || null,
          reference_number: reference.trim() || null,
          notes: notes.trim() || null,
          // Auto-allocate across open debts oldest-first; any remainder is an advance.
          allocations: buildWorkerPaymentAllocations(total, debtItems),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(toHebrewError(json.error, "שמירת התשלום לעובד נכשלה."));
        return;
      }
      handleOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      setError(toHebrewError(err, HEBREW.saveErrorUnknown));
    } finally {
      setSubmitting(false);
    }
  }

  const workerName = payableWorkers.find((u) => u.id === userId)?.label;
  const methodLabel = PAYMENT_METHOD_OPTIONS.find((m) => m.value === method)?.label;
  const accountName = accountsList.find((a) => a.id === accountId)?.name;

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle="תשלום לעובד"
      dialogDescription="רישום תשלום לעובד"
      size="formLg"
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={submitting}
      onBack={stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={submitting}
      onNext={() => (isLastStep ? void save() : goNext())}
      nextLabel={isLastStep ? (submitting ? HEBREW.saving : "שמירת תשלום") : undefined}
      nextDisabled={isLastStep ? submitting : debtLoading || !isSatisfied(stepId)}
      isLastStep={isLastStep}
      submitOnEnter
      error={error || undefined}
    >
      {stepId === "worker" ? (
        <>
          <StepHeading title="לאיזה עובד לשלם?" />
          <div className="grid gap-3">
            <Input value={workerQuery} onChange={(e) => setWorkerQuery(e.target.value)} placeholder="חיפוש עובד..." />
            <div className="space-y-1">
              {filteredWorkers.map((user) => (
                <OptionRow
                  key={user.id}
                  label={user.label}
                  selected={userId === user.id}
                  onClick={() => selectWorker(user.id)}
                />
              ))}
            </div>
          </div>
        </>
      ) : stepId === "amount" ? (
        <>
          <StepHeading title="על איזה סכום?" />
          <label className="space-y-2 text-sm">
            <CurrencyInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            {debtLoading ? (
              <span className="block text-[11px] text-muted-foreground">טוען יתרה...</span>
            ) : openOwed > 0 ? (
              <span className="block text-[11px] text-muted-foreground">
                יתרה פתוחה: {formatCurrency(openOwed)} • {debtItems.length} פריטים פתוחים
              </span>
            ) : (
              <span className="block text-[11px] text-muted-foreground">
                אין יתרה פתוחה לעובד זה. תשלום שיירשם יישמר כמקדמה ללא קיזוז.
              </span>
            )}
          </label>
        </>
      ) : stepId === "date" ? (
        <>
          <StepHeading title="מתי שולם?" />
          <div>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            <DateQuickPicks
              onPick={(d) => {
                setDate(d);
                advanceTo(stepIds[stepIndex("date") + 1]);
              }}
            />
          </div>
        </>
      ) : stepId === "method" ? (
        <>
          <StepHeading title="באיזה אמצעי?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                label={option.label}
                selected={method === option.value}
                onClick={() => pickMethod(option.value)}
              />
            ))}
          </div>
        </>
      ) : stepId === "account" ? (
        <>
          <StepHeading title="מאיזה חשבון?" />
          <div className="grid gap-2">
            {accountsList.map((a) => (
              <OptionRow
                key={a.id}
                icon={accountKindIcon(a.kind)}
                label={a.name}
                sub={getAccountKindLabel(a.kind)}
                selected={accountId === a.id}
                onClick={() => {
                  setAccountId(a.id);
                  advanceTo("reference");
                }}
              />
            ))}
          </div>
        </>
      ) : stepId === "reference" ? (
        <>
          <StepHeading title="מספר אסמכתא?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
            <Input autoFocus value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </>
      ) : stepId === "notes" ? (
        <>
          <StepHeading title={HEBREW.notes} sub="לא חובה" />
          <label className="space-y-2 text-sm">
            <div className="relative">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="pe-11"
              />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </label>
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולשמור?" />
          <SummarySection title="פרטי התשלום">
            <SummaryRow label="עובד" value={workerName ?? "—"} />
            <SummaryRow label="סכום" value={formatCurrency(Number(amount) || 0)} />
            <SummaryRow label="תאריך" value={normalizeDateOnly(date)} />
            <SummaryRow label={HEBREW.paymentMethod} value={methodLabel ?? "ללא ציון"} />
            {accountId ? <SummaryRow label="חשבון" value={accountName} /> : null}
            {reference.trim() ? <SummaryRow label="אסמכתא" value={reference} /> : null}
            {notes.trim() ? <SummaryRow label={HEBREW.notes} value={notes} /> : null}
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}

export default WorkerPaymentDialog;

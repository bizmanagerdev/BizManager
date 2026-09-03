"use client";

// "קליטת תשלום" — money came IN against a debt somebody already owes us.
//
// Deliberately NOT the same as הכנסה חדשה: that one records a fresh money-in row
// and you tell it which project/order it belongs to. This one starts from the
// debt — pick the customer who owes, pick WHICH open order/project the money is
// for, and the payment closes (or reduces) that specific receivable. The customer
// picker only lists customers with something outstanding, because those are the
// only ones a collection call is ever about.
//
// One-question-per-stage (2026-08-25, user request: match IncomeDialog/
// ExpenseDialog's step-by-step flow, no dropdowns) — customer and payment
// method are now tappable cards instead of <select>s, and every field that
// used to share one grouped screen gets its own step.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SpinnerIcon, BankIcon, CardIcon, CashIcon } from "@/components/ui/icons";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, DateQuickPicks, StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { loadAccounts } from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS, nextMonthTenth } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";
import type { CustomerReceivable } from "@/lib/collections";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { appendDictatedText } from "@/lib/dictation";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { getTodayDate } from "@/app/(app)/dashboard/DashboardActions.helpers";

type Debtor = {
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  outstanding_amount: number;
  overdue_amount: number;
};

type CollectStepId =
  | "customer"
  | "receivable"
  | "amount"
  | "method"
  | "account"
  | "date"
  | "settlement"
  | "check"
  | "reference"
  | "notes"
  | "summary";

const STEP_LABEL: Record<CollectStepId, string> = {
  customer: "לקוח",
  receivable: "חוב",
  amount: "סכום",
  method: "תשלום",
  account: "חשבון",
  date: "תאריך",
  settlement: "סליקה",
  check: "צ'ק",
  reference: "אסמכתא",
  notes: "הערות",
  summary: "סיכום",
};

function accountKindIcon(kind: string | null | undefined) {
  if (kind === "bank") return BankIcon;
  if (kind === "card") return CardIcon;
  return CashIcon;
}

function receivableTitle(receivable: CustomerReceivable) {
  if (receivable.title && receivable.title.trim()) return receivable.title;
  if (receivable.source_type === "project") return "פרויקט";
  if (receivable.source_type === "loan") return "הלוואה";
  return "הזמנה";
}

export function CollectPaymentDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [debtors, setDebtors] = useState<Debtor[] | null>(null);
  const [debtorsError, setDebtorsError] = useState<string | null>(null);
  const [debtorQuery, setDebtorQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [receivables, setReceivables] = useState<CustomerReceivable[] | null>(null);
  const [receivablesLoading, setReceivablesLoading] = useState(false);
  const [sourceKey, setSourceKey] = useState("");

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayDate());
  const [method, setMethod] = useState("");
  // Set only for a credit_card payment collected through a clearing company
  // (e.g. Grow) — the customer paid, but the account only sees the money on
  // this later date, batched with every other card payment settling the same
  // day. See lib/accounts.ts's growthBatches / lib/payments.ts nextMonthTenth.
  const [dueDate, setDueDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [reference, setReference] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who owes money — loaded once per open (amounts move, so don't cache it).
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDebtors(null);
    setDebtorsError(null);
    void fetch("/api/collections/debtors", { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as { debtors?: Debtor[]; error?: string };
        if (!active) return;
        if (!response.ok) {
          setDebtorsError(toHebrewError(json.error, "טעינת החייבים נכשלה."));
          setDebtors([]);
          return;
        }
        setDebtors(json.debtors ?? []);
      })
      .catch(() => {
        if (active) {
          setDebtorsError("טעינת החייבים נכשלה.");
          setDebtors([]);
        }
      });
    return () => {
      active = false;
    };
  }, [open]);

  // Preload accounts on open so the "account" step can render one tappable
  // card per account (same reasoning as ExpenseDialog/IncomeDialog).
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

  const selectedReceivable = useMemo(
    () => (receivables ?? []).find((r) => r.collection_key === sourceKey) ?? null,
    [receivables, sourceKey]
  );

  const filteredDebtors = useMemo(() => {
    const q = debtorQuery.trim().toLowerCase();
    if (!q) return debtors ?? [];
    return (debtors ?? []).filter(
      (d) => d.customer_name.toLowerCase().includes(q) || (d.customer_phone ?? "").includes(q)
    );
  }, [debtorQuery, debtors]);

  async function loadReceivables(nextCustomerId: string) {
    setCustomerId(nextCustomerId);
    setSourceKey("");
    setAmount("");
    setReceivables(null);
    setError(null);
    if (!nextCustomerId) return;
    setReceivablesLoading(true);
    try {
      const response = await fetch(
        `/api/collections/receivables?customer_id=${encodeURIComponent(nextCustomerId)}`,
        { cache: "no-store" }
      );
      const json = (await response.json().catch(() => ({}))) as {
        receivables?: CustomerReceivable[];
        error?: string;
      };
      if (!response.ok) {
        setError(toHebrewError(json.error, "טעינת החובות נכשלה."));
        setReceivables([]);
        return;
      }
      const openReceivables = (json.receivables ?? []).filter((r) => r.outstanding_amount > 0);
      setReceivables(openReceivables);
      // Only one open debt? Then there's nothing to choose — pick it and move on.
      const only = openReceivables.filter((r) => r.source_type !== "loan");
      if (only.length === 1) selectReceivable(only[0]);
    } catch {
      setError("טעינת החובות נכשלה.");
      setReceivables([]);
    } finally {
      setReceivablesLoading(false);
    }
  }

  function selectReceivable(receivable: CustomerReceivable) {
    setSourceKey(receivable.collection_key);
    // Default to paying the whole thing off — the common case on a collection call.
    setAmount(String(Math.round(receivable.outstanding_amount * 100) / 100));
    setStepId("amount");
  }

  // A pending payment (an uncleared check, a future-dated transfer) isn't a new
  // payment — the row already exists, the money just landed. Flip it to cleared.
  function markPendingCollected(paymentId: string) {
    const snapshot = receivables;
    scheduleDeferredAction({
      key: `payment-collected:${paymentId}`,
      message: "התשלום סומן כנגבה.",
      onApplyOptimistic: () => {
        setReceivables((prev) =>
          (prev ?? []).map((r) => ({ ...r, pending_payments: r.pending_payments.filter((p) => p.id !== paymentId) }))
        );
      },
      onRevert: () => setReceivables(snapshot),
      onCommit: async () => {
        const response = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: paymentId, collected: true }),
        });
        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: toHebrewError(json.error, "סימון התשלום כנגבה נכשל.") };
        }
        onSaved?.();
        await loadReceivables(customerId);
        return { ok: true };
      },
    });
  }

  // ── Dynamic step list ────────────────────────────────────────────────────
  const stepIds = useMemo<CollectStepId[]>(() => {
    const ids: CollectStepId[] = ["customer"];
    if (customerId) ids.push("receivable");
    ids.push("amount", "method");
    if (accountsList.length > 0) ids.push("account");
    ids.push("date");
    if (method === "credit_card") ids.push("settlement");
    if (method === "check") ids.push("check");
    ids.push("reference", "notes", "summary");
    return ids;
  }, [customerId, accountsList.length, method]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  const amountValid = Number.isFinite(Number(amount)) && Number(amount) > 0;
  const debtorName = debtors?.find((d) => d.customer_id === customerId)?.customer_name;
  const summaryMethodLabel = PAYMENT_METHOD_OPTIONS.find((m) => m.value === method)?.label;
  const summaryAccountName = accountsList.find((a) => a.id === accountId)?.name;

  function isSatisfied(id: CollectStepId): boolean {
    switch (id) {
      case "customer":
        return Boolean(customerId);
      case "receivable":
        return Boolean(selectedReceivable);
      case "amount":
        return amountValid;
      case "method":
        return Boolean(method);
      case "account":
        return Boolean(accountId);
      case "date":
        return Boolean(date);
      case "check":
        return Boolean(dueDate);
      case "settlement":
      case "reference":
      case "notes":
      case "summary":
        return true;
    }
  }

  const [stepId, setStepId] = useState<CollectStepId>("customer");
  const { stepIndex, isLastStep, canClickStep, goToStep, goBack, goNext, advanceTo } = useStepFlow<CollectStepId>({
    stepId,
    setStepId,
    steps: stepIds,
    isSatisfied,
  });

  const reset = useCallback(() => {
    setStepId("customer");
    setDebtorQuery("");
    setCustomerId("");
    setReceivables(null);
    setSourceKey("");
    setAmount("");
    setDate(getTodayDate());
    setMethod("");
    setDueDate("");
    setAccountId("");
    setReference("");
    setCheckNumber("");
    setCheckPhotoFiles([]);
    setNotes("");
    setError(null);
  }, [setStepId]);

  function pickMethod(next: string) {
    setMethod(next);
    setAccountId((prev) => prev || defaultAccountForMethod(accountsList, next));
    // A settlement/deposit date only ever applies to credit_card or check — drop
    // any leftover choice from before so it can't leak into an unrelated method's payload.
    if (next !== "credit_card" && next !== "check") setDueDate("");
    advanceTo(accountsList.length > 0 ? "account" : "date");
  }

  // A check's deposit date defaults to the payment date (same as the server's
  // own fallback in buildPaymentInsert) but stays editable for a postdated check.
  useEffect(() => {
    if (stepId === "check" && !dueDate && date) setDueDate(date);
  }, [stepId, date, dueDate]);

  async function save() {
    setError(null);
    if (!selectedReceivable) {
      setError("יש לבחור את החוב שאליו נכנס התשלום.");
      return;
    }
    const amountValue = Number(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setError("יש להזין סכום תקין.");
      return;
    }
    if (!date) {
      setError("יש למלא תאריך תשלום.");
      return;
    }
    if (!method) {
      setError("יש לבחור אמצעי תשלום.");
      return;
    }
    if (method === "check" && !dueDate) {
      setError("יש למלא תאריך פירעון לצ'ק.");
      return;
    }
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/payments/create",
        {
          business_domain: selectedReceivable.business_domain,
          project_id: selectedReceivable.source_type === "project" ? selectedReceivable.source_id : null,
          order_id: selectedReceivable.source_type === "order" ? selectedReceivable.source_id : null,
          property_id: null,
          amount_total: amountValue,
          payment_date: date,
          due_date: method === "credit_card" || method === "check" ? dueDate || null : null,
          requires_split: false,
          payment_method: method,
          account_id: accountId || null,
          reference_number: reference.trim() || null,
          check_number: method === "check" && checkNumber.trim() ? checkNumber.trim() : null,
          notes: notes.trim() || null,
          tag_ids: [],
        },
        "קליטת תשלום",
        { idempotent: true }
      );
      if (result.queued) {
        onOpenChange(false);
        reset();
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "רישום התשלום נכשל."));
        return;
      }
      onOpenChange(false);
      reset();
      onSaved?.();
      toast.success("התשלום נקלט.");
    } catch (err: unknown) {
      setError(toHebrewError(err, "רישום התשלום נכשל."));
    } finally {
      setSubmitting(false);
    }
  }

  const payableReceivables = (receivables ?? []).filter((r) => r.source_type !== "loan");
  const loanReceivables = (receivables ?? []).filter((r) => r.source_type === "loan");

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      dialogTitle="קליטת תשלום"
      dialogDescription="רישום כסף שהתקבל מלקוח וזיכוי החוב הפתוח שלו."
      size="form2xl"
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
      nextLabel={isLastStep ? (submitting ? "שומר..." : "שמירת תשלום") : undefined}
      nextDisabled={isLastStep ? submitting : !isSatisfied(stepId)}
      isLastStep={isLastStep}
      submitOnEnter
      error={error || undefined}
    >
      {stepId === "customer" ? (
        <>
          <StepHeading title="מי הלקוח שמשלם?" />
          <div className="grid gap-3">
          {debtors === null ? (
            <div className="flex h-11 items-center gap-2 rounded-xl border border-input px-4 text-muted-foreground">
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              <span>טוען חייבים...</span>
            </div>
          ) : debtors.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground">
              {debtorsError ?? "אין כרגע לקוחות עם חוב פתוח."}
            </div>
          ) : (
            <>
              <Input
                value={debtorQuery}
                onChange={(e) => setDebtorQuery(e.target.value)}
                placeholder="חיפוש לפי שם או טלפון..."
              />
              <div className="space-y-1.5">
                {filteredDebtors.map((debtor) => (
                  <OptionRow
                    key={debtor.customer_id}
                    label={debtor.customer_name}
                    sub={`${debtor.customer_phone ? `${debtor.customer_phone} · ` : ""}${formatCurrency(debtor.outstanding_amount)}`}
                    selected={customerId === debtor.customer_id}
                    onClick={() => {
                      void loadReceivables(debtor.customer_id);
                      advanceTo("receivable");
                    }}
                  />
                ))}
                {filteredDebtors.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">לא נמצאו לקוחות לחיפוש הזה.</div>
                ) : null}
              </div>
            </>
          )}
          </div>
        </>
      ) : stepId === "receivable" ? (
        <>
          <StepHeading title="על מה התשלום?" />
          <div className="space-y-2">
          {receivablesLoading ? (
            <div className="flex items-center gap-2 rounded-xl border p-3 text-muted-foreground">
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              <span>טוען חובות...</span>
            </div>
          ) : payableReceivables.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground">
              אין ללקוח הזה חוב פתוח על הזמנה או פרויקט.
            </div>
          ) : (
            <div className="space-y-1.5">
              {payableReceivables.map((receivable) => {
                const selected = receivable.collection_key === sourceKey;
                return (
                  <div key={receivable.collection_key} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => selectReceivable(receivable)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-right transition-all ${
                        selected
                          ? "border-primary/30 bg-primary/10"
                          : "border-border bg-accent/30 hover:bg-accent"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{receivableTitle(receivable)}</span>
                        <span className="font-semibold">{formatCurrency(receivable.outstanding_amount)}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>{receivable.source_type === "project" ? "פרויקט" : "הזמנה"}</span>
                        {receivable.due_date || receivable.next_due_date ? (
                          <span>לתשלום עד {receivable.due_date ?? receivable.next_due_date}</span>
                        ) : null}
                        {receivable.days_late > 0 ? (
                          <span className="text-destructive">{receivable.days_late} ימי פיגור</span>
                        ) : null}
                      </div>
                    </button>

                    {/* Pending rows (uncleared check / future transfer) — the
                        money already has a row, so clear it instead of creating
                        a duplicate payment. */}
                    {selected && receivable.pending_payments.length > 0
                      ? receivable.pending_payments.map((pending) => (
                          <div
                            key={pending.id}
                            className="me-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-background px-3 py-2 text-xs"
                          >
                            <span>
                              ממתין: {formatCurrency(pending.amount)}
                              {pending.check_number ? ` · צ'ק ${pending.check_number}` : ""}
                              {pending.due_date ? ` · לפירעון ${pending.due_date}` : ""}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="h-7 text-xs"
                              onClick={() => markPendingCollected(pending.id)}
                            >
                              סמן כנגבה
                            </Button>
                          </div>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          )}
          {loanReceivables.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              ללקוח יש גם הלוואה פתוחה — החזרי הלוואה נרשמים בעמוד ההלוואות (ריבית וקרן בנפרד).
            </p>
          ) : null}
          </div>
        </>
      ) : stepId === "amount" ? (
        <>
          <StepHeading title="כמה התקבל?" />
          <label className="space-y-2 text-sm">
          <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          {selectedReceivable ? (
            <span className="block text-[11px] text-muted-foreground">
              החוב הפתוח: {formatCurrency(selectedReceivable.outstanding_amount)}
            </span>
          ) : null}
          </label>
        </>
      ) : stepId === "method" ? (
        <>
          <StepHeading title="איך שולם?" />
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
          <StepHeading title="לאיזה חשבון?" />
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
                advanceTo("date");
              }}
            />
          ))}
          </div>
        </>
      ) : stepId === "date" ? (
        <>
          <StepHeading title="מתי התקבל התשלום?" />
          <div>
          <label className="space-y-2 text-sm">
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <DateQuickPicks
            onPick={(d) => {
              setDate(d);
              advanceTo(stepIds[stepIndex("date") + 1]);
            }}
          />
          </div>
        </>
      ) : stepId === "settlement" ? (
        <>
          <StepHeading
            title="התשלום מגיע דרך סליקה (כמו גרואו)?"
            sub="אם כן, הכסף ייכנס לחשבון בסכום מרוכז יחד עם עוד תשלומים — לא ביום התשלום עצמו"
          />
          <div className="grid gap-2">
            <OptionRow
              label="כן — סליקה (גרואו)"
              sub={date ? `יופיע בחשבון ב-${nextMonthTenth(date)}` : undefined}
              selected={Boolean(dueDate)}
              onClick={() => {
                setDueDate(nextMonthTenth(date));
                advanceTo(stepIds[stepIndex("settlement") + 1]);
              }}
            />
            <OptionRow
              label="לא — הגיע ישירות לחשבון"
              selected={!dueDate}
              onClick={() => {
                setDueDate("");
                advanceTo(stepIds[stepIndex("settlement") + 1]);
              }}
            />
          </div>
        </>
      ) : stepId === "check" ? (
        <>
          <StepHeading title="פרטי הצ'ק" />
          <div className="space-y-4">
            <label className="space-y-2 text-sm">
              <span className="text-sm font-medium">תאריך פירעון</span>
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <CheckDetailsFields
              checkNumber={checkNumber}
              onCheckNumberChange={setCheckNumber}
              photoFiles={checkPhotoFiles}
              onPhotoFilesChange={setCheckPhotoFiles}
              disabled={submitting}
            />
          </div>
        </>
      ) : stepId === "reference" ? (
        <>
          <StepHeading title="מספר אסמכתא?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
          </label>
        </>
      ) : stepId === "notes" ? (
        <>
          <StepHeading title="הערות פנימיות?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
          <div className="relative">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              autoFocus
              className="pe-11"
            />
            <DictateButton
              onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
              disabled={submitting}
              className="absolute bottom-1 end-1 h-8 w-8"
            />
          </div>
          </label>
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולשמור?" />
          <SummarySection title="פרטי התשלום">
            <SummaryRow label="לקוח" value={debtorName} />
            {selectedReceivable ? <SummaryRow label="חוב" value={receivableTitle(selectedReceivable)} /> : null}
            <SummaryRow label="סכום" value={formatCurrency(Number(amount) || 0)} />
            <SummaryRow label="אמצעי תשלום" value={summaryMethodLabel} />
            <SummaryRow label="חשבון" value={summaryAccountName} />
            <SummaryRow label="תאריך" value={date} />
            {method === "credit_card" && dueDate ? (
              <SummaryRow label="סליקה" value={`יופיע בחשבון ב-${dueDate}`} />
            ) : null}
            {method === "check" && dueDate ? <SummaryRow label="תאריך פירעון" value={dueDate} /> : null}
            {method === "check" && checkNumber.trim() ? <SummaryRow label="מספר צ'ק" value={checkNumber} /> : null}
            {reference.trim() ? <SummaryRow label="אסמכתא" value={reference} /> : null}
            {notes.trim() ? <SummaryRow label="הערות" value={notes} /> : null}
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}

export default CollectPaymentDialog;

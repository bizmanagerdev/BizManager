"use client";

// "קליטת תשלום" — money came IN against a debt somebody already owes us.
//
// Deliberately NOT the same as הכנסה חדשה: that one records a fresh money-in row
// and you tell it which project/order it belongs to. This one starts from the
// debt — pick the customer who owes, pick WHICH open order/project the money is
// for, and the payment closes (or reduces) that specific receivable. The customer
// picker only lists customers with something outstanding, because those are the
// only ones a collection call is ever about.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";
import type { CustomerReceivable } from "@/lib/collections";
import { offlineFetch } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { getTodayDate } from "@/app/(app)/dashboard/DashboardActions.helpers";

type Debtor = {
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  outstanding_amount: number;
  overdue_amount: number;
};

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

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
  const [customerId, setCustomerId] = useState("");
  const [receivables, setReceivables] = useState<CustomerReceivable[] | null>(null);
  const [receivablesLoading, setReceivablesLoading] = useState(false);
  const [sourceKey, setSourceKey] = useState("");

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayDate());
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [reference, setReference] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setCustomerId("");
    setReceivables(null);
    setSourceKey("");
    setAmount("");
    setDate(getTodayDate());
    setMethod("");
    setAccountId("");
    setReference("");
    setCheckNumber("");
    setCheckPhotoFiles([]);
    setNotes("");
    setError(null);
  }, []);

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

  const selectedReceivable = useMemo(
    () => (receivables ?? []).find((r) => r.collection_key === sourceKey) ?? null,
    [receivables, sourceKey]
  );

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
      const open = (json.receivables ?? []).filter((r) => r.outstanding_amount > 0);
      setReceivables(open);
      // Only one open debt? Then there's nothing to choose — pick it.
      const only = open.filter((r) => r.source_type !== "loan");
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
  }

  // A pending payment (an uncleared check, a future-dated transfer) isn't a new
  // payment — the row already exists, the money just landed. Flip it to cleared.
  async function markPendingCollected(paymentId: string) {
    if (clearingId) return;
    setClearingId(paymentId);
    try {
      const response = await fetch("/api/payments/mark-collected", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paymentId, collected: true }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        setError(toHebrewError(json.error, "סימון התשלום כנגבה נכשל."));
        return;
      }
      toast.success("התשלום סומן כנגבה.");
      onSaved?.();
      await loadReceivables(customerId);
    } catch (err: unknown) {
      setError(toHebrewError(err, "סימון התשלום כנגבה נכשל."));
    } finally {
      setClearingId(null);
    }
  }

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
          due_date: null,
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

  const debtorOptions = useMemo(
    () =>
      (debtors ?? []).map((debtor) => ({
        value: debtor.customer_id,
        // Phone next to the name in every customer list, and the open balance so
        // you can find the right person by what they owe.
        label: `${debtor.customer_name}${debtor.customer_phone ? ` · ${debtor.customer_phone}` : ""} — ${formatCurrency(debtor.outstanding_amount)}`,
      })),
    [debtors]
  );

  const payableReceivables = (receivables ?? []).filter((r) => r.source_type !== "loan");
  const loanReceivables = (receivables ?? []).filter((r) => r.source_type === "loan");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <AdaptiveDialog size="form2xl">
        <DialogHeader className="text-right">
          <DialogTitle>קליטת תשלום</DialogTitle>
          <DialogDescription>
            רישום כסף שהתקבל מלקוח וזיכוי החוב הפתוח שלו — בלי לצאת מהמסך הנוכחי.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={submitting} className="contents">
          <div className="space-y-4">
            <div className="space-y-2 text-right text-sm">
              <span className="font-medium">לקוח *</span>
              {debtors === null ? (
                <div className="flex h-11 items-center gap-2 rounded-xl border border-input px-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>טוען חייבים...</span>
                </div>
              ) : debtors.length === 0 ? (
                <div className="rounded-xl border bg-muted/30 p-3 text-muted-foreground">
                  {debtorsError ?? "אין כרגע לקוחות עם חוב פתוח."}
                </div>
              ) : (
                <SearchableSelect
                  ariaLabel="בחירת לקוח"
                  placeholder="בחרו לקוח"
                  searchPlaceholder="חיפוש לפי שם או טלפון..."
                  options={debtorOptions}
                  value={customerId}
                  onChange={(next) => void loadReceivables(next)}
                />
              )}
            </div>

            {customerId ? (
              <div className="space-y-2 text-right text-sm">
                <span className="font-medium">על מה התשלום *</span>
                {receivablesLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border p-3 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
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
                              <span className="font-semibold">
                                {formatCurrency(receivable.outstanding_amount)}
                              </span>
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

                          {/* Pending rows (uncleared check / future transfer) —
                              the money already has a row, so clear it instead of
                              creating a duplicate payment. */}
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
                                    disabled={clearingId !== null}
                                    onClick={() => void markPendingCollected(pending.id)}
                                  >
                                    {clearingId === pending.id ? "מסמן..." : "סמן כנגבה"}
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
            ) : null}

            {selectedReceivable ? (
              <>
                <AdaptiveGrid variant="formTwoLoose">
                  <label className="space-y-2 text-right text-sm">
                    <span className="font-medium">סכום שהתקבל *</span>
                    <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <span className="block text-[11px] text-muted-foreground">
                      החוב הפתוח: {formatCurrency(selectedReceivable.outstanding_amount)}
                    </span>
                  </label>

                  <label className="space-y-2 text-right text-sm">
                    <span className="font-medium">תאריך *</span>
                    <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                  </label>

                  <label className="space-y-2 text-right text-sm">
                    <span className="font-medium">אמצעי תשלום *</span>
                    <select
                      className={`${fieldClass} text-right`}
                      value={method}
                      onChange={(e) => {
                        const next = e.target.value;
                        setMethod(next);
                        setAccountId((prev) => prev || defaultAccountForMethod(accountsList, next));
                      }}
                    >
                      <option value=""></option>
                      {PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <AccountSelect
                    required
                    value={accountId}
                    onChange={setAccountId}
                    onLoaded={(list) => {
                      setAccountsList(list);
                      setAccountId((prev) => prev || defaultAccountForMethod(list, method));
                    }}
                  />

                  <label className="space-y-2 text-right text-sm">
                    <span className="font-medium">אסמכתא</span>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </label>
                </AdaptiveGrid>

                {method === "check" ? (
                  <CheckDetailsFields
                    checkNumber={checkNumber}
                    onCheckNumberChange={setCheckNumber}
                    photoFiles={checkPhotoFiles}
                    onPhotoFilesChange={setCheckPhotoFiles}
                    disabled={submitting}
                  />
                ) : null}

                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">הערות</span>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </label>
              </>
            ) : null}
          </div>
        </fieldset>

        {error ? <p className="text-right text-sm text-destructive">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void save()} disabled={submitting || !selectedReceivable}>
            {submitting ? "שומר..." : "שמירת תשלום"}
          </Button>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}

export default CollectPaymentDialog;

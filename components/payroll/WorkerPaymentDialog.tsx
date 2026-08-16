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

import { useMemo, useState } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { formatCurrency } from "@/lib/payroll";
import type { WorkerDebtItemRow } from "@/lib/payroll-center";
import type { UserRole } from "@/lib/auth/requireProfile";
import type { UserOption } from "@/app/(app)/dashboard/quick-actions-types";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";
import { getTodayDate } from "@/app/(app)/dashboard/DashboardActions.helpers";
import {
  buildWorkerPaymentAllocations,
  sortOpenWorkerDebt,
  sumOpenOwed,
  validateWorkerPaymentForm,
} from "@/app/(app)/dashboard/DashboardActions.forms";

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
  const [userId, setUserId] = useState("");
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

  const openOwed = useMemo(() => sumOpenOwed(debtItems), [debtItems]);

  function reset() {
    setError(null);
    setUserId("");
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
      onOpenChange(false);
      reset();
      onSaved();
    } catch (err: unknown) {
      setError(toHebrewError(err, HEBREW.saveErrorUnknown));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        // Mid-submit the request is already creating rows — closing would orphan it.
        if (!next && submitting) return;
        onOpenChange(next);
        if (!next) reset();
      }}
      title="תשלום לעובד"
      description="רישום תשלום לעובד שעתי / חודשי / קבלן. התשלום יקוזז מהיתרה הפתוחה (תלושים / משמרות)."
      size="form2xl"
      onSubmit={() => void save()}
      submitLabel="שמירת תשלום"
      busyLabel={HEBREW.saving}
      busy={submitting}
      submitDisabled={debtLoading}
      error={error || undefined}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-2 text-right text-sm md:col-span-2">
          <span className="font-medium">{"עובד *"}</span>
          <SearchableSelect
            ariaLabel="בחירת עובד"
            placeholder="בחרו עובד"
            searchPlaceholder="חיפוש עובד..."
            options={payableWorkers.map((user) => ({ value: user.id, label: user.label }))}
            value={userId}
            onChange={selectWorker}
          />
        </label>

        {userId ? (
          <div className="md:col-span-2 rounded-xl border bg-muted/30 p-3 text-right text-sm">
            {debtLoading ? (
              <span className="text-muted-foreground">{"טוען יתרה..."}</span>
            ) : openOwed > 0 ? (
              <span>
                {"יתרה פתוחה: "}
                <span className="font-semibold">{formatCurrency(openOwed)}</span>
                <span className="text-muted-foreground">{` • ${debtItems.length} פריטים פתוחים`}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                {"אין יתרה פתוחה לעובד זה. תשלום שיירשם יישמר כמקדמה ללא קיזוז."}
              </span>
            )}
          </div>
        ) : null}

        <label className="space-y-2 text-right text-sm">
          <span className="font-medium">{"סכום *"}</span>
          <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <label className="space-y-2 text-right text-sm">
          <span className="font-medium">{"תאריך תשלום *"}</span>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="space-y-2 text-right text-sm">
          <span className="font-medium">{HEBREW.paymentMethod}</span>
          <NativeSelect
            value={method}
            onChange={(e) => {
              const next = e.target.value;
              setMethod(next);
              if (!accountId) setAccountId(defaultAccountForMethod(accountsList, next));
            }}
          >
            <option value=""></option>
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </label>

        <AccountSelect
          required
          value={accountId}
          onChange={setAccountId}
          onLoaded={(list) => {
            setAccountsList(list);
            if (!accountId) setAccountId(defaultAccountForMethod(list, method));
          }}
        />

        <label className="space-y-2 text-right text-sm">
          <span className="font-medium">{"אסמכתא"}</span>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>

        <label className="space-y-2 text-right text-sm md:col-span-2">
          <span className="font-medium">{HEBREW.notes}</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
      </div>
    </FormDialog>
  );
}

export default WorkerPaymentDialog;

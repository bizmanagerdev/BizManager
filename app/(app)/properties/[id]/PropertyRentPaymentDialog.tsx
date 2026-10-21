"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { offlineFetch } from "@/lib/offline-queue";
import { registerReversibleCreate } from "@/lib/undo-engine";
import { uploadTogether } from "@/lib/upload-together";
import { queueFinancialAttachmentsAfter } from "@/lib/payments/uploadCheckPhotos";
import { toHebrewError } from "@/lib/error-messages";
import { israelDateKey } from "@/lib/timezone";
import { nextUncoveredPeriod, rentPeriodStatus, rentThisPeriod } from "@/lib/property-rent";
import { rentPeriodChoices, rentPeriodLabel } from "@/lib/rent-periods";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { uploadFinancialAttachment } from "@/app/(app)/dashboard/DashboardActions.helpers";
import { toRentPayment } from "./propertyMovements";

// Recording a lease's rent (owner, 2026-10-20 — the ניהול נכסים card: "every
// rent payment says which month it covers"): the month it's for — this
// period, or the next one not paid yet — and how many ("שולם לחודשיים"), by
// the lease's own calendar (א׳ חשון, not 1 November, for a Hebrew lease). It
// goes up through the same route as every income, with its lease and period.

type Form = {
  periodStart: string;
  periods: string;
  amount: string;
  amountTouched: boolean;
  paymentMethod: string;
  paymentDate: string;
  dueDate: string;
  checkNumber: string;
  referenceNumber: string;
  notes: string;
  accountId: string;
};

/**
 * Where a new rent payment starts: a given month (the rent roll's row), or
 * this period while it isn't paid and the next one that isn't once it is;
 * paid the lease's usual way when that's known.
 */
export type RentPaymentPrefill = { periodStart?: string | null; method?: string | null; accountId?: string | null };

function startingForm(lease: LeaseAgreement, payments: PropertyPayment[], prefill: RentPaymentPrefill = {}): Form {
  const today = israelDateKey();
  const rent = payments.map(toRentPayment);
  const status = prefill.periodStart
    ? rentPeriodStatus(lease, rent, prefill.periodStart, today)
    : rentThisPeriod(lease, rent, today);
  // This period while it isn't paid; once it is, the next one that isn't.
  const periodStart =
    prefill.periodStart ??
    (status.state === "paid" || !status.periodStart ? nextUncoveredPeriod(lease, rent, today) : status.periodStart);
  // A period paid in part: what's left of it.
  const owed = status.periodStart === periodStart ? lease.monthlyRentAmount - status.collected : lease.monthlyRentAmount;
  return {
    periodStart,
    periods: "1",
    amount: String(owed > 0 ? owed : lease.monthlyRentAmount),
    amountTouched: false,
    paymentMethod: prefill.method || "bank_transfer",
    paymentDate: today,
    dueDate: "",
    checkNumber: "",
    referenceNumber: "",
    notes: "",
    accountId: "",
  };
}

export default function PropertyRentPaymentDialog({
  open,
  onOpenChange,
  propertyId,
  lease,
  payments,
  prefill,
  onRecorded,
  onUndone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  lease: LeaseAgreement | null;
  /** The property's incomes: where this lease's rent stands. */
  payments: PropertyPayment[];
  /** The month it's for and the usual way it's paid (the rent roll's row). */
  prefill?: RentPaymentPrefill;
  /** The payment as recorded — the rent roll shows its row paid at once, before the page reads it again. */
  onRecorded?: (payment: PropertyPayment) => void;
  /** It was undone (its "בטל"): gone again. */
  onUndone?: (paymentId: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<Form | null>(null);
  const [openFor, setOpenFor] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // Each opening starts from where the rent stands now.
  if (open !== openFor) {
    setOpenFor(open);
    if (open && lease) {
      const start = startingForm(lease, payments, prefill);
      setForm({ ...start, accountId: prefill?.accountId || defaultAccountForMethod(accounts, start.paymentMethod) });
      setPhotos([]);
    }
  }

  if (!lease) return null;
  const yearly = lease.periodMonths === 12;
  const isCheck = form?.paymentMethod === "check";
  const set = (patch: Partial<Form>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  // From a few months back to well ahead of today — and the month it opened on, wherever that is.
  const choices = form
    ? [...new Set([...rentPeriodChoices(lease, israelDateKey(), yearly ? 2 : 6, yearly ? 3 : 18), form.periodStart])].sort()
    : [];
  const count = Math.max(1, Number(form?.periods) || 1);

  function setPeriods(value: string) {
    if (!lease) return;
    const n = Math.max(1, Number(value) || 1);
    // The amount follows the number of periods until it's typed by hand.
    setForm((prev) =>
      prev ? { ...prev, periods: value, amount: prev.amountTouched ? prev.amount : String(lease.monthlyRentAmount * n) } : prev
    );
  }

  function pickMethod(method: string) {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            paymentMethod: method,
            checkNumber: method === "check" ? prev.checkNumber : "",
            dueDate: method === "check" ? prev.dueDate || prev.paymentDate : "",
            accountId: defaultAccountForMethod(accounts, method) || prev.accountId,
          }
        : prev
    );
  }

  async function submit() {
    if (!form || !lease || busy) return;
    if (!(Number(form.amount) > 0)) {
      toast.error("יש להזין סכום תקין.");
      return;
    }
    if (!form.paymentDate) {
      toast.error("יש לבחור תאריך.");
      return;
    }
    if (isCheck && !form.dueDate) {
      toast.error("יש להזין תאריך פירעון לצ׳ק.");
      return;
    }
    if (accounts.length > 0 && !form.accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    setBusy(true);
    try {
      const result = await offlineFetch(
        "/api/payments/create",
        {
          business_domain: "property_management",
          property_id: propertyId,
          payment_date: form.paymentDate,
          due_date: isCheck ? form.dueDate : null,
          amount_total: Number(form.amount),
          payment_method: form.paymentMethod,
          check_number: isCheck ? form.checkNumber.trim() : "",
          reference_number: form.referenceNumber.trim(),
          notes: form.notes.trim(),
          account_id: form.accountId || null,
          requires_split: false,
          lease_id: lease.id,
          rent_period_start: form.periodStart,
          rent_periods: count,
          counts_as_rent: true,
        },
        "תשלום שכירות",
        { idempotent: true }
      );
      // As it went up — for a page to show at once (an id only once the server has it).
      const recorded = (id: string): PropertyPayment => ({
        id,
        date: form.paymentDate,
        amount: Number(form.amount),
        method: form.paymentMethod,
        dueDate: isCheck ? form.dueDate : null,
        checkNumber: isCheck ? form.checkNumber.trim() || null : null,
        paymentStatus: isCheck ? "pending" : "cleared",
        accountId: form.accountId || null,
        notes: form.notes.trim() || null,
        referenceNumber: form.referenceNumber.trim() || null,
        requiresSplit: false,
        createdAt: new Date().toISOString(),
        leaseId: lease.id,
        rentPeriodStart: form.periodStart,
        rentPeriods: count,
        countsAsRent: true,
        attachments: [],
      });
      if (result.queued) {
        // Kept on the device: the check's photos go up once it reaches the server.
        if (isCheck) await queueFinancialAttachmentsAfter(result.key, "payment.id", "payment", photos);
        onRecorded?.(recorded(`queued:${result.key ?? crypto.randomUUID()}`));
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        toast.error(toHebrewError(result.error, "שמירת התשלום נכשלה."));
        return;
      }
      const paymentId = (result.data as { payment?: { id?: string } })?.payment?.id ?? null;
      onRecorded?.(recorded(paymentId ?? `saved:${crypto.randomUUID()}`));
      if (paymentId && isCheck && photos.length > 0) {
        await uploadTogether(photos, (file) => uploadFinancialAttachment("payment", paymentId, file));
      }
      onOpenChange(false);
      startTransition(() => router.refresh());
      const message = `נרשם תשלום שכירות ל${rentPeriodLabel(lease, form.periodStart, count)}.`;
      if (!paymentId) {
        toast.success(message);
        return;
      }
      registerReversibleCreate({
        scope: "payment",
        id: paymentId,
        message,
        onUndo: async () => {
          const res = await fetch("/api/payments/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: paymentId }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "ביטול נכשל.") };
          onUndone?.(paymentId);
          startTransition(() => router.refresh());
          return { ok: true };
        },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open && Boolean(form)}
      onOpenChange={onOpenChange}
      title="רישום תשלום שכירות"
      description={lease.customerName ?? undefined}
      size="formMd"
      onSubmit={() => void submit()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={busy}
    >
      {form ? (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={yearly ? "לשנה" : "לחודש"}>
              <NativeSelect value={form.periodStart} onChange={(e) => set({ periodStart: e.target.value })}>
                {choices.map((start) => (
                  <option key={start} value={start}>
                    {rentPeriodLabel(lease, start)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={yearly ? "כמה שנים" : "כמה חודשים"}>
              <NativeSelect value={form.periods} onChange={(e) => setPeriods(e.target.value)}>
                {Array.from({ length: yearly ? 3 : 12 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={String(n)}>
                    {n === 1 ? (yearly ? "שנה אחת" : "חודש אחד") : `${n} ${yearly ? "שנים" : "חודשים"}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {count > 1 ? (
            <div className="text-xs text-muted-foreground">משלם על {rentPeriodLabel(lease, form.periodStart, count)}</div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="סכום">
              <CurrencyInput value={form.amount} onChange={(e) => set({ amount: e.target.value, amountTouched: true })} />
            </Field>
            <Field label="אמצעי תשלום">
              <NativeSelect value={form.paymentMethod} onChange={(e) => pickMethod(e.target.value)}>
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={isCheck ? "תאריך קבלה" : "תאריך"}>
              <DateInput value={form.paymentDate} onChange={(e) => set({ paymentDate: e.target.value })} />
            </Field>
            {isCheck ? (
              <Field label="תאריך פירעון">
                <DateInput value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              </Field>
            ) : (
              <Field label="אסמכתא" hint="רשות">
                <Input value={form.referenceNumber} onChange={(e) => set({ referenceNumber: e.target.value })} />
              </Field>
            )}
          </div>
          {isCheck ? (
            <CheckDetailsFields
              checkNumber={form.checkNumber}
              onCheckNumberChange={(value) => set({ checkNumber: value })}
              photoFiles={photos}
              onPhotoFilesChange={setPhotos}
            />
          ) : null}
          <Field label="הערה" hint="רשות">
            <Input
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder={`שכירות ${rentPeriodLabel(lease, form.periodStart, count)}`}
            />
          </Field>
          <AccountSelect
            required
            value={form.accountId}
            onChange={(value) => set({ accountId: value })}
            onLoaded={(list) => {
              setAccounts(list);
              setForm((prev) => (prev ? { ...prev, accountId: prev.accountId || defaultAccountForMethod(list, prev.paymentMethod) } : prev));
            }}
          />
        </div>
      ) : null}
    </FormDialog>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyAmountInput, knowsCurrency, typedAmountOf, useMoneyCurrency, type RowCurrency } from "@/components/fx/MoneyCurrency";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import type { Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { leaseForPayment, rentCoverage } from "@/lib/property-rent";
import { rentPeriodChoices, rentPeriodLabel } from "@/lib/rent-periods";
import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { currencyFieldsFrom, isForeignCurrency } from "@/lib/fx/currencies";
import { dayKey, toRentPayment } from "./propertyMovements";

// Editing one of a property's incomes — any of them, whatever it was paid
// with (owner's card, note 8: "לראות את כל הפרטים בהכנסות ושיהיה אופציה של
// עדכון ושהכותרת תהיה מה שכתוב"). The note is the income's title, so it's
// asked first. Everything already on the payment goes back with the save: the
// update route clears a field it isn't sent, which is how editing a rent
// check used to wipe its note. A rent payment also says which month(s) it pays
// for, by its lease's calendar; one that isn't rent (a refund) says so.
// Its amount is in its currency — ₪, US$ or C$ (2026-10-23) — with the day's
// rate under it, as in the window it was added in.

type Form = {
  title: string;
  paymentDate: string;
  dueDate: string;
  amount: string;
  paymentMethod: string;
  checkNumber: string;
  referenceNumber: string;
  accountId: string;
  countsAsRent: boolean;
  leaseId: string;
  periodStart: string;
  periods: string;
};

/** Its currency as the amount field takes it; none when it wasn't read (an older copy). */
function currencyRow(payment: PropertyPayment | null): RowCurrency | null {
  return payment && payment.foreign !== undefined ? currencyFieldsFrom(payment.foreign) : null;
}

function toForm(payment: PropertyPayment, leases: LeaseAgreement[], currentLease: LeaseAgreement | null): Form {
  const lease = leaseForPayment(leases, toRentPayment(payment), currentLease) ?? currentLease;
  return {
    title: payment.notes ?? "",
    paymentDate: dayKey(payment.date) ?? "",
    dueDate: dayKey(payment.dueDate) ?? "",
    amount: typedAmountOf(currencyRow(payment), payment.amount),
    paymentMethod: PAYMENT_METHOD_OPTIONS.some((m) => m.value === payment.method) ? (payment.method as string) : "bank_transfer",
    checkNumber: payment.checkNumber ?? "",
    referenceNumber: payment.referenceNumber ?? "",
    accountId: payment.accountId ?? "",
    countsAsRent: payment.countsAsRent !== false,
    leaseId: lease?.id ?? "",
    // The month(s) it's for, by the same rule the table reads it with.
    periodStart: (lease && rentCoverage(lease, { ...toRentPayment(payment), countsAsRent: true })?.start) || "",
    periods: String(payment.rentPeriods ?? 1),
  };
}

function leaseName(lease: LeaseAgreement): string {
  const dates = [lease.startDate, lease.endDate].map((d) => formatShortDate(d, "")).filter(Boolean).join(" – ");
  return [lease.unitLabel, lease.customerName ?? "שוכר", dates].filter(Boolean).join(" · ");
}

export default function PropertyIncomeEditDialog({
  payment,
  onClose,
  leases = [],
  currentLease = null,
}: {
  /** The income being edited; null keeps the dialog closed. */
  payment: PropertyPayment | null;
  onClose: () => void;
  /** The property's leases: which one the rent is for, and its months. */
  leases?: LeaseAgreement[];
  currentLease?: LeaseAgreement | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<Form | null>(payment ? toForm(payment, leases, currentLease) : null);
  const [formFor, setFormFor] = useState<PropertyPayment | null>(payment);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Each opening starts from the payment as saved.
  if (payment !== formFor) {
    setFormFor(payment);
    setForm(payment ? toForm(payment, leases, currentLease) : null);
  }
  const lease = form ? leases.find((l) => l.id === form.leaseId) ?? null : null;
  const yearly = lease?.periodMonths === 12;
  const row = currencyRow(payment);
  const money = useMoneyCurrency({
    open: Boolean(payment),
    initial: row,
    known: knowsCurrency(row),
    accountCurrency: accounts.find((a) => a.id === form?.accountId)?.currency ?? null,
    date: form?.paymentDate,
  });

  const isCheck = form?.paymentMethod === "check";
  const set = (key: keyof Form, value: string) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  function submit() {
    if (!payment || !form) return;
    if (!form.paymentDate) {
      toast.error(isCheck ? "יש לבחור את חודש השכירות." : "יש לבחור תאריך.");
      return;
    }
    if (isCheck && !form.dueDate) {
      toast.error("יש להזין תאריך פירעון לצ׳ק.");
      return;
    }
    if (!(Number(form.amount) > 0)) {
      toast.error("יש להזין סכום תקין.");
      return;
    }
    if (isForeignCurrency(money.currency) && money.rate === null) {
      toast.error(money.loading ? "רגע, מביא את השער היציג…" : "יש להקליד את השער.");
      return;
    }
    if (accounts.length > 0 && !form.accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    const id = payment.id;
    const saved = form;
    // Rent: its lease and month(s); not rent: neither (the route clears them).
    const rentLease = saved.countsAsRent ? leases.find((l) => l.id === saved.leaseId) ?? null : null;
    const rentPeriods = Math.max(1, Number(saved.periods) || 1);
    // Months ticked one by one, left as they were: kept (a new amount is shared out over them by the route).
    const before = toForm(payment, leases, currentLease);
    const keepsTicked =
      Boolean(payment.rentAllocation) &&
      saved.countsAsRent &&
      saved.leaseId === before.leaseId &&
      saved.periodStart === before.periodStart &&
      saved.periods === before.periods;
    const rent: Record<string, unknown> = !saved.countsAsRent
      ? { counts_as_rent: false }
      : keepsTicked
        ? { counts_as_rent: true }
        : rentLease && saved.periodStart
          ? { counts_as_rent: true, lease_id: rentLease.id, rent_period_start: saved.periodStart, rent_periods: rentPeriods }
          : { counts_as_rent: true };
    const rentPatch = !saved.countsAsRent
      ? { countsAsRent: false, leaseId: null, rentPeriodStart: null, rentPeriods: 1, rentAllocation: null }
      : keepsTicked
        ? { countsAsRent: true }
        : rentLease && saved.periodStart
          ? { countsAsRent: true, leaseId: rentLease.id, rentPeriodStart: saved.periodStart, rentPeriods, rentAllocation: null }
          : { countsAsRent: true };
    // In US$ or C$: the amount as typed goes to the route, which works out the
    // shekels at the rate; the row on screen shows them meanwhile.
    const typed = Number(saved.amount);
    const currencyBody = money.body();
    const foreignCurrency = money.known && isForeignCurrency(money.currency) ? money.currency : null;
    const shekels = foreignCurrency ? money.shekels(typed) ?? payment.amount : typed;
    const foreignPatch = money.known
      ? {
          foreign:
            foreignCurrency && money.rate
              ? { currency: foreignCurrency, amount: typed, rate: money.rate, rateManual: money.manual }
              : null,
        }
      : {};
    onClose();
    scheduleDeferredEdit({
      scope: "property-payment",
      id,
      message: "ההכנסה עודכנה.",
      patch: {
        notes: saved.title.trim() || null,
        date: saved.paymentDate,
        dueDate: saved.dueDate || null,
        amount: shekels,
        ...foreignPatch,
        method: saved.paymentMethod,
        checkNumber: saved.paymentMethod === "check" ? saved.checkNumber || null : null,
        referenceNumber: saved.referenceNumber.trim() || null,
        accountId: saved.accountId || null,
        ...rentPatch,
      },
      onCommit: async () => {
        const res = await fetch("/api/payments/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            business_domain: "property_management",
            payment_date: saved.paymentDate,
            due_date: saved.dueDate || null,
            amount_total: typed,
            ...currencyBody,
            payment_method: saved.paymentMethod,
            check_number: saved.paymentMethod === "check" ? saved.checkNumber || null : null,
            reference_number: saved.referenceNumber.trim(),
            notes: saved.title.trim(),
            requires_split: payment.requiresSplit,
            account_id: saved.accountId || null,
            ...rent,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "") };
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  return (
    <FormDialog
      open={Boolean(payment && form)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="עריכת הכנסה"
      size="formMd"
      onSubmit={submit}
      submitLabel="שמירה"
    >
      {form ? (
        <div className="mt-4 space-y-3">
          <Field label="על מה">
            <Textarea
              rows={2}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="שכירות חודש חשוון"
            />
          </Field>
          {leases.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="סוג">
                <NativeSelect
                  value={form.countsAsRent ? "rent" : "other"}
                  onChange={(e) => setForm((prev) => (prev ? { ...prev, countsAsRent: e.target.value === "rent" } : prev))}
                >
                  <option value="rent">שכירות</option>
                  <option value="other">לא שכירות (החזר וכד׳)</option>
                </NativeSelect>
              </Field>
              {form.countsAsRent && leases.length > 1 ? (
                <Field label="חוזה">
                  <NativeSelect
                    value={form.leaseId}
                    onChange={(e) => {
                      // Another lease: the month its date falls in on that lease's calendar.
                      const next = leases.find((l) => l.id === e.target.value);
                      const start =
                        next && payment
                          ? rentCoverage(next, { ...toRentPayment(payment), leaseId: next.id, periodStart: null, countsAsRent: true })?.start
                          : null;
                      setForm((prev) => (prev ? { ...prev, leaseId: e.target.value, periodStart: start ?? prev.periodStart } : prev));
                    }}
                  >
                    {leases.map((l) => (
                      <option key={l.id} value={l.id}>
                        {leaseName(l)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              {form.countsAsRent && lease && form.periodStart ? (
                <>
                  <Field label={yearly ? "לשנה" : "לחודש"}>
                    <NativeSelect value={form.periodStart} onChange={(e) => set("periodStart", e.target.value)}>
                      {rentPeriodChoices(lease, form.periodStart, yearly ? 2 : 12, yearly ? 3 : 12).map((start) => (
                        <option key={start} value={start}>
                          {rentPeriodLabel(lease, start)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={yearly ? "כמה שנים" : "כמה חודשים"}>
                    <NativeSelect value={form.periods} onChange={(e) => set("periods", e.target.value)}>
                      {Array.from({ length: yearly ? 3 : 12 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={String(n)}>
                          {n === 1 ? (yearly ? "שנה אחת" : "חודש אחד") : `${n} ${yearly ? "שנים" : "חודשים"}`}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {payment?.rentAllocation ? (
                    // Recorded for months ticked one by one: what each got, and what changing them here does.
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      נרשם על {payment.rentAllocation.map((s) => `${rentPeriodLabel(lease, s.period).replace(/ (תש\S*|\d{4})$/, "")} ${formatCurrency(s.amount)}`).join(" · ")}.
                      {" "}שינוי החודשים כאן יחלק את הסכום שווה בשווה.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="סכום">
              <CurrencyAmountInput money={money} value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label="אמצעי תשלום">
              <NativeSelect
                value={form.paymentMethod}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? { ...prev, paymentMethod: e.target.value, checkNumber: e.target.value === "check" ? prev.checkNumber : "" }
                      : prev
                  )
                }
              >
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {/* A check from the rent schedule: its date is the month it's for,
                its due date is when the money comes in. */}
            <Field label={isCheck ? "לחודש השכירות" : "תאריך"}>
              <DateInput value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} />
            </Field>
            {isCheck ? (
              <Field label="תאריך פירעון">
                <DateInput value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
              </Field>
            ) : null}
            {isCheck ? (
              <Field label="מספר צ׳ק">
                <Input value={form.checkNumber} onChange={(e) => set("checkNumber", e.target.value)} />
              </Field>
            ) : null}
            <Field label="אסמכתא">
              <Input value={form.referenceNumber} onChange={(e) => set("referenceNumber", e.target.value)} />
            </Field>
          </div>
          <AccountSelect required value={form.accountId} onChange={(value) => set("accountId", value)} onLoaded={setAccounts} />
        </div>
      ) : null}
    </FormDialog>
  );
}

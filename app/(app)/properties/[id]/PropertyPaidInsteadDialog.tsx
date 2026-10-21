"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { LeaseAgreement, PropertyPayment } from "@/lib/properties";
import { nextUncoveredPeriod, rentCoverage } from "@/lib/property-rent";
import { rentPeriodLabel } from "@/lib/rent-periods";
import { formatCurrency } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { israelDateKey } from "@/lib/timezone";
import { toRentPayment } from "./propertyMovements";

// A month paid another way than its check (owner, 2026-10-21): "that month he
// paid by transfer — the check wasn't used, it'll be used another time; it's
// a check of this tenant, not of a month". So the transfer is recorded as that
// month's rent, and the check stays a check — its number, its amount, still
// waiting — moved by itself to the next month nothing pays yet ("the next one
// that doesn't have a check"), with its deposit date.

/** Every way but a check (and a card, which a tenant's rent never comes by). */
const OTHER_METHODS = PAYMENT_METHOD_OPTIONS.filter((m) => m.value !== "check" && m.value !== "credit_card");

type Form = { method: string; date: string; accountId: string; reference: string };

export default function PropertyPaidInsteadDialog({
  check,
  lease,
  payments,
  propertyId,
  title,
  onClose,
  onRecorded,
}: {
  /** The check; null keeps the dialog closed. */
  check: PropertyPayment | null;
  /** Its lease: whose months these are. */
  lease: LeaseAgreement | null;
  /** The property's incomes: which month nothing pays yet. */
  payments: PropertyPayment[];
  propertyId: string;
  /** What it's for ("שכירות כסלו תשפ״ז"). */
  title: string;
  onClose: () => void;
  /**
   * The month's payment as it will be recorded (id "instead:<check id>") — the
   * rent roll shows the month paid at once, while the check's move can still
   * be undone.
   */
  onRecorded?: (payment: PropertyPayment) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<Form>({ method: "bank_transfer", date: israelDateKey(), accountId: "", reference: "" });
  const [formFor, setFormFor] = useState<PropertyPayment | null>(check);
  if (check !== formFor) {
    setFormFor(check);
    setForm({ method: "bank_transfer", date: israelDateKey(), accountId: defaultAccountForMethod(accounts, "bank_transfer"), reference: "" });
  }

  // The check's month (the transfer pays it), and the one it moves to: the
  // first nothing pays once the transfer pays this one and the check doesn't.
  const months = useMemo(() => {
    if (!check || !lease) return null;
    const cover = rentCoverage(lease, toRentPayment(check));
    if (!cover) return null;
    const others = payments.filter((p) => p.id !== check.id).map(toRentPayment);
    const transfer = { date: cover.start, paymentStatus: "cleared", amount: check.amount, leaseId: lease.id, periodStart: cover.start, periods: cover.periods };
    const next = nextUncoveredPeriod(lease, [...others, transfer]);
    return { start: cover.start, periods: cover.periods, next };
  }, [check, lease, payments]);

  const set = (patch: Partial<Form>) => setForm((prev) => ({ ...prev, ...patch }));
  function pickMethod(method: string) {
    setForm((prev) => ({ ...prev, method, accountId: defaultAccountForMethod(accounts, method) || prev.accountId }));
  }

  function submit() {
    if (!check || !lease || !months) return;
    if (!form.date) {
      toast.error("יש לבחור את תאריך התשלום.");
      return;
    }
    if (accounts.length > 0 && !form.accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    const saved = form;
    const { start, periods, next } = months;
    const nextLabel = rentPeriodLabel(lease, next);
    onClose();
    onRecorded?.({
      ...check,
      id: `instead:${check.id}`,
      date: saved.date,
      method: saved.method,
      dueDate: null,
      checkNumber: null,
      paymentStatus: "cleared",
      accountId: saved.accountId || null,
      notes: null,
      referenceNumber: saved.reference.trim() || null,
      createdAt: new Date().toISOString(),
      leaseId: lease.id,
      rentPeriodStart: start,
      rentPeriods: periods,
      countsAsRent: true,
      attachments: [],
    });
    scheduleDeferredEdit({
      scope: "property-payment",
      id: check.id,
      message: `נרשם: שולם ב${OTHER_METHODS.find((m) => m.value === saved.method)?.label ?? "תשלום"}. הצ׳ק עבר ל${nextLabel}.`,
      // The check, at once, in its new month.
      patch: { date: next, dueDate: next, rentPeriodStart: next, rentPeriods: 1, leaseId: lease.id },
      onCommit: async () => {
        // The month's rent, as it really came …
        const created = await fetch("/api/payments/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            business_domain: "property_management",
            property_id: propertyId,
            payment_date: saved.date,
            amount_total: check.amount,
            payment_method: saved.method,
            reference_number: saved.reference.trim(),
            notes: "",
            account_id: saved.accountId || null,
            requires_split: false,
            lease_id: lease.id,
            rent_period_start: start,
            rent_periods: periods,
            counts_as_rent: true,
          }),
        });
        const createdJson = await created.json().catch(() => ({}));
        if (!created.ok) return { ok: false, error: toHebrewError(createdJson?.error, "רישום התשלום נכשל.") };
        // … and the check, still waiting, for the next month nothing pays.
        const moved = await fetch("/api/payments/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: check.id,
            business_domain: "property_management",
            payment_date: next,
            due_date: next,
            amount_total: check.amount,
            payment_method: "check",
            check_number: check.checkNumber ?? "",
            reference_number: check.referenceNumber ?? "",
            notes: check.notes ?? "",
            requires_split: check.requiresSplit,
            account_id: check.accountId,
            lease_id: lease.id,
            rent_period_start: next,
            rent_periods: 1,
          }),
        });
        const movedJson = await moved.json().catch(() => ({}));
        if (!moved.ok) {
          return { ok: false, error: toHebrewError(movedJson?.error, "התשלום נרשם, אבל העברת הצ׳ק לחודש הבא נכשלה.") };
        }
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  return (
    <FormDialog
      open={Boolean(check)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="שולם אחרת החודש"
      description={check ? `${title} · ${formatCurrency(check.amount)}` : undefined}
      size="formSm"
      onSubmit={submit}
      submitLabel="שמירה"
    >
      <div className="mt-4 space-y-3">
        <Field label="איך שולם">
          <NativeSelect value={form.method} onChange={(e) => pickMethod(e.target.value)}>
            {OTHER_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="תאריך התשלום">
            <DateInput value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="אסמכתא" hint="רשות">
            <Input value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
        </div>
        <AccountSelect
          required
          value={form.accountId}
          onChange={(value) => set({ accountId: value })}
          onLoaded={(list) => {
            setAccounts(list);
            setForm((prev) => (prev.accountId ? prev : { ...prev, accountId: defaultAccountForMethod(list, prev.method) }));
          }}
        />
        {check && lease && months ? (
          <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
            {check.checkNumber ? `צ׳ק #${check.checkNumber}` : "הצ׳ק"} נשאר אצלנו ועובר ל
            <span className="font-semibold">{rentPeriodLabel(lease, months.next)}</span> — החודש הבא שעוד אין לו תשלום.
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

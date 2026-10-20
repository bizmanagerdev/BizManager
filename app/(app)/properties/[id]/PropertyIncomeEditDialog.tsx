"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import type { Account } from "@/lib/accounts";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import type { PropertyPayment } from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredEdit } from "@/lib/undo-engine";
import { dayKey } from "./propertyMovements";

// Editing one of a property's incomes — any of them, whatever it was paid
// with (owner's card, note 8: "לראות את כל הפרטים בהכנסות ושיהיה אופציה של
// עדכון ושהכותרת תהיה מה שכתוב"). The note is the income's title, so it's
// asked first. Everything already on the payment goes back with the save: the
// update route clears a field it isn't sent, which is how editing a rent
// check used to wipe its note.

type Form = {
  title: string;
  paymentDate: string;
  dueDate: string;
  amount: string;
  paymentMethod: string;
  checkNumber: string;
  referenceNumber: string;
  accountId: string;
};

function toForm(payment: PropertyPayment): Form {
  return {
    title: payment.notes ?? "",
    paymentDate: dayKey(payment.date) ?? "",
    dueDate: dayKey(payment.dueDate) ?? "",
    amount: String(payment.amount ?? ""),
    paymentMethod: PAYMENT_METHOD_OPTIONS.some((m) => m.value === payment.method) ? (payment.method as string) : "bank_transfer",
    checkNumber: payment.checkNumber ?? "",
    referenceNumber: payment.referenceNumber ?? "",
    accountId: payment.accountId ?? "",
  };
}

export default function PropertyIncomeEditDialog({
  payment,
  onClose,
}: {
  /** The income being edited; null keeps the dialog closed. */
  payment: PropertyPayment | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<Form | null>(payment ? toForm(payment) : null);
  const [formFor, setFormFor] = useState<PropertyPayment | null>(payment);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Each opening starts from the payment as saved.
  if (payment !== formFor) {
    setFormFor(payment);
    setForm(payment ? toForm(payment) : null);
  }

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
    if (accounts.length > 0 && !form.accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    const id = payment.id;
    const saved = form;
    onClose();
    scheduleDeferredEdit({
      scope: "property-payment",
      id,
      message: "ההכנסה עודכנה.",
      patch: {
        notes: saved.title.trim() || null,
        date: saved.paymentDate,
        dueDate: saved.dueDate || null,
        amount: Number(saved.amount),
        method: saved.paymentMethod,
        checkNumber: saved.paymentMethod === "check" ? saved.checkNumber || null : null,
        referenceNumber: saved.referenceNumber.trim() || null,
        accountId: saved.accountId || null,
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
            amount_total: Number(saved.amount),
            payment_method: saved.paymentMethod,
            check_number: saved.paymentMethod === "check" ? saved.checkNumber || null : null,
            reference_number: saved.referenceNumber.trim(),
            notes: saved.title.trim(),
            requires_split: payment.requiresSplit,
            account_id: saved.accountId || null,
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="סכום">
              <CurrencyInput value={form.amount} onChange={(e) => set("amount", e.target.value)} />
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

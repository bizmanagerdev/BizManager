"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import AccountSelect from "@/components/financial/AccountSelect";
import type { Account } from "@/lib/accounts";
import type { PropertyPayment } from "@/lib/properties";
import { formatCurrency } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { scheduleDeferredEdit } from "@/lib/undo-engine";

// A rent check that's due, and it cleared (owner, 2026-10-21): into which
// account, really — the one it was recorded with, unless the money landed
// elsewhere.

export default function PropertyCheckArrivedDialog({
  payment,
  title,
  onClose,
}: {
  /** The check; null keeps the dialog closed. */
  payment: PropertyPayment | null;
  /** What it's for ("שכירות כסלו תשפ״ז"). */
  title: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(payment?.accountId ?? "");
  const [accountFor, setAccountFor] = useState<PropertyPayment | null>(payment);
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Each opening starts from the account the check was recorded with.
  if (payment !== accountFor) {
    setAccountFor(payment);
    setAccountId(payment?.accountId ?? "");
  }

  function submit() {
    if (!payment) return;
    if (accounts.length > 0 && !accountId) {
      toast.error("יש לבחור חשבון.");
      return;
    }
    const id = payment.id;
    const account = accountId || null;
    onClose();
    scheduleDeferredEdit({
      scope: "property-payment",
      id,
      message: "הצ׳ק סומן כנפרע.",
      patch: { paymentStatus: "cleared", accountId: account },
      onCommit: async () => {
        const res = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, collected: true, account_id: account }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "סימון הצ׳ק נכשל.") };
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  return (
    <FormDialog
      open={Boolean(payment)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="הצ׳ק נפרע"
      description={payment ? `${title} · ${formatCurrency(payment.amount)}${payment.checkNumber ? ` · צ׳ק #${payment.checkNumber}` : ""}` : undefined}
      size="formSm"
      onSubmit={submit}
      submitLabel="שמירה"
    >
      <div className="mt-4 space-y-2">
        <AccountSelect required value={accountId} onChange={setAccountId} onLoaded={setAccounts} />
        <p className="text-xs text-muted-foreground">לאיזה חשבון נכנס הכסף בפועל — אם לא לחשבון שנרשם מראש.</p>
      </div>
    </FormDialog>
  );
}

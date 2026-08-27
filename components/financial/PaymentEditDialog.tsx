"use client";

// Inline edit for a `payments` row from the account register
// (app/(app)/financial/bank/BankClient.tsx). A payment can be order-tied,
// project-tied, or standalone — each is edited through a DIFFERENT existing
// dialog and update endpoint (see GET /api/payments/edit-context's own header
// comment for why), so this component's whole job is: fetch which one it is,
// then hand off to the real dialog. It never builds its own form.
//
// The one-beat delay between "click עריכה" and the real dialog appearing is
// covered by a plain loading shell — none of the underlying dialogs can render
// before they know which kind they are.

import { useEffect, useState } from "react";
import { toHebrewError } from "@/lib/error-messages";
import { ViewDialog } from "@/components/ui/view-dialog";
import { SpinnerIcon } from "@/components/ui/icons";
import { EditPaymentDialog, type PaymentItem } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";
import { AddIncomeDialog } from "@/app/(app)/projects/[id]/ProjectExpenseDialogs";
import type { PaymentRow } from "@/lib/payments";

type EditContext =
  | { kind: "order"; orderId: string; totalAmount: number; totalPaid: number; payment: PaymentItem }
  | {
      kind: "project";
      projectId: string;
      projectType: string | null;
      projectStartDate: string | null;
      vatRate: number;
      priceIncludesVat: boolean;
      payment: PaymentRow;
    }
  | { kind: "standalone"; payment: PaymentRow };

export function PaymentEditDialog({
  paymentId,
  onOpenChange,
  onSaved,
}: {
  /** null closes the dialog. */
  paymentId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Tagged with the paymentId each result belongs to, so a stale fetch from
  // the PREVIOUS id is simply ignored on render instead of needing an explicit
  // reset at the top of the effect (which is also what a plain resolved-vs-
  // still-loading useState boolean would need, and this is one state instead
  // of two/three kept in sync by hand).
  const [result, setResult] = useState<{ paymentId: string; context?: EditContext; error?: string } | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let active = true;
    void fetch(`/api/payments/edit-context?id=${encodeURIComponent(paymentId)}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as EditContext & { error?: string };
        if (!active) return;
        if (!res.ok) {
          setResult({ paymentId, error: toHebrewError((json as { error?: string }).error, "טעינת התשלום נכשלה.") });
          return;
        }
        setResult({ paymentId, context: json });
      })
      .catch((err: unknown) => {
        if (active) setResult({ paymentId, error: toHebrewError(err, "טעינת התשלום נכשלה.") });
      });
    return () => {
      active = false;
    };
  }, [paymentId]);

  if (!paymentId) return null;

  const current = result?.paymentId === paymentId ? result : null;
  const context = current?.context ?? null;

  if (!context) {
    return (
      <ViewDialog open onOpenChange={(open) => { if (!open) onOpenChange(false); }} title="עריכת תקבול" size="formMd">
        {current?.error ? (
          <p className="py-4 text-sm text-destructive">{current.error}</p>
        ) : (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            טוען...
          </div>
        )}
      </ViewDialog>
    );
  }

  if (context.kind === "order") {
    return (
      <EditPaymentDialog
        payment={context.payment}
        orderId={context.orderId}
        totalAmount={context.totalAmount}
        totalPaid={context.totalPaid}
        onClose={() => onOpenChange(false)}
        onSaved={async () => {
          onOpenChange(false);
          onSaved();
        }}
      />
    );
  }

  return (
    <AddIncomeDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      projectId={context.kind === "project" ? context.projectId : ""}
      projectType={context.kind === "project" ? context.projectType : null}
      projectStartDate={context.kind === "project" ? context.projectStartDate : null}
      vatRate={context.kind === "project" ? context.vatRate : 0}
      priceIncludesVat={context.kind === "project" ? context.priceIncludesVat : false}
      editingPayment={context.payment}
      onSaved={() => {
        onOpenChange(false);
        onSaved();
      }}
    />
  );
}

export default PaymentEditDialog;

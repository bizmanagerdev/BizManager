"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { formatShortDate } from "@/lib/date";

export default function OrderInvoicePanel({
  orderId,
  needsInvoice,
  invoiceSentAt,
  deliveryConfirmedAt,
}: {
  orderId: string;
  needsInvoice: boolean | null;
  invoiceSentAt: string | null;
  deliveryConfirmedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const deliverySaved = (deliveryConfirmedAt ?? "").slice(0, 10);
  const [deliveryDraft, setDeliveryDraft] = useState(deliverySaved);

  async function apply(update: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orders/invoice-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, ...update }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const segBtn = (active: boolean) =>
    `h-9 flex-1 rounded-md border px-3 text-sm transition-colors disabled:opacity-50 ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-input bg-background hover:bg-muted/40"
    }`;

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">צריך חשבונית?</div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply({ needs_invoice: true })}
              className={segBtn(needsInvoice === true)}
            >
              כן
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply({ needs_invoice: false })}
              className={segBtn(needsInvoice === false)}
            >
              לא
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">הנפקת חשבונית</div>
          {invoiceSentAt ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">הונפקה · {formatShortDate(invoiceSentAt)}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void apply({ invoice_sent: false })}
              >
                בטל
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={busy || needsInvoice === false}
              onClick={() => void apply({ invoice_sent: true })}
            >
              סמן כהונפקה
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">תאריך אספקה</div>
          <div className="flex items-center gap-2">
            <DateInput value={deliveryDraft} onChange={(e) => setDeliveryDraft(e.target.value)} />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || deliveryDraft === deliverySaved}
              onClick={() => void apply({ delivery_confirmed_at: deliveryDraft || null })}
            >
              שמור
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";

function today() {
  return new Date().toISOString().slice(0, 10);
}

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
  const [error, setError] = useState<string | null>(null);

  const invoiceSaved = (invoiceSentAt ?? "").slice(0, 10);
  const [invoiceDraft, setInvoiceDraft] = useState(invoiceSaved || today());

  const deliverySaved = (deliveryConfirmedAt ?? "").slice(0, 10);
  const [deliveryDraft, setDeliveryDraft] = useState(deliverySaved);

  async function apply(update: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/invoice-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, ...update }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "השמירה נכשלה.");
      }
    } catch {
      setError("השמירה נכשלה.");
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
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Needs invoice? */}
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

        {/* Invoice issued date (backdatable) */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            {invoiceSentAt ? "תאריך הנפקת חשבונית" : "הנפקת חשבונית"}
          </div>
          <div className="flex items-center gap-2">
            <DateInput value={invoiceDraft} onChange={(e) => setInvoiceDraft(e.target.value)} />
            <Button
              type="button"
              size="sm"
              disabled={busy || !invoiceDraft || invoiceDraft === invoiceSaved}
              onClick={() => void apply({ invoice_sent_at: invoiceDraft })}
            >
              {invoiceSentAt ? "עדכן" : "סמן כהונפקה"}
            </Button>
          </div>
          {invoiceSentAt ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void apply({ invoice_sent: false })}
              className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            >
              בטל סימון הנפקה
            </button>
          ) : null}
        </div>

        {/* Delivery date */}
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

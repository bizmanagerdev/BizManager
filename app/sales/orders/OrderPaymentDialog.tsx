"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";

type CreatedPayment = {
  id?: string;
  payment_date?: string | null;
  amount_total?: number | string | null;
  payment_method?: string | null;
  reference_number?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function OrderPaymentDialog({
  orderId,
  totalAmount,
  paidAmount,
  onCreated,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  onCreated?: (payload: {
    payment: CreatedPayment | null;
    paymentStatus: string;
    totalPaid: number;
  }) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  const remainingBefore = Math.max(totalAmount - paidAmount, 0);
  const amountNumber = Number(amount);

  const preview = useMemo(() => {
    const safeAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 0;
    const nextPaid = paidAmount + safeAmount;
    return {
      nextPaid,
      nextRemaining: Math.max(totalAmount - nextPaid, 0),
      nextStatus: derivePaymentStatus(totalAmount, nextPaid),
    };
  }, [amountNumber, paidAmount, totalAmount]);

  async function submitPayment() {
    if (submitting) return;
    setError(null);

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("יש להזין סכום תשלום גדול מ-0.");
      return;
    }
    if (!paymentDate) {
      setError("יש לבחור תאריך תשלום.");
      return;
    }
    if (!paymentMethod) {
      setError("יש לבחור אמצעי תשלום.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          amount_total: amountNumber,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          reference_number: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        payment?: CreatedPayment | null;
        payment_status?: string;
        total_paid?: number;
      };

      if (!res.ok) {
        setError(json.error ?? "עדכון התשלום נכשל.");
        return;
      }

      onCreated?.({
        payment: json.payment ?? null,
        paymentStatus: json.payment_status ?? derivePaymentStatus(totalAmount, preview.nextPaid),
        totalPaid: typeof json.total_paid === "number" ? json.total_paid : preview.nextPaid,
      });

      setAmount("");
      setPaymentDate(getTodayDate());
      setPaymentMethod("");
      setReferenceNumber("");
      setNotes("");
      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        עדכון תשלום
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>עדכון תשלום</DialogTitle>
            <DialogDescription>
              אפשר להוסיף תשלום נוסף להזמנה, גם אם היא משולמת בכמה חלקים ובכמה אמצעים.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-muted-foreground">סכום הזמנה</div>
                <div className="font-medium">{formatCurrency(totalAmount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">שולם עד עכשיו</div>
                <div className="font-medium">{formatCurrency(paidAmount)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">נותר לגבייה</div>
                <div className="font-medium">{formatCurrency(remainingBefore)}</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">סכום תשלום *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך תשלום *</label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">אמצעי תשלום *</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">בחר אמצעי תשלום...</option>
                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">מספר אסמכתא</label>
                <Input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="אופציונלי"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">הערות</label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="אופציונלי"
                />
              </div>
            </div>

            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">אחרי השמירה</span>
                <span className={`rounded-full border px-2 py-1 text-xs ${paymentStatusClasses(preview.nextStatus)}`}>
                  {paymentStatusLabel(preview.nextStatus)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סכום שולם</span>
                <span>{formatCurrency(preview.nextPaid)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">יתרה</span>
                <span>{formatCurrency(preview.nextRemaining)}</span>
              </div>
            </div>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void submitPayment()} disabled={submitting}>
              {submitting ? "שומר..." : "שמירת תשלום"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

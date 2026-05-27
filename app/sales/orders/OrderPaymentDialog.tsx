"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
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
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";

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
  const [entryType, setEntryType] = useState<"payment" | "refund">(
    paidAmount > totalAmount ? "refund" : "payment"
  );
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");

  const remainingBefore = Math.max(totalAmount - paidAmount, 0);
  const refundBefore = Math.max(paidAmount - totalAmount, 0);
  const amountNumber = Number(amount);

  const preview = useMemo(() => {
    const safeAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 0;
    const signedAmount = entryType === "refund" ? safeAmount * -1 : safeAmount;
    const nextPaid = paidAmount + signedAmount;

    return {
      nextPaid,
      nextRemaining: Math.max(totalAmount - nextPaid, 0),
      nextRefund: Math.max(nextPaid - totalAmount, 0),
      nextStatus: derivePaymentStatus(totalAmount, nextPaid),
    };
  }, [amountNumber, entryType, paidAmount, totalAmount]);

  async function submitPayment() {
    if (submitting) return;
    setError(null);

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError(entryType === "refund" ? "יש להזין סכום החזר גדול מ-0." : "יש להזין סכום תשלום גדול מ-0.");
      return;
    }
    if (!paymentDate) {
      setError(entryType === "refund" ? "יש לבחור תאריך החזר." : "יש לבחור תאריך תשלום.");
      return;
    }
    if (!paymentMethod) {
      setError(entryType === "refund" ? "יש לבחור אמצעי החזר." : "יש לבחור אמצעי תשלום.");
      return;
    }
    if (paymentMethod === "check" && !dueDate) {
      setError("יש להזין תאריך פירעון לצ'ק.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          entry_type: entryType,
          amount_total: amountNumber,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          due_date: paymentMethod === "check" ? dueDate : undefined,
          reference_number: referenceNumber.trim() || undefined,
          check_number: paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
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
        setError(json.error ?? (entryType === "refund" ? "רישום ההחזר נכשל." : "עדכון התשלום נכשל."));
        return;
      }

      const createdPaymentId = json.payment?.id ?? "";
      if (paymentMethod === "check" && createdPaymentId && checkPhotoFiles.length > 0) {
        await uploadCheckPhotos(createdPaymentId, checkPhotoFiles);
      }

      onCreated?.({
        payment: json.payment ?? null,
        paymentStatus: json.payment_status ?? preview.nextStatus,
        totalPaid: typeof json.total_paid === "number" ? json.total_paid : preview.nextPaid,
      });

      setAmount("");
      setEntryType(preview.nextRefund > 0 ? "refund" : "payment");
      setPaymentDate(getTodayDate());
      setPaymentMethod("");
      setDueDate("");
      setReferenceNumber("");
      setCheckNumber("");
      setCheckPhotoFiles([]);
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

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setEntryType(paidAmount > totalAmount ? "refund" : "payment");
          }
        }}
      >
        <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{entryType === "refund" ? "רישום החזר" : "עדכון תשלום"}</DialogTitle>
            <DialogDescription>
              {entryType === "refund"
                ? "אפשר לרשום החזר ללקוח ולעדכן את יתרת ההזמנה."
                : "אפשר להוסיף תשלום נוסף להזמנה, גם אם היא משולמת בכמה חלקים ובכמה אמצעים."}
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
                <div className="text-muted-foreground">{refundBefore > 0 ? "החזר פתוח" : "נותר לגבייה"}</div>
                <div className={`font-medium ${refundBefore > 0 ? "text-warning-soft-foreground" : ""}`}>
                  {formatCurrency(refundBefore > 0 ? refundBefore : remainingBefore)}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">סוג פעולה</label>
              <select
                value={entryType}
                onChange={(e) => setEntryType(e.target.value === "refund" ? "refund" : "payment")}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="payment">תשלום</option>
                <option value="refund">החזר</option>
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">{entryType === "refund" ? "סכום החזר *" : "סכום תשלום *"}</label>
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
                <label className="text-sm font-medium">{entryType === "refund" ? "תאריך החזר *" : "תאריך תשלום *"}</label>
                <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">{entryType === "refund" ? "אמצעי החזר *" : "אמצעי תשלום *"}</label>
              <select
                value={paymentMethod}
                onChange={(e) => { setPaymentMethod(e.target.value); if (e.target.value !== "check") setDueDate(""); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{entryType === "refund" ? "בחר אמצעי החזר..." : "בחר אמצעי תשלום..."}</option>
                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {paymentMethod === "check" ? (
              <>
                <div className="space-y-1">
                  <label className="text-sm font-medium">תאריך פירעון *</label>
                  <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <CheckDetailsFields
                  checkNumber={checkNumber}
                  onCheckNumberChange={setCheckNumber}
                  photoFiles={checkPhotoFiles}
                  onPhotoFilesChange={setCheckPhotoFiles}
                  disabled={submitting}
                />
              </>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">{entryType === "refund" ? "מספר אסמכתא להחזר" : "מספר אסמכתא"}</label>
                <Input
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="אופציונלי"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{entryType === "refund" ? "הערות להחזר" : "הערות"}</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="אופציונלי" />
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
                <span className="text-muted-foreground">שולם נטו</span>
                <span>{formatCurrency(preview.nextPaid)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{preview.nextRefund > 0 ? "החזר" : "יתרה"}</span>
                <span className={preview.nextRefund > 0 ? "text-warning-soft-foreground" : ""}>
                  {formatCurrency(preview.nextRefund > 0 ? preview.nextRefund : preview.nextRemaining)}
                </span>
              </div>
            </div>

            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void submitPayment()} disabled={submitting}>
              {submitting ? "שומר..." : entryType === "refund" ? "שמירת החזר" : "שמירת תשלום"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
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
  paymentMethodLabel,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import type { MorningLocalDocument } from "@/lib/morning/types";

export type PaymentItem = {
  id: string;
  payment_date: string | null;
  amount_total: number;
  payment_method: string | null;
  due_date: string | null;
  reference_number: string | null;
  check_number: string | null;
  notes: string | null;
  insertedByLabel: string | null;
  morningDocuments: MorningLocalDocument[];
};

type Props = {
  orderId: string;
  customerId: string | null;
  totalAmount: number;
  payments: PaymentItem[];
  canManage: boolean;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return value;
  }
}

function EditPaymentDialog({
  payment,
  orderId,
  totalAmount,
  totalPaid,
  onClose,
  onSaved,
}: {
  payment: PaymentItem;
  orderId: string;
  totalAmount: number;
  totalPaid: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const originalAmount = payment.amount_total;
  const [entryType, setEntryType] = useState<"payment" | "refund">(
    originalAmount < 0 ? "refund" : "payment"
  );
  const [amount, setAmount] = useState(String(Math.abs(originalAmount)));
  const [paymentDate, setPaymentDate] = useState(payment.payment_date ?? "");
  const [paymentMethod, setPaymentMethod] = useState(payment.payment_method ?? "");
  const [dueDate, setDueDate] = useState(payment.due_date ?? "");
  const [referenceNumber, setReferenceNumber] = useState(payment.reference_number ?? "");
  const [checkNumber, setCheckNumber] = useState(payment.check_number ?? "");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState(payment.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNumber = Number(amount);
  const signedAmount =
    entryType === "refund" ? -Math.abs(amountNumber) : Math.abs(amountNumber);

  const preview = useMemo(() => {
    const safeNew =
      Number.isFinite(amountNumber) && amountNumber > 0 ? signedAmount : originalAmount;
    const nextPaid = totalPaid - originalAmount + safeNew;
    return {
      nextPaid,
      nextRemaining: Math.max(totalAmount - nextPaid, 0),
      nextStatus: derivePaymentStatus(totalAmount, nextPaid),
    };
  }, [amountNumber, signedAmount, totalAmount, totalPaid, originalAmount]);

  async function handleSubmit() {
    if (submitting) return;
    setError(null);

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("יש להזין סכום גדול מ-0.");
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
    if (paymentMethod === "check" && !dueDate) {
      setError("יש להזין תאריך פירעון לצ'ק.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders/payments/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: payment.id,
          order_id: orderId,
          amount_total: signedAmount,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          due_date: dueDate.trim() || undefined,
          reference_number: referenceNumber.trim() || undefined,
          check_number:
            paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "עדכון נכשל.");
        return;
      }
      if (paymentMethod === "check" && checkPhotoFiles.length > 0) {
        await uploadCheckPhotos(payment.id, checkPhotoFiles);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>עריכת תשלום</DialogTitle>
          <DialogDescription>עדכון פרטי תשלום קיים</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
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
              <label className="text-sm font-medium">סכום *</label>
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
              <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
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

          {paymentMethod ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {paymentMethod === "check"
                  ? "תאריך פירעון *"
                  : "תאריך פירעון צפוי (אופציונלי)"}
              </label>
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {paymentMethod !== "check" ? (
                <p className="text-[11px] text-muted-foreground">
                  לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                </p>
              ) : null}
            </div>
          ) : null}

          {paymentMethod === "check" ? (
            <CheckDetailsFields
              checkNumber={checkNumber}
              onCheckNumberChange={setCheckNumber}
              photoFiles={checkPhotoFiles}
              onPhotoFilesChange={setCheckPhotoFiles}
              disabled={submitting}
            />
          ) : null}

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
              <span className="text-muted-foreground">אחרי העדכון</span>
              <span
                className={`rounded-full border px-2 py-1 text-xs ${paymentStatusClasses(preview.nextStatus)}`}
              >
                {paymentStatusLabel(preview.nextStatus)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">יתרה</span>
              <span>{formatCurrency(preview.nextRemaining)}</span>
            </div>
          </div>

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "שומר..." : "שמירת שינויים"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderPaymentActionsClient({
  orderId,
  customerId,
  totalAmount,
  payments,
  canManage,
}: Props) {
  const router = useRouter();
  const [editingPayment, setEditingPayment] = useState<PaymentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [isRefreshPending, startRefreshTransition] = useTransition();
  const refreshResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isRefreshPending && refreshResolveRef.current) {
      const resolve = refreshResolveRef.current;
      refreshResolveRef.current = null;
      resolve();
    }
  }, [isRefreshPending]);

  function refreshAndWait() {
    return new Promise<void>((resolve) => {
      refreshResolveRef.current = resolve;
      startRefreshTransition(() => {
        router.refresh();
      });
    });
  }

  async function deletePayment(paymentId: string) {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/orders/payments/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: paymentId, order_id: orderId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(json.error ?? "מחיקה נכשלה.");
        return;
      }
      setDeletingId(null);
      await refreshAndWait();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const totalPaid = payments.reduce((s, p) => s + p.amount_total, 0);

  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">עדיין לא הוזנו תשלומים להזמנה זו.</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {payments.map((payment, index) => {
          const isRefund = payment.amount_total < 0;
          const isDeleting = deletingId === payment.id;

          return (
            <div
              key={payment.id || `payment-${index}`}
              className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${isRefund ? "text-warning-soft-foreground" : ""}`}>
                      {isRefund
                        ? `החזר ${formatCurrency(Math.abs(payment.amount_total))}`
                        : formatCurrency(payment.amount_total)}
                    </span>
                    <span className="text-muted-foreground">{formatDate(payment.payment_date)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {isRefund ? "אמצעי החזר" : "אמצעי"}:{" "}
                    {paymentMethodLabel(payment.payment_method)}
                    {payment.reference_number
                      ? ` • אסמכתא: ${payment.reference_number}`
                      : ""}
                    {payment.payment_method === "check" && payment.check_number
                      ? ` • מס' צ'ק: ${payment.check_number}`
                      : ""}
                    {payment.due_date ? ` • פירעון: ${formatDate(payment.due_date)}` : ""}
                  </div>
                  {payment.notes ? (
                    <div className="mt-1 text-muted-foreground">הערות: {payment.notes}</div>
                  ) : null}
                  {payment.insertedByLabel ? (
                    <div className="mt-1 text-muted-foreground">{payment.insertedByLabel}</div>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingPayment(payment)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {isDeleting ? (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void deletePayment(payment.id)}
                          disabled={deleteSubmitting}
                        >
                          {deleteSubmitting ? "מוחק..." : "אשר מחיקה"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => {
                            setDeletingId(null);
                            setDeleteError(null);
                          }}
                          disabled={deleteSubmitting}
                        >
                          ביטול
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeletingId(payment.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>

              {deleteError && isDeleting ? (
                <div className="mt-2 text-xs text-destructive">{deleteError}</div>
              ) : null}

              {!isRefund && payment.id && customerId ? (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <MorningDocumentsPanel
                    customerId={customerId}
                    orderId={orderId}
                    paymentId={payment.id}
                    documents={payment.morningDocuments}
                    allowReceipt
                    allowInvoiceReceipt
                    compact
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {editingPayment ? (
        <EditPaymentDialog
          payment={editingPayment}
          orderId={orderId}
          totalAmount={totalAmount}
          totalPaid={totalPaid}
          onClose={() => setEditingPayment(null)}
          onSaved={async () => {
            setEditingPayment(null);
            await refreshAndWait();
          }}
        />
      ) : null}
    </>
  );
}

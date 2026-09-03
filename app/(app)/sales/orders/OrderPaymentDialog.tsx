"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { nextMonthTenth } from "@/lib/payments";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import { offlineFetch } from "@/lib/offline-queue";

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
    minimumFractionDigits: 0,
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
  buttonClassName,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  onCreated?: (payload: {
    payment: CreatedPayment | null;
    paymentStatus: string;
    totalPaid: number;
  }) => void;
  buttonClassName?: string;
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
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
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
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    if (paymentMethod === "check" && !dueDate) {
      setError("יש להזין תאריך פירעון לצ'ק.");
      return;
    }

    function resetForm() {
      setAmount("");
      setEntryType(preview.nextRefund > 0 ? "refund" : "payment");
      setPaymentDate(getTodayDate());
      setPaymentMethod("");
      setAccountId("");
      setDueDate("");
      setReferenceNumber("");
      setCheckNumber("");
      setCheckPhotoFiles([]);
      setNotes("");
      setOpen(false);
    }

    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/orders/payments/create",
        {
          order_id: orderId,
          entry_type: entryType,
          amount_total: amountNumber,
          payment_date: paymentDate,
          payment_method: paymentMethod,
          account_id: accountId || undefined,
          due_date: dueDate.trim() || undefined,
          reference_number: referenceNumber.trim() || undefined,
          check_number: paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
          notes: notes.trim() || undefined,
        },
        entryType === "refund" ? "החזר להזמנה" : "תשלום להזמנה",
        { idempotent: true }
      );

      if (result.queued) {
        // Saved on the device; it will sync when the connection returns. Reflect
        // it optimistically so the order total updates now. (A check photo, if
        // any, can't be uploaded offline and will need re-attaching later.)
        onCreated?.({
          payment: null,
          paymentStatus: preview.nextStatus,
          totalPaid: preview.nextPaid,
        });
        resetForm();
        return;
      }

      if (!result.ok) {
        setError(toHebrewError(result.error, (entryType === "refund" ? "רישום ההחזר נכשל." : "עדכון התשלום נכשל.")));
        return;
      }

      const json = result.data as {
        payment?: CreatedPayment | null;
        payment_status?: string;
        total_paid?: number;
      } | null;

      const createdPaymentId = json?.payment?.id ?? "";
      if (paymentMethod === "check" && createdPaymentId && checkPhotoFiles.length > 0) {
        await uploadCheckPhotos(createdPaymentId, checkPhotoFiles);
      }

      onCreated?.({
        payment: json?.payment ?? null,
        paymentStatus: json?.payment_status ?? preview.nextStatus,
        totalPaid: typeof json?.total_paid === "number" ? json.total_paid : preview.nextPaid,
      });

      resetForm();
      router.refresh();
    } catch (err: unknown) {
      setError(toHebrewError(err, "שגיאה לא ידועה"));
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
        className={buttonClassName ?? "w-full sm:w-auto"}
        onClick={() => setOpen(true)}
      >
        עדכון תשלום
      </Button>

      <FormDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setEntryType(paidAmount > totalAmount ? "refund" : "payment");
          }
        }}
        title={entryType === "refund" ? "רישום החזר" : "עדכון תשלום"}
        description={
          entryType === "refund"
            ? "אפשר לרשום החזר ללקוח ולעדכן את יתרת ההזמנה."
            : "אפשר להוסיף תשלום נוסף להזמנה, גם אם היא משולמת בכמה חלקים ובכמה אמצעים."
        }
        onSubmit={() => void submitPayment()}
        submitLabel={entryType === "refund" ? "שמירת החזר" : "שמירת תשלום"}
        busyLabel="שומר..."
        busy={submitting}
        error={error || undefined}
      >

          <div className="grid gap-3">
            <div className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
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
              <NativeSelect
                value={entryType}
                onChange={(e) => setEntryType(e.target.value === "refund" ? "refund" : "payment")}
              >
                <option value="payment">תשלום</option>
                <option value="refund">החזר</option>
              </NativeSelect>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">{entryType === "refund" ? "סכום החזר *" : "סכום תשלום *"}</label>
                <CurrencyInput
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
              <NativeSelect
                value={paymentMethod}
                onChange={(e) => {
                  const m = e.target.value;
                  setPaymentMethod(m);
                  setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                  // Credit-card payments here always clear through Grow — default the
                  // settlement date so the ledger batches it without an extra click.
                  if (m === "credit_card") setDueDate((prev) => prev || nextMonthTenth(paymentDate));
                }}
              >
                <option value="">{entryType === "refund" ? "בחר אמצעי החזר..." : "בחר אמצעי תשלום..."}</option>
                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <AccountSelect
              required
              value={accountId}
              onChange={setAccountId}
              onLoaded={(list) => {
                setAccountsList(list);
                setAccountId((prev) => prev || defaultAccountForMethod(list, paymentMethod));
              }}
            />

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
                {paymentMethod === "credit_card" ? (
                  <button
                    type="button"
                    onClick={() => setDueDate(nextMonthTenth(paymentDate) || dueDate)}
                    className="rounded border border-input px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    מגיע דרך סליקה (גרואו) — 10 לחודש הבא
                  </button>
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          </div>
      </FormDialog>
    </>
  );
}

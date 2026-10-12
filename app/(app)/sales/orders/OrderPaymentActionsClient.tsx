"use client";
import { toHebrewError } from "@/lib/error-messages";
import { toast } from "sonner";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachIcon } from "@/components/ui/icons";
import { DocumentLink } from "@/components/ui/document-tile";
import { isImageDocument } from "@/lib/documents";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentCollectionChip,
  paymentMethodLabel,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import { offlineFetch } from "@/lib/offline-queue";
import { devicePaymentSaves } from "@/lib/payments/device-payment-saves";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { nextMonthTenth, parseInstallments, splitCardInstallments } from "@/lib/payments";
import { CardInstallmentsField } from "@/components/financial/CardInstallmentsField";
import type { MorningLocalDocument } from "@/lib/morning/types";
import type { FinancialAttachment } from "@/lib/payments";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { formatShortDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";

export type PaymentItem = {
  id: string;
  payment_date: string | null;
  amount_total: number;
  payment_method: string | null;
  payment_status: string | null;
  due_date: string | null;
  reference_number: string | null;
  check_number: string | null;
  account_id: string | null;
  notes: string | null;
  insertedByLabel: string | null;
  morningDocuments: MorningLocalDocument[];
  /** Its files — a check's photo. Null while they're still on their way (the
   *  phone's page gets them from the server after it shows). */
  files?: FinancialAttachment[] | null;
};

type Props = {
  orderId: string;
  customerId: string | null;
  totalAmount: number;
  payments: PaymentItem[];
  canManage: boolean;
};

// ₪ first, the dashboard's way (owner, 2026-10-11) — lib/money.ts. A refund
// is written "החזר" + its size, so no amount here is negative.
function formatCurrency(value: number) {
  return formatMoney(value);
}

// dd/mm/yy in Israel time, like every other date on the order page (the
// browser's he-IL format wrote 25.10.26, and in its own time zone).
function formatDate(value: string | null) {
  return formatShortDate(value, "");
}

/**
 * A payment's photo — a check's — and, for a check, the way to it on the
 * checks page (owner, 2026-10-05: it was a dead end: no photo, no link). A
 * check's line keeps its height while the photos are still on their way, so
 * the rows under it don't move when they arrive.
 */
function PaymentFilesLine({ payment, checksLink }: { payment: PaymentItem; checksLink: boolean }) {
  const isCheck = payment.payment_method === "check";
  const pending = payment.files === null;
  const files = (payment.files ?? []).filter((file) => file.url);
  const link = isCheck && checksLink && Boolean(payment.id);
  if (!link && files.length === 0 && !(isCheck && pending)) return null;
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 ${isCheck ? "min-h-12" : ""}`}>
      {pending ? <Skeleton className="h-12 w-16 rounded-md" /> : null}
      {/* Each opens as it did; הורדה follows it on hover (owner, 2026-10-12:
          "wherever there is a doc … a download option"). */}
      {files.map((file) =>
        isImageDocument(file) ? (
          <DocumentLink
            key={file.document_id}
            name={isCheck ? "צילום הצ׳ק" : (file.file_name ?? "קובץ")}
            fileName={file.file_name}
            url={file.url as string}
            className="block shrink-0 overflow-hidden rounded-md border border-border/70"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, not a static asset */}
            <img src={file.url ?? ""} alt={isCheck ? "צילום הצ׳ק" : (file.file_name ?? "קובץ")} className="h-12 w-16 object-cover" loading="lazy" />
          </DocumentLink>
        ) : (
          <DocumentLink
            key={file.document_id}
            name={file.file_name ?? "קובץ"}
            fileName={file.file_name}
            url={file.url as string}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-xs text-secondary hover:bg-accent"
          >
            <AttachIcon className="h-3 w-3" />
            קובץ
          </DocumentLink>
        )
      )}
      {link ? (
        <Link
          href={`/checks?focus=${encodeURIComponent(payment.id)}`}
          className="whitespace-nowrap text-xs font-medium text-secondary hover:underline"
        >
          לצ׳ק בדף הצ׳קים ←
        </Link>
      ) : null}
    </div>
  );
}

// Exported so the account register (app/(app)/financial/bank/BankClient.tsx)
// can reuse it directly for an order-tied `p:` ledger row's inline edit — same
// form, same /api/orders/payments/update endpoint (which keeps the order's
// payment_status in sync), no duplicated UI. The register fetches its own
// totalAmount/totalPaid via GET /api/payments/edit-context first, since it
// doesn't otherwise hold the order's other payments.
export function EditPaymentDialog({
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
  const [accountId, setAccountId] = useState(payment.account_id ?? "");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [dueDate, setDueDate] = useState(payment.due_date ?? "");
  const [referenceNumber, setReferenceNumber] = useState(payment.reference_number ?? "");
  const [checkNumber, setCheckNumber] = useState(payment.check_number ?? "");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState(payment.notes ?? "");
  // Splitting this payment into installments: it becomes the first, and the
  // rest are added a month apart.
  const [installments, setInstallments] = useState("1");
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
    if (accountsList.length > 0 && !accountId) {
      setError("יש לבחור חשבון לתנועה.");
      return;
    }
    if (paymentMethod === "check" && !dueDate) {
      setError("יש להזין תאריך פירעון לצ'ק.");
      return;
    }
    const isCardIncome = paymentMethod === "credit_card" && signedAmount > 0;
    const installmentCount = isCardIncome ? parseInstallments(installments) : 1;
    if (installmentCount === null) {
      setError("מספר התשלומים צריך להיות בין 1 ל-36.");
      return;
    }
    const [firstPart, ...moreParts] = isCardIncome
      ? splitCardInstallments({ amount: signedAmount, paymentDate, count: installmentCount, notes })
      : [{ amount: signedAmount, paymentDate, dueDate: "", notes: notes.trim() || null }];

    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/orders/payments/update",
        {
          id: payment.id,
          order_id: orderId,
          amount_total: firstPart.amount,
          payment_date: firstPart.paymentDate,
          payment_method: paymentMethod,
          account_id: accountId || undefined,
          // A card payment lands with the month's deposit — the 10th of the next
          // month (lib/card-settlements.ts). A refund leaves on its own day.
          due_date: isCardIncome ? nextMonthTenth(firstPart.paymentDate) || undefined : dueDate.trim() || undefined,
          reference_number: referenceNumber.trim() || undefined,
          check_number:
            paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
          notes: firstPart.notes || undefined,
        },
        "עדכון תשלום"
      );
      if (!result.queued && !result.ok) {
        setError(toHebrewError(result.error, "עדכון נכשל."));
        return;
      }
      // The other installments, as new payments on the same order.
      for (const [i, part] of moreParts.entries()) {
        const added = await offlineFetch(
          "/api/orders/payments/create",
          {
            order_id: orderId,
            entry_type: "payment",
            amount_total: part.amount,
            payment_date: part.paymentDate,
            payment_method: paymentMethod,
            account_id: accountId || undefined,
            due_date: part.dueDate || undefined,
            reference_number: referenceNumber.trim() || undefined,
            notes: part.notes || undefined,
          },
          "תשלום להזמנה",
          { idempotent: true }
        );
        if (!added.queued && !added.ok) {
          setError(`נרשמו ${i + 1} מתוך ${moreParts.length + 1} תשלומים. ${toHebrewError(added.error, "רישום שאר התשלומים נכשל.")}`);
          await onSaved();
          return;
        }
      }
      if (result.queued) {
        await onSaved();
        return;
      }
      if (paymentMethod === "check" && checkPhotoFiles.length > 0) {
        await uploadCheckPhotos(payment.id, checkPhotoFiles);
      }
      await onSaved();
    } catch (err) {
      setError(toHebrewError(err, "שגיאה לא ידועה"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="עריכת תשלום"
      description="עדכון פרטי תשלום קיים"
      onSubmit={() => void handleSubmit()}
      submitLabel="שמירת שינויים"
      busyLabel="שומר..."
      busy={submitting}
      error={error || undefined}
    >

        {/* The app's one label-over-input, Field, the required ones with its
            red "*" (owner, 2026-10-11). */}
        <div className="grid gap-3">
          <Field label="סוג פעולה">
            <NativeSelect
              value={entryType}
              onChange={(e) => setEntryType(e.target.value === "refund" ? "refund" : "payment")}
            >
              <option value="payment">תשלום</option>
              <option value="refund">החזר</option>
            </NativeSelect>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="סכום" required>
              <CurrencyInput
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="תאריך תשלום" required>
              <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
            </Field>
          </div>

          <Field label="אמצעי תשלום" required>
            <NativeSelect
              value={paymentMethod}
              onChange={(e) => {
                const m = e.target.value;
                setPaymentMethod(m);
                setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
              }}
            >
              <option value="">בחר אמצעי תשלום...</option>
              {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <AccountSelect
            required
            value={accountId}
            onChange={setAccountId}
            onLoaded={setAccountsList}
          />

          {paymentMethod === "credit_card" && signedAmount > 0 ? (
            <CardInstallmentsField
              value={installments}
              onChange={setInstallments}
              amount={Number.isFinite(amountNumber) ? amountNumber : 0}
              paymentDate={paymentDate}
              disabled={submitting}
            />
          ) : paymentMethod ? (
            <Field
              label={paymentMethod === "check" ? "תאריך פירעון" : "תאריך פירעון צפוי (אופציונלי)"}
              required={paymentMethod === "check"}
            >
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {paymentMethod !== "check" ? (
                <p className="text-[0.647rem] text-muted-foreground">
                  לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                </p>
              ) : null}
            </Field>
          ) : null}

          {paymentMethod === "check" ? (
            <CheckDetailsFields
              checkNumber={checkNumber}
              onCheckNumberChange={setCheckNumber}
              photoFiles={checkPhotoFiles}
              onPhotoFilesChange={setCheckPhotoFiles}
              existingPhotoUrls={(payment.files ?? [])
                .filter((file) => file.url && isImageDocument(file))
                .map((file) => file.url as string)}
              disabled={submitting}
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="מספר אסמכתא">
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="אופציונלי"
              />
            </Field>
            <Field label="הערות">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="אופציונלי"
              />
            </Field>
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

        </div>
    </FormDialog>
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
  const [items, setItems] = useState(payments);
  const [editingPayment, setEditingPayment] = useState<PaymentItem | null>(null);
  // The payment whose bin was pressed — asked about in the app's one confirm
  // dialog (owner, 2026-10-11: every delete asks through ConfirmDialog; this
  // was an inline "אשר מחיקה / ביטול" pair beside the bin).
  const [pendingDelete, setPendingDelete] = useState<PaymentItem | null>(null);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [, startRefreshTransition] = useTransition();

  // Keep the local list in sync when the server sends fresh data.
  useEffect(() => {
    setItems(payments);
  }, [payments]);

  // Reconcile server-derived data (order totals, Morning docs) in the
  // background — never blocks the instant local update the user already saw.
  function backgroundRefresh() {
    startRefreshTransition(() => {
      router.refresh();
    });
  }

  async function deletePayment(paymentId: string) {
    const snapshot = items;
    // Optimistic: remove the row immediately.
    setItems((prev) => prev.filter((p) => p.id !== paymentId));
    try {
      const result = await offlineFetch(
        "/api/orders/payments/delete",
        { id: paymentId, order_id: orderId },
        "מחיקת תשלום"
      );
      if (!result.queued && !result.ok) {
        setItems(snapshot); // rollback
        toast.error("מחיקת התשלום נכשלה", { description: toHebrewError(result.error, "") });
        return;
      }
      backgroundRefresh();
    } catch (err) {
      setItems(snapshot); // rollback
      toast.error("מחיקת התשלום נכשלה", { description: toHebrewError(err, "") });
    }
  }

  async function markCollected(paymentId: string, collected: boolean) {
    const nextStatus = collected ? "cleared" : "pending";
    const snapshot = items;
    // Optimistic: reflect the new collection status immediately.
    setItems((prev) =>
      prev.map((p) => (p.id === paymentId ? { ...p, payment_status: nextStatus } : p))
    );
    setCollectingId(paymentId);
    try {
      // On the phone first (lib/payments/device-payment-saves.ts): the order's
      // paid status follows at once, and the page drawn from the phone redraws
      // by itself — no refresh.
      const device = devicePaymentSaves("orders");
      if (device && (await device.markCollected(paymentId, collected))) return;
      const result = await offlineFetch(
        "/api/payments/mark-collected",
        { id: paymentId, collected },
        collected ? "סימון תשלום כנגבה" : "ביטול גבייה"
      );
      if (!result.queued && !result.ok) {
        setItems(snapshot); // rollback
        toast.error("עדכון הגבייה נכשל", { description: toHebrewError(result.error, "") });
        return;
      }
      backgroundRefresh();
    } finally {
      setCollectingId(null);
    }
  }

  const totalPaid = items.reduce((s, p) => s + p.amount_total, 0);

  if (items.length === 0) {
    // The app's one empty look, the dense box inside a card (owner, 2026-10-11).
    return <EmptyState dense>עדיין לא הוזנו תשלומים להזמנה זו.</EmptyState>;
  }

  return (
    <>
      <div className="space-y-2">
        {items.map((payment, index) => {
          const isRefund = payment.amount_total < 0;
          const collectionChip = paymentCollectionChip(payment);
          const isPending =
            typeof payment.payment_status === "string" &&
            payment.payment_status.trim().toLowerCase() === "pending";
          const isCollecting = collectingId === payment.id;

          return (
            <div
              key={payment.id || `payment-${index}`}
              className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
            >
              {/* The amount line shares its row with the buttons; the details run
                  the card's full width under it (beside the buttons they were
                  squeezed to a narrow column on a phone). */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className={`font-medium ${isRefund ? "text-warning-soft-foreground" : ""}`}>
                    {isRefund
                      ? `החזר ${formatCurrency(Math.abs(payment.amount_total))}`
                      : formatCurrency(payment.amount_total)}
                  </span>
                  <span className="text-muted-foreground">{formatDate(payment.payment_date)}</span>
                  {collectionChip ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[0.647rem] ${collectionChip.classes}`}>
                      {collectionChip.label}
                    </span>
                  ) : null}
                </div>

                {/* A short list inside the page: its pencil and bin stay in
                    view (owner, 2026-10-11). */}
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {isPending && !isRefund ? (
                      // 32px to look at, 44px to tap: the ::before reaches past
                      // its edges, as the call button does (contact-link.tsx).
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="relative h-8 text-xs before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']"
                        onClick={() => void markCollected(payment.id, true)}
                        disabled={isCollecting}
                      >
                        {isCollecting ? "מסמן..." : "סימון כנגבה"}
                      </Button>
                    ) : null}
                    <EditButton onClick={() => setEditingPayment(payment)} label="עריכה" />
                    <DeleteButton label="מחיקת תשלום" onClick={() => setPendingDelete(payment)} />
                  </div>
                ) : null}
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
              <PaymentFilesLine payment={payment} checksLink={canManage} />
              {payment.notes ? (
                <div className="mt-1 text-muted-foreground">הערות: {payment.notes}</div>
              ) : null}
              {payment.insertedByLabel ? (
                <div className="mt-1 text-muted-foreground">{payment.insertedByLabel}</div>
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
            backgroundRefresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        destructive
        title="מחיקת תשלום"
        description={
          pendingDelete
            ? `למחוק את ${pendingDelete.amount_total < 0 ? "ההחזר" : "התשלום"} של ${formatCurrency(
                Math.abs(pendingDelete.amount_total)
              )}${pendingDelete.payment_date ? ` מתאריך ${formatDate(pendingDelete.payment_date)}` : ""}? לא ניתן לשחזר.`
            : undefined
        }
        confirmLabel="מחיקה"
        onConfirm={() => {
          if (!pendingDelete) return;
          const paymentId = pendingDelete.id;
          // The row leaves at once (deletePayment is optimistic), so the
          // dialog closes with it rather than waiting on the server.
          setPendingDelete(null);
          void deletePayment(paymentId);
        }}
      />
    </>
  );
}

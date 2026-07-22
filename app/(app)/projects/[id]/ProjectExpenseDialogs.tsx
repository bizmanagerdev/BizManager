"use client";

// Lazy-loaded heavy financial-entry dialogs, extracted from ProjectTabsClient so
// their code only downloads when a user actually opens "add expense"/"add income".
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ORDER_PAYMENT_METHOD_OPTIONS } from "@/lib/orders/paymentStatus";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { toHebrewError } from "@/lib/error-messages";
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import { type FinancialAttachment, type PaymentRow } from "@/lib/payments";
import {
  getErrorMessage,
  isImageAttachment,
  projectDateOrToday,
  toNumber,
  uploadFinancialAttachment,
} from "./ProjectExpenseDialogs.helpers";
export function AddIncomeDialog({
  open,
  onOpenChange,
  projectId,
  projectType,
  projectStartDate,
  vatRate,
  priceIncludesVat,
  editingPayment,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectType: string | null;
  projectStartDate: string | null;
  vatRate: number;
  priceIncludesVat: boolean;
  editingPayment: PaymentRow | null;
  onSaved: (saved: PaymentRow) => void;
}) {
  const isEditing = Boolean(editingPayment);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const [paymentDateTouched, setPaymentDateTouched] = useState(false);
  const [paymentMethodTouched, setPaymentMethodTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(projectDateOrToday(projectStartDate));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentAccountsList, setPaymentAccountsList] = useState<Account[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [requiresSplit, setRequiresSplit] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);
  const requiresDueDate = paymentMethod === "check";
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(paymentDate) &&
    Boolean(paymentMethod.trim()) &&
    (!requiresDueDate || Boolean(dueDate));

  const amountNumber = Number(amount);
  const amountError =
    !amount.trim()
      ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4"
      : !Number.isFinite(amountNumber)
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05de\u05e1\u05e4\u05e8"
      : amountNumber <= 0
      ? "\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d4\u05d9\u05d5\u05ea \u05d2\u05d3\u05d5\u05dc \u05de-0"
      : null;
  const paymentDateError = !paymentDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const paymentMethodError = !paymentMethod.trim() ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;
  const dueDateError = requiresDueDate && !dueDate ? "\u05e9\u05d3\u05d4 \u05d7\u05d5\u05d1\u05d4" : null;

  const showAmountError = (submitAttempted || amountTouched) && Boolean(amountError);
  const showPaymentDateError =
    (submitAttempted || paymentDateTouched) && Boolean(paymentDateError);
  const showPaymentMethodError =
    (submitAttempted || paymentMethodTouched) && Boolean(paymentMethodError);

  const addIncomeValidationMessage = (() => {
    if (!submitAttempted || submitting || canSubmit) return "";
    const missing: string[] = [];
    if (amountError) missing.push("\u05e1\u05db\u05d5\u05dd");
    if (paymentDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da");
    if (paymentMethodError) missing.push("\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd");
    if (dueDateError) missing.push("\u05ea\u05d0\u05e8\u05d9\u05da \u05e4\u05d9\u05e8\u05e2\u05d5\u05df");
    return missing.length > 0
      ? `\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05de\u05d5\u05e8: ${missing.join(", ")}`
      : "";
  })();

  useEffect(() => {
    if (!open) return;
    setSubmitAttempted(false);
    setAmountTouched(false);
    setPaymentDateTouched(false);
    setPaymentMethodTouched(false);
    setAmount(
      editingPayment && toNumber(editingPayment.amount_total) !== null
        ? String(toNumber(editingPayment.amount_total))
        : ""
    );
    setPaymentDate(editingPayment?.payment_date ?? projectDateOrToday(projectStartDate));
    setPaymentMethod(editingPayment?.payment_method ?? "");
    setPaymentAccountId(editingPayment?.account_id ?? "");
    setDueDate(editingPayment?.due_date ?? "");
    setRequiresSplit(Boolean(editingPayment?.requires_split));
    setReferenceNumber(editingPayment?.reference_number ?? "");
    setCheckNumber(editingPayment?.check_number ?? "");
    setNotes(editingPayment?.notes ?? "");
    setAttachmentFiles([]);
    setExistingAttachments(Array.isArray(editingPayment?.attachments) ? editingPayment.attachments : []);
  }, [editingPayment, open, projectStartDate]);

  async function submit() {
    setSubmitAttempted(true);

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!paymentDate) return;
    if (!paymentMethod.trim()) return;
    if (paymentAccountsList.length > 0 && !paymentAccountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    if (paymentMethod === "check" && !dueDate) return;

    setSubmitting(true);
    try {
      const res = await fetch(isEditing ? "/api/payments/update" : "/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editingPayment?.id ?? undefined,
          business_domain: mapProjectTypeToExpenseDomain(projectType),
          project_id: projectId,
          amount_total: amountNumber,
          payment_date: paymentDate ? paymentDate : null,
          due_date: dueDate.trim() || null,
          // Price-includes-VAT projects always record payments in full.
          requires_split: priceIncludesVat ? false : requiresSplit,
          payment_method: paymentMethod.trim() ? paymentMethod : undefined,
          account_id: paymentAccountId || undefined,
          reference_number: referenceNumber.trim() ? referenceNumber : undefined,
          check_number:
            paymentMethod === "check" && checkNumber.trim() ? checkNumber.trim() : undefined,
          notes: notes.trim() ? notes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
          description: toHebrewError(json?.error, ""),
        });
        return;
      }
      const savedPayment = (json?.payment as PaymentRow | undefined) ?? editingPayment;
      if (!savedPayment?.id) {
        toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
          description: "Missing payment id",
        });
        return;
      }

      let paymentWithAttachment = savedPayment;
      const uploadedAttachments: FinancialAttachment[] = [];
      for (const file of attachmentFiles) {
        const attachment = await uploadFinancialAttachment("payment", savedPayment.id, file);
        if (attachment?.document_id) uploadedAttachments.push(attachment);
      }
      paymentWithAttachment = {
        ...savedPayment,
        attachments: [...existingAttachments, ...uploadedAttachments],
      };

      toast.success(isEditing ? "ההכנסה עודכנה" : "ההכנסה נוספה");
      setAmount("");
      setPaymentDate(projectDateOrToday(projectStartDate));
      setPaymentMethod("");
      setDueDate("");
      setRequiresSplit(false);
      setReferenceNumber("");
      setCheckNumber("");
      setNotes("");
      setAttachmentFiles([]);
      setExistingAttachments([]);
      onSaved(paymentWithAttachment);
    } catch (e: unknown) {
      toast.error(isEditing ? "שגיאה בעדכון ההכנסה" : "שגיאה בהוספת ההכנסה", {
        description: getErrorMessage(e),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "עריכת הכנסה" : "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05db\u05e0\u05e1\u05d4"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "עדכון פרטי ההכנסה של הפרויקט."
              : "\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05ea\u05d9\u05e8\u05e9\u05dd \u05db\u05ea\u05e7\u05d1\u05d5\u05dc \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="text-xs text-muted-foreground">
            {"\u05e9\u05d3\u05d5\u05ea \u05d4\u05de\u05e1\u05d5\u05de\u05e0\u05d9\u05dd \u05d1-* \u05d4\u05dd \u05e9\u05d3\u05d5\u05ea \u05d7\u05d5\u05d1\u05d4."}
          </div>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05e1\u05db\u05d5\u05dd *"}</div>
              <CurrencyInput
                inputMode="numeric"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                onBlur={() => setAmountTouched(true)}
                placeholder={"\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: 5000"}
                aria-invalid={showAmountError}
                className={
                  showAmountError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {showAmountError ? (
                <div className="text-xs text-destructive">{amountError}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05ea\u05d0\u05e8\u05d9\u05da *"}</div>
              <DateInput
                value={paymentDate}
                onChange={(e) => {
                  setPaymentDate(e.target.value);
                  setPaymentDateTouched(true);
                }}
                onBlur={() => setPaymentDateTouched(true)}
                aria-invalid={showPaymentDateError}
                className={
                  showPaymentDateError
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {showPaymentDateError ? (
                <div className="text-xs text-destructive">{paymentDateError}</div>
              ) : null}
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">{"\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd *"}</div>
              <select
                value={paymentMethod}
                onChange={(e) => {
                  const m = e.target.value;
                  setPaymentMethod(m);
                  setPaymentMethodTouched(true);
                  setPaymentAccountId((prev) => prev || defaultAccountForMethod(paymentAccountsList, m));
                }}
                onBlur={() => setPaymentMethodTouched(true)}
                aria-invalid={showPaymentMethodError}
                className={
                  showPaymentMethodError
                    ? "h-10 w-full rounded-md border border-destructive bg-background px-3 text-sm focus-visible:ring-destructive"
                    : "h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                }
              >
                <option value="">בחר אמצעי תשלום...</option>
                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {showPaymentMethodError ? (
                <div className="text-xs text-destructive">{paymentMethodError}</div>
              ) : null}
              {requiresDueDate ? (
                <div className="text-xs text-muted-foreground">
                  {"צ'ק נשמר כ\"ממתין לפירעון\" עד לתאריך הפירעון."}
                </div>
              ) : null}
            </div>
            <AccountSelect
              required
              value={paymentAccountId}
              onChange={setPaymentAccountId}
              onLoaded={(list) => {
                setPaymentAccountsList(list);
                setPaymentAccountId((prev) => prev || defaultAccountForMethod(list, paymentMethod));
              }}
            />
            <div className="space-y-1">
              <div className="text-sm font-medium">
                {requiresDueDate ? "תאריך פירעון *" : "תאריך פירעון צפוי (אופציונלי)"}
              </div>
              <DateInput
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-invalid={Boolean(dueDateError)}
                className={
                  dueDateError ? "border-destructive focus-visible:ring-destructive" : ""
                }
              />
              {dueDateError ? (
                <div className="text-xs text-destructive">{dueDateError}</div>
              ) : !requiresDueDate ? (
                <div className="text-[11px] text-muted-foreground">
                  לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                </div>
              ) : null}
            </div>
          </AdaptiveGrid>

          <AdaptiveGrid variant="formTwo">
            <div className="space-y-1">
              <div className="text-sm font-medium">אסמכתא (אופציונלי)</div>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="מספר קבלה/העברה"
              />
            </div>
            {requiresDueDate ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">מספר צ׳ק</div>
                <Input
                  value={checkNumber}
                  onChange={(e) => setCheckNumber(e.target.value)}
                  placeholder="לדוגמה 123456"
                  inputMode="numeric"
                />
                <div className="text-xs text-muted-foreground">
                  ניתן לצרף צילום של הצ&apos;ק במקטע &quot;קבצים מצורפים&quot; למטה.
                </div>
              </div>
            ) : null}
          </AdaptiveGrid>

          {priceIncludesVat ? (
            <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              מחיר הפרויקט כולל מע״מ — כל תשלום נזקף במלואו ליעד. אין צורך לסמן ״תשלום רשמי״.
            </div>
          ) : (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requiresSplit}
                  onChange={(e) => setRequiresSplit(e.target.checked)}
                />
                <span>תשלום רשמי (כולל מע״מ {Math.round(vatRate * 10000) / 100}%)</span>
              </label>
              {requiresSplit && Number.isFinite(Number(amount)) && Number(amount) > 0
                ? (() => {
                    const gross = Number(amount);
                    const net = Math.round((gross / (1 + vatRate)) * 100) / 100;
                    const vat = Math.round((gross - net) * 100) / 100;
                    const fmt = (n: number) =>
                      new Intl.NumberFormat("he-IL", {
                        style: "currency",
                        currency: "ILS",
                        minimumFractionDigits: 0,
    maximumFractionDigits: 2,
                      }).format(n);
                    return (
                      <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        מתוך {fmt(gross)} — <span className="font-medium text-foreground">{fmt(net)}</span> ייזקפו
                        למחיר הפרויקט · {fmt(vat)} מע״מ.
                      </div>
                    );
                  })()
                : null}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-sm font-medium">{"\u05d4\u05e2\u05e8\u05d5\u05ea (\u05d0\u05d5\u05e4\u05e6\u05d9\u05d5\u05e0\u05dc\u05d9)"}</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={"\u05d4\u05e2\u05e8\u05d5\u05ea..."}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
            <div className="flex items-center gap-2">
              <FileUploadActions
                files={attachmentFiles}
                multiple
                onFilesSelected={setAttachmentFiles}
                chooseLabel={attachmentFiles.length > 0 || existingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                chooseVariant="outline"
                size="sm"
              />
              {attachmentFiles.length > 0 ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                  נקה בחירה
                </Button>
              ) : null}
            </div>
            {existingAttachments.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                <div className="flex flex-wrap gap-2">
                  {existingAttachments.map((attachment) => (
                    <a
                      key={attachment.document_id}
                      href={attachment.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                    >
                      {attachment.file_name ?? "קובץ"}
                    </a>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {existingAttachments
                    .filter((attachment) => attachment.url && isImageAttachment(attachment))
                    .map((attachment) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${attachment.document_id}-preview`}
                        src={attachment.url ?? ""}
                        alt={attachment.file_name ?? "קובץ"}
                        className="h-20 w-20 rounded-lg border object-cover"
                      />
                    ))}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            {!canSubmit && !submitting ? (
              <div className="me-auto text-xs text-destructive">{addIncomeValidationMessage}</div>
            ) : (
              <div className="me-auto" />
            )}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {"\u05d1\u05d9\u05d8\u05d5\u05dc"}
            </Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? "\u05e9\u05d5\u05de\u05e8..." : isEditing ? "עדכון" : "\u05e9\u05de\u05d9\u05e8\u05d4"}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}


"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import LoadingDots from "@/app/sales/orders/LoadingDots";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import { formatShortDate } from "@/lib/date";

type OrderItem = {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  unit_price: number;
  discount_amount: number;
  notes: string;
};

type PaymentRow = {
  id: string;
  payment_date: string | null;
  amount_total: number;
  payment_method: string;
  reference_number: string;
  notes: string;
};

type DeliveryImage = {
  id: string;
  file_name: string | null;
  uploaded_at: string | null;
  url: string | null;
};

type EditPayload = {
  initialOrder: {
    id: string;
    customer_id: string;
    order_date: string;
    status: string;
    payment_status: string;
    discount_amount: number;
    notes: string;
    items: OrderItem[];
  };
  initialPayments: PaymentRow[];
  deliveryImages?: DeliveryImage[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  return formatShortDate(value);
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeQty(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.round(parsed));
}

function Section({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
          {step}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function OrderConfirmDialog({
  orderId,
  buttonLabel = "אישור אספקה",
  buttonClassName,
  title = "אישור אספקת הזמנה",
  description = "עדכון כמויות סופיות, תשלום, החזר והוכחת אספקה במסך אחד.",
  defaultStatus = "delivered",
}: {
  orderId: string;
  buttonLabel?: React.ReactNode;
  buttonClassName?: string;
  title?: string;
  description?: string;
  defaultStatus?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EditPayload | null>(null);
  const [lines, setLines] = useState<OrderItem[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [recordRefund, setRecordRefund] = useState(true);
  const [refundDate, setRefundDate] = useState(getTodayDate());
  const [refundMethod, setRefundMethod] = useState("");
  const [refundReferenceNumber, setRefundReferenceNumber] = useState("");
  const [refundNotes, setRefundNotes] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(getTodayDate());
  const [deliveryImages, setDeliveryImages] = useState<File[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/edit-data`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as EditPayload & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "טעינת נתוני האישור נכשלה.");
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "טעינת נתוני האישור נכשלה.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!data) return;
    setLines(data.initialOrder.items);
    setPaymentAmount("");
    setPaymentDate(getTodayDate());
    setPaymentMethod("");
    setReferenceNumber("");
    setPaymentNotes("");
    setRecordRefund(true);
    setRefundDate(getTodayDate());
    setRefundMethod("");
    setRefundReferenceNumber("");
    setRefundNotes("");
    setDeliveryNotes(data.initialOrder.notes ?? "");
    setDeliveryDate(getTodayDate());
    setDeliveryImages([]);
    setError(null);
  }, [data]);

  const existingPaid = useMemo(
    () => (data?.initialPayments ?? []).reduce((sum, payment) => sum + (payment.amount_total || 0), 0),
    [data]
  );

  const subtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) => sum + line.quantity_ordered * line.unit_price - line.discount_amount,
        0
      ),
    [lines]
  );

  const totalAmount = subtotal - (data?.initialOrder.discount_amount ?? 0);
  const paymentAmountNumber = Number(paymentAmount || 0);
  const pendingPaymentAmount = Number.isFinite(paymentAmountNumber) && paymentAmountNumber > 0 ? paymentAmountNumber : 0;
  const projectedPaid = existingPaid + pendingPaymentAmount;
  const projectedRemaining = Math.max(totalAmount - projectedPaid, 0);
  const refundDue = Math.max(projectedPaid - totalAmount, 0);
  const refundToRecord = recordRefund ? refundDue : 0;
  const finalPaidAfterRefund = projectedPaid - refundToRecord;
  const finalRemainingAfterRefund = Math.max(totalAmount - finalPaidAfterRefund, 0);
  const finalPaymentStatus = derivePaymentStatus(totalAmount, finalPaidAfterRefund);
  const projectedPaymentStatus = derivePaymentStatus(totalAmount, projectedPaid);
  const finalStatus = defaultStatus || "delivered";

  function updateQuantity(index: number, nextValue: string) {
    setLines((prev) =>
      prev.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity_ordered: normalizeQty(nextValue) } : line
      )
    );
  }

  async function submit() {
    if (!data || submitting) return;
    setError(null);

    if (lines.length === 0) {
      setError("לא ניתן לאשר הזמנה ללא פריטים.");
      return;
    }

    const invalidLine = lines.find((line) => !line.product_id || line.quantity_ordered <= 0);
    if (invalidLine) {
      setError("יש להשלים כמויות תקינות לכל הפריטים.");
      return;
    }

    if (pendingPaymentAmount > 0) {
      if (!paymentDate) {
        setError("יש לבחור תאריך תשלום.");
        return;
      }
      if (!paymentMethod) {
        setError("יש לבחור אמצעי תשלום.");
        return;
      }
    }

    if (refundDue > 0 && recordRefund) {
      if (!refundDate) {
        setError("יש לבחור תאריך החזר.");
        return;
      }
      if (!refundMethod) {
        setError("יש לבחור אמצעי החזר.");
        return;
      }
    }

    const invalidDeliveryImage = deliveryImages.find((file) => !file.type.startsWith("image/"));
    if (invalidDeliveryImage) {
      setError("ניתן לצרף רק קובץ תמונה.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        order_id: data.initialOrder.id,
        customer_id: data.initialOrder.customer_id,
        order_date: data.initialOrder.order_date,
        status: finalStatus,
        payment_status: finalPaymentStatus,
        delivery_date: deliveryDate || getTodayDate(),
        discount_amount: data.initialOrder.discount_amount,
        notes: deliveryNotes.trim(),
        items: lines.map((line) => ({
          product_id: line.product_id,
          quantity_ordered: line.quantity_ordered,
          unit_price: line.unit_price,
          discount_amount: line.discount_amount,
          notes: line.notes,
        })),
        payments:
          pendingPaymentAmount > 0
            ? [
                {
                  amount_total: pendingPaymentAmount,
                  payment_date: paymentDate,
                  payment_method: paymentMethod,
                  reference_number: referenceNumber.trim() || null,
                  notes: paymentNotes.trim() || null,
                },
              ]
            : [],
        refunds:
          refundDue > 0 && recordRefund
            ? [
                {
                  amount_total: refundDue,
                  payment_date: refundDate,
                  payment_method: refundMethod,
                  reference_number: refundReferenceNumber.trim() || null,
                  notes: refundNotes.trim() || null,
                },
              ]
            : [],
      };

      const formData = new FormData();
      formData.set("payload", JSON.stringify(payload));
      deliveryImages.forEach((image) => {
        formData.append("delivery_images", image);
      });

      const res = await fetch("/api/orders/update", {
        method: "POST",
        body: formData,
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "אישור ההזמנה נכשל.");
        return;
      }

      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "שגיאה לא ידועה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setError(null);
      }}
    >
      <Button type="button" size="sm" variant="outline" className={buttonClassName ?? "w-full sm:w-auto"} onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
      <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <LoadingDots
              label="טוען את פרטי ההזמנה"
              description="אוסף את הכמויות, התשלום והתמונות כדי שתוכלו לאשר אספקה בביטחון."
            />
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {data ? (
            <div className="space-y-5">
              <section className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">תאריך הזמנה</div>
                    <div className="mt-1 font-medium">{formatDate(data.initialOrder.order_date)}</div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">שולם עד עכשיו</div>
                    <div className="mt-1 font-medium">{formatCurrency(existingPaid)}</div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">סה״כ הזמנה מעודכן</div>
                    <div className="mt-1 font-medium">{formatCurrency(totalAmount)}</div>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                    <div className="text-xs text-muted-foreground">{refundDue > 0 ? "החזר נדרש" : "יתרה אחרי אישור"}</div>
                    <div className={`mt-1 font-medium ${refundDue > 0 ? "text-warning-soft-foreground" : ""}`}>
                      {formatCurrency(refundDue > 0 ? refundDue : projectedRemaining)}
                    </div>
                  </div>
                </div>
              </section>

              <Section step="1" title="כמויות סופיות" description="עדכן את הכמות שנמסרה בפועל לכל פריט.">
                <div className="space-y-2">
                  {lines.map((line, index) => {
                    const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
                    return (
                      <div
                        key={`${line.product_id}-${index}`}
                        className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-3 sm:grid-cols-[1fr_120px_140px]"
                      >
                        <div>
                          <div className="font-medium">{line.product_name}</div>
                          <div className="text-xs text-muted-foreground">מחיר יחידה: {formatCurrency(line.unit_price)}</div>
                          {line.notes ? <div className="mt-1 text-xs text-muted-foreground">הערות: {line.notes}</div> : null}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">כמות</label>
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={line.quantity_ordered}
                            onChange={(e) => updateQuantity(index, e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-medium">סה״כ שורה</div>
                          <div className="h-10 rounded-md border bg-muted/20 px-3 py-2 text-sm">{formatCurrency(lineTotal)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              <Section step="2" title="תשלום והחזר" description="רשום מה נגבה במסירה, ואם צריך גם החזר ללקוח.">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">אחרי התשלום הזה</span>
                      <span className={`rounded-full border px-2 py-1 text-xs ${paymentStatusClasses(projectedPaymentStatus)}`}>
                        {paymentStatusLabel(projectedPaymentStatus)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">שולם</span>
                      <span>{formatCurrency(projectedPaid)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{refundDue > 0 ? "החזר ללקוח" : "יתרה"}</span>
                      <span className={refundDue > 0 ? "font-medium text-warning-soft-foreground" : ""}>
                        {formatCurrency(refundDue > 0 ? refundDue : projectedRemaining)}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">סכום תשלום</label>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">תאריך תשלום</label>
                      <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">אמצעי תשלום</label>
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
                    <div className="space-y-1">
                      <label className="text-sm font-medium">אסמכתא</label>
                      <Input
                        value={referenceNumber}
                        onChange={(e) => setReferenceNumber(e.target.value)}
                        placeholder="אופציונלי"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">הערת תשלום</label>
                    <Input
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      placeholder="אופציונלי"
                    />
                  </div>

                  {refundDue > 0 ? (
                    <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning-soft/60 p-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={recordRefund} onChange={(e) => setRecordRefund(e.target.checked)} />
                        <span>לרשום החזר עכשיו</span>
                      </label>

                      <div className="text-sm">
                        סכום החזר: <span className="font-semibold text-warning-soft-foreground">{formatCurrency(refundDue)}</span>
                      </div>

                      {recordRefund ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-sm font-medium">תאריך החזר</label>
                              <DateInput value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm font-medium">אמצעי החזר</label>
                              <select
                                value={refundMethod}
                                onChange={(e) => setRefundMethod(e.target.value)}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                <option value="">בחר אמצעי החזר...</option>
                                {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                                  <option key={`refund-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-sm font-medium">אסמכתא להחזר</label>
                              <Input
                                value={refundReferenceNumber}
                                onChange={(e) => setRefundReferenceNumber(e.target.value)}
                                placeholder="אופציונלי"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm font-medium">הערת החזר</label>
                              <Input
                                value={refundNotes}
                                onChange={(e) => setRefundNotes(e.target.value)}
                                placeholder="למשל: הוחזר עקב שינוי בכמויות"
                              />
                            </div>
                          </div>

                          <div className="rounded-2xl border border-border/60 bg-background/80 p-3 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">אחרי רישום ההחזר</span>
                              <span className={`rounded-full border px-2 py-1 text-xs ${paymentStatusClasses(finalPaymentStatus)}`}>
                                {paymentStatusLabel(finalPaymentStatus)}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">שולם נטו</span>
                              <span>{formatCurrency(finalPaidAfterRefund)}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">יתרה</span>
                              <span>{formatCurrency(finalRemainingAfterRefund)}</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-warning-soft-foreground">ההחזר לא יירשם במערכת עד שתסמן ותמלא פרטי החזר.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section step="3" title="הוכחת אספקה" description="צרף תמונות ועדכן הערות מסירה.">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">תאריך אספקה</label>
                    <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
                    <p className="text-xs text-muted-foreground">התאריך שבו אושרה האספקה בפועל.</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">העלאת תמונה</label>
                    <FileUploadActions
                      files={deliveryImages}
                      accept="image/*"
                      multiple
                      onFilesSelected={setDeliveryImages}
                      chooseLabel="בחר תמונות"
                      className="flex-wrap"
                    />
                    <p className="text-xs text-muted-foreground">
                      אפשר לצרף הוכחת אספקה חדשה בלי למחוק תמונות קיימות.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium">הערות אספקה</label>
                    <Textarea
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      rows={4}
                      placeholder="הערות למסירה, חוסרים, מצב אספקה..."
                    />
                  </div>

                  {(data.deliveryImages ?? []).length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">תמונות קיימות</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(data.deliveryImages ?? []).map((image) => (
                          <a
                            key={image.id}
                            href={image.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-border/70 bg-background/70 p-2 text-sm"
                          >
                            {image.url ? (
                              <img
                                src={image.url}
                                alt={image.file_name ?? "Delivery image"}
                                className="mb-2 h-32 w-full rounded object-cover"
                              />
                            ) : null}
                            <div className="font-medium">{image.file_name ?? "תמונה"}</div>
                            <div className="text-xs text-muted-foreground">{formatDate(image.uploaded_at)}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section step="4" title="אישור" description="האישור יעדכן את המלאי, התשלום, ההחזר והסטטוס להזמנה שסופקה.">
                <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">סטטוס אחרי שמירה</span>
                    <span className="font-medium">סופקה</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">סטטוס תשלום</span>
                    <span className={`rounded-full border px-2 py-1 text-xs ${paymentStatusClasses(finalPaymentStatus)}`}>
                      {paymentStatusLabel(finalPaymentStatus)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">שולם נטו</span>
                    <span>{formatCurrency(finalPaidAfterRefund)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">יתרה</span>
                    <span>{formatCurrency(finalRemainingAfterRefund)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">תמונות חדשות</span>
                    <span>{deliveryImages.length}</span>
                  </div>
                </div>
              </Section>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || loading || !data}>
            {submitting ? "שומר..." : "אישור אספקה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

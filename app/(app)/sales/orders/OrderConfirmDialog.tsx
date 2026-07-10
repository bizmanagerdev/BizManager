"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Delete, Trash2, Truck } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { Button } from "@/components/ui/button";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
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
import { Textarea } from "@/components/ui/textarea";
import LoadingDots from "@/app/(app)/sales/orders/LoadingDots";
import {
  ORDER_PAYMENT_METHOD_OPTIONS,
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
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

type ProductSearchResult = {
  id: string;
  name: string;
  sku: string | null;
  base_price: number | null;
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

// Paid-amount line: green once the order is fully paid, red while a balance remains.
function paidAmountClass(status: string) {
  return status === "paid"
    ? "font-semibold text-success-soft-foreground"
    : "font-semibold text-destructive-soft-foreground";
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeQty(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.round(parsed));
}


// Wizard step headings — eyebrow ("שלב N · <eyebrow>") + the big question title.
const STEP_META: Record<string, { eyebrow: string; title: string; description?: string }> = {
  items: { eyebrow: "פריטים סופיים", title: "מה נמסר בפועל?", description: "עדכן כמויות, הסר או הוסף מוצרים שסופקו." },
  paidChoice: { eyebrow: "תשלום", title: "האם נגבה תשלום במסירה?" },
  amount: { eyebrow: "תשלום", title: "כמה נגבה במסירה?" },
  paymentDate: { eyebrow: "תשלום", title: "מתי שולם?" },
  paymentMethod: { eyebrow: "תשלום", title: "באיזה אמצעי תשלום?" },
  paymentAccount: { eyebrow: "תשלום", title: "לאיזה חשבון נכנס התשלום?" },
  reference: { eyebrow: "תשלום", title: "אסמכתא", description: "אופציונלי — מספר קבלה/אסמכתא." },
  paymentNotes: { eyebrow: "תשלום", title: "הערת תשלום", description: "אופציונלי." },
  refund: { eyebrow: "החזר", title: "רישום החזר ללקוח", description: "נגבה יותר מסכום ההזמנה." },
  deliveryDate: { eyebrow: "הוכחת אספקה", title: "מתי סופק?", description: "התאריך שבו אושרה האספקה בפועל." },
  images: { eyebrow: "הוכחת אספקה", title: "צירוף תמונות", description: "צלם או העלה הוכחת אספקה." },
  comments: { eyebrow: "הערות אספקה", title: "הערות למסירה", description: "חוסרים, מצב אספקה, כל דבר שכדאי לתעד." },
  review: { eyebrow: "אישור", title: "לאשר את האספקה?", description: "בדוק את הסיכום ואשר. המלאי, התשלום והסטטוס יתעדכנו." },
};

export default function OrderConfirmDialog({
  orderId,
  buttonLabel = "אישור אספקה",
  buttonClassName,
  buttonVariant = "outline",
  title = "אישור אספקת הזמנה",
  description = "עדכון כמויות סופיות, תשלום, החזר והוכחת אספקה במסך אחד.",
  defaultStatus = "delivered",
  customerName,
}: {
  orderId: string;
  buttonLabel?: React.ReactNode;
  buttonClassName?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  title?: string;
  description?: string;
  defaultStatus?: string;
  customerName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepId, setStepId] = useState("items");
  const [paidNow, setPaidNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EditPayload | null>(null);
  const [lines, setLines] = useState<OrderItem[]>([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getTodayDate());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
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
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const [productSearching, setProductSearching] = useState(false);

  // Debounced product search so products can be added (not just quantities edited).
  useEffect(() => {
    if (!open) return;
    const query = productQuery.trim();
    if (!query) {
      setProductResults([]);
      setProductSearching(false);
      return;
    }
    setProductSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}&limit=20`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as { products?: ProductSearchResult[] };
        setProductResults(Array.isArray(json.products) ? json.products : []);
      } catch {
        setProductResults([]);
      } finally {
        setProductSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open, productQuery]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/edit-data`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as EditPayload & { error?: string };
        if (!res.ok) throw new Error(toHebrewError(json.error, "טעינת נתוני האישור נכשלה."));
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(toHebrewError(err, "טעינת נתוני האישור נכשלה."));
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
    setPaymentAccountId("");
    setRefundAccountId("");
    setDeliveryNotes(data.initialOrder.notes ?? "");
    setDeliveryDate(getTodayDate());
    setDeliveryImages([]);
    setProductQuery("");
    setProductResults([]);
    setStepId("items");
    setPaidNow(false);
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
  const refundDue = Math.max(projectedPaid - totalAmount, 0);
  const refundToRecord = recordRefund ? refundDue : 0;
  const finalPaidAfterRefund = projectedPaid - refundToRecord;
  const finalRemainingAfterRefund = Math.max(totalAmount - finalPaidAfterRefund, 0);
  const finalPaymentStatus = derivePaymentStatus(totalAmount, finalPaidAfterRefund);
  const finalStatus = defaultStatus || "delivered";

  function updateQuantity(index: number, nextValue: string) {
    setLines((prev) =>
      prev.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity_ordered: normalizeQty(nextValue) } : line
      )
    );
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, lineIndex) => lineIndex !== index));
  }

  function addProduct(product: ProductSearchResult) {
    setLines((prev) => {
      const existingIndex = prev.findIndex((line) => line.product_id === product.id);
      if (existingIndex >= 0) {
        return prev.map((line, lineIndex) =>
          lineIndex === existingIndex
            ? { ...line, quantity_ordered: line.quantity_ordered + 1 }
            : line
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          quantity_ordered: 1,
          unit_price: product.base_price ?? 0,
          discount_amount: 0,
          notes: "",
        },
      ];
    });
    setProductQuery("");
    setProductResults([]);
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
      if (accountsList.length > 0 && !paymentAccountId) {
        setError("יש לבחור חשבון לתשלום.");
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
      if (accountsList.length > 0 && !refundAccountId) {
        setError("יש לבחור חשבון להחזר.");
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
      const orderId = data.initialOrder.id;

      const payload = {
        order_id: orderId,
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
                  account_id: paymentAccountId || null,
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
                  account_id: refundAccountId || null,
                  reference_number: refundReferenceNumber.trim() || null,
                  notes: refundNotes.trim() || null,
                },
              ]
            : [],
      };

      // Goes through offlineUpload so a confirm taken on a poor/no connection is
      // saved to the device and replayed on reconnect instead of hanging or
      // being lost. orders/update is idempotency-guarded, so a replay can't
      // double-insert payments or re-consume stock. ConnectionToasts announces
      // the queued/synced state globally.
      const result = await offlineUpload("/api/orders/update", {
        fields: { payload: JSON.stringify(payload) },
        files: deliveryImages.map((image) => ({ fieldName: "delivery_images", file: image })),
        label: "אישור האספקה",
      });

      if (result.queued) {
        setOpen(false);
        return;
      }

      if (!result.ok) {
        // The client handles this failure, so it never reaches Sentry on its own —
        // report it with the real server message + status. That's what was missing
        // when this only surfaced as a screenshot of "אישור ההזמנה נכשל".
        Sentry.captureMessage("order confirm failed", {
          level: "error",
          tags: { area: "order-confirm" },
          extra: { orderId, status: result.status, serverError: result.error },
        });
        const fallback =
          result.status === 413
            ? "הקבצים שצורפו גדולים מדי. צמצמו את מספר התמונות ונסו שוב."
            : result.status === 504 || result.status === 408
              ? "השרת לא הגיב בזמן. נסו שוב."
              : "אישור ההזמנה נכשל.";
        setError(result.error || fallback);
        return;
      }

      setOpen(false);
      router.refresh();
    } catch (err: unknown) {
      Sentry.captureException(err, { tags: { area: "order-confirm" } });
      setError(toHebrewError(err, "שגיאה לא ידועה"));
    } finally {
      setSubmitting(false);
    }
  }

  // Steps are a dynamic list of string IDs — choosing "paid" splits each payment
  // field into its own step, and an overpayment inserts a refund step.
  const steps = useMemo(() => {
    const s: string[] = ["items", "paidChoice"];
    if (paidNow) {
      s.push("amount", "paymentDate", "paymentMethod");
      if (accountsList.length > 0) s.push("paymentAccount");
      s.push("reference", "paymentNotes");
    }
    if (refundDue > 0) s.push("refund");
    s.push("deliveryDate", "images", "comments", "review");
    return s;
  }, [paidNow, accountsList.length, refundDue]);

  const stepIndex = Math.max(0, steps.indexOf(stepId));
  const currentStepId = steps[stepIndex] ?? "items";
  const isLastStep = currentStepId === "review";
  const progress = ((stepIndex + 1) / steps.length) * 100;

  // Navigation reads the latest step list via refs, because a choice mid-flow
  // (paid? / overpayment) reshapes the array between render and click.
  const stepsRef = useRef(steps);
  const stepIdRef = useRef(currentStepId);
  useEffect(() => {
    stepsRef.current = steps;
    stepIdRef.current = currentStepId;
  });

  function stepError(id: string): string | null {
    switch (id) {
      case "items":
        if (lines.length === 0) return "לא ניתן לאשר הזמנה ללא פריטים.";
        if (lines.some((line) => !line.product_id || line.quantity_ordered <= 0)) {
          return "יש להשלים כמויות תקינות לכל הפריטים.";
        }
        return null;
      case "amount":
        if (!(pendingPaymentAmount > 0)) return "יש להזין סכום תשלום.";
        return null;
      case "paymentDate":
        if (!paymentDate) return "יש לבחור תאריך תשלום.";
        return null;
      case "paymentMethod":
        if (!paymentMethod) return "יש לבחור אמצעי תשלום.";
        return null;
      case "paymentAccount":
        if (accountsList.length > 0 && !paymentAccountId) return "יש לבחור חשבון לתשלום.";
        return null;
      case "refund":
        if (recordRefund) {
          if (!refundDate) return "יש לבחור תאריך החזר.";
          if (!refundMethod) return "יש לבחור אמצעי החזר.";
          if (accountsList.length > 0 && !refundAccountId) return "יש לבחור חשבון להחזר.";
        }
        return null;
      case "images":
        if (deliveryImages.some((file) => !file.type.startsWith("image/"))) {
          return "ניתן לצרף רק קובץ תמונה.";
        }
        return null;
      default:
        return null;
    }
  }

  function goTo(delta: 1 | -1) {
    const arr = stepsRef.current;
    const cur = arr.indexOf(stepIdRef.current);
    const base = cur < 0 ? 0 : cur;
    const next = Math.max(0, Math.min(arr.length - 1, base + delta));
    setStepId(arr[next]);
  }
  function goNext() {
    const err = stepError(stepIdRef.current);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    goTo(1);
  }
  function goBack() {
    setError(null);
    goTo(-1);
  }
  function choosePaid(value: boolean) {
    setPaidNow(value);
    if (!value) setPaymentAmount("");
    setError(null);
    // Let the reshaped step list settle before advancing off this step.
    window.setTimeout(() => goTo(1), 120);
  }

  function renderStepContent() {
    if (!data) return null;
    switch (currentStepId) {
      case "items":
        return (
          <div className="space-y-2">
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין פריטים — הוסף מוצר כדי לאשר אספקה.</p>
            ) : null}
            {lines.map((line, index) => {
              const lineTotal = line.quantity_ordered * line.unit_price - line.discount_amount;
              return (
                <div
                  key={`${line.product_id}-${index}`}
                  className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-3 sm:grid-cols-[1fr_120px_140px_40px]"
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
                  <div className="flex items-end justify-end sm:pb-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-9 w-9 p-0"
                      title="הסרת מוצר"
                      aria-label="הסרת מוצר"
                      onClick={() => removeLine(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="space-y-2 border-t border-border/60 pt-3">
              <label className="text-sm font-medium">הוספת מוצר</label>
              <Input
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                placeholder="חיפוש מוצר לפי שם, מק״ט או ברקוד..."
              />
              {productSearching ? <p className="text-xs text-muted-foreground">מחפש...</p> : null}
              {!productSearching && productQuery.trim() && productResults.length === 0 ? (
                <p className="text-xs text-muted-foreground">לא נמצאו מוצרים.</p>
              ) : null}
              {productResults.length > 0 ? (
                <div className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/70 bg-background/70">
                  {productResults.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-muted/40"
                      onClick={() => addProduct(product)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{product.name}</span>
                        {product.sku ? (
                          <span className="block text-xs text-muted-foreground">מק״ט: {product.sku}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(product.base_price ?? 0)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      case "paidChoice":
        return (
          <div className="mx-auto flex max-w-sm flex-col gap-2">
            <button
              type="button"
              onClick={() => choosePaid(true)}
              className={`rounded-xl border p-4 text-center text-sm font-semibold transition-colors ${paidNow ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}
            >
              כן, נגבה תשלום
            </button>
            <button
              type="button"
              onClick={() => choosePaid(false)}
              className={`rounded-xl border p-4 text-center text-sm font-semibold transition-colors ${!paidNow ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted"}`}
            >
              לא נגבה תשלום
            </button>
          </div>
        );
      case "amount": {
        const outstanding = Math.max(totalAmount - existingPaid, 0);
        const appendDigit = (d: string) =>
          setPaymentAmount((prev) => {
            if (d === ".") {
              if (prev.includes(".")) return prev;
              return (prev || "0") + ".";
            }
            if (prev === "0") return d;
            return prev + d;
          });
        const backspace = () => setPaymentAmount((prev) => prev.slice(0, -1));
        const quickClass =
          "rounded-lg border border-input bg-background py-1 text-xs font-semibold transition-colors hover:bg-muted";
        const padClass =
          "flex items-center justify-center rounded-lg border border-input bg-background py-1.5 text-base font-semibold transition-colors hover:bg-muted";
        return (
          <div className="mx-auto max-w-xs space-y-1.5">
            <p className="text-xs text-muted-foreground">
              יתרה לתשלום:{" "}
              <span className="font-semibold text-foreground">{formatCurrency(outstanding)}</span> · אפשר להשאיר 0
            </p>
            {/* Amount hero — ₪ on the right with the amount right next to it */}
            <div className="flex items-baseline justify-start gap-2 rounded-lg border border-border/60 bg-muted/10 px-4 py-1.5">
              <span className="text-lg text-muted-foreground">₪</span>
              <span className="text-2xl font-bold tabular-nums">{paymentAmount || "0"}</span>
            </div>
            {/* Quick amounts */}
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" className={quickClass} onClick={() => setPaymentAmount(String(outstanding))}>
                הכל
              </button>
              <button
                type="button"
                className={quickClass}
                onClick={() => setPaymentAmount(String(Math.round((outstanding / 2) * 100) / 100))}
              >
                חצי
              </button>
              <button type="button" className={quickClass} onClick={() => setPaymentAmount("")}>
                לא שולם
              </button>
            </div>
            {/* Keypad */}
            <div className="grid grid-cols-3 gap-1">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className={padClass} onClick={() => appendDigit(d)}>
                  {d}
                </button>
              ))}
              <button type="button" className={padClass} onClick={() => appendDigit(".")}>
                .
              </button>
              <button type="button" className={padClass} onClick={() => appendDigit("0")}>
                0
              </button>
              <button type="button" className={padClass} aria-label="מחיקה" onClick={backspace}>
                <Delete className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      }
      case "paymentDate":
        return (
          <div className="mx-auto max-w-xs space-y-1">
            <label className="text-sm font-medium">תאריך תשלום</label>
            <DateInput value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
        );
      case "paymentMethod":
        return (
          <div className="mx-auto max-w-xs space-y-1">
            <label className="text-sm font-medium">אמצעי תשלום</label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                const m = e.target.value;
                setPaymentMethod(m);
                setPaymentAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
              }}
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
        );
      case "paymentAccount":
        return (
          <div className="mx-auto max-w-xs">
            <AccountSelect
              required
              value={paymentAccountId}
              onChange={setPaymentAccountId}
              onLoaded={(list) => {
                setAccountsList(list);
                setPaymentAccountId((prev) => prev || defaultAccountForMethod(list, paymentMethod));
              }}
            />
          </div>
        );
      case "reference":
        return (
          <div className="mx-auto max-w-xs space-y-1">
            <label className="text-sm font-medium">אסמכתא</label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="אופציונלי" />
          </div>
        );
      case "paymentNotes":
        return (
          <div className="mx-auto max-w-xs space-y-1">
            <label className="text-sm font-medium">הערת תשלום</label>
            <Input value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="אופציונלי" />
          </div>
        );
      case "refund":
        return (
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
                      onChange={(e) => {
                        const m = e.target.value;
                        setRefundMethod(m);
                        setRefundAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                      }}
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
                  <AccountSelect
                    required
                    value={refundAccountId}
                    onChange={setRefundAccountId}
                    onLoaded={(list) => {
                      setAccountsList(list);
                      setRefundAccountId((prev) => prev || defaultAccountForMethod(list, refundMethod));
                    }}
                  />
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
              </>
            ) : (
              <div className="text-xs text-warning-soft-foreground">ההחזר לא יירשם במערכת עד שתסמן ותמלא פרטי החזר.</div>
            )}
          </div>
        );
      case "deliveryDate":
        return (
          <div className="mx-auto max-w-xs space-y-1">
            <label className="text-sm font-medium">תאריך אספקה</label>
            <DateInput value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
        );
      case "images":
        return (
          <div className="space-y-4">
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
              <p className="text-xs text-muted-foreground">אפשר לצרף הוכחת אספקה חדשה בלי למחוק תמונות קיימות.</p>
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
        );
      case "comments":
        return (
          <div className="space-y-1">
            <label className="text-sm font-medium">הערות אספקה</label>
            <Textarea
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              rows={5}
              placeholder="הערות למסירה, חוסרים, מצב אספקה..."
            />
          </div>
        );
      case "review":
        return (
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
              <span className={paidAmountClass(finalPaymentStatus)}>{formatCurrency(finalPaidAfterRefund)}</span>
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
        );
      default:
        return null;
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
      <Button type="button" size="sm" variant={buttonVariant} className={buttonClassName ?? "w-full sm:w-auto"} onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
      <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden p-3 sm:p-4">
        <DialogHeader className="space-y-1.5">
          <div className="flex items-center gap-2 pe-8">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Truck className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{customerName ? customerName : title}</span>
            </DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {stepIndex + 1} / {steps.length}
            </span>
          </div>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
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
            <div className="space-y-2">
              {/* Question header for the current step */}
              <div>
                <h2 className="text-base font-bold leading-tight">{STEP_META[currentStepId]?.title}</h2>
                {STEP_META[currentStepId]?.description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{STEP_META[currentStepId]?.description}</p>
                ) : null}
              </div>

              {renderStepContent()}

              {/* Hidden loader so the accounts list is known before the account step */}
              <div className="hidden">
                <AccountSelect
                  value={paymentAccountId}
                  onChange={setPaymentAccountId}
                  onLoaded={(list) => setAccountsList(list)}
                />
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="mt-2 flex-row justify-between gap-2 border-t pt-2">
          {stepIndex > 0 ? (
            <Button type="button" size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={goBack} disabled={submitting}>
              <ChevronRight className="h-4 w-4" />
              חזרה
            </Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" className="flex-1 sm:flex-none" onClick={() => setOpen(false)} disabled={submitting}>
              ביטול
            </Button>
          )}
          {isLastStep ? (
            <Button type="button" size="sm" className="flex-1 sm:flex-none" onClick={() => void submit()} disabled={submitting || loading || !data}>
              {submitting ? (
                "שומר..."
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  אישור אספקה
                </>
              )}
            </Button>
          ) : (
            <Button type="button" size="sm" className="flex-1 sm:flex-none" onClick={goNext} disabled={loading || !data}>
              הבא
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

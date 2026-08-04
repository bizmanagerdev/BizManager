"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, MapPin } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { offlineUpload } from "@/lib/offline-upload";
import { toHebrewError } from "@/lib/error-messages";
import { DateInput } from "@/components/ui/date-input";
import { StepWizardDialog } from "@/components/ui/step-wizard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPin, pinFrom, type DeliveryPin } from "@/lib/delivery-location";
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
import { appendOrderComment, formatOrderCommentTimestamp } from "@/lib/orders/comments";

type OrderItem = {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  /** How much of this line has already been delivered in prior partial deliveries. */
  quantity_delivered: number;
  unit_price: number;
  discount_amount: number;
  notes: string;
};

/** An order line plus the quantity being delivered in THIS confirmation. */
type ConfirmLine = OrderItem & { delivered_now: number };

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
    minimumFractionDigits: 0,
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

// Wizard step headings — eyebrow ("שלב N · <eyebrow>") + the big question title.
const STEP_META: Record<string, { eyebrow: string; title: string; description?: string }> = {
  items: { eyebrow: "כמות שנמסרה", title: "מה נמסר בפועל?", description: "סמן כמה נמסר מכל פריט. מה שלא נמסר יישאר פתוח למשלוח." },
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
  arrival: {
    eyebrow: "פרטי הגעה",
    title: "איך מגיעים למקום?",
    description: "נשמר על הלקוח לכל מסירה עתידית — לא על ההזמנה הזו.",
  },
  review: { eyebrow: "אישור", title: "לאשר את האספקה?", description: "בדוק את הסיכום ואשר. המלאי, התשלום והסטטוס יתעדכנו." },
};

export default function OrderConfirmDialog({
  orderId,
  buttonLabel = "אישור אספקה",
  buttonClassName,
  buttonVariant = "outline",
  title = "אישור אספקת הזמנה",
  description = "עדכון כמויות שנמסרו, תשלום, החזר והוכחת אספקה במסך אחד.",
  customerName,
  authorName,
}: {
  orderId: string;
  buttonLabel?: React.ReactNode;
  buttonClassName?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  title?: string;
  description?: string;
  customerName?: string | null;
  /** Who's confirming — used to attribute the delivery note in the order thread. */
  authorName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stepId, setStepId] = useState("items");
  const [paidNow, setPaidNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EditPayload | null>(null);
  const [lines, setLines] = useState<ConfirmLine[]>([]);
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
  // Arrival details are about the PLACE, so they save on the customer, not here.
  const [arrivalInstructions, setArrivalInstructions] = useState("");
  const [arrivalPin, setArrivalPin] = useState<DeliveryPin | null>(null);
  const [capturingPin, setCapturingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  // What the customer had when we opened — so we only write on an actual change.
  const [initialArrival, setInitialArrival] = useState<{
    instructions: string;
    pin: DeliveryPin | null;
  }>({ instructions: "", pin: null });

  function captureArrivalPin() {
    if (!navigator.geolocation) {
      setPinError("המכשיר הזה לא תומך באיתור מיקום.");
      return;
    }
    setCapturingPin(true);
    setPinError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setArrivalPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setCapturingPin(false);
      },
      (geoError) => {
        setCapturingPin(false);
        // Name the permission case — "failed" sends people looking for a bug when
        // the browser is simply waiting to be allowed.
        setPinError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "הגישה למיקום נחסמה. אפשרו מיקום לאתר בהגדרות הדפדפן."
            : "לא הצלחנו לקבוע את המיקום."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
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
    // Default each line's "delivered now" to whatever is still owed, so the common
    // "delivered everything" case is already filled in.
    setLines(
      data.initialOrder.items.map((item) => ({
        ...item,
        delivered_now: Math.max(item.quantity_ordered - Math.max(item.quantity_delivered || 0, 0), 0),
      }))
    );
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
    // Start EMPTY: this box is a NEW delivery note, not the existing order thread.
    // Seeding it from data.initialOrder.notes (which is the attributed comment log)
    // and writing it back on confirm used to overwrite the whole thread.
    setDeliveryNotes("");
    setDeliveryDate(getTodayDate());
    setDeliveryImages([]);
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

  // Seed the arrival fields from whatever this customer already has saved, so
  // the driver edits the standing directions instead of silently blanking them.
  const arrivalCustomerId = data?.initialOrder.customer_id ?? "";
  useEffect(() => {
    if (!open || !arrivalCustomerId) return;
    let active = true;
    void fetch(`/api/customers/delivery-location?customer_id=${encodeURIComponent(arrivalCustomerId)}`, {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { instructions?: string | null; lat?: number | null; lng?: number | null } | null) => {
        if (!active || !json) return;
        const pin = pinFrom(json.lat, json.lng);
        setArrivalInstructions(json.instructions ?? "");
        setArrivalPin(pin);
        setInitialArrival({ instructions: json.instructions ?? "", pin });
      })
      .catch(() => {
        /* offline — the driver can still type directions, they just start empty */
      });
    return () => {
      active = false;
    };
  }, [open, arrivalCustomerId]);

  // Only write the arrival details when they actually changed, so an untouched
  // step can't blank out standing directions.
  const arrivalChanged =
    arrivalInstructions.trim() !== (initialArrival.instructions ?? "") ||
    arrivalPin?.lat !== initialArrival.pin?.lat ||
    arrivalPin?.lng !== initialArrival.pin?.lng;

  const totalAmount = subtotal - (data?.initialOrder.discount_amount ?? 0);
  const paymentAmountNumber = Number(paymentAmount || 0);
  const pendingPaymentAmount = Number.isFinite(paymentAmountNumber) && paymentAmountNumber > 0 ? paymentAmountNumber : 0;
  const projectedPaid = existingPaid + pendingPaymentAmount;
  const refundDue = Math.max(projectedPaid - totalAmount, 0);
  const refundToRecord = recordRefund ? refundDue : 0;
  const finalPaidAfterRefund = projectedPaid - refundToRecord;
  const finalRemainingAfterRefund = Math.max(totalAmount - finalPaidAfterRefund, 0);
  const finalPaymentStatus = derivePaymentStatus(totalAmount, finalPaidAfterRefund);

  // Per-line delivery math: what was already delivered, what's still owed, and how
  // much is being delivered in THIS confirmation (clamped to the remaining qty).
  const deliveryLines = useMemo(
    () =>
      lines.map((line) => {
        const already = Math.max(line.quantity_delivered || 0, 0);
        const remaining = Math.max(line.quantity_ordered - already, 0);
        const now = Math.min(Math.max(line.delivered_now || 0, 0), remaining);
        return { line, already, remaining, now, finalDelivered: already + now };
      }),
    [lines]
  );
  const totalOrdered = lines.reduce((sum, line) => sum + line.quantity_ordered, 0);
  const totalFinalDelivered = deliveryLines.reduce((sum, d) => sum + d.finalDelivered, 0);
  const totalDeliveredNow = deliveryLines.reduce((sum, d) => sum + d.now, 0);
  // Everything owed is now delivered → close it as "delivered"; otherwise it stays
  // open as "partially_delivered" so it keeps showing in orders + the deliveries queue.
  const isFullyDelivered = totalOrdered > 0 && totalFinalDelivered + 0.0000001 >= totalOrdered;
  const finalStatus = isFullyDelivered ? "delivered" : "partially_delivered";

  function setDeliveredNow(index: number, nextValue: string) {
    const parsed = Number(nextValue);
    setLines((prev) =>
      prev.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, delivered_now: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 }
          : line
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

    if (totalDeliveredNow <= 0) {
      setError("יש לסמן כמות שנמסרה בפריט אחד לפחות.");
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

      // Arrival details belong to the customer, so they go to their own endpoint
      // before the order save. Fire-and-forget on failure: a GPS pin not sticking
      // must never block confirming a delivery that physically happened.
      if (arrivalChanged && data.initialOrder.customer_id) {
        void fetch("/api/customers/delivery-location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_id: data.initialOrder.customer_id,
            instructions: arrivalInstructions.trim() || null,
            lat: arrivalPin?.lat ?? null,
            lng: arrivalPin?.lng ?? null,
          }),
        }).catch(() => {
          /* best-effort — the delivery confirmation is what matters here */
        });
      }

      // Append the delivery note to the existing thread instead of replacing it.
      // Empty note → keep the original notes untouched (never clobber the thread).
      const trimmedDeliveryNote = deliveryNotes.trim();
      const mergedNotes = trimmedDeliveryNote
        ? appendOrderComment(data.initialOrder.notes ?? "", {
            author_name: authorName ?? null,
            created_at: formatOrderCommentTimestamp(new Date()),
            body: trimmedDeliveryNote,
          })
        : data.initialOrder.notes ?? "";

      const payload = {
        order_id: orderId,
        customer_id: data.initialOrder.customer_id,
        order_date: data.initialOrder.order_date,
        status: finalStatus,
        payment_status: finalPaymentStatus,
        delivery_date: deliveryDate || getTodayDate(),
        discount_amount: data.initialOrder.discount_amount,
        notes: mergedNotes,
        items: deliveryLines.map(({ line, finalDelivered }) => ({
          product_id: line.product_id,
          quantity_ordered: line.quantity_ordered,
          quantity_delivered: finalDelivered,
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
    s.push("deliveryDate", "images", "comments", "arrival", "review");
    return s;
  }, [paidNow, accountsList.length, refundDue]);

  // The wizard chrome wants {n,label} entries; the labels are unused in "bar"
  // mode, but the count drives the progress bar.
  const wizardSteps = useMemo(
    () => steps.map((id, index) => ({ n: index + 1, label: STEP_META[id]?.eyebrow ?? "" })),
    [steps]
  );
  const stepIndex = Math.max(0, steps.indexOf(stepId));
  const currentStepId = steps[stepIndex] ?? "items";
  const isLastStep = currentStepId === "review";

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
        if (totalDeliveredNow <= 0) return "יש לסמן כמות שנמסרה בפריט אחד לפחות.";
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
              <p className="text-sm text-muted-foreground">אין פריטים בהזמנה זו.</p>
            ) : null}
            {deliveryLines.map(({ line, already, remaining, now }, index) => (
              <div
                key={`${line.product_id}-${index}`}
                className="grid grid-cols-1 gap-3 rounded-xl border border-border/70 bg-background/70 p-3 sm:grid-cols-[1fr_130px]"
              >
                <div>
                  <div className="font-medium">{line.product_name}</div>
                  <div className="text-xs text-muted-foreground">
                    הוזמן: {line.quantity_ordered}
                    {already > 0 ? ` · נמסר עד כה: ${already}` : ""}
                    {" · נותר: "}
                    <span className={remaining > 0 ? "font-semibold text-foreground" : ""}>{remaining}</span>
                  </div>
                  {line.notes ? <div className="mt-1 text-xs text-muted-foreground">הערות: {line.notes}</div> : null}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">נמסר כעת</label>
                  <Input
                    type="number"
                    min="0"
                    max={remaining}
                    step="1"
                    value={now}
                    disabled={remaining <= 0}
                    onChange={(e) => setDeliveredNow(index, e.target.value)}
                  />
                </div>
              </div>
            ))}
            {!isFullyDelivered && totalDeliveredNow > 0 ? (
              <p className="rounded-lg border border-warning/40 bg-warning-soft/60 p-2 text-xs text-warning-soft-foreground">
                אספקה חלקית — ההזמנה תישאר פתוחה (סופק חלקית) ותמשיך להופיע במשלוחים עד להשלמת היתרה.
              </p>
            ) : null}
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
            <NativeSelect
              value={paymentMethod}
              onChange={(e) => {
                const m = e.target.value;
                setPaymentMethod(m);
                setPaymentAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
              }}
            >
              <option value="">בחר אמצעי תשלום...</option>
              {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">תאריך החזר</label>
                    <DateInput value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">אמצעי החזר</label>
                    <NativeSelect
                      value={refundMethod}
                      onChange={(e) => {
                        const m = e.target.value;
                        setRefundMethod(m);
                        setRefundAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                      }}
                    >
                      <option value="">בחר אמצעי החזר...</option>
                      {ORDER_PAYMENT_METHOD_OPTIONS.map((option) => (
                        <option key={`refund-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              rows={4}
              placeholder="הערות למסירה, חוסרים, מצב אספקה..."
            />
            <p className="text-xs text-muted-foreground">נשמר על ההזמנה הזו בלבד.</p>
          </div>
        );
      // Its own step on purpose: the delivery notes describe THIS delivery, while
      // these describe the PLACE. Saving them on the customer is what lets the next
      // driver benefit from what this one just worked out — and standing at the door
      // is the one moment someone actually knows.
      case "arrival":
        return (
          <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3">
            <label className="text-sm font-medium">הוראות הגעה</label>
            <Textarea
              value={arrivalInstructions}
              onChange={(e) => setArrivalInstructions(e.target.value)}
              rows={3}
              placeholder="לדוגמה: לעקוף את הבניין מימין, שער כחול בחניון"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={captureArrivalPin}
                disabled={capturingPin}
              >
                <MapPin className="h-4 w-4" />
                {capturingPin ? "מאתר..." : "שמור את המיקום שאני נמצא בו"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {arrivalPin ? `נקודה נשמרה: ${formatPin(arrivalPin)}` : "לא נשמרה נקודה"}
              </span>
            </div>
            {pinError ? <p className="text-xs text-destructive">{pinError}</p> : null}
          </div>
        );
      case "review":
        return (
          <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">סטטוס אחרי שמירה</span>
              <span className="font-medium">{isFullyDelivered ? "סופק" : "סופק חלקית"}</span>
            </div>
            {!isFullyDelivered ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">נמסר מתוך ההזמנה</span>
                <span className="font-medium">
                  {totalFinalDelivered} / {totalOrdered}
                </span>
              </div>
            ) : null}
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">פרטי הגעה</span>
              <span>{arrivalChanged ? "יישמרו ללקוח" : "ללא שינוי"}</span>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={buttonVariant}
        className={buttonClassName ?? "w-full sm:w-auto"}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>

      <StepWizardDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setError(null);
        }}
        dialogTitle={customerName || title}
        dialogDescription={description}
        // Too many steps to name in a row on a phone, so progress is a bar.
        progressVariant="bar"
        steps={wizardSteps}
        current={stepIndex + 1}
        canClickStep={() => false}
        onStepClick={() => {}}
        closeDisabled={submitting}
        onBack={stepIndex > 0 ? goBack : undefined}
        backDisabled={submitting}
        onNext={isLastStep ? () => void submit() : goNext}
        nextLabel={isLastStep ? "אישור אספקה" : "הבא"}
        nextDisabled={submitting || loading || !data}
        isLastStep={isLastStep}
        showStepCounter={false}
        error={error || undefined}
      >
        {loading ? (
          <LoadingDots
            label="טוען את פרטי ההזמנה"
            description="אוסף את הכמויות, התשלום והתמונות כדי שתוכלו לאשר אספקה בביטחון."
          />
        ) : null}

        {data ? (
          <div className="space-y-2">
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
      </StepWizardDialog>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import { formatOrderDate } from "@/lib/orders/format";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatOrderStatus(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "draft":
      return "פתוחה";
    case "confirmed":
      return "מאושרת";
    case "processing":
      return "בטיפול";
    case "out_for_delivery":
      return "במשלוח";
    case "delivered":
      return "סופקה";
    case "completed":
      return "הושלמה";
    case "cancelled":
      return "בוטלה";
    default:
      return status ?? "-";
  }
}

function formatPaymentStatus(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "unpaid":
      return "לא שולם";
    case "partial":
      return "שולם חלקית";
    case "paid":
      return "שולם";
    case "refunded":
      return "הוחזר";
    default:
      return status ?? "-";
  }
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

type DetailsResponse = {
  order: Row;
  orderItems: Row[];
  payments: Row[];
  customer: Row | null;
  products: Row[];
  totalAmount: number;
  totalPaid: number;
  paymentStatus: string;
};

export default function OrderDetailsDialog({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailsResponse | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/details`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as DetailsResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json.error ?? "טעינת פרטי ההזמנה נכשלה.");
        }
        if (!cancelled) setData(json);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "טעינת פרטי ההזמנה נכשלה.");
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

  const productMap = useMemo(() => {
    const map = new Map<string, Row>();
    (data?.products ?? []).forEach((row) => {
      if (typeof row?.id === "string") map.set(row.id, row);
    });
    return map;
  }, [data?.products]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        פרטי הזמנה
      </Button>
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>הזמנה #{orderId.slice(0, 8)}</DialogTitle>
          <DialogDescription>צפייה מהירה בפרטי ההזמנה, תשלומים ופריטים.</DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">טוען פרטי הזמנה...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {data ? (
          <div className="space-y-4">
            <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">לקוח</span>
                <span>
                  {getString((data.customer ?? {}) as Row, "name") ??
                    getString((data.customer ?? {}) as Row, "name_for_invoice") ??
                    getString(data.order, "customer_id") ??
                    "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">עיר</span>
                <span>
                  {extractCityFromAddress(getString((data.customer ?? {}) as Row, "address")) ?? "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">תאריך הזמנה</span>
                <span>{formatOrderDate(getString(data.order, "order_date"))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס הזמנה</span>
                <span>{formatOrderStatus(getString(data.order, "status"))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס תשלום</span>
                <span>{formatPaymentStatus(data.paymentStatus)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סכום כולל</span>
                <span>{formatCurrency(data.totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">שולם</span>
                <span>{formatCurrency(data.totalPaid)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">יתרה</span>
                <span>{formatCurrency(Math.max(data.totalAmount - data.totalPaid, 0))}</span>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">תשלומים</h3>
              {(data.payments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">עדיין לא הוזנו תשלומים.</p>
              ) : (
                <div className="space-y-2">
                  {data.payments.map((payment, index) => {
                    const amount = getNumber(payment, "amount_total") ?? 0;
                    const isRefund = amount < 0;

                    return (
                      <div
                        key={getString(payment, "id") ?? `payment-${index}`}
                        className="rounded-md border p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium ${isRefund ? "text-amber-700" : ""}`}>
                            {isRefund ? `החזר ${formatCurrency(Math.abs(amount))}` : formatCurrency(amount)}
                          </span>
                          <span className="text-muted-foreground">
                            {formatOrderDate(
                              getString(payment, "payment_date") ?? getString(payment, "created_at")
                            )}
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {isRefund ? "אמצעי החזר" : "אמצעי"}: {paymentMethodLabel(getString(payment, "payment_method"))}
                          {getString(payment, "reference_number")
                            ? ` | אסמכתא: ${getString(payment, "reference_number")}`
                            : ""}
                        </div>
                        {getString(payment, "notes") ? (
                          <div className="mt-1 text-muted-foreground">הערות: {getString(payment, "notes")}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">פריטי הזמנה</h3>
              {(data.orderItems ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו פריטים להזמנה זו.</p>
              ) : (
                <div className="space-y-2">
                  {data.orderItems.map((item, index) => {
                    const productId = getString(item, "product_id") ?? "";
                    const product = productMap.get(productId) ?? {};
                    const productName =
                      getString(product as Row, "name") ??
                      getString(product as Row, "product_name") ??
                      productId;
                    const quantity = getNumber(item, "quantity_ordered") ?? 0;
                    const unitPrice = getNumber(item, "unit_price") ?? 0;
                    const lineTotal = getNumber(item, "line_total") ?? quantity * unitPrice;

                    return (
                      <div
                        key={getString(item, "id") ?? `${productId}-${index}`}
                        className="rounded-md border p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{productName}</span>
                          <span>{formatCurrency(lineTotal)}</span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          כמות: {quantity} | מחיר יחידה: {formatCurrency(unitPrice)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <OrderConfirmDialog orderId={orderId} buttonLabel="אישור / עדכון הזמנה" />
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

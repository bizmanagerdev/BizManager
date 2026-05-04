"use client";

import {
  ChevronDown,
  CreditCard,
  FileText,
  MapPin,
  Package,
  ScrollText,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderEditDialog from "@/app/sales/orders/OrderEditDialog";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import { formatOrderDate } from "@/lib/orders/format";
import { paymentMethodLabel, paymentStatusClasses } from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

type DetailsResponse = {
  order: Row;
  orderItems: Row[];
  payments: Row[];
  customer: Row | null;
  products: Row[];
  totalAmount: number;
  totalPaid: number;
  paymentStatus: string;
  remainingBalance?: number;
};

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

export function formatOrderStatus(status: string | null) {
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

function normalizeOrderStatus(value: string | null) {
  switch ((value ?? "").toLowerCase()) {
    case "approved":
      return "confirmed";
    case "in_progress":
      return "processing";
    case "ready":
      return "out_for_delivery";
    case "done":
      return "completed";
    default:
      return (value ?? "").toLowerCase();
  }
}

export function orderStatusClasses(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "delivered":
    case "completed":
    case "closed":
      return "border-transparent bg-emerald-100 text-black";
    case "draft":
    case "confirmed":
    case "processing":
    case "out_for_delivery":
      return "border-transparent bg-orange-100 text-black";
    case "cancelled":
      return "border-transparent bg-rose-100 text-black";
    default:
      return "border-transparent bg-orange-100 text-black";
  }
}

function SummaryRow({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  icon,
  iconClassName = "bg-sky-50 text-sky-700 border border-sky-200",
  children,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  iconClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ${iconClassName}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ExpandableSection({
  title,
  count,
  icon,
  iconClassName = "bg-sky-50 text-sky-700 border border-sky-200",
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  iconClassName?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-border/70 bg-card/70 p-4">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ${iconClassName}`}>
              {icon}
            </div>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">{count} רשומות</div>
            </div>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

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

  const summary = useMemo(() => {
    const items = data?.orderItems ?? [];
    const subtotal = items.reduce((sum, item) => {
      const quantity = getNumber(item, "quantity_ordered") ?? 0;
      const unitPrice = getNumber(item, "unit_price") ?? 0;
      return sum + quantity * unitPrice;
    }, 0);
    const lineDiscount = items.reduce((sum, item) => sum + (getNumber(item, "discount_amount") ?? 0), 0);
    const orderDiscount = getNumber((data?.order ?? {}) as Row, "discount_amount") ?? 0;
    const discount = lineDiscount + orderDiscount;
    const total = data?.totalAmount ?? 0;
    const paid = data?.totalPaid ?? 0;
    const remaining = Math.max(total - paid, 0);
    const lastPayment = (data?.payments ?? [])[0] ?? null;

    return {
      subtotal,
      discount,
      total,
      paid,
      remaining,
      lastPayment,
      itemCount: items.length,
      activityCount: (data?.payments ?? []).length,
    };
  }, [data]);

  const customerName =
    getString((data?.customer ?? {}) as Row, "name") ??
    getString((data?.customer ?? {}) as Row, "name_for_invoice") ??
    getString((data?.order ?? {}) as Row, "customer_id") ??
    "-";
  const customerEmail = getString((data?.customer ?? {}) as Row, "email");
  const customerPhone = getString((data?.customer ?? {}) as Row, "phone");
  const fullAddress = getString((data?.customer ?? {}) as Row, "address") ?? "-";
  const orderNotes = getString((data?.order ?? {}) as Row, "notes");

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
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>הזמנה #{orderId.slice(0, 8)}</DialogTitle>
          <DialogDescription>סיכום הזמנה, לקוח, כתובת למשלוח ותשלום.</DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">טוען פרטי הזמנה...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {data ? (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard
                title="סיכום הזמנה"
                subtitle={`${summary.itemCount} פריטים`}
                icon={<FileText className="h-4 w-4" />}
                iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge value={getString(data.order, "status") ?? ""} type="order" />
                    <Badge className={paymentStatusClasses(data.paymentStatus)}>
                      {formatPaymentStatus(data.paymentStatus)}
                    </Badge>
                  </div>
                  <SummaryRow label="סכום ביניים" value={formatCurrency(summary.subtotal)} />
                  {summary.discount > 0 ? (
                    <SummaryRow
                      label="הנחה"
                      value={`-${formatCurrency(summary.discount)}`}
                      valueClassName="text-emerald-700"
                    />
                  ) : null}
                  <SummaryRow label="סה״כ" value={formatCurrency(summary.total)} valueClassName="font-semibold" />
                  <SummaryRow label="שולם" value={formatCurrency(summary.paid)} />
                  <SummaryRow label="יתרה" value={formatCurrency(summary.remaining)} />
                </div>
              </SectionCard>

              <SectionCard
                title="לקוח"
                icon={<UserRound className="h-4 w-4" />}
                iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
              >
                <div className="space-y-1 text-sm">
                  <div className="font-medium">{customerName}</div>
                  <div className="text-muted-foreground">
                    {[customerEmail, customerPhone].filter(Boolean).join(" · ") || "-"}
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="כתובת למשלוח"
                icon={<MapPin className="h-4 w-4" />}
                iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
              >
                <div className="space-y-3 text-sm">
                  <div className="leading-6">{fullAddress}</div>
                  {orderNotes ? (
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                      <div className="mb-1 text-xs font-medium text-muted-foreground">הערות</div>
                      <div className="leading-6">{orderNotes}</div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title="תשלום"
                icon={<CreditCard className="h-4 w-4" />}
                iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
              >
                <div className="space-y-1 text-sm">
                  <div className="font-medium">
                    {summary.lastPayment
                      ? paymentMethodLabel(getString(summary.lastPayment, "payment_method"))
                      : "אין תשלום רשום"}
                  </div>
                  <div className="text-muted-foreground">
                    {summary.lastPayment
                      ? `${formatPaymentStatus(data.paymentStatus)} · ${formatOrderDate(
                          getString(summary.lastPayment, "payment_date") ??
                            getString(summary.lastPayment, "created_at")
                        )}`
                      : formatPaymentStatus(data.paymentStatus)}
                  </div>
                  <div className="text-base font-semibold">{formatCurrency(summary.paid)}</div>
                </div>
              </SectionCard>
            </div>

            <ExpandableSection
              title="פריטי הזמנה"
              count={summary.itemCount}
              icon={<Package className="h-4 w-4" />}
              iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
            >
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
                        className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{productName}</span>
                          <span>{formatCurrency(lineTotal)}</span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          כמות: {quantity} · מחיר יחידה: {formatCurrency(unitPrice)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ExpandableSection>

            <ExpandableSection
              title="פעילות"
              count={summary.activityCount}
              icon={<ScrollText className="h-4 w-4" />}
              iconClassName="border border-sky-200 bg-sky-50 text-sky-700"
            >
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
                        className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
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
                            ? ` · אסמכתא: ${getString(payment, "reference_number")}`
                            : ""}
                        </div>
                        {getString(payment, "notes") ? (
                          <div className="mt-1 text-muted-foreground">הערות: {getString(payment, "notes")}</div>
                        ) : null}
                        {getString(payment, "recorded_by_display") ? (
                          <div className="mt-1 text-muted-foreground">
                            הוזן ע״י {getString(payment, "recorded_by_display")}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </ExpandableSection>
          </div>
        ) : null}

        <DialogFooter className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          <OrderPaymentDialog
            orderId={orderId}
            totalAmount={data?.totalAmount ?? 0}
            paidAmount={data?.totalPaid ?? 0}
          />
          <OrderEditDialog orderId={orderId} buttonLabel="עריכת הזמנה" />
          <OrderConfirmDialog orderId={orderId} buttonLabel="אישור אספקה" />
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

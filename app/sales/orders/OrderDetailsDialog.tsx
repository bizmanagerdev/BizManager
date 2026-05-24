"use client";

/* eslint-disable @next/next/no-img-element */

import {
  CalendarDays,
  ChevronDown,
  CreditCard,
  FileImage,
  FileText,
  MapPin,
  Package,
  ScrollText,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderEditDialog from "@/app/sales/orders/OrderEditDialog";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import DeleteOrderButton from "@/app/sales/orders/[id]/DeleteOrderButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { formatRelativeDateLabel } from "@/lib/date";
import { formatOrderDate } from "@/lib/orders/format";
import { paymentMethodLabel, paymentStatusClasses } from "@/lib/orders/paymentStatus";
import type { MorningLocalDocument } from "@/lib/morning/types";

type Row = Record<string, unknown>;

type DeliveryImage = {
  id: string;
  file_name: string | null;
  uploaded_at: string | null;
  url: string | null;
};

type DetailsResponse = {
  order: Row;
  orderItems: Row[];
  payments: Row[];
  morningDocuments: MorningLocalDocument[];
  deliveryImages: DeliveryImage[];
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
      return "bg-success text-success-foreground border-transparent";
    case "draft":
      return "bg-destructive text-destructive-foreground border-transparent";
    case "confirmed":
    case "processing":
    case "out_for_delivery":
      return "bg-warning text-warning-foreground border-transparent";
    case "cancelled":
      return "border-border bg-background text-muted-foreground";
    default:
      return "bg-warning text-warning-foreground border-transparent";
  }
}

function SummaryMetric({ label, value, valueClassName = "" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-medium ${valueClassName}`}>{value}</div>
    </div>
  );
}

function SummaryInfo({
  icon: Icon,
  label,
  value,
  tone = "sky",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  tone?: "sky" | "emerald" | "red";
}) {
  const toneClass =
    tone === "red"
      ? "bg-destructive text-destructive-foreground border-transparent"
      : tone === "emerald"
        ? "bg-success text-success-foreground border-transparent"
        : "bg-info text-info-foreground border-transparent";

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background/80 p-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm font-medium leading-6">{value}</div>
      </div>
    </div>
  );
}

function ExpandableSection({
  title,
  subtitle,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-border/70 bg-card/70 p-4" open>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border bg-info text-info-foreground border-transparent">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted-foreground">
                {subtitle ?? count ?? ""}
              </div>
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
  const [refreshSeed, setRefreshSeed] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/details`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as DetailsResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "טעינת פרטי ההזמנה נכשלה.");
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
  }, [open, orderId, refreshSeed]);

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

    return {
      subtotal,
      discount,
      total,
      paid,
      remaining,
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
  const customerCity = fullAddress.split("|")[0]?.trim() || "-";
  const orderNotes = getString((data?.order ?? {}) as Row, "notes");
  const orderMorningDocuments = data?.morningDocuments ?? [];
  const orderLevelMorningDocuments = orderMorningDocuments.filter((document) => !document.payment_id);
  const deliveryImages = data?.deliveryImages ?? [];
  const resolvedCustomerId =
    getString((data?.customer ?? {}) as Row, "id") ?? getString((data?.order ?? {}) as Row, "customer_id") ?? "";
  const orderDate = getString((data?.order ?? {}) as Row, "order_date");
  const normalizedStatus = normalizeOrderStatus(getString((data?.order ?? {}) as Row, "status"));
  const isOpenOrder = !["delivered", "completed", "closed", "cancelled"].includes(normalizedStatus);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        פרטי הזמנה
      </Button>
      <DialogContent className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>הזמנה #{orderId.slice(0, 8)}</DialogTitle>
          <DialogDescription>מרכז ניהול להזמנה, תשלום, מסמכים ואישור אספקה.</DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-muted-foreground">טוען פרטי הזמנה...</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {data ? (
          <div className="space-y-5">
            <section className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">הזמנה #{orderId.slice(0, 8)}</div>
                    <div className="text-2xl font-semibold">{customerName}</div>
                    <div className="text-sm text-muted-foreground">
                      {[customerPhone, customerEmail].filter(Boolean).join(" · ") || "-"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      value={getString(data.order, "status") ?? ""}
                      type="order"
                      className={orderStatusClasses(getString(data.order, "status") ?? "")}
                    />
                    <Badge className={paymentStatusClasses(data.paymentStatus)}>
                      {formatPaymentStatus(data.paymentStatus)}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <SummaryInfo
                    icon={CalendarDays}
                    label="תאריך הזמנה"
                    tone={isOpenOrder ? "red" : "sky"}
                    value={
                      <div className="space-y-1">
                        <div className={isOpenOrder ? "text-destructive" : ""}>{formatOrderDate(orderDate)}</div>
                        <div className={`text-xs ${isOpenOrder ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                          {formatRelativeDateLabel(orderDate)}
                        </div>
                      </div>
                    }
                  />
                  <SummaryInfo icon={UserRound} label="לקוח וטלפון" value={<span>{customerName} · {customerPhone ?? "-"}</span>} />
                  <SummaryInfo icon={MapPin} label="עיר וכתובת" value={<span>{customerCity} · {fullAddress}</span>} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <SummaryMetric label="סכום ביניים" value={formatCurrency(summary.subtotal)} />
                  <SummaryMetric label="הנחה" value={summary.discount > 0 ? `-${formatCurrency(summary.discount)}` : "-"} valueClassName={summary.discount > 0 ? "text-success-soft-foreground" : ""} />
                  <SummaryMetric label="סה״כ" value={formatCurrency(summary.total)} />
                  <SummaryMetric label="שולם" value={formatCurrency(summary.paid)} />
                  <SummaryMetric label="יתרה" value={formatCurrency(summary.remaining)} valueClassName={summary.remaining > 0 ? "text-warning-soft-foreground" : ""} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <OrderPaymentDialog
                    orderId={orderId}
                    totalAmount={data.totalAmount ?? 0}
                    paidAmount={data.totalPaid ?? 0}
                    onCreated={() => setRefreshSeed((current) => current + 1)}
                  />
                  <OrderConfirmDialog orderId={orderId} buttonLabel="אישור אספקה" />
                  <OrderEditDialog orderId={orderId} buttonLabel="עריכת הזמנה" />
                  <DeleteOrderButton orderId={orderId} />
                </div>
              </div>
            </section>

            <ExpandableSection title="פריטים" subtitle={`${summary.itemCount} פריטים`} icon={Package}>
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
                        {(getNumber(item, "discount_amount") ?? 0) > 0 ? (
                          <div className="mt-1 text-success-soft-foreground">הנחת שורה: -{formatCurrency(getNumber(item, "discount_amount") ?? 0)}</div>
                        ) : null}
                        {getString(item, "notes") ? (
                          <div className="mt-1 text-muted-foreground">הערות: {getString(item, "notes")}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </ExpandableSection>

            <ExpandableSection title="תשלומים, החזרים ופעילות" subtitle={`${summary.activityCount} רשומות`} icon={ScrollText}>
              {(data.payments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">עדיין לא הוזנו תשלומים.</p>
              ) : (
                <div className="space-y-2">
                  {data.payments.map((payment, index) => {
                    const amount = getNumber(payment, "amount_total") ?? 0;
                    const isRefund = amount < 0;
                    const paymentId = getString(payment, "id") ?? "";
                    const paymentMorningDocuments = orderMorningDocuments.filter(
                      (document) => document.payment_id === paymentId
                    );

                    return (
                      <div
                        key={paymentId || `payment-${index}`}
                        className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium ${isRefund ? "text-warning-soft-foreground" : ""}`}>
                            {isRefund ? `החזר ${formatCurrency(Math.abs(amount))}` : formatCurrency(amount)}
                          </span>
                          <span className="text-muted-foreground">
                            {formatOrderDate(getString(payment, "payment_date") ?? getString(payment, "created_at"))}
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {isRefund ? "אמצעי החזר" : "אמצעי"}: {paymentMethodLabel(getString(payment, "payment_method"))}
                          {getString(payment, "reference_number") ? ` · אסמכתא: ${getString(payment, "reference_number")}` : ""}
                        </div>
                        {getString(payment, "notes") ? (
                          <div className="mt-1 text-muted-foreground">הערות: {getString(payment, "notes")}</div>
                        ) : null}
                        {getString(payment, "recorded_by_display") ? (
                          <div className="mt-1 text-muted-foreground">הוזן ע״י {getString(payment, "recorded_by_display")}</div>
                        ) : null}
                        {!isRefund && paymentId && resolvedCustomerId ? (
                          <div className="mt-3 border-t border-border/60 pt-3">
                            <MorningDocumentsPanel
                              customerId={resolvedCustomerId}
                              orderId={orderId}
                              paymentId={paymentId}
                              documents={paymentMorningDocuments}
                              allowReceipt
                              allowInvoiceReceipt
                              compact
                              onChanged={() => setRefreshSeed((current) => current + 1)}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </ExpandableSection>

            <ExpandableSection title="הוכחת אספקה" subtitle={`${deliveryImages.length} תמונות`} icon={FileImage}>
              {deliveryImages.length === 0 ? (
                <p className="text-sm text-muted-foreground">עדיין לא הועלו תמונות אספקה להזמנה זו.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {deliveryImages.map((image) => (
                    <a
                      key={image.id}
                      href={image.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
                    >
                      {image.url ? (
                        <img
                          src={image.url}
                          alt={image.file_name ?? "Delivery proof"}
                          className="mb-3 h-40 w-full rounded-lg object-cover"
                        />
                      ) : null}
                      <div className="font-medium">{image.file_name ?? "תמונת אספקה"}</div>
                      <div className="text-xs text-muted-foreground">{formatOrderDate(image.uploaded_at)}</div>
                    </a>
                  ))}
                </div>
              )}
            </ExpandableSection>

            <ExpandableSection title="מסמכים ו-Morning" subtitle={`${orderMorningDocuments.length} מסמכים`} icon={FileText}>
              {resolvedCustomerId ? (
                <MorningDocumentsPanel
                  customerId={resolvedCustomerId}
                  orderId={orderId}
                  documents={orderLevelMorningDocuments}
                  allowQuote
                  allowInvoice
                  onChanged={() => setRefreshSeed((current) => current + 1)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">לא נמצא לקוח מקושר למסמכי Morning.</p>
              )}
            </ExpandableSection>

            <ExpandableSection title="הערות" subtitle={orderNotes ? "קיימות הערות להזמנה" : "ללא הערות"} icon={CreditCard}>
              {orderNotes ? (
                <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
                  {orderNotes}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">לא נוספו הערות להזמנה זו.</p>
              )}
            </ExpandableSection>
          </div>
        ) : null}

        <DialogFooter className="mt-2 border-t pt-4">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            סגירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

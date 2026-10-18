"use client";

import dynamic from "next/dynamic";
import { pinFrom } from "@/lib/delivery-location";
import { StatActionCard, collectionStatusTextClass } from "@/components/ui/stat-action-card";
import { CommentIcon, DeliveryIcon, DocumentIcon, HistoryIcon, OrderIcon, PaymentIcon, ReceiptIcon } from "@/components/ui/icons";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import OrderRemindersSection from "@/app/(app)/sales/orders/[id]/OrderRemindersSection";
import DeliveryImagesCard from "@/app/(app)/sales/orders/[id]/DeliveryImagesCard";
import { SECTION_ICON_CLASS, SectionCard, SectionCount } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import OrderPaymentDialog from "@/app/(app)/sales/orders/OrderPaymentDialog";
import OrderEditDialog from "@/app/(app)/sales/orders/OrderEditDialog";
import InvoiceQuickMenu from "@/app/(app)/sales/orders/InvoiceQuickMenu";
import OrderCommentsThread from "@/app/(app)/sales/orders/[id]/OrderCommentsThread";
import OrderHeaderMenu from "@/app/(app)/sales/orders/[id]/OrderHeaderMenu";
import OrderPageHeading from "@/app/(app)/sales/orders/[id]/OrderPageHeading";
import { CustomerContactCard } from "@/components/customers/CustomerContactCard";
import { OrderPaymentActionsClient } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";
import type { PaymentItem } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";
import { splitPaymentAmounts, orderCollectionStatusLabel, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { computeSourceCollection, isOpenOrderStatus } from "@/lib/collections";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import { formatDayOrDateTime, formatEnteredLabel, formatRelativeDateLabel, formatShortDate, formatShortDateTime } from "@/lib/date";
import type { OrderPageCore } from "@/lib/orders/order-page";
import type { OrderPageExtras } from "@/app/(app)/sales/orders/[id]/loadOrderPageExtras";
import { israelDateKey } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { addressNotFound } from "@/lib/address/columns";

// An order's page, from what was read for it: the order itself
// (lib/orders/order-page.ts — from the server, or from the device copy) and
// the parts only the server reads (loadOrderPageExtras.ts — `extras`, null
// while they're still on their way: those sections hold their place).

const OrderConfirmDialog = dynamic(() => import("@/app/(app)/sales/orders/OrderConfirmDialog"), {
  loading: () => null,
});

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

// ₪ first, the dashboard's way (owner, 2026-10-11) — lib/money.ts.
function formatCurrency(value: number) {
  return formatMoney(value);
}

function formatDate(value: string | null) {
  return formatShortDate(value);
}

// A missing value is "—", as everywhere (owner, 2026-10-11).
function formatDateTime(value: string | null) {
  return formatShortDateTime(value, "—");
}

function paymentInsertedByLabel(
  payment: Row,
  {
    paymentRecordedByNameByValue,
    paymentAuditById,
  }: {
    paymentRecordedByNameByValue: Record<string, string>;
    paymentAuditById: OrderPageExtras["paymentAudit"];
  }
) {
  // Who AND when it was typed in — payments.created_at, not the payment's own
  // day (owner, 2026-10-15: "see exactly when things happen").
  const recordedByValue = getString(payment, "recorded_by");
  if (recordedByValue && paymentRecordedByNameByValue[recordedByValue]) {
    return formatEnteredLabel(paymentRecordedByNameByValue[recordedByValue], getString(payment, "created_at"));
  }

  const paymentId = getString(payment, "id");
  const audit = paymentId ? paymentAuditById[paymentId] : undefined;
  if (audit?.action === "create") {
    return formatEnteredLabel(audit.actorName, audit.createdAt ?? getString(payment, "created_at"));
  }

  // No name known (yet — the history arrives with the server's parts): the
  // time alone, so the line is already there and only gains the name.
  return formatEnteredLabel(null, getString(payment, "created_at"));
}

function formatAddressForDisplay(address: string | null) {
  if (!address) return null;
  const parts = address
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Where a server-only part will go, until it arrives. */
function PendingBlock({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted/40 ${className}`} aria-busy="true" />;
}

/** Full-width solid-fill override for dialog trigger buttons whose default variant is outline. */
const FULL_SECONDARY_TRIGGER_CLASSES =
  "border-transparent bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:text-secondary-foreground w-full";

/** Anchor of the תזכורות section — the phone פעולות list links to it. */
const REMINDERS_SECTION_ID = "order-reminders";

const NO_PAYMENT_AUDIT: OrderPageExtras["paymentAudit"] = {};

export default function OrderPageView({
  id,
  core,
  extras,
  viewer,
}: {
  id: string;
  core: OrderPageCore;
  /** The server-only parts; null while they're on their way. */
  extras: OrderPageExtras | null;
  viewer: { role: string; name: string | null };
}) {
  const { order, items: orderItems, payments, financials, customer, branch, errors } = core;
  const paymentRecordedByNameByValue = core.names;
  const collectOnDelivery = order?.collect_payment_on_delivery === true;

  const customerId = order && typeof order.customer_id === "string" ? order.customer_id : null;
  const orderCreatedBy = getString(order ?? {}, "created_by");
  const orderCreatedByName = orderCreatedBy ? paymentRecordedByNameByValue[orderCreatedBy] ?? null : null;
  // When the order was really typed in (created_at), beside the day it is FOR
  // (order_date, a picked day) — owner, 2026-10-15.
  const orderEnteredLabel = formatEnteredLabel(orderCreatedByName, getString(order ?? {}, "created_at"));

  const productMap = new Map<string, Row>();
  core.products.forEach((row) => {
    if (typeof row?.id === "string") productMap.set(row.id, row);
  });

  const morningDocuments = extras?.morningDocuments ?? [];
  const orderLevelMorningDocuments = morningDocuments.filter((document) => !document.payment_id);

  const customerName =
    getString(customer ?? {}, "name") ?? getString(customer ?? {}, "name_for_invoice") ?? customerId ?? "—";
  const customerNameForInvoiceRaw = getString(customer ?? {}, "name_for_invoice");
  const customerNameForInvoice =
    customerNameForInvoiceRaw && customerNameForInvoiceRaw !== customerName ? customerNameForInvoiceRaw : null;
  const customerBranchName = getString(branch ?? {}, "name");
  // Only used where a single combined label is needed (share text, print) — the
  // page's own customer card shows the branch as its own row instead.
  const customerDisplayName = customerBranchName ? `${customerName} · סניף ${customerBranchName}` : customerName;
  const customerRegistrationNumber = getString(customer ?? {}, "registration_number");
  const customerPhone = getString(customer ?? {}, "phone");
  const customerEmail = getString(customer ?? {}, "email");
  const fullAddress = formatAddressForDisplay(getString(customer ?? {}, "address"));
  // The branch's own address/phone (when this order is for one) is where the
  // order actually goes — falls back to the customer's own contact details.
  const branchAddress = getString(branch ?? {}, "address");
  const branchPhone = getString(branch ?? {}, "phone");
  const effectiveAddress = branchAddress ? formatAddressForDisplay(branchAddress) : fullAddress;
  // The customer's saved drop-off point wins over the address — unless the
  // order goes to a branch somewhere else.
  const orderPin = branchAddress ? null : pinFrom(customer?.delivery_lat, customer?.delivery_lng);
  const orderAddressNotFound = !branchAddress && addressNotFound(customer);
  const effectivePhone = branchPhone ?? customerPhone;
  const orderNotes = getString(order ?? {}, "notes");

  const orderDate = getString(order ?? {}, "order_date");
  const orderNeedsInvoice = typeof order?.needs_invoice === "boolean" ? order.needs_invoice : null;
  const orderInvoiceSentAt = getString(order ?? {}, "invoice_sent_at");
  const orderDeliveryConfirmedAt = getString(order ?? {}, "delivery_confirmed_at");
  const orderRequestedDeliveryDate = getString(order ?? {}, "requested_delivery_date");

  const subtotal = orderItems.reduce((sum, item) => {
    const quantity = getNumber(item, "quantity_ordered") ?? 0;
    const unitPrice = getNumber(item, "unit_price") ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
  const lineDiscount = orderItems.reduce((sum, item) => sum + (getNumber(item, "discount_amount") ?? 0), 0);
  const orderDiscount = getNumber(order ?? {}, "discount_amount") ?? 0;
  const totalDiscount = lineDiscount + orderDiscount;
  const derivedTotalAmount = Math.max(subtotal - totalDiscount, 0);
  // COLLECTION SPLIT: "paid" reflects collected money only; expected (pending)
  // money is shown separately so a future-dated payment never marks the order שולם.
  const paymentSplit = splitPaymentAmounts(
    payments.map((payment) => ({
      amount_total: getNumber(payment, "amount_total") ?? 0,
      payment_status: getString(payment, "payment_status"),
      due_date: getString(payment, "due_date"),
    }))
  );
  const derivedTotalPaid = paymentSplit.collected;
  const expectedAmount = getNumber(financials ?? {}, "pending_amount") ?? paymentSplit.pending;
  const overdueExpectedAmount = getNumber(financials ?? {}, "overdue_amount") ?? paymentSplit.overdue;
  const viewTotalAmount = getNumber(financials ?? {}, "total_amount");
  const viewTotalPaid = getNumber(financials ?? {}, "total_paid");
  const useDerivedFinancials =
    viewTotalAmount === null ||
    (Math.abs((viewTotalAmount ?? 0) - derivedTotalAmount) > 0.009 && derivedTotalAmount > 0) ||
    Math.abs((viewTotalPaid ?? 0) - derivedTotalPaid) > 0.009;
  const totalAmount = useDerivedFinancials ? derivedTotalAmount : viewTotalAmount ?? 0;
  const totalPaid = useDerivedFinancials ? derivedTotalPaid : viewTotalPaid ?? 0;
  const remainingBalance = useDerivedFinancials
    ? Math.max(derivedTotalAmount - derivedTotalPaid, 0)
    : getNumber(financials ?? {}, "remaining_balance") ?? Math.max(totalAmount - totalPaid, 0);
  const paymentCount = getNumber(financials ?? {}, "payment_count") ?? payments.length;
  const orderDueDate = getString(order ?? {}, "due_date");
  const orderPaymentTerms = getString(order ?? {}, "payment_terms");
  const orderPendingMethods = Array.from(
    new Set(
      payments
        .filter((p) => (getString(p, "payment_status") ?? "").toLowerCase() === "pending" && getString(p, "payment_method"))
        .map((p) => paymentMethodLabel(getString(p, "payment_method")))
    )
  );
  const collectionStatus = computeSourceCollection({
    total: totalAmount,
    collected: paymentSplit.collected,
    pending: paymentSplit.pending,
    overdue: paymentSplit.overdue,
    outstanding: remainingBalance,
    nextDueDate: getString(financials ?? {}, "next_due_date"),
    referenceDate: orderDate,
    dueDate: orderDueDate,
    blockOverdue: isOpenOrderStatus(getString(order ?? {}, "status")),
    today: israelDateKey(),
  }).status;
  const canManagePayments = viewer.role === "admin" || viewer.role === "office";

  const paymentsWithMeta: PaymentItem[] = payments.map((payment) => {
    const paymentId = getString(payment, "id") ?? "";
    return {
      id: paymentId,
      payment_date: getString(payment, "payment_date"),
      amount_total: getNumber(payment, "amount_total") ?? 0,
      payment_method: getString(payment, "payment_method"),
      payment_status: getString(payment, "payment_status"),
      due_date: getString(payment, "due_date"),
      reference_number: getString(payment, "reference_number"),
      check_number: getString(payment, "check_number"),
      account_id: getString(payment, "account_id"),
      notes: getString(payment, "notes"),
      insertedByLabel: paymentInsertedByLabel(payment, {
        paymentRecordedByNameByValue,
        paymentAuditById: extras?.paymentAudit ?? NO_PAYMENT_AUDIT,
      }),
      morningDocuments: morningDocuments.filter((d) => d.payment_id === paymentId),
      files: extras ? (extras.paymentFiles[paymentId] ?? []) : null,
    };
  });

  // "מה צריך לעשות" — pending actions for this order.
  const orderStatusValue = getString(order ?? {}, "status") ?? "";
  const orderIsActive = Boolean(order) && isOpenOrderStatus(orderStatusValue);
  const orderIsCancelled = orderStatusValue.trim().toLowerCase() === "cancelled";
  const needsDeliveryAction = orderIsActive;
  const needsPaymentAction = Boolean(order) && remainingBalance > 0.009;
  // An order whose total is 0 but has items is mispriced — surface it instead of
  // letting a "remaining = 0" hide the payment action on an unpaid order.
  const needsPricingAction = Boolean(order) && totalAmount <= 0.009 && orderItems.length > 0;
  const totalUnits = orderItems.reduce((sum, item) => sum + (getNumber(item, "quantity_ordered") ?? 0), 0);

  // Serializable order summary for the WhatsApp-share + print/PDF actions.
  const shareItems = orderItems.map((item) => {
    const productId = getString(item, "product_id") ?? "";
    const product = productMap.get(productId);
    const quantity = getNumber(item, "quantity_ordered") ?? 0;
    const unitPrice = getNumber(item, "unit_price") ?? 0;
    return {
      name:
        getString(product ?? {}, "name") ??
        getString(product ?? {}, "product_name") ??
        getString(item, "description") ??
        productId,
      quantity,
      lineTotal: getNumber(item, "line_total") ?? quantity * unitPrice,
    };
  });
  const orderShareData = {
    orderNumber: id.slice(0, 8),
    orderDate: formatDate(orderDate),
    customerName: customerDisplayName,
    customerPhone,
    items: shareItems,
    totalAmount,
    totalPaid,
    remainingBalance,
  };

  const orderActivity = extras?.activity ?? [];
  const isAdmin = viewer.role === "admin";
  const canLogCommunication = viewer.role === "admin" || viewer.role === "office";

  return (
    <div className="space-y-3">
      {/* The things you do to an order: on desktop the edit pencil and a ⋮ in
          the heading (owner, 2026-10-11: the project page's row); on the phone
          the same actions become the ⋮ beside the back arrow, and the order's
          number + customer go into the top bar — OrderHeaderMenu registers it
          from here, though the heading itself only shows from lg. */}
      <OrderPageHeading
        customerId={customerId}
        customerName={customerName}
        customerDisplayName={customerDisplayName}
        actions={
          order ? (
            <OrderHeaderMenu
              orderId={id}
              customerId={customerId ?? undefined}
              customerName={customerDisplayName}
              share={orderShareData}
              canManage={canLogCommunication}
              remindersSectionId={REMINDERS_SECTION_ID}
            />
          ) : null
        }
      />

      {errors.order ? <p className="text-sm text-destructive">שגיאת הזמנה: {errors.order}</p> : null}
      {errors.items ? <p className="text-sm text-destructive">שגיאת פריטים: {errors.items}</p> : null}
      {errors.payments ? <p className="text-sm text-destructive">שגיאת תשלומים: {errors.payments}</p> : null}
      {errors.financials && !errors.financials.includes("order_financials_view") ? (
        <p className="text-sm text-destructive">שגיאת סיכום הזמנה: {errors.financials}</p>
      ) : null}
      {extras?.errors.deliveryLinks ? (
        <p className="text-sm text-destructive">שגיאת תמונות אספקה: {extras.errors.deliveryLinks}</p>
      ) : null}
      {extras?.errors.orderDocuments ? (
        <p className="text-sm text-destructive">שגיאת מסמכי Morning: {extras.errors.orderDocuments}</p>
      ) : null}
      {extras?.errors.paymentDocuments ? (
        <p className="text-sm text-destructive">שגיאת מסמכי Morning לתשלומים: {extras.errors.paymentDocuments}</p>
      ) : null}

      {order ? (
        <section className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <StatActionCard
              icon={<DeliveryIcon className="h-5 w-5" />}
              label="סטטוס הזמנה"
              value={getOrderStatusLabel(getString(order, "status") ?? "")}
              valueClassName={
                orderIsActive
                  ? "text-primary"
                  : (getString(order, "status") ?? "").toLowerCase() === "cancelled"
                    ? "text-muted-foreground"
                    : "text-success-soft-foreground"
              }
              // Everything the old header line carried lives here now: when it
              // was ordered, how long ago that was, and who entered it.
              details={[
                {
                  label: "תאריך הזמנה",
                  value: (
                    <>
                      {formatDate(orderDate)}
                      {formatRelativeDateLabel(orderDate) ? ` (${formatRelativeDateLabel(orderDate)})` : ""}
                      {orderEnteredLabel ? (
                        <span className="block font-normal text-muted-foreground">{orderEnteredLabel}</span>
                      ) : null}
                    </>
                  ),
                },
                ...(orderRequestedDeliveryDate
                  ? [{ label: "תאריך אספקה מבוקש", value: formatDate(orderRequestedDeliveryDate) }]
                  : []),
                { label: "פריטים", value: `${orderItems.length} (${totalUnits} יחידות)` },
                ...(orderDeliveryConfirmedAt ? [{ label: "אספקה אושרה", value: formatDayOrDateTime(orderDeliveryConfirmedAt) }] : []),
              ]}
              action={
                needsDeliveryAction ? (
                  // Its own name and ✓ (MARK_DELIVERED_LABEL), the same as on
                  // every list; the page's one main button keeps its fill.
                  <OrderConfirmDialog
                    orderId={id}
                    buttonClassName={FULL_SECONDARY_TRIGGER_CLASSES}
                    authorName={viewer.name}
                  />
                ) : null
              }
            />

            {/* Phone: who to call sits directly under the status card — the
                header no longer carries the number. On desktop the same card
                keeps its place at the top of the side column. */}
            <div className="lg:hidden">
              <CustomerContactCard
                customerId={customerId}
                name={customerName}
                invoiceName={customerNameForInvoice}
                registrationNumber={customerRegistrationNumber}
                branchName={customerBranchName}
                phone={effectivePhone}
                email={customerEmail}
                address={effectiveAddress}
                pin={orderPin} addressNotFound={orderAddressNotFound}
              />
            </div>

            <StatActionCard
              icon={<PaymentIcon className="h-5 w-5" />}
              label="תשלום"
              value={needsPricingAction ? "לא נקבע סכום" : remainingBalance > 0.009 ? formatCurrency(remainingBalance) : "שולם"}
              valueClassName={needsPricingAction || remainingBalance > 0.009 ? "text-primary" : "text-success-soft-foreground"}
              badges={
                <>
                  {needsPricingAction || remainingBalance > 0.009 || collectionStatus === "overpaid" ? (
                    <span className={`text-xs font-semibold ${collectionStatusTextClass(collectionStatus)}`}>
                      {orderCollectionStatusLabel(collectionStatus)}
                    </span>
                  ) : null}
                  <span className={`text-xs font-semibold ${collectOnDelivery ? "text-primary" : "text-muted-foreground"}`}>
                    {collectOnDelivery ? "גבייה ע”י הנהג" : "גבייה במשרד"}
                  </span>
                </>
              }
              subtitles={needsPricingAction ? ["להזמנה יש פריטים אבל לא נקבע סכום — עדכן מחירים"] : undefined}
              details={
                needsPricingAction
                  ? undefined
                  : [
                      { label: "נגבה", value: `${formatCurrency(totalPaid)} מתוך ${formatCurrency(totalAmount)}` },
                      { label: "תשלומים", value: String(paymentCount) },
                      ...(expectedAmount > 0.009
                        ? [
                            {
                              label: "צפוי לגבייה",
                              value: `${formatCurrency(expectedAmount)}${
                                overdueExpectedAmount > 0.009 ? ` (${formatCurrency(overdueExpectedAmount)} באיחור)` : ""
                              }`,
                            },
                          ]
                        : []),
                      {
                        label: "תנאי תשלום",
                        value: `${paymentTermsLabel(orderPaymentTerms)}${orderDueDate ? ` · פירעון ${formatDate(orderDueDate)}` : ""}`,
                      },
                      ...(orderPendingMethods.length > 0 ? [{ label: "אמצעי תשלום", value: orderPendingMethods.join(", ") }] : []),
                    ]
              }
              action={
                needsPricingAction ? (
                  <OrderEditDialog orderId={id} triggerLabel="עריכת מחירים" />
                ) : needsPaymentAction ? (
                  <OrderPaymentDialog
                    orderId={id}
                    totalAmount={totalAmount}
                    paidAmount={totalPaid}
                    buttonClassName={FULL_SECONDARY_TRIGGER_CLASSES}
                    devicePage="orders"
                  />
                ) : null
              }
            />

            <StatActionCard
              icon={<DocumentIcon className="h-5 w-5" />}
              label="חשבונית"
              value={
                <InvoiceQuickMenu
                  orderId={id}
                  needsInvoice={orderNeedsInvoice}
                  invoiceSentAt={orderInvoiceSentAt}
                  showSentDate={false}
                  variant="text"
                />
              }
              details={orderInvoiceSentAt ? [{ label: "תאריך הנפקה", value: formatDateTime(orderInvoiceSentAt) }] : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-start">
            <div className="space-y-3 lg:order-2">
              <div className="hidden lg:block">
                <CustomerContactCard
                  customerId={customerId}
                  name={customerName}
                  invoiceName={customerNameForInvoice}
                  registrationNumber={customerRegistrationNumber}
                  branchName={customerBranchName}
                  phone={effectivePhone}
                  email={customerEmail}
                  address={effectiveAddress}
                  pin={orderPin} addressNotFound={orderAddressNotFound}
                />
              </div>

              {/* A cancelled order was never delivered and never will be, so it
                  gets no card. Otherwise the card always shows — it's the home
                  for managing delivery photos (add/replace/delete), not just a
                  post-delivery record. */}
              {orderIsCancelled ? null : extras ? (
                <DeliveryImagesCard
                  orderId={id}
                  images={extras.deliveryImages}
                  deliveryConfirmedAt={orderDeliveryConfirmedAt}
                  needsDeliveryAction={needsDeliveryAction}
                  orderStatus={orderStatusValue}
                  authorName={viewer.name}
                />
              ) : (
                <PendingBlock className="h-32" />
              )}
            </div>

            <div className="space-y-3 lg:order-1 lg:col-span-2">
              {/* Section icons grey and a section's count the dashboard's grey
                  pill, on every page (owner, 2026-10-11: these were outlined
                  "N פריטים / N רשומות" pills). */}
              <SectionCard
                icon={<OrderIcon className={SECTION_ICON_CLASS} />}
                title="פריטים"
                aside={<SectionCount count={orderItems.length} />}
              >
                {orderItems.length === 0 ? (
                  <EmptyState dense>לא נמצאו פריטים להזמנה זו.</EmptyState>
                ) : (
                  <>
                    <div className="divide-y divide-border/60">
                      {orderItems.map((item, index) => {
                        const productId = getString(item, "product_id") ?? "";
                        const product = productMap.get(productId);
                        const productName =
                          getString(product ?? {}, "name") ??
                          getString(product ?? {}, "product_name") ??
                          // Off-catalog (custom) line: its name is the description.
                          getString(item, "description") ??
                          productId;
                        const quantity = getNumber(item, "quantity_ordered") ?? 0;
                        const delivered = getNumber(item, "quantity_delivered") ?? 0;
                        const unitPrice = getNumber(item, "unit_price") ?? 0;
                        const lineTotal = getNumber(item, "line_total") ?? quantity * unitPrice;
                        const lineDiscountAmount = getNumber(item, "discount_amount") ?? 0;
                        const lineNotes = getString(item, "notes");
                        // Show fulfillment only while a line is unfinished — a fully
                        // delivered (or untouched) line doesn't need "נמסר X מתוך Y".
                        const showDelivery = delivered > 0 && delivered < quantity;
                        // Only meaningful while the order is still open — a closed/
                        // delivered order already consumed whatever stock it had.
                        const availableStock = getNumber(product ?? {}, "available_quantity");
                        const shortfall = orderIsActive && typeof availableStock === "number" && quantity > availableStock;

                        return (
                          <div
                            key={getString(item, "id") ?? `${productId}-${index}`}
                            className="flex items-center justify-between gap-3 py-2.5 text-sm"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-xs font-semibold">
                                ×{quantity}
                              </span>
                              <div className="min-w-0">
                                <div className="font-medium">{productName}</div>
                                <div className="text-xs text-muted-foreground">
                                  מחיר יחידה {formatCurrency(unitPrice)}
                                  {lineDiscountAmount > 0 ? ` · הנחה -${formatCurrency(lineDiscountAmount)}` : ""}
                                </div>
                                {showDelivery ? (
                                  <div className="mt-0.5 text-xs font-medium text-warning-soft-foreground">
                                    נמסר {delivered} מתוך {quantity} · נותר {quantity - delivered}
                                  </div>
                                ) : null}
                                {shortfall ? (
                                  <div className="mt-0.5 text-xs font-medium text-destructive-soft-foreground">
                                    חוסר במלאי — במלאי {availableStock}, הוזמנו {quantity}
                                  </div>
                                ) : null}
                                {lineNotes ? (
                                  <div className="mt-0.5 flex items-start gap-1 text-xs text-primary">
                                    <CommentIcon className="mt-0.5 h-3 w-3 shrink-0" />
                                    <span>{lineNotes}</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="shrink-0 font-semibold">{formatCurrency(lineTotal)}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-1 rounded-xl bg-muted/30 p-3 text-sm">
                      {totalDiscount > 0 ? (
                        <>
                          <div className="flex items-center justify-between gap-2 text-muted-foreground">
                            <span>סכום ביניים · {totalUnits} יחידות</span>
                            <span>{formatCurrency(subtotal)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-success-soft-foreground">
                            <span>הנחה</span>
                            <span>-{formatCurrency(totalDiscount)}</span>
                          </div>
                        </>
                      ) : null}
                      <div className="flex items-center justify-between gap-2 font-semibold">
                        <span>
                          סה&quot;כ הזמנה
                          {totalDiscount > 0 ? "" : ` · ${totalUnits} יחידות`}
                        </span>
                        <span>{formatCurrency(totalAmount)}</span>
                      </div>
                    </div>
                  </>
                )}
              </SectionCard>

              {viewer.role === "admin" || viewer.role === "office" ? (
                <OrderRemindersSection id={REMINDERS_SECTION_ID} orderId={id} customerId={customerId ?? undefined} canManage />
              ) : null}

              <SectionCard
                icon={<PaymentIcon className={SECTION_ICON_CLASS} />}
                title="תשלומים"
                aside={
                  canManagePayments && !needsPaymentAction && !needsPricingAction ? (
                    <OrderPaymentDialog orderId={id} totalAmount={totalAmount} paidAmount={totalPaid} devicePage="orders" />
                  ) : (
                    <SectionCount count={payments.length} />
                  )
                }
              >
                <OrderPaymentActionsClient
                  orderId={id}
                  customerId={customerId}
                  totalAmount={totalAmount}
                  payments={paymentsWithMeta}
                  canManage={canManagePayments}
                />
              </SectionCard>

              <SectionCard
                icon={<ReceiptIcon className={SECTION_ICON_CLASS} />}
                title="מסמכים"
                aside={
                  orderLevelMorningDocuments.length > 0 ? (
                    <SectionCount count={orderLevelMorningDocuments.length} />
                  ) : null
                }
              >
                {!customerId ? (
                  <p className="text-sm text-muted-foreground">לא נמצא לקוח מקושר למסמכי Morning.</p>
                ) : extras ? (
                  <MorningDocumentsPanel
                    customerId={customerId}
                    orderId={id}
                    documents={orderLevelMorningDocuments}
                    allowQuote
                    allowInvoice
                  />
                ) : (
                  <PendingBlock className="h-16" />
                )}
              </SectionCard>

              <SectionCard icon={<CommentIcon className={SECTION_ICON_CLASS} />} title="הערות ותגובות">
                <OrderCommentsThread orderId={id} initialNotes={orderNotes} authorColors={core.commentAuthorColors} />
              </SectionCard>

              {isAdmin ? (
                <SectionCard
                  icon={<HistoryIcon className={SECTION_ICON_CLASS} />}
                  title="היסטוריית פעילות"
                  aside={orderActivity.length > 0 ? <SectionCount count={orderActivity.length} /> : null}
                >
                  {extras ? <EntityActivityTimeline items={orderActivity} /> : <PendingBlock className="h-20" />}
                </SectionCard>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

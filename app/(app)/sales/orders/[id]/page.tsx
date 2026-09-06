import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { StatActionCard, collectionStatusTextClass } from "@/components/ui/stat-action-card";
import { ChevronLeftIcon, CommentIcon, CopyIcon, DeliveryIcon, DocumentIcon, HistoryIcon, OrderIcon, PaymentIcon, ReceiptIcon } from "@/components/ui/icons";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { getOrderStatusLabel } from "@/lib/ui/status-colors";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { getEntityAuditTrail, getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import DeleteOrderButton from "@/app/(app)/sales/orders/[id]/DeleteOrderButton";
import OrderRemindersSection from "@/app/(app)/sales/orders/[id]/OrderRemindersSection";
import DeliveryImagesCard from "@/app/(app)/sales/orders/[id]/DeliveryImagesCard";
import { SectionCard } from "@/components/ui/section-card";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";
import OrderPaymentDialog from "@/app/(app)/sales/orders/OrderPaymentDialog";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import OrderEditDialog from "@/app/(app)/sales/orders/OrderEditDialog";
import InvoiceQuickMenu from "@/app/(app)/sales/orders/InvoiceQuickMenu";
import OrderCommentsThread from "@/app/(app)/sales/orders/[id]/OrderCommentsThread";
import OrderShareActions from "@/app/(app)/sales/orders/[id]/OrderShareActions";
import OrderHeaderMenu from "@/app/(app)/sales/orders/[id]/OrderHeaderMenu";
import { CustomerContactCard } from "@/components/customers/CustomerContactCard";
import { STORAGE_BUCKET } from "@/lib/storage";
import { OrderPaymentActionsClient } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";
import type { PaymentItem } from "@/app/(app)/sales/orders/OrderPaymentActionsClient";
import { splitPaymentAmounts, orderCollectionStatusLabel, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { computeSourceCollection, isOpenOrderStatus } from "@/lib/collections";
import { attachProductStock } from "@/lib/orders/productStock";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import { formatRelativeDateLabel, formatShortDate, formatShortDateTime } from "@/lib/date";
import type { MorningLocalDocument } from "@/lib/morning/types";

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
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  return formatShortDate(value);
}

function formatDateTime(value: string | null) {
  return formatShortDateTime(value, "-");
}

function paymentInsertedByLabel(
  payment: Row,
  {
    paymentRecordedByNameByValue,
    paymentAuditById,
  }: {
    paymentRecordedByNameByValue: Record<string, string>;
    paymentAuditById: Record<string, { action: string; actorName: string; createdAt: string | null }>;
  }
) {
  const recordedByValue = getString(payment, "recorded_by");
  if (recordedByValue && paymentRecordedByNameByValue[recordedByValue]) {
    return `הוזן ע"י ${paymentRecordedByNameByValue[recordedByValue]}`;
  }

  const paymentId = getString(payment, "id");
  if (!paymentId) return null;
  const audit = paymentAuditById[paymentId];
  if (audit?.action === "create") {
    return `הוזן ע"י ${audit.actorName}${audit.createdAt ? ` | ${formatDateTime(audit.createdAt)}` : ""}`;
  }

  return null;
}


function formatAddressForDisplay(address: string | null) {
  if (!address) return null;
  const parts = address
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Full-width solid-fill override for dialog trigger buttons whose default variant is outline. */
const FULL_SECONDARY_TRIGGER_CLASSES =
  "border-transparent bg-secondary text-secondary-foreground shadow-md shadow-secondary/20 hover:bg-secondary/90 hover:text-secondary-foreground w-full";

/** Anchor of the תזכורות section — the phone פעולות list links to it. */
const REMINDERS_SECTION_ID = "order-reminders";


export default async function SalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireStaffPage();

  const [
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: financials, error: financialsError },
    { data: deliveryLinks, error: deliveryLinksError },
    { data: collectRow },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,branch_id,order_date,status,payment_status,payment_terms,due_date,discount_amount,notes,needs_invoice,invoice_sent_at,delivery_confirmed_at,requested_delivery_date,created_by")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id,order_id,product_id,description,quantity_ordered,quantity_delivered,unit_price,discount_amount,line_total,notes")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,payment_status,due_date,reference_number,check_number,account_id,notes,created_at,recorded_by")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid,collected_amount,pending_amount,overdue_amount,remaining_balance,payment_count,payment_status,next_due_date")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("document_links")
      .select("document_id,created_at")
      .eq("entity_type", "order")
      .eq("entity_id", id),
    // Separate best-effort read: the column only exists after running
    // db/sql/add_collect_payment_on_delivery.sql — never break the page before that.
    supabase.from("orders").select("collect_payment_on_delivery").eq("id", id).maybeSingle(),
  ]);

  const collectOnDelivery = (collectRow as Row | null)?.collect_payment_on_delivery === true;

  const customerId =
    order && typeof (order as Row).customer_id === "string"
      ? ((order as Row).customer_id as string)
      : null;
  const branchId =
    order && typeof (order as Row).branch_id === "string" ? ((order as Row).branch_id as string) : null;

  // Derive all the lookup keys from the first batch up front so the dependent
  // reads below can all run in ONE parallel round trip instead of ~5 sequential.
  const productIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((row) => (typeof row?.product_id === "string" ? row.product_id : null))
        .filter(Boolean)
    )
  ) as string[];
  const paymentIds = Array.from(
    new Set(
      ((payments ?? []) as Row[])
        .map((payment) => getString(payment, "id"))
        .filter((value): value is string => Boolean(value))
    )
  );
  const paymentRecordedByValues = Array.from(
    new Set(
      ((payments ?? []) as Row[])
        .map((payment) => getString(payment, "recorded_by"))
        .filter((value): value is string => Boolean(value))
    )
  );
  const orderCreatedBy = getString((order as Row) ?? {}, "created_by");
  const deliveryDocumentIds = Array.from(
    new Set(
      ((deliveryLinks ?? []) as Row[])
        .map((row) => getString(row as Row, "document_id"))
        .filter((value): value is string => Boolean(value))
    )
  );

  const morningDocSelect =
    "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes";

  const [
    { data: customer },
    { data: branch },
    { data: products },
    paymentAuditResult,
    paymentRecordedByNameByValue,
    { data: orderMorningDocuments, error: orderMorningDocumentsError },
    { data: paymentMorningDocuments, error: paymentMorningDocumentsError },
    { data: deliveryDocuments },
  ] = await Promise.all([
    customerId
      ? supabase
          .from("customers")
          .select("id,name,name_for_invoice,registration_number,email,phone,address")
          .eq("id", customerId)
          .maybeSingle()
      : Promise.resolve({ data: null as Row | null }),
    branchId
      ? supabase.from("customer_branches").select("id,name,address,phone").eq("id", branchId).maybeSingle()
      : Promise.resolve({ data: null as Row | null }),
    productIds.length > 0
      ? supabase.from("products").select("id,name,sku,barcode").in("id", productIds)
      : Promise.resolve({ data: [] as Row[] }),
    getLatestAuditByRecordIds(supabase, { tableName: "payments", recordIds: paymentIds }),
    resolveUserDisplayNamesForValues(
      supabase,
      Array.from(new Set([...paymentRecordedByValues, ...(orderCreatedBy ? [orderCreatedBy] : [])]))
    ),
    supabase
      .from("morning_documents")
      .select(morningDocSelect)
      .eq("order_id", id)
      .order("issued_at", { ascending: false }),
    paymentIds.length > 0
      ? supabase
          .from("morning_documents")
          .select(morningDocSelect)
          .in("payment_id", paymentIds)
          .order("issued_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[], error: null }),
    deliveryDocumentIds.length > 0
      ? supabase
          .from("documents")
          .select("id,file_name,storage_key,uploaded_at,document_type")
          .in("id", deliveryDocumentIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const orderCreatedByName = orderCreatedBy ? paymentRecordedByNameByValue[orderCreatedBy] ?? null : null;

  // Live stock (on-hand − reserved) per line, so the item list can name exactly
  // which product is short — same signal/formula as the orders list badge and
  // the create/confirm wizards.
  const productsWithStock = await attachProductStock(supabase, (products ?? []) as Row[]);
  const productMap = new Map<string, Row>();
  productsWithStock.forEach((row) => {
    if (typeof row?.id === "string") {
      productMap.set(row.id, row as Row);
    }
  });

  const morningDocuments = Array.from(
    new Map(
      [...((orderMorningDocuments ?? []) as Row[]), ...((paymentMorningDocuments ?? []) as Row[])].map((row) => [
        getString(row, "id") ?? "",
        row,
      ])
    ).values()
  ).filter((row) => Boolean(getString(row as Row, "id"))) as MorningLocalDocument[];

  const orderLevelMorningDocuments = morningDocuments.filter((document) => !document.payment_id);

  const deliveryDocumentMap = new Map<string, Row>();
  ((deliveryDocuments ?? []) as Row[]).forEach((row) => {
    const documentId = getString(row as Row, "id");
    if (documentId) deliveryDocumentMap.set(documentId, row as Row);
  });

  // Sign every delivery image in ONE storage call (was one request per image).
  const deliveryImageDocs = ((deliveryLinks ?? []) as Row[])
    .map((link) => {
      const documentId = getString(link as Row, "document_id");
      const document = documentId ? deliveryDocumentMap.get(documentId) : null;
      if (!documentId || !document) return null;
      if (getString(document, "document_type") !== "order_delivery_image") return null;
      const storageKey = getString(document, "storage_key");
      if (!storageKey) return null;
      return {
        id: documentId,
        storageKey,
        file_name: getString(document, "file_name"),
        uploaded_at: getString(document, "uploaded_at") ?? getString(link as Row, "created_at"),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const signedUrlByKey = new Map<string, string>();
  if (deliveryImageDocs.length > 0) {
    const { data: signedList } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrls(
        deliveryImageDocs.map((d) => d.storageKey),
        60 * 60
      );
    (signedList ?? []).forEach((entry) => {
      if (entry && typeof entry.path === "string" && typeof entry.signedUrl === "string") {
        signedUrlByKey.set(entry.path, entry.signedUrl);
      }
    });
  }

  const deliveryImagesResolved = deliveryImageDocs.map((d) => ({
    id: d.id,
    file_name: d.file_name,
    uploaded_at: d.uploaded_at,
    url: signedUrlByKey.get(d.storageKey) ?? null,
  }));

  const customerName =
    getString((customer as Row) ?? {}, "name") ??
    getString((customer as Row) ?? {}, "name_for_invoice") ??
    customerId ??
    "-";
  const customerNameForInvoiceRaw = getString((customer as Row) ?? {}, "name_for_invoice");
  const customerNameForInvoice =
    customerNameForInvoiceRaw && customerNameForInvoiceRaw !== customerName
      ? customerNameForInvoiceRaw
      : null;
  const customerBranchName = getString((branch as Row) ?? {}, "name");
  // Only used where a single combined label is needed (share text, print) — the
  // page's own customer card shows the branch as its own row instead.
  const customerDisplayName = customerBranchName ? `${customerName} · סניף ${customerBranchName}` : customerName;
  const customerRegistrationNumber = getString((customer as Row) ?? {}, "registration_number");
  const customerPhone = getString((customer as Row) ?? {}, "phone");
  const customerEmail = getString((customer as Row) ?? {}, "email");
  const fullAddress = formatAddressForDisplay(getString((customer as Row) ?? {}, "address"));
  // The branch's own address/phone (when this order is for one) is where the
  // order actually goes — falls back to the customer's own contact details.
  const branchAddress = getString((branch as Row) ?? {}, "address");
  const branchPhone = getString((branch as Row) ?? {}, "phone");
  const effectiveAddress = branchAddress ? formatAddressForDisplay(branchAddress) : fullAddress;
  const effectivePhone = branchPhone ?? customerPhone;
  const orderNotes = getString((order as Row) ?? {}, "notes");

  // Comment avatars should use each author's CHOSEN color (users.avatar_color),
  // matching the color they picked everywhere else. Comments store only the
  // author's display name, so we resolve name/email → color here. The users
  // table is small, so one plain read (only when there are notes) is fine.
  const commentAuthorColors: Record<string, string> = {};
  if (orderNotes) {
    const { data: userRows } = await supabase.from("users").select("full_name,email,avatar_color");
    for (const row of (userRows ?? []) as Row[]) {
      const color =
        typeof row.avatar_color === "string" && row.avatar_color.trim() ? row.avatar_color.trim() : null;
      if (!color) continue;
      const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
      const email = typeof row.email === "string" ? row.email.trim() : "";
      if (fullName) commentAuthorColors[fullName] = color;
      if (email) commentAuthorColors[email] = color;
    }
  }

  const orderDate = getString((order as Row) ?? {}, "order_date");
  const orderNeedsInvoice =
    typeof (order as Row)?.needs_invoice === "boolean" ? ((order as Row).needs_invoice as boolean) : null;
  const orderInvoiceSentAt = getString((order as Row) ?? {}, "invoice_sent_at");
  const orderDeliveryConfirmedAt = getString((order as Row) ?? {}, "delivery_confirmed_at");
  const orderRequestedDeliveryDate = getString((order as Row) ?? {}, "requested_delivery_date");

  const subtotal = ((orderItems ?? []) as Row[]).reduce((sum, item) => {
    const quantity = getNumber(item, "quantity_ordered") ?? 0;
    const unitPrice = getNumber(item, "unit_price") ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
  const lineDiscount = ((orderItems ?? []) as Row[]).reduce(
    (sum, item) => sum + (getNumber(item, "discount_amount") ?? 0),
    0
  );
  const orderDiscount = getNumber((order as Row) ?? {}, "discount_amount") ?? 0;
  const totalDiscount = lineDiscount + orderDiscount;
  const derivedTotalAmount = Math.max(subtotal - totalDiscount, 0);
  // COLLECTION SPLIT: "paid" reflects collected money only; expected (pending)
  // money is shown separately so a future-dated payment never marks the order שולם.
  const paymentSplit = splitPaymentAmounts(
    ((payments ?? []) as Row[]).map((payment) => ({
      amount_total: getNumber(payment, "amount_total") ?? 0,
      payment_status: getString(payment, "payment_status"),
      due_date: getString(payment, "due_date"),
    }))
  );
  const derivedTotalPaid = paymentSplit.collected;
  const expectedAmount =
    getNumber((financials as Row) ?? {}, "pending_amount") ?? paymentSplit.pending;
  const overdueExpectedAmount =
    getNumber((financials as Row) ?? {}, "overdue_amount") ?? paymentSplit.overdue;
  const viewTotalAmount = getNumber((financials as Row) ?? {}, "total_amount");
  const viewTotalPaid = getNumber((financials as Row) ?? {}, "total_paid");
  const useDerivedFinancials =
    viewTotalAmount === null ||
    (Math.abs((viewTotalAmount ?? 0) - derivedTotalAmount) > 0.009 && derivedTotalAmount > 0) ||
    Math.abs((viewTotalPaid ?? 0) - derivedTotalPaid) > 0.009;
  const totalAmount = useDerivedFinancials ? derivedTotalAmount : viewTotalAmount ?? 0;
  const totalPaid = useDerivedFinancials ? derivedTotalPaid : viewTotalPaid ?? 0;
  const remainingBalance = useDerivedFinancials
    ? Math.max(derivedTotalAmount - derivedTotalPaid, 0)
    : getNumber((financials as Row) ?? {}, "remaining_balance") ?? Math.max(totalAmount - totalPaid, 0);
  const paymentCount = getNumber((financials as Row) ?? {}, "payment_count") ?? (payments ?? []).length;
  const orderDueDate = getString((order as Row) ?? {}, "due_date");
  const orderPaymentTerms = getString((order as Row) ?? {}, "payment_terms");
  const orderPendingMethods = Array.from(
    new Set(
      ((payments ?? []) as Row[])
        .filter(
          (p) =>
            (getString(p, "payment_status") ?? "").toLowerCase() === "pending" &&
            getString(p, "payment_method")
        )
        .map((p) => paymentMethodLabel(getString(p, "payment_method")))
    )
  );
  const collectionStatus = computeSourceCollection({
    total: totalAmount,
    collected: paymentSplit.collected,
    pending: paymentSplit.pending,
    overdue: paymentSplit.overdue,
    outstanding: remainingBalance,
    nextDueDate: getString((financials as Row) ?? {}, "next_due_date"),
    referenceDate: orderDate,
    dueDate: orderDueDate,
    blockOverdue: isOpenOrderStatus(getString((order as Row) ?? {}, "status")),
    today: new Date().toISOString().slice(0, 10),
  }).status;
  const canManagePayments = profile.role === "admin" || profile.role === "office";

  const paymentsWithMeta: PaymentItem[] = ((payments ?? []) as Row[]).map((payment) => {
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
        paymentAuditById: paymentAuditResult.byRecordId,
      }),
      morningDocuments: morningDocuments.filter((d) => d.payment_id === paymentId),
    };
  });

  // "מה צריך לעשות" — pending actions for this order.
  const orderStatusValue = getString((order as Row) ?? {}, "status") ?? "";
  const orderIsActive = Boolean(order) && isOpenOrderStatus(orderStatusValue);
  const orderIsCancelled = orderStatusValue.trim().toLowerCase() === "cancelled";
  const needsDeliveryAction = orderIsActive;
  const needsPaymentAction = Boolean(order) && remainingBalance > 0.009;
  // An order whose total is 0 but has items is mispriced — surface it instead of
  // letting a "remaining = 0" hide the payment action on an unpaid order.
  const needsPricingAction =
    Boolean(order) && totalAmount <= 0.009 && (orderItems ?? []).length > 0;
  const totalUnits = (orderItems ?? []).reduce(
    (sum, item) => sum + (getNumber(item as Row, "quantity_ordered") ?? 0),
    0
  );

  // Serializable order summary for the WhatsApp-share + print/PDF actions.
  const shareItems = ((orderItems ?? []) as Row[]).map((item) => {
    const productId = getString(item, "product_id") ?? "";
    const product = productMap.get(productId);
    const quantity = getNumber(item, "quantity_ordered") ?? 0;
    const unitPrice = getNumber(item, "unit_price") ?? 0;
    return {
      name:
        getString((product ?? {}) as Row, "name") ??
        getString((product ?? {}) as Row, "product_name") ??
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

  // Per-entity activity timeline (admin only, mirroring /activity access). Shows
  // this order's own change history plus payments recorded against it.
  const orderActivity =
    profile.role === "admin" && order
      ? (
          await getEntityAuditTrail(supabase, [
            { tableName: "orders", recordId: id },
            { tableName: "payments", jsonKey: "order_id", value: id },
          ])
        ).items
      : [];

  // The handful of things you do to an order. Rendered twice: inline in the
  // desktop heading, and — on the phone — as a פעולות section at the foot of the
  // page, the same shape the project page uses.
  const canLogCommunication = profile.role === "admin" || profile.role === "office";
  const orderActionButtons = (
    <>
      <Button asChild size="sm" variant="outline" className="h-9">
        <Link href={`/sales/orders/new?duplicate=${id}`} title="שכפול הזמנה">
          <CopyIcon className="h-4 w-4" />
          <span>שכפול</span>
        </Link>
      </Button>
      <OrderShareActions order={orderShareData} />
      <OrderEditDialog orderId={id} />
      {canLogCommunication ? (
        <LogCommunicationButton
          entityType="order"
          entityId={id}
          customerId={customerId}
          defaultTopic="sales"
          className="h-9"
        />
      ) : null}
    </>
  );

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-3">
        {/* Desktop chrome only. Everything this line used to say — order date,
            how long ago, who entered it — is in the סטטוס הזמנה card now. */}
        <div className="hidden space-y-2 lg:block">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            {/* Desktop only — on the phone the customer name and the order number
                are in the top bar, so a "מכירות ‹ name" line here is a repeat. */}
            <nav
              className="hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground lg:flex"
              aria-label="ניווט"
            >
              <Link href="/sales" className="hover:text-foreground hover:underline">
                מכירות
              </Link>
              <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
              <h1 className="min-w-0 truncate text-lg font-bold text-foreground">
                {customerId ? (
                  <Link href={`/customers/${customerId}`} className="hover:underline">
                    {customerDisplayName}
                  </Link>
                ) : (
                  customerName
                )}
              </h1>
            </nav>
            {/* Desktop only — on the phone these live at the foot of the page,
                where the project page keeps them. */}
            {order ? (
              <div className="hidden shrink-0 flex-wrap items-center gap-2 lg:flex">
                {orderActionButtons}
                <DeleteOrderButton orderId={id} />
              </div>
            ) : null}
          </div>
        </div>

        {orderError ? <p className="text-sm text-destructive">שגיאת הזמנה: {orderError.message}</p> : null}
        {itemsError ? <p className="text-sm text-destructive">שגיאת פריטים: {itemsError.message}</p> : null}
        {paymentsError ? <p className="text-sm text-destructive">שגיאת תשלומים: {paymentsError.message}</p> : null}
        {financialsError && !financialsError.message.includes("order_financials_view") ? (
          <p className="text-sm text-destructive">שגיאת סיכום הזמנה: {financialsError.message}</p>
        ) : null}
        {deliveryLinksError ? (
          <p className="text-sm text-destructive">שגיאת תמונות אספקה: {deliveryLinksError.message}</p>
        ) : null}
        {orderMorningDocumentsError ? (
          <p className="text-sm text-destructive">שגיאת מסמכי Morning: {orderMorningDocumentsError.message}</p>
        ) : null}
        {paymentMorningDocumentsError ? (
          <p className="text-sm text-destructive">שגיאת מסמכי Morning לתשלומים: {paymentMorningDocumentsError.message}</p>
        ) : null}

        {order ? (
          <section className="space-y-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <StatActionCard
                icon={<DeliveryIcon className="h-5 w-5" />}
                label="סטטוס הזמנה"
                value={getOrderStatusLabel(getString(order as Row, "status") ?? "")}
                valueClassName={
                  orderIsActive
                    ? "text-primary"
                    : (getString(order as Row, "status") ?? "").toLowerCase() === "cancelled"
                      ? "text-muted-foreground"
                      : "text-success-soft-foreground"
                }
                // Everything the old header line carried lives here now: when it
                // was ordered, how long ago that was, and who entered it.
                details={[
                  {
                    label: "תאריך הזמנה",
                    value: `${formatDate(orderDate)}${
                      formatRelativeDateLabel(orderDate) ? ` (${formatRelativeDateLabel(orderDate)})` : ""
                    }`,
                  },
                  ...(orderRequestedDeliveryDate
                    ? [{ label: "תאריך אספקה מבוקש", value: formatDate(orderRequestedDeliveryDate) }]
                    : []),
                  { label: "פריטים", value: `${(orderItems ?? []).length} (${totalUnits} יחידות)` },
                  ...(orderDeliveryConfirmedAt
                    ? [{ label: "אספקה אושרה", value: formatDate(orderDeliveryConfirmedAt) }]
                    : []),
                  ...(orderCreatedByName ? [{ label: 'הוזן ע"י', value: orderCreatedByName }] : []),
                ]}
                action={
                  needsDeliveryAction ? (
                    <OrderConfirmDialog
                      orderId={id}
                      buttonLabel="אישור אספקה"
                      buttonClassName={FULL_SECONDARY_TRIGGER_CLASSES}
                      authorName={profile.full_name ?? profile.email ?? null}
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
                />
              </div>

              <StatActionCard
                icon={<PaymentIcon className="h-5 w-5" />}
                label="תשלום"
                value={
                  needsPricingAction
                    ? "לא נקבע סכום"
                    : remainingBalance > 0.009
                      ? formatCurrency(remainingBalance)
                      : "שולם"
                }
                valueClassName={
                  needsPricingAction || remainingBalance > 0.009
                    ? "text-primary"
                    : "text-success-soft-foreground"
                }
                badges={
                  <>
                    {needsPricingAction ||
                    remainingBalance > 0.009 ||
                    collectionStatus === "overpaid" ? (
                      <span className={`text-xs font-semibold ${collectionStatusTextClass(collectionStatus)}`}>
                        {orderCollectionStatusLabel(collectionStatus)}
                      </span>
                    ) : null}
                    <span
                      className={`text-xs font-semibold ${
                        collectOnDelivery ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {collectOnDelivery ? "גבייה ע”י הנהג" : "גבייה במשרד"}
                    </span>
                  </>
                }
                subtitles={
                  needsPricingAction
                    ? ["להזמנה יש פריטים אבל לא נקבע סכום — עדכן מחירים"]
                    : undefined
                }
                details={
                  needsPricingAction
                    ? undefined
                    : [
                        {
                          label: "נגבה",
                          value: `${formatCurrency(totalPaid)} מתוך ${formatCurrency(totalAmount)}`,
                        },
                        { label: "תשלומים", value: String(paymentCount) },
                        ...(expectedAmount > 0.009
                          ? [
                              {
                                label: "צפוי לגבייה",
                                value: `${formatCurrency(expectedAmount)}${
                                  overdueExpectedAmount > 0.009
                                    ? ` (${formatCurrency(overdueExpectedAmount)} באיחור)`
                                    : ""
                                }`,
                              },
                            ]
                          : []),
                        {
                          label: "תנאי תשלום",
                          value: `${paymentTermsLabel(orderPaymentTerms)}${
                            orderDueDate ? ` · פירעון ${formatDate(orderDueDate)}` : ""
                          }`,
                        },
                        ...(orderPendingMethods.length > 0
                          ? [{ label: "אמצעי תשלום", value: orderPendingMethods.join(", ") }]
                          : []),
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
                details={
                  orderInvoiceSentAt
                    ? [{ label: "תאריך הנפקה", value: formatDate(orderInvoiceSentAt) }]
                    : undefined
                }
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
              />
            </div>

            {/* A cancelled order was never delivered and never will be, so it
                gets no card. Otherwise the card always shows — it's the home
                for managing delivery photos (add/replace/delete), not just a
                post-delivery record. */}
            {!orderIsCancelled ? (
              <DeliveryImagesCard
                orderId={id}
                images={deliveryImagesResolved}
                deliveryConfirmedAt={orderDeliveryConfirmedAt}
                needsDeliveryAction={needsDeliveryAction}
                orderStatus={orderStatusValue}
                authorName={profile.full_name ?? profile.email ?? null}
              />
            ) : null}
          </div>

          <div className="space-y-3 lg:order-1 lg:col-span-2">
            <SectionCard
              icon={<OrderIcon className="h-4 w-4" />}
              title="פריטים"
              aside={
                <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                  {(orderItems ?? []).length} פריטים
                </span>
              }
            >
              {(orderItems ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו פריטים להזמנה זו.</p>
              ) : (
                <>
                  <div className="divide-y divide-border/60">
                    {(orderItems ?? []).map((item, index) => {
                      const productId = getString(item as Row, "product_id") ?? "";
                      const product = productMap.get(productId);
                      const productName =
                        getString((product ?? {}) as Row, "name") ??
                        getString((product ?? {}) as Row, "product_name") ??
                        // Off-catalog (custom) line: its name is the description.
                        getString(item as Row, "description") ??
                        productId;
                      const quantity = getNumber(item as Row, "quantity_ordered") ?? 0;
                      const delivered = getNumber(item as Row, "quantity_delivered") ?? 0;
                      const unitPrice = getNumber(item as Row, "unit_price") ?? 0;
                      const lineTotal = getNumber(item as Row, "line_total") ?? quantity * unitPrice;
                      const lineDiscountAmount = getNumber(item as Row, "discount_amount") ?? 0;
                      const lineNotes = getString(item as Row, "notes");
                      // Show fulfillment only while a line is unfinished — a fully
                      // delivered (or untouched) line doesn't need "נמסר X מתוך Y".
                      const showDelivery = delivered > 0 && delivered < quantity;
                      // Only meaningful while the order is still open — a closed/
                      // delivered order already consumed whatever stock it had.
                      const availableStock = getNumber((product ?? {}) as Row, "available_quantity");
                      const shortfall =
                        orderIsActive && typeof availableStock === "number" && quantity > availableStock;

                      return (
                        <div
                          key={getString(item as Row, "id") ?? `${productId}-${index}`}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/30 text-xs font-semibold">
                              ×{quantity}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{productName}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                מחיר יחידה {formatCurrency(unitPrice)}
                                {lineDiscountAmount > 0
                                  ? ` · הנחה -${formatCurrency(lineDiscountAmount)}`
                                  : ""}
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

            {profile.role === "admin" || profile.role === "office" ? (
              <OrderRemindersSection
                id={REMINDERS_SECTION_ID}
                orderId={id}
                customerId={customerId ?? undefined}
                canManage
              />
            ) : null}

            <SectionCard
              icon={<PaymentIcon className="h-4 w-4" />}
              title="תשלומים"
              aside={
                canManagePayments && !needsPaymentAction && !needsPricingAction ? (
                  <OrderPaymentDialog orderId={id} totalAmount={totalAmount} paidAmount={totalPaid} />
                ) : (
                  <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {(payments ?? []).length} רשומות
                  </span>
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
              icon={<ReceiptIcon className="h-4 w-4" />}
              title="מסמכים"
              aside={
                orderLevelMorningDocuments.length > 0 ? (
                  <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                    {orderLevelMorningDocuments.length} מסמכים
                  </span>
                ) : null
              }
            >
              {customerId ? (
                <MorningDocumentsPanel
                  customerId={customerId}
                  orderId={id}
                  documents={orderLevelMorningDocuments}
                  allowQuote
                  allowInvoice
                />
              ) : (
                <p className="text-sm text-muted-foreground">לא נמצא לקוח מקושר למסמכי Morning.</p>
              )}
            </SectionCard>

            <SectionCard icon={<CommentIcon className="h-4 w-4" />} title="הערות ותגובות">
              <OrderCommentsThread orderId={id} initialNotes={orderNotes} authorColors={commentAuthorColors} />
            </SectionCard>

            {profile.role === "admin" ? (
              <SectionCard
                icon={<HistoryIcon className="h-4 w-4" />}
                title="היסטוריית פעילות"
                aside={
                  orderActivity.length > 0 ? (
                    <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                      {orderActivity.length} רשומות
                    </span>
                  ) : null
                }
              >
                <EntityActivityTimeline items={orderActivity} />
              </SectionCard>
            ) : null}
          </div>
        </div>
          </section>
        ) : null}

        {/* Phone: the order's number + customer go into the top bar, and these
            same actions become the ⋮ beside the back arrow. Renders no row. */}
        {order ? (
          <OrderHeaderMenu
            orderId={id}
            customerId={customerId ?? undefined}
            customerName={customerDisplayName}
            share={orderShareData}
            canManage={canLogCommunication}
            remindersSectionId={REMINDERS_SECTION_ID}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

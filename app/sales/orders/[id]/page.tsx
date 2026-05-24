import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { NavLink } from "@/components/NavLink";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireProfile } from "@/lib/auth/requireProfile";
import { getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import DeleteOrderButton from "@/app/sales/orders/[id]/DeleteOrderButton";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderEditDialog from "@/app/sales/orders/OrderEditDialog";
import { OrderPaymentActionsClient } from "@/app/sales/orders/OrderPaymentActionsClient";
import type { PaymentItem } from "@/app/sales/orders/OrderPaymentActionsClient";
import { derivePaymentStatus, paymentStatusClasses } from "@/lib/orders/paymentStatus";
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

function normalizeOrderStatus(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return "confirmed";
    case "in_progress":
      return "processing";
    case "ready":
      return "out_for_delivery";
    case "done":
      return "completed";
    default:
      return (status ?? "").toLowerCase();
  }
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

function DetailSection({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-2xl border border-border/70 bg-card/70 p-4" open={defaultOpen}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle ? <div className="text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export default async function SalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  const [
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: financials, error: financialsError },
    { data: deliveryLinks, error: deliveryLinksError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,order_date,status,payment_status,discount_amount,notes")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id,order_id,product_id,quantity_ordered,unit_price,discount_amount,line_total,notes")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,due_date,reference_number,notes,created_at,recorded_by")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid,remaining_balance,payment_count,payment_status")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("document_links")
      .select("document_id,created_at")
      .eq("entity_type", "order")
      .eq("entity_id", id),
  ]);

  const customerId =
    order && typeof (order as Row).customer_id === "string"
      ? ((order as Row).customer_id as string)
      : null;

  const { data: customer } =
    customerId
      ? await supabase
          .from("customers")
          .select("id,name,name_for_invoice,email,phone,address")
          .eq("id", customerId)
          .maybeSingle()
      : { data: null as Row | null };

  const productIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((row) => (typeof row?.product_id === "string" ? row.product_id : null))
        .filter(Boolean)
    )
  ) as string[];

  const { data: products } =
    productIds.length > 0
      ? await supabase
          .from("products")
          .select("id,name,sku,barcode")
          .in("id", productIds)
      : { data: [] as Row[] };

  const productMap = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") {
      productMap.set(row.id, row as Row);
    }
  });

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

  const [paymentAuditResult, paymentRecordedByNameByValue] = await Promise.all([
    getLatestAuditByRecordIds(supabase, {
      tableName: "payments",
      recordIds: paymentIds,
    }),
    resolveUserDisplayNamesForValues(supabase, paymentRecordedByValues),
  ]);

  const [
    { data: orderMorningDocuments, error: orderMorningDocumentsError },
    { data: paymentMorningDocuments, error: paymentMorningDocumentsError },
  ] = await Promise.all([
    supabase
      .from("morning_documents")
      .select(
        "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
      )
      .eq("order_id", id)
      .order("issued_at", { ascending: false }),
    paymentIds.length > 0
      ? supabase
          .from("morning_documents")
          .select(
            "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
          )
          .in("payment_id", paymentIds)
          .order("issued_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const morningDocuments = Array.from(
    new Map(
      [...((orderMorningDocuments ?? []) as Row[]), ...((paymentMorningDocuments ?? []) as Row[])].map((row) => [
        getString(row, "id") ?? "",
        row,
      ])
    ).values()
  ).filter((row) => Boolean(getString(row as Row, "id"))) as MorningLocalDocument[];

  const orderLevelMorningDocuments = morningDocuments.filter((document) => !document.payment_id);

  const deliveryDocumentIds = Array.from(
    new Set(
      ((deliveryLinks ?? []) as Row[])
        .map((row) => getString(row as Row, "document_id"))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: deliveryDocuments } =
    deliveryDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,file_name,storage_key,uploaded_at,document_type")
          .in("id", deliveryDocumentIds)
      : { data: [] as Row[] };

  const deliveryDocumentMap = new Map<string, Row>();
  ((deliveryDocuments ?? []) as Row[]).forEach((row) => {
    const documentId = getString(row as Row, "id");
    if (documentId) deliveryDocumentMap.set(documentId, row as Row);
  });

  const deliveryImages = await Promise.all(
    ((deliveryLinks ?? []) as Row[]).map(async (link) => {
      const documentId = getString(link as Row, "document_id");
      if (!documentId) return null;
      const document = deliveryDocumentMap.get(documentId);
      if (!document) return null;
      if (getString(document, "document_type") !== "order_delivery_image") return null;

      const storageKey = getString(document, "storage_key");
      const { data: signed } = storageKey
        ? await supabase.storage.from("business-documents").createSignedUrl(storageKey, 60 * 60)
        : { data: null };

      return {
        id: documentId,
        file_name: getString(document, "file_name"),
        uploaded_at: getString(document, "uploaded_at") ?? getString(link as Row, "created_at"),
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      };
    })
  );

  const deliveryImagesResolved = deliveryImages.filter((row): row is NonNullable<typeof row> => Boolean(row));

  const customerName =
    getString((customer as Row) ?? {}, "name") ??
    getString((customer as Row) ?? {}, "name_for_invoice") ??
    customerId ??
    "-";
  const customerPhone = getString((customer as Row) ?? {}, "phone");
  const customerEmail = getString((customer as Row) ?? {}, "email");
  const fullAddress = getString((customer as Row) ?? {}, "address");
  const customerCity = extractCityFromAddress(fullAddress) ?? "-";
  const orderNotes = getString((order as Row) ?? {}, "notes");
  const orderDate = getString((order as Row) ?? {}, "order_date");
  const normalizedStatus = normalizeOrderStatus(getString((order as Row) ?? {}, "status"));
  const isOpenOrder = !["delivered", "completed", "closed", "cancelled"].includes(normalizedStatus);

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
  const derivedTotalPaid = ((payments ?? []) as Row[]).reduce(
    (sum, payment) => sum + (getNumber(payment, "amount_total") ?? 0),
    0
  );
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
  const paymentStatus = useDerivedFinancials
    ? derivePaymentStatus(derivedTotalAmount, derivedTotalPaid)
    : getString((financials as Row) ?? {}, "payment_status") ?? derivePaymentStatus(totalAmount, totalPaid);
  const canManagePayments = profile.role === "admin" || profile.role === "office";

  const paymentsWithMeta: PaymentItem[] = ((payments ?? []) as Row[]).map((payment) => {
    const paymentId = getString(payment, "id") ?? "";
    return {
      id: paymentId,
      payment_date: getString(payment, "payment_date"),
      amount_total: getNumber(payment, "amount_total") ?? 0,
      payment_method: getString(payment, "payment_method"),
      due_date: getString(payment, "due_date"),
      reference_number: getString(payment, "reference_number"),
      notes: getString(payment, "notes"),
      insertedByLabel: paymentInsertedByLabel(payment, {
        paymentRecordedByNameByValue,
        paymentAuditById: paymentAuditResult.byRecordId,
      }),
      morningDocuments: morningDocuments.filter((d) => d.payment_id === paymentId),
    };
  });

  const itemsSubtitleParts = [
    `${(orderItems ?? []).length} פריטים`,
    `סכום ביניים ${formatCurrency(subtotal)}`,
    totalDiscount > 0 ? `הנחה ${formatCurrency(totalDiscount)}` : null,
  ].filter(Boolean) as string[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">הזמנה #{id.slice(0, 8)}</h1>
            <p className="text-sm text-muted-foreground">מרכז הזמנה עם פעולות מהירות ופרטים לפי צורך.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/sales/orders/new" className="text-sm text-primary">
              הזמנה חדשה
            </Link>
            <NavLink to="/sales" className="text-sm text-primary">
              חזרה למכירות
            </NavLink>
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
          <section className="space-y-4 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">הזמנה #{id.slice(0, 8)}</div>
                <div className="text-2xl font-semibold">{customerName}</div>
                <div className="text-sm text-muted-foreground">
                  {[customerPhone, customerEmail].filter(Boolean).join(" • ") || "-"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {customerCity} • {fullAddress ?? "-"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={getString(order as Row, "status") ?? ""} type="order" />
                <span className={`rounded-full border px-2.5 py-1 text-xs ${paymentStatusClasses(paymentStatus)}`}>
                  {formatPaymentStatus(paymentStatus)}
                </span>
              </div>
            </div>

            <div
              className={`rounded-2xl border p-4 ${
                isOpenOrder ? "border-destructive/30 bg-destructive-soft/80" : "border-info/30 bg-info-soft/70"
              }`}
            >
              <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
                <div className="space-y-1">
                  <div className={`text-xs font-medium ${isOpenOrder ? "text-destructive" : "text-info-soft-foreground"}`}>
                    תאריך הזמנה
                  </div>
                  <div className={`text-2xl font-semibold ${isOpenOrder ? "text-destructive" : "text-foreground"}`}>
                    {formatDate(orderDate)}
                  </div>
                  <div className={`text-sm ${isOpenOrder ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                    {formatRelativeDateLabel(orderDate)}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2">
                    <div className="text-xs text-muted-foreground">סה&quot;כ</div>
                    <div className="mt-1 text-sm font-medium">{formatCurrency(totalAmount)}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2">
                    <div className="text-xs text-muted-foreground">שולם</div>
                    <div className="mt-1 text-sm font-medium">{formatCurrency(totalPaid)}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2">
                    <div className="text-xs text-muted-foreground">יתרה</div>
                    <div className={`mt-1 text-sm font-medium ${remainingBalance > 0 ? "text-warning-soft-foreground" : ""}`}>
                      {formatCurrency(remainingBalance)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2">
                    <div className="text-xs text-muted-foreground">תשלומים</div>
                    <div className="mt-1 text-sm font-medium">{paymentCount}</div>
                  </div>
                </div>
              </div>
            </div>

            {false ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">טלפון לקוח</div>
                <div className="mt-1 text-sm font-medium">{customerPhone ?? "-"}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">עיר</div>
                <div className="mt-1 text-sm font-medium">{customerCity}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">סכום ביניים</div>
                <div className="mt-1 text-sm font-medium">{formatCurrency(subtotal)}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                <div className="text-xs text-muted-foreground">הנחה</div>
                <div className={`mt-1 text-sm font-medium ${totalDiscount > 0 ? "text-success-soft-foreground" : ""}`}>
                  {totalDiscount > 0 ? `-${formatCurrency(totalDiscount)}` : "-"}
                </div>
              </div>
            </div> : null}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <OrderPaymentDialog orderId={id} totalAmount={totalAmount} paidAmount={totalPaid} />
              <OrderConfirmDialog orderId={id} buttonLabel="אישור אספקה" />
              <OrderEditDialog orderId={id} buttonLabel="עריכת הזמנה" />
              <DeleteOrderButton orderId={id} />
            </div>
          </section>
        ) : null}

        <DetailSection title="פריטים" subtitle={`${(orderItems ?? []).length} פריטים`}>
          <div className="mb-3 text-xs text-muted-foreground">{itemsSubtitleParts.join(" • ")}</div>
          {(orderItems ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו פריטים להזמנה זו.</p>
          ) : (
            <div className="space-y-2">
              {(orderItems ?? []).map((item, index) => {
                const productId = getString(item as Row, "product_id") ?? "";
                const product = productMap.get(productId);
                const productName =
                  getString((product ?? {}) as Row, "name") ??
                  getString((product ?? {}) as Row, "product_name") ??
                  productId;
                const quantity = getNumber(item as Row, "quantity_ordered") ?? 0;
                const unitPrice = getNumber(item as Row, "unit_price") ?? 0;
                const lineTotal = getNumber(item as Row, "line_total") ?? quantity * unitPrice;
                const lineDiscountAmount = getNumber(item as Row, "discount_amount") ?? 0;
                const lineNotes = getString(item as Row, "notes");

                return (
                  <div
                    key={getString(item as Row, "id") ?? `${productId}-${index}`}
                    className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{productName}</span>
                      <span>{formatCurrency(lineTotal)}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      כמות: {quantity} • מחיר יחידה: {formatCurrency(unitPrice)}
                    </div>
                    {lineDiscountAmount > 0 ? (
                      <div className="mt-1 text-success-soft-foreground">הנחת שורה: -{formatCurrency(lineDiscountAmount)}</div>
                    ) : null}
                    {lineNotes ? <div className="mt-1 text-muted-foreground">הערות: {lineNotes}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </DetailSection>

        <DetailSection title="תשלומים, החזרים ופעילות" subtitle={`${(payments ?? []).length} רשומות`}>
          <OrderPaymentActionsClient
            orderId={id}
            customerId={customerId}
            totalAmount={totalAmount}
            payments={paymentsWithMeta}
            canManage={canManagePayments}
          />
        </DetailSection>

        <DetailSection title="הוכחת אספקה" subtitle={`${deliveryImagesResolved.length} תמונות`}>
          {deliveryImagesResolved.length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין לא הועלתה תמונת אספקה להזמנה זו.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {deliveryImagesResolved.map((image) => (
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
                      alt={image.file_name ?? "Delivery image"}
                      className="mb-3 h-48 w-full rounded-lg object-cover"
                    />
                  ) : null}
                  <div className="font-medium">{image.file_name ?? "תמונה"}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(image.uploaded_at)}</div>
                </a>
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection title="מסמכים ו-Morning" subtitle={`${orderLevelMorningDocuments.length} מסמכים`}>
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
        </DetailSection>

        <DetailSection title="הערות" subtitle={orderNotes ? "קיימות הערות להזמנה" : "ללא הערות"} defaultOpen={false}>
          {orderNotes ? (
            <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
              {orderNotes}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">לא נוספו הערות להזמנה זו.</p>
          )}
        </DetailSection>
      </div>
    </AppShell>
  );
}

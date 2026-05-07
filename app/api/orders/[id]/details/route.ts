import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getLatestAuditByRecordIds, resolveUserDisplayNamesForValues } from "@/lib/audit";
import { derivePaymentStatus } from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;
const BUCKET = "business-documents";

function getString(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row | null | undefined, key: string) {
  const value = row?.[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { id } = await context.params;

  const [
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: financials, error: financialsError },
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
      .select("id,payment_date,amount_total,payment_method,reference_number,notes,created_at,recorded_by")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid,remaining_balance,payment_count,payment_status")
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 400 });
  }
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }
  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 400 });
  }
  if (financialsError) {
    const missingView = financialsError.message.includes("order_financials_view");
    if (!missingView) {
      return NextResponse.json({ error: financialsError.message }, { status: 400 });
    }
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const customerId = getString(order as Row, "customer_id");
  const { data: customer, error: customerError } = customerId
    ? await supabase
        .from("customers")
        .select(
          "id,name,name_for_invoice,email,phone,address,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error"
        )
        .eq("id", customerId)
        .maybeSingle()
    : { data: null, error: null };

  if (customerError) {
    return NextResponse.json({ error: customerError.message }, { status: 400 });
  }

  const productIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((row) => (typeof row?.product_id === "string" ? row.product_id : null))
        .filter(Boolean)
    )
  ) as string[];

  const { data: products, error: productsError } =
    productIds.length > 0
      ? await supabase.from("products").select("id,name,sku,barcode").in("id", productIds)
      : { data: [], error: null };

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 400 });
  }

  const derivedSubtotal = ((orderItems ?? []) as Row[]).reduce((sum, item) => {
    const quantity = getNumber(item, "quantity_ordered") ?? 0;
    const unitPrice = getNumber(item, "unit_price") ?? 0;
    return sum + quantity * unitPrice;
  }, 0);
  const derivedLineDiscount = ((orderItems ?? []) as Row[]).reduce(
    (sum, item) => sum + (getNumber(item, "discount_amount") ?? 0),
    0
  );
  const derivedOrderDiscount = getNumber(order as Row, "discount_amount") ?? 0;
  const derivedTotalAmount = Math.max(derivedSubtotal - derivedLineDiscount - derivedOrderDiscount, 0);
  const derivedTotalPaid = ((payments ?? []) as Row[]).reduce(
    (sum, payment) => sum + (getNumber(payment, "amount_total") ?? 0),
    0
  );
  const derivedRemainingBalance = Math.max(derivedTotalAmount - derivedTotalPaid, 0);
  const derivedPaymentStatus = derivePaymentStatus(derivedTotalAmount, derivedTotalPaid);

  const financialRow = (financials as Row | null) ?? null;
  const viewTotalAmount = getNumber(financialRow, "total_amount");
  const viewTotalPaid = getNumber(financialRow, "total_paid");
  const viewPaymentStatus = getString(financialRow, "payment_status");
  const useDerivedFinancials =
    viewTotalAmount === null ||
    (Math.abs((viewTotalAmount ?? 0) - derivedTotalAmount) > 0.009 && derivedTotalAmount > 0) ||
    Math.abs((viewTotalPaid ?? 0) - derivedTotalPaid) > 0.009;
  const totalAmount = useDerivedFinancials ? derivedTotalAmount : viewTotalAmount ?? 0;
  const totalPaid = useDerivedFinancials ? derivedTotalPaid : viewTotalPaid ?? 0;
  const paymentStatus = useDerivedFinancials
    ? derivedPaymentStatus
    : viewPaymentStatus ?? derivePaymentStatus(totalAmount, totalPaid);
  const paymentCount = getNumber(financialRow, "payment_count") ?? (payments ?? []).length;
  const remainingBalance = useDerivedFinancials
    ? derivedRemainingBalance
    : getNumber(financialRow, "remaining_balance") ?? Math.max(totalAmount - totalPaid, 0);
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
  const paymentsWithRecordedBy = ((payments ?? []) as Row[]).map((payment) => {
    const recordedByValue = getString(payment, "recorded_by");
    const paymentId = getString(payment, "id");
    const audit = paymentId ? paymentAuditResult.byRecordId[paymentId] : null;
    const recordedByDisplay =
      (recordedByValue ? paymentRecordedByNameByValue[recordedByValue] : null) ??
      (audit?.action === "create" ? audit.actorName : null);

    return {
      ...payment,
      recorded_by_display: recordedByDisplay,
      recorded_by_created_at: audit?.action === "create" ? audit.createdAt : null,
    };
  });

  const [
    { data: orderMorningDocuments, error: orderMorningDocumentsError },
    { data: paymentMorningDocuments, error: paymentMorningDocumentsError },
  ] = await Promise.all([
    supabase
      .from("morning_documents")
      .select(
        "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at"
      )
      .eq("order_id", id)
      .order("issued_at", { ascending: false }),
    paymentIds.length > 0
      ? supabase
          .from("morning_documents")
          .select(
            "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at"
          )
          .in("payment_id", paymentIds)
          .order("issued_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (orderMorningDocumentsError) {
    return NextResponse.json({ error: orderMorningDocumentsError.message }, { status: 400 });
  }
  if (paymentMorningDocumentsError) {
    return NextResponse.json({ error: paymentMorningDocumentsError.message }, { status: 400 });
  }

  const morningDocuments = Array.from(
    new Map(
      [...((orderMorningDocuments ?? []) as Row[]), ...((paymentMorningDocuments ?? []) as Row[])].map((row) => [
        getString(row, "id") ?? crypto.randomUUID(),
        row,
      ])
    ).values()
  );

  const { data: deliveryLinks, error: deliveryLinksError } = await supabase
    .from("document_links")
    .select("document_id,created_at")
    .eq("entity_type", "order")
    .eq("entity_id", id);

  if (deliveryLinksError) {
    return NextResponse.json({ error: deliveryLinksError.message }, { status: 400 });
  }

  const deliveryDocumentIds = Array.from(
    new Set(
      ((deliveryLinks ?? []) as Row[])
        .map((row) => getString(row, "document_id"))
        .filter((value): value is string => Boolean(value))
    )
  );

  const { data: deliveryDocuments, error: deliveryDocumentsError } =
    deliveryDocumentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,file_name,storage_key,uploaded_at,document_type")
          .in("id", deliveryDocumentIds)
      : { data: [], error: null };

  if (deliveryDocumentsError) {
    return NextResponse.json({ error: deliveryDocumentsError.message }, { status: 400 });
  }

  const deliveryDocumentMap = new Map<string, Row>();
  ((deliveryDocuments ?? []) as Row[]).forEach((row) => {
    const documentId = getString(row, "id");
    if (documentId) deliveryDocumentMap.set(documentId, row);
  });

  const deliveryImages = await Promise.all(
    ((deliveryLinks ?? []) as Row[]).map(async (link) => {
      const documentId = getString(link, "document_id");
      if (!documentId) return null;
      const document = deliveryDocumentMap.get(documentId);
      if (!document) return null;
      if (getString(document, "document_type") !== "order_delivery_image") return null;

      const storageKey = getString(document, "storage_key");
      const { data: signed } = storageKey
        ? await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 60)
        : { data: null };

      return {
        id: documentId,
        file_name: getString(document, "file_name"),
        uploaded_at: getString(document, "uploaded_at") ?? getString(link, "created_at"),
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      };
    })
  );

  return NextResponse.json({
    order,
    orderItems: orderItems ?? [],
    payments: paymentsWithRecordedBy,
    morningDocuments,
    deliveryImages: deliveryImages.filter((row): row is NonNullable<typeof row> => Boolean(row)),
    customer,
    products: products ?? [],
    totalAmount,
    totalPaid,
    remainingBalance,
    paymentCount,
    paymentStatus,
  });
}

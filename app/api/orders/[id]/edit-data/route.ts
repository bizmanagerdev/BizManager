import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { hasDeliveriesAccess } from "@/lib/auth/roleAccess";
import { STORAGE_BUCKET } from "@/lib/storage";
import { attachProductStock } from "@/lib/orders/productStock";

type Row = Record<string, unknown>;

function getString(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function getNumber(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  if (!hasDeliveriesAccess(profile.role, profile.deliveries_access)) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const { id } = await context.params;
  // The delivery-confirmation dialog only shows the order's own lines (no
  // customer switch, no add-product picker), so it never reads `customers` or
  // `products` from this response. Skip those queries for it — in particular
  // products_with_last_used, whose order_count is a live aggregate over all
  // order_items/orders (no materialization), which is what made every
  // confirm-delivery load pay a full-catalog popularity scan for nothing.
  const isConfirmScope = new URL(req.url).searchParams.get("scope") === "confirm";

  const [
    { data: order, error: orderError },
    { data: orderItems, error: orderItemsError },
    { data: payments, error: paymentsError },
    { data: baseCustomers, error: customersError },
    { data: baseProducts, error: productsError },
    { data: deliveryLinks, error: deliveryLinksError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,branch_id,order_date,status,payment_status,payment_terms,due_date,discount_amount,needs_invoice,notes,requested_delivery_date")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id,order_id,product_id,description,quantity_ordered,quantity_delivered,unit_price,discount_amount,notes")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    isConfirmScope
      ? Promise.resolve({ data: [] as Row[], error: null })
      : supabase
          .from("customers")
          .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
          .order("name", { ascending: true })
          .range(0, 49),
    isConfirmScope
      ? Promise.resolve({ data: [] as Row[], error: null })
      : supabase
          .from("products_with_last_used")
          .select("id,name,sku,barcode,description,base_price,base_cost,active")
          .order("order_count", { ascending: false })
          .order("name", { ascending: true })
          .range(0, 49),
    supabase
      .from("document_links")
      .select("document_id,created_at")
      .eq("entity_type", "order")
      .eq("entity_id", id),
  ]);

  if (customersError) {
    return NextResponse.json({ error: toHebrewError(customersError.message) }, { status: 400 });
  }
  if (productsError) {
    return NextResponse.json({ error: toHebrewError(productsError.message) }, { status: 400 });
  }
  if (orderError) {
    return NextResponse.json({ error: toHebrewError(orderError.message) }, { status: 400 });
  }
  if (orderItemsError) {
    return NextResponse.json({ error: toHebrewError(orderItemsError.message) }, { status: 400 });
  }
  if (paymentsError) {
    return NextResponse.json({ error: toHebrewError(paymentsError.message) }, { status: 400 });
  }
  if (deliveryLinksError) {
    return NextResponse.json({ error: toHebrewError(deliveryLinksError.message) }, { status: 400 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const selectedCustomerId = getString((order ?? {}) as Row, ["customer_id"]);
  const selectedProductIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((item) => getString(item as Row, ["product_id"]))
        .filter((value): value is string => Boolean(value))
    )
  );

  const [{ data: selectedCustomer }, { data: selectedProducts }] = await Promise.all([
    !isConfirmScope && selectedCustomerId
      ? supabase
          .from("customers")
          .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
          .eq("id", selectedCustomerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    selectedProductIds.length > 0
      ? supabase
          .from("products")
          .select("id,name,sku,barcode,description,base_price,base_cost,active")
          .in("id", selectedProductIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const customers = isConfirmScope
    ? []
    : Array.from(
        new Map(
          [selectedCustomer, ...((baseCustomers ?? []) as Row[])]
            .filter(Boolean)
            .map((row) => [getString(row as Row, ["customer_id", "id"]) ?? "", row as Row] as const)
            .filter(([key]) => key)
        ).values()
      );
  // Confirm scope only needs product_name for the order's own lines — skip the
  // stock lookup, it's unused there.
  const products = isConfirmScope
    ? ((selectedProducts ?? []) as Row[])
    : await attachProductStock(
        supabase,
        Array.from(
          new Map(
            [...((selectedProducts ?? []) as Row[]), ...((baseProducts ?? []) as Row[])]
              .map((row) => [getString(row as Row, ["id"]) ?? "", row] as const)
              .filter(([key]) => key)
          ).values()
        )
      );

  const productsById = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") productsById.set(row.id, row as Row);
  });

  // Separate best-effort read: the column only exists after running
  // db/sql/add_collect_payment_on_delivery.sql — never break edit before that.
  const { data: collectRow } = await supabase
    .from("orders")
    .select("collect_payment_on_delivery")
    .eq("id", id)
    .maybeSingle();

  const initialOrder = {
    id,
    customer_id: getString(order as Row, ["customer_id"]) ?? "",
    branch_id: getString(order as Row, ["branch_id"]),
    collect_payment_on_delivery: (collectRow as Row | null)?.collect_payment_on_delivery === true,
    order_date: (getString(order as Row, ["order_date"]) ?? "").slice(0, 10),
    status: getString(order as Row, ["status"]) ?? "draft",
    payment_status: getString(order as Row, ["payment_status"]) ?? "unpaid",
    payment_terms: getString(order as Row, ["payment_terms"]),
    due_date: (getString(order as Row, ["due_date"]) ?? "").slice(0, 10) || null,
    requested_delivery_date:
      (getString(order as Row, ["requested_delivery_date"]) ?? "").slice(0, 10) || null,
    discount_amount: getNumber(order as Row, ["discount_amount"]) ?? 0,
    // Must round-trip so editing a "צריך חשבונית" order and saving doesn't reset
    // the flag to false (the wizard reads initialOrder.needs_invoice).
    needs_invoice:
      typeof (order as Row)?.needs_invoice === "boolean"
        ? ((order as Row).needs_invoice as boolean)
        : null,
    notes: getString(order as Row, ["notes"]) ?? "",
    items: (orderItems ?? []).map((item) => {
      const productId = getString(item as Row, ["product_id"]) ?? "";
      const description = getString(item as Row, ["description"]) ?? "";
      const product = productsById.get(productId) ?? {};
      return {
        product_id: productId,
        // Off-catalog (custom) lines have no product_id — their name is the
        // free-text description, which doubles as the display name.
        description,
        product_name:
          getString(product as Row, ["name", "product_name", "title", "sku"]) ?? (description || productId),
        quantity_ordered: getNumber(item as Row, ["quantity_ordered"]) ?? 1,
        quantity_delivered: getNumber(item as Row, ["quantity_delivered"]) ?? 0,
        unit_price: getNumber(item as Row, ["unit_price"]) ?? 0,
        discount_amount: getNumber(item as Row, ["discount_amount"]) ?? 0,
        notes: getString(item as Row, ["notes"]) ?? "",
      };
    }),
  };

  const normalizedPayments = ((payments ?? []) as Row[]).map((payment) => ({
    id: getString(payment as Row, ["id"]) ?? "",
    payment_date: getString(payment as Row, ["payment_date"]),
    amount_total: getNumber(payment as Row, ["amount_total"]) ?? 0,
    payment_method: getString(payment as Row, ["payment_method"]) ?? "",
    reference_number: getString(payment as Row, ["reference_number"]) ?? "",
    notes: getString(payment as Row, ["notes"]) ?? "",
  }));

  const deliveryDocumentIds = Array.from(
    new Set(
      ((deliveryLinks ?? []) as Row[])
        .map((row) => getString(row as Row, ["document_id"]))
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
    const documentId = getString(row, ["id"]);
    if (documentId) deliveryDocumentMap.set(documentId, row);
  });

  const deliveryImages = await Promise.all(
    ((deliveryLinks ?? []) as Row[]).map(async (link) => {
      const documentId = getString(link as Row, ["document_id"]);
      if (!documentId) return null;

      const row = deliveryDocumentMap.get(documentId);
      if (!row) return null;
      if (getString(row, ["document_type"]) !== "order_delivery_image") return null;

      const storageKey = getString(row, ["storage_key"]);
      const { data: signed } = storageKey
        ? await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storageKey, 60 * 60)
        : { data: null };

      return {
        id: documentId,
        file_name: getString(row, ["file_name"]),
        uploaded_at: getString(row, ["uploaded_at"]) ?? getString(link as Row, ["created_at"]),
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      };
    })
  );

  return NextResponse.json({
    customers,
    products,
    initialOrder,
    initialPayments: normalizedPayments,
    deliveryImages: deliveryImages.filter((row): row is NonNullable<typeof row> => Boolean(row)),
  });
}

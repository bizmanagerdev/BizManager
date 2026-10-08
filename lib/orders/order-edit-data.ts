import type { SupabaseClient } from "@supabase/supabase-js";
import { toHebrewError } from "@/lib/error-messages";
import { STORAGE_BUCKET } from "@/lib/storage";
import { attachProductStock } from "@/lib/orders/productStock";

// Everything the order form needs to edit an order — the order with its own
// payment terms, due date, invoice and collect-on-delivery settings, its lines
// (custom lines by their own name), payments, and the customer and product
// lists. ONE loader for every way in: /api/orders/[id]/edit-data (the edit
// dialog, the delivery confirmation), the edit page, and the phone's copy
// (lib/powersync/local-supabase.ts runs it as is) — so an edit never starts
// from a different, thinner read (the edit page used to, and saving there
// reset the order's terms, due date, invoice flag and collect-on-delivery).

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

export type OrderEditData = {
  customers: Row[];
  products: Row[];
  initialOrder: {
    id: string;
    customer_id: string;
    branch_id: string | null;
    collect_payment_on_delivery: boolean;
    order_date: string;
    status: string;
    payment_status: string;
    payment_terms: string | null;
    due_date: string | null;
    requested_delivery_date: string | null;
    discount_amount: number;
    needs_invoice: boolean | null;
    notes: string;
    items: {
      product_id: string;
      description: string;
      product_name: string;
      available_quantity: number | null;
      quantity_ordered: number;
      quantity_delivered: number;
      unit_price: number;
      discount_amount: number;
      notes: string;
    }[];
  };
  initialPayments: {
    id: string;
    payment_date: string | null;
    amount_total: number;
    payment_method: string;
    reference_number: string;
    notes: string;
  }[];
  deliveryImages: { id: string; file_name: string | null; uploaded_at: string | null; url: string | null }[];
};

/**
 * `confirm`: the delivery confirmation only shows the order's own lines — no
 * customer or catalog lists (products_with_last_used is a live aggregate over
 * every order line). `deliveryImages`: the order's delivery photos, signed
 * (the server only — the edit form doesn't show them).
 */
export async function loadOrderEditData(
  supabase: SupabaseClient,
  id: string,
  options: { confirm?: boolean; deliveryImages?: boolean } = {}
): Promise<{ ok: true; data: OrderEditData } | { ok: false; status: number; error: string }> {
  const isConfirmScope = options.confirm === true;
  const withImages = options.deliveryImages !== false;

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
    withImages
      ? supabase.from("document_links").select("document_id,created_at").eq("entity_type", "order").eq("entity_id", id)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);

  for (const error of [customersError, productsError, orderError, orderItemsError, paymentsError, deliveryLinksError]) {
    if (error) return { ok: false, status: 400, error: toHebrewError(error.message) };
  }
  if (!order) return { ok: false, status: 404, error: "Order not found" };

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
  // Confirm scope skips the customer/catalog lists (never used there) but still
  // needs stock — attachProductStock only queries `inventory` for the order's
  // own (small) product-id set here, so it stays cheap; it's the full-catalog
  // products_with_last_used scan above that was slow, not this.
  const products = isConfirmScope
    ? await attachProductStock(supabase, (selectedProducts ?? []) as Row[])
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

  const initialOrder: OrderEditData["initialOrder"] = {
    id,
    customer_id: getString(order as Row, ["customer_id"]) ?? "",
    branch_id: getString(order as Row, ["branch_id"]),
    collect_payment_on_delivery: (collectRow as Row | null)?.collect_payment_on_delivery === true,
    order_date: (getString(order as Row, ["order_date"]) ?? "").slice(0, 10),
    status: getString(order as Row, ["status"]) ?? "draft",
    payment_status: getString(order as Row, ["payment_status"]) ?? "unpaid",
    payment_terms: getString(order as Row, ["payment_terms"]),
    due_date: (getString(order as Row, ["due_date"]) ?? "").slice(0, 10) || null,
    requested_delivery_date: (getString(order as Row, ["requested_delivery_date"]) ?? "").slice(0, 10) || null,
    discount_amount: getNumber(order as Row, ["discount_amount"]) ?? 0,
    // Must round-trip so editing a "צריך חשבונית" order and saving doesn't reset
    // the flag to false (the wizard reads initialOrder.needs_invoice).
    needs_invoice: typeof (order as Row)?.needs_invoice === "boolean" ? ((order as Row).needs_invoice as boolean) : null,
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
        product_name: getString(product as Row, ["name", "product_name", "title", "sku"]) ?? (description || productId),
        // null = untracked (no inventory row) — the confirm dialog never warns on those.
        available_quantity: getNumber(product as Row, ["available_quantity"]),
        quantity_ordered: getNumber(item as Row, ["quantity_ordered"]) ?? 1,
        quantity_delivered: getNumber(item as Row, ["quantity_delivered"]) ?? 0,
        unit_price: getNumber(item as Row, ["unit_price"]) ?? 0,
        discount_amount: getNumber(item as Row, ["discount_amount"]) ?? 0,
        notes: getString(item as Row, ["notes"]) ?? "",
      };
    }),
  };

  const initialPayments = ((payments ?? []) as Row[]).map((payment) => ({
    id: getString(payment as Row, ["id"]) ?? "",
    payment_date: getString(payment as Row, ["payment_date"]),
    amount_total: getNumber(payment as Row, ["amount_total"]) ?? 0,
    payment_method: getString(payment as Row, ["payment_method"]) ?? "",
    reference_number: getString(payment as Row, ["reference_number"]) ?? "",
    notes: getString(payment as Row, ["notes"]) ?? "",
  }));

  return {
    ok: true,
    data: {
      customers,
      products,
      initialOrder,
      initialPayments,
      deliveryImages: withImages ? await signedDeliveryImages(supabase, (deliveryLinks ?? []) as Row[]) : [],
    },
  };
}

/** The order's delivery photos (its order_delivery_image documents), each with a signed link. */
async function signedDeliveryImages(supabase: SupabaseClient, deliveryLinks: Row[]): Promise<OrderEditData["deliveryImages"]> {
  const deliveryDocumentIds = Array.from(
    new Set(deliveryLinks.map((row) => getString(row, ["document_id"])).filter((value): value is string => Boolean(value)))
  );

  const { data: deliveryDocuments } =
    deliveryDocumentIds.length > 0
      ? await supabase.from("documents").select("id,file_name,storage_key,uploaded_at,document_type").in("id", deliveryDocumentIds)
      : { data: [] as Row[] };

  const deliveryDocumentMap = new Map<string, Row>();
  ((deliveryDocuments ?? []) as Row[]).forEach((row) => {
    const documentId = getString(row, ["id"]);
    if (documentId) deliveryDocumentMap.set(documentId, row);
  });

  const deliveryImages = await Promise.all(
    deliveryLinks.map(async (link) => {
      const documentId = getString(link, ["document_id"]);
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
        uploaded_at: getString(row, ["uploaded_at"]) ?? getString(link, ["created_at"]),
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
      };
    })
  );
  return deliveryImages.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

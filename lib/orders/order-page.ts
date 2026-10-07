import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { attachProductStock } from "@/lib/orders/productStock";

// What an order's page shows of the order itself — the order, its lines and
// their products' stock, its payments and money, the customer and branch, who
// entered what — read the same way on the server and on the device copy
// (lib/powersync/dashboard-local.ts, card "orderPage"), so the two can't drift
// apart. The rest of the page (Morning documents, delivery photos, the
// history) only the server can read: app/(app)/sales/orders/[id]/loadOrderPageExtras.ts.

type Row = Record<string, unknown>;

export type OrderPageCore = {
  /** The order this is for. */
  filters: { id: string };
  order: Row | null;
  items: Row[];
  /** Newest first. */
  payments: Row[];
  /** order_financials_view's row for the order. */
  financials: Row | null;
  customer: Row | null;
  branch: Row | null;
  /** The lines' products, each with its live stock (available_quantity; null = not tracked). */
  products: Row[];
  /** Who recorded each payment and who entered the order: the name behind each value stored. */
  names: Record<string, string>;
  /** Comment authors' chosen colours, by name and by email (read only when the order has notes). */
  commentAuthorColors: Record<string, string>;
  /** Each read's failure, shown on the page. */
  errors: { order: string | null; items: string | null; payments: string | null; financials: string | null };
};

type ReadResult = { data: unknown; error: { message: string } | null };

function getString(row: Row | null | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

/** The distinct non-empty strings of `values`, in first-seen order. */
function uniqueStrings(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

/** The order's payments, newest first (same-day ones by when they were entered). */
export function readOrderPayments(supabase: SupabaseClient, id: string): Promise<ReadResult> {
  return Promise.resolve(
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,payment_status,due_date,reference_number,check_number,account_id,notes,created_at,recorded_by")
      .eq("order_id", id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
  );
}

/** The ids of the payments in a readOrderPayments() result. */
export function orderPaymentIds(result: ReadResult): string[] {
  return uniqueStrings(((result.data ?? []) as Row[]).map((payment) => getString(payment, "id")));
}

/**
 * Every read goes out at once, each as soon as what it needs is in (the
 * customer once the order row is there, the products once the lines are).
 * `payments`: the payments read when the caller already started it.
 */
export async function loadOrderPageCore(
  supabase: SupabaseClient,
  id: string,
  { payments: paymentsStarted }: { payments?: Promise<ReadResult> } = {}
): Promise<OrderPageCore> {
  const orderRead: Promise<ReadResult> = Promise.resolve(
    supabase
      .from("orders")
      .select(
        "id,customer_id,branch_id,order_date,status,payment_status,payment_terms,due_date,discount_amount,notes,needs_invoice,invoice_sent_at,delivery_confirmed_at,requested_delivery_date,created_by,collect_payment_on_delivery"
      )
      .eq("id", id)
      .maybeSingle()
  );
  const itemsRead: Promise<ReadResult> = Promise.resolve(
    supabase
      .from("order_items")
      .select("id,order_id,product_id,description,quantity_ordered,quantity_delivered,unit_price,discount_amount,line_total,notes")
      .eq("order_id", id)
  );
  const paymentsRead = paymentsStarted ?? readOrderPayments(supabase, id);
  const financialsRead: Promise<ReadResult> = Promise.resolve(
    supabase
      .from("order_financials_view")
      .select("id,total_amount,total_paid,collected_amount,pending_amount,overdue_amount,remaining_balance,payment_count,payment_status,next_due_date")
      .eq("id", id)
      .maybeSingle()
  );

  const orderRow = orderRead.then(({ data }) => (data ?? null) as Row | null);
  const customerRead = orderRow.then(async (order) => {
    const customerId = getString(order, "customer_id");
    if (!customerId) return null;
    const { data } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,email,phone,address")
      .eq("id", customerId)
      .maybeSingle();
    return (data ?? null) as Row | null;
  });
  const branchRead = orderRow.then(async (order) => {
    const branchId = getString(order, "branch_id");
    if (!branchId) return null;
    const { data } = await supabase.from("customer_branches").select("id,name,address,phone").eq("id", branchId).maybeSingle();
    return (data ?? null) as Row | null;
  });
  // The lines' products with their live stock (on-hand − reserved), so the
  // item list can name exactly which product is short — same signal/formula as
  // the orders list badge and the create/confirm wizards. Names and stock are
  // read side by side, both by the lines' product ids.
  const productsRead = itemsRead.then(async ({ data: items }) => {
    const productIds = uniqueStrings(((items ?? []) as Row[]).map((item) => getString(item, "product_id")));
    if (productIds.length === 0) return [] as Row[];
    const [{ data: products }, stock] = await Promise.all([
      supabase.from("products").select("id,name,sku,barcode").in("id", productIds),
      attachProductStock(
        supabase,
        productIds.map((productId) => ({ id: productId }))
      ),
    ]);
    const availableById = new Map(stock.map((row) => [row.id, row.available_quantity]));
    return ((products ?? []) as Row[]).map((product) => ({
      ...product,
      available_quantity: availableById.get(product.id) ?? null,
    }));
  });
  // Who recorded each payment, and who created the order.
  const namesRead = Promise.all([orderRow, paymentsRead]).then(([order, { data: payments }]) =>
    resolveUserDisplayNamesForValues(
      supabase,
      uniqueStrings([
        ...((payments ?? []) as Row[]).map((payment) => getString(payment, "recorded_by")),
        getString(order, "created_by"),
      ])
    )
  );
  // Comment avatars use each author's CHOSEN colour (users.avatar_color),
  // matching the colour they picked everywhere else. Comments store only the
  // author's display name, so name/email → colour is resolved here. The users
  // table is small, so one plain read (only when there are notes) is fine.
  const colorsRead = orderRow.then(async (order) => {
    const colors: Record<string, string> = {};
    if (!getString(order, "notes")) return colors;
    const { data: userRows } = await supabase.from("users").select("full_name,email,avatar_color");
    for (const row of (userRows ?? []) as Row[]) {
      const color = typeof row.avatar_color === "string" && row.avatar_color.trim() ? row.avatar_color.trim() : null;
      if (!color) continue;
      const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
      const email = typeof row.email === "string" ? row.email.trim() : "";
      if (fullName) colors[fullName] = color;
      if (email) colors[email] = color;
    }
    return colors;
  });

  const [order, items, payments, financials, customer, branch, products, names, commentAuthorColors] = await Promise.all([
    orderRead,
    itemsRead,
    paymentsRead,
    financialsRead,
    customerRead,
    branchRead,
    productsRead,
    namesRead,
    colorsRead,
  ]);

  return {
    filters: { id },
    order: (order.data ?? null) as Row | null,
    items: (items.data ?? []) as Row[],
    payments: (payments.data ?? []) as Row[],
    financials: (financials.data ?? null) as Row | null,
    customer,
    branch,
    products,
    names,
    commentAuthorColors,
    errors: {
      order: order.error?.message ?? null,
      items: items.error?.message ?? null,
      payments: payments.error?.message ?? null,
      financials: financials.error?.message ?? null,
    },
  };
}

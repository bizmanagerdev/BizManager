import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";

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

export default async function EditSalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  const [
    { data: customers, error: customersError },
    { data: products, error: productsError },
    { data: order, error: orderError },
    { data: orderItems, error: orderItemsError },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,phone,email,address,active,notes")
      .limit(5000),
    supabase.from("products").select("*").limit(1000),
    supabase.from("orders").select("*").eq("id", id).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", id).limit(500),
  ]);

  const productsById = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") productsById.set(row.id, row as Row);
  });

  const initialOrder = order
    ? {
        id,
        customer_id: getString(order as Row, ["customer_id"]) ?? "",
        order_date: (getString(order as Row, ["order_date"]) ?? "").slice(0, 10),
        payment_status: getString(order as Row, ["payment_status"]) ?? "unpaid",
        discount_amount: getNumber(order as Row, ["discount_amount"]) ?? 0,
        notes: getString(order as Row, ["notes"]) ?? "",
        items: (orderItems ?? []).map((item) => {
          const productId = getString(item as Row, ["product_id"]) ?? "";
          const product = productsById.get(productId) ?? {};
          return {
            product_id: productId,
            product_name:
              getString(product as Row, ["name", "product_name", "title", "sku"]) ?? productId,
            quantity_ordered: getNumber(item as Row, ["quantity_ordered"]) ?? 1,
            unit_price: getNumber(item as Row, ["unit_price"]) ?? 0,
            discount_amount: getNumber(item as Row, ["discount_amount"]) ?? 0,
            notes: getString(item as Row, ["notes"]) ?? "",
          };
        }),
      }
    : null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">עריכת הזמנה</h1>
          <p className="text-sm text-muted-foreground">עדכון לקוח, מוצרים ותשלום להזמנה קיימת.</p>
        </div>

        {orderError ? <p className="text-sm text-destructive">שגיאת הזמנה: {orderError.message}</p> : null}
        {orderItemsError ? (
          <p className="text-sm text-destructive">שגיאת פריטים: {orderItemsError.message}</p>
        ) : null}
        {!order && !orderError ? <p className="text-sm text-muted-foreground">ההזמנה לא נמצאה.</p> : null}

        {initialOrder ? (
          <NewOrderClient
            customers={(customers ?? []) as Row[]}
            products={(products ?? []) as Row[]}
            customersError={customersError?.message ?? null}
            productsError={productsError?.message ?? null}
            mode="edit"
            initialOrder={initialOrder}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

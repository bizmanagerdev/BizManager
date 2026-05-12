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
    { data: order, error: orderError },
    { data: orderItems, error: orderItemsError },
    { data: payments },
    { data: baseCustomers, error: customersError },
    { data: baseProducts, error: productsError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,order_date,status,payment_status,discount_amount,notes")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id,order_id,product_id,quantity_ordered,unit_price,discount_amount,notes")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("id,payment_date,amount_total,payment_method,reference_number,notes")
      .eq("order_id", id)
      .order("payment_date", { ascending: false }),
    supabase
      .from("customers")
      .select("id,name,phone,email,address,requires_prepayment")
      .order("name", { ascending: true })
      .range(0, 49),
    supabase
      .from("products")
      .select("id,name,sku,barcode,description,base_price,base_cost,active")
      .order("name", { ascending: true })
      .range(0, 49),
  ]);

  const selectedCustomerId = getString((order ?? {}) as Row, ["customer_id"]);
  const selectedProductIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((item) => getString(item as Row, ["product_id"]))
        .filter((value): value is string => Boolean(value))
    )
  );

  const [{ data: selectedCustomer }, { data: selectedProducts }] = await Promise.all([
    selectedCustomerId
      ? supabase
          .from("customers")
          .select("id,name,phone,email,address,requires_prepayment")
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

  const customers = Array.from(
    new Map(
      [selectedCustomer, ...((baseCustomers ?? []) as Row[])]
        .filter(Boolean)
        .map((row) => [getString(row as Row, ["customer_id", "id"]) ?? "", row as Row] as const)
        .filter(([key]) => key)
    ).values()
  );
  const products = Array.from(
    new Map(
      [...((selectedProducts ?? []) as Row[]), ...((baseProducts ?? []) as Row[])]
        .map((row) => [getString(row as Row, ["id"]) ?? "", row] as const)
        .filter(([key]) => key)
    ).values()
  );

  const productsById = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") productsById.set(row.id, row as Row);
  });

  const initialOrder = order
    ? {
        id,
        customer_id: getString(order as Row, ["customer_id"]) ?? "",
        order_date: (getString(order as Row, ["order_date"]) ?? "").slice(0, 10),
        status: getString(order as Row, ["status"]) ?? "draft",
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
            initialPayments={((payments ?? []) as Row[]).map((payment) => ({
              id: getString(payment as Row, ["id"]) ?? "",
              payment_date: getString(payment as Row, ["payment_date"]),
              amount_total: getNumber(payment as Row, ["amount_total"]) ?? 0,
              payment_method: getString(payment as Row, ["payment_method"]) ?? "",
              reference_number: getString(payment as Row, ["reference_number"]) ?? "",
              notes: getString(payment as Row, ["notes"]) ?? "",
            }))}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

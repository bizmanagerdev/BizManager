import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import SalesOrdersClient from "@/app/sales/SalesOrdersClient";
import SalesTabsNav from "@/app/sales/SalesTabsNav";
import PriceListClient from "@/app/sales/PriceListClient";
import SalesInventoryClient from "@/app/sales/SalesInventoryClient";

type Row = Record<string, unknown>;

export const revalidate = 30;

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

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function productName(row: Row) {
  return (
    getString(row, "name") ??
    getString(row, "product_name") ??
    getString(row, "title") ??
    getString(row, "sku") ??
    "מוצר"
  );
}

function productCode(row: Row) {
  return getString(row, "sku") ?? getString(row, "code") ?? getString(row, "barcode") ?? null;
}

function productUnitPrice(row: Row) {
  return (
    getNumber(row, "base_price") ??
    getNumber(row, "sale_price") ??
    getNumber(row, "selling_price") ??
    getNumber(row, "price") ??
    getNumber(row, "unit_price") ??
    getNumber(row, "retail_price")
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { tab } = (await searchParams) ?? {};
  const activeTab =
    tab === "inventory" || tab === "price-list" || tab === "deliveries" ? tab : "orders";

  const { profile, supabase } = await requireProfile();

  const [
    { data: orders, error: ordersError },
    { data: customers, error: customersError },
    { data: orderPayments, error: orderPaymentsError },
    { data: movements, error: movementsError },
    { data: inventoryRows, error: inventoryError },
    { data: products, error: productsError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select("id,customer_id,order_date,status,payment_status,total_amount,notes")
      .order("order_date", { ascending: false })
      .limit(1000),
    supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,email,address")
      .limit(5000),
    supabase
      .from("payments")
      .select("id,target_type,target_id,payment_date,amount_total,payment_method,reference_number,notes,created_at,updated_at")
      .eq("target_type", "order")
      .limit(5000),
    supabase
      .from("inventory_movements")
      .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved,updated_at")
      .limit(5000),
    supabase.from("products").select("*").limit(5000),
  ]);

  const customerById = new Map<string, Row>();
  ((customers ?? []) as Row[]).forEach((row) => {
    const id = getString(row, "id");
    if (id) customerById.set(id, row);
  });

  const deliveryStatuses = new Set(["draft", "confirmed", "processing", "out_for_delivery"]);
  const deliveries = ((orders ?? []) as Row[])
    .filter((order) => deliveryStatuses.has(getString(order, "status") ?? ""))
    .map((order) => {
      const customerId = getString(order, "customer_id") ?? "";
      const customer = customerById.get(customerId) ?? null;
      const customerName =
        (customer ? getString(customer, "name") ?? getString(customer, "name_for_invoice") : null) ??
        customerId;
      const customerPhone = customer ? getString(customer, "phone") : null;
      const address = customer ? getString(customer, "address") : null;
      const city = extractCityFromAddress(address);
      return {
        id: getString(order, "id") ?? "",
        orderDate: getString(order, "order_date"),
        status: getString(order, "status") ?? "-",
        totalAmount: getNumber(order, "total_amount"),
        notes: getString(order, "notes"),
        customerName,
        customerPhone,
        city: city ?? "ללא עיר",
        address: address ?? "-",
      };
    })
    .filter((row) => row.id);

  const deliveriesByCity = Array.from(
    deliveries.reduce((map, delivery) => {
      const list = map.get(delivery.city) ?? [];
      list.push(delivery);
      map.set(delivery.city, list);
      return map;
    }, new Map<string, typeof deliveries>())
  ).sort((a, b) => a[0].localeCompare(b[0], "he"));

  const purchasedByProductId = new Map<string, number>();
  ((movements ?? []) as Row[]).forEach((row) => {
    const movementType = getString(row, "movement_type") ?? "";
    if (movementType.toLowerCase() !== "in") return;
    const productId = getString(row, "product_id");
    if (!productId) return;
    const qty = getNumber(row, "quantity") ?? 0;
    if (!Number.isFinite(qty)) return;
    purchasedByProductId.set(productId, (purchasedByProductId.get(productId) ?? 0) + qty);
  });

  const inventoryByProductId = new Map<string, number | null>();
  ((inventoryRows ?? []) as Row[]).forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    inventoryByProductId.set(productId, getNumber(row, "quantity_on_hand"));
  });

  const productRows = ((products ?? []) as Row[])
    .map((row) => ({
      id: getString(row, "id") ?? "",
      name: productName(row),
      code: productCode(row),
      unitPrice: productUnitPrice(row),
      stock: inventoryByProductId.get(getString(row, "id") ?? "") ?? null,
      purchasedAmount: purchasedByProductId.get(getString(row, "id") ?? "") ?? 0,
      description: getString(row, "description") ?? getString(row, "notes"),
      active: row.active === false ? false : true,
    }))
    .filter((row) => row.id)
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">מכירות</h1>
            <p className="text-sm text-muted-foreground">
              הזמנות, מלאי, מחירון ותכנון משלוחים לפי עיר.
            </p>
          </div>

          <Button asChild>
            <Link href="/sales/orders/new">הזמנה חדשה</Link>
          </Button>
        </div>

        <SalesTabsNav activeTab={activeTab} />

        {activeTab === "orders" ? (
          <>
            {ordersError ? (
              <p className="text-sm text-destructive">שגיאת הזמנות: {ordersError.message}</p>
            ) : null}
            {customersError ? (
              <p className="text-sm text-destructive">שגיאת לקוחות: {customersError.message}</p>
            ) : null}
            {orderPaymentsError ? (
              <p className="text-sm text-destructive">שגיאת תשלומים: {orderPaymentsError.message}</p>
            ) : null}

            <SalesOrdersClient
              orders={(orders ?? []) as Row[]}
              customers={(customers ?? []) as Row[]}
              payments={(orderPayments ?? []) as Row[]}
            />
          </>
        ) : null}

        {activeTab === "inventory" ? (
          <>
            {inventoryError ? (
              <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {inventoryError.message}</p>
            ) : movementsError ? (
              <p className="text-sm text-destructive">שגיאה בטעינת תנועות מלאי: {movementsError.message}</p>
            ) : (
              <SalesInventoryClient
                products={(products ?? []) as Row[]}
                inventoryRows={(inventoryRows ?? []) as Row[]}
                movements={(movements ?? []) as Row[]}
              />
            )}
          </>
        ) : null}

        {activeTab === "price-list" ? (
          <>
            {productsError ? (
              <p className="text-sm text-destructive">שגיאה בטעינת מחירון: {productsError.message}</p>
            ) : (
              <PriceListClient initialProducts={productRows} />
            )}
          </>
        ) : null}

        {activeTab === "deliveries" ? (
          <>
            {ordersError || customersError ? (
              <p className="text-sm text-destructive">
                שגיאה בטעינת משלוחים: {(ordersError?.message ?? customersError?.message) ?? ""}
              </p>
            ) : deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין כרגע הזמנות מקובצות למשלוחים.</p>
            ) : (
              <div className="space-y-3">
                {deliveriesByCity.map(([city, cityDeliveries]) => (
                  <Card key={city}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-semibold">{city}</h3>
                        <span className="text-sm text-muted-foreground">
                          {cityDeliveries.length} משלוחים
                        </span>
                      </div>

                      <div className="space-y-2">
                        {cityDeliveries.map((delivery) => (
                          <div key={delivery.id} className="rounded-md border p-3 text-sm">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <div className="font-medium">
                                הזמנה #{delivery.id.slice(0, 8)} | {delivery.customerName}
                              </div>
                              <div className="text-muted-foreground">
                                {delivery.orderDate ?? "-"} | {delivery.status}
                              </div>
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              טלפון: {delivery.customerPhone ?? "-"} | כתובת: {delivery.address}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              סכום: {formatCurrency(delivery.totalAmount)}
                              {delivery.notes ? ` | הערות: ${delivery.notes}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}


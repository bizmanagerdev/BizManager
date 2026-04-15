import Link from "next/link";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";
import SalesOrdersClient from "@/app/sales/SalesOrdersClient";
import SalesTabsNav from "@/app/sales/SalesTabsNav";
import PriceListClient from "@/app/sales/PriceListClient";
import SalesInventoryClient from "@/app/sales/SalesInventoryClient";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export const revalidate = 30;

const PAGE_SIZE = 50;
const MOVEMENTS_PAGE_SIZE = 200;

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
  return getNumber(row, "base_price");
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function pageRange(page: number) {
  return {
    from: (page - 1) * PAGE_SIZE,
    to: page * PAGE_SIZE - 1,
  };
}

function buildCustomerReturnHref(
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  if (!customerId) return "/customers";
  const params = new URLSearchParams({ customer_id: customerId });
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("page", customerPage);
  return `/customers?${params.toString()}`;
}

function buildSalesHref(
  activeTab: string,
  pageKey: "ordersPage" | "inventoryPage" | "pricePage" | "deliveriesPage",
  page: number,
  customerId: string | null,
  customerName: string | null,
  customerPage: string | null
) {
  const params = new URLSearchParams();
  if (activeTab !== "orders") params.set("tab", activeTab);
  if (customerId) params.set("customer_id", customerId);
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("customer_page", customerPage);
  if (page > 1) params.set(pageKey, String(page));
  const query = params.toString();
  return query ? `/sales?${query}` : "/sales";
}

async function loadProductPageData(supabase: SupabaseClient, page: number) {
  const { from, to } = pageRange(page);
  const {
    data: products,
    error: productsError,
    count,
  } = await supabase
    .from("products")
    .select("id,name,sku,barcode,description,base_price,base_cost,active", {
      count: "estimated",
    })
    .order("name", { ascending: true })
    .range(from, to);

  const productIds = ((products ?? []) as Row[])
    .map((row) => getString(row, "id"))
    .filter((value): value is string => Boolean(value));

  const [{ data: inventoryRows, error: inventoryError }, { data: purchasedMovements, error: movementsError }] =
    productIds.length > 0
      ? await Promise.all([
          supabase
            .from("inventory")
            .select("product_id,quantity_on_hand,quantity_reserved,updated_at")
            .in("product_id", productIds),
          supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity")
            .eq("movement_type", "in")
            .in("product_id", productIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  return {
    products: (products ?? []) as Row[],
    inventoryRows: (inventoryRows ?? []) as Row[],
    purchasedMovements: (purchasedMovements ?? []) as Row[],
    count: typeof count === "number" ? count : ((products ?? []) as Row[]).length,
    productsError,
    inventoryError,
    movementsError,
  };
}

async function loadInventoryPageData(
  supabase: SupabaseClient,
  page: number
) {
  const productPage = await loadProductPageData(supabase, page);
  const productIds = productPage.products
    .map((row) => getString(row, "id"))
    .filter((value): value is string => Boolean(value));

  const { data: movements, error: movementsError } = productIds.length
    ? await supabase
        .from("inventory_movements")
        .select("id,product_id,movement_type,quantity,source_type,source_id,performed_by,notes,created_at")
        .in("product_id", productIds)
        .order("created_at", { ascending: false })
        .range(0, MOVEMENTS_PAGE_SIZE - 1)
    : { data: [], error: null };

  return {
    ...productPage,
    movements: (movements ?? []) as Row[],
    movementsError: productPage.movementsError?.message ? productPage.movementsError : movementsError,
  };
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string;
    customer_id?: string;
    customer_name?: string;
    customer_page?: string;
    ordersPage?: string;
    inventoryPage?: string;
    pricePage?: string;
    deliveriesPage?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const customerId =
    typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null;
  const customerName =
    typeof params.customer_name === "string" && params.customer_name.trim()
      ? params.customer_name.trim()
      : null;
  const customerPage =
    typeof params.customer_page === "string" && params.customer_page.trim()
      ? params.customer_page.trim()
      : null;
  const activeTab =
    params.tab === "inventory" || params.tab === "price-list" || params.tab === "deliveries"
      ? params.tab
      : "orders";

  const ordersPage = parsePage(params.ordersPage);
  const inventoryPage = parsePage(params.inventoryPage);
  const pricePage = parsePage(params.pricePage);
  const deliveriesPage = parsePage(params.deliveriesPage);

  const { profile, supabase } = await requireProfile();

  let content: ReactNode = null;

  if (activeTab === "orders") {
    const { from, to } = pageRange(ordersPage);
    let ordersQuery = supabase
      .from("order_overview_view")
      .select(
        "order_id,customer_id,customer_name,customer_email,customer_phone,customer_city,customer_address,order_date,created_at,status,payment_status,total_amount,total_paid,remaining_balance,payment_count",
        { count: "estimated" }
      )
      .order("order_date", { ascending: false });
    if (customerId) ordersQuery = ordersQuery.eq("customer_id", customerId);
    const { data, error, count } = await ordersQuery.range(from, to);

    const totalCount = typeof count === "number" ? count : ((data ?? []) as Row[]).length;
    const hasPreviousPage = ordersPage > 1;
    const hasNextPage = typeof count === "number" ? to + 1 < count : ((data ?? []) as Row[]).length === PAGE_SIZE;

    content = (
      <>
        {error ? (
          <p className="text-sm text-destructive">שגיאת הזמנות: {error.message}</p>
        ) : (
          <>
            <SalesOrdersClient orders={(data ?? []) as Row[]} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {ordersPage} • מוצגים {((data ?? []) as Row[]).length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "ordersPage", ordersPage - 1, customerId, customerName, customerPage)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "ordersPage", ordersPage + 1, customerId, customerName, customerPage)}>הבא</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  if (activeTab === "price-list") {
    const { products, inventoryRows, purchasedMovements, count, productsError, inventoryError, movementsError } =
      await loadProductPageData(supabase, pricePage);

    const purchasedByProductId = new Map<string, number>();
    purchasedMovements.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const qty = getNumber(row, "quantity") ?? 0;
      if (!Number.isFinite(qty)) return;
      purchasedByProductId.set(productId, (purchasedByProductId.get(productId) ?? 0) + qty);
    });

    const inventoryByProductId = new Map<string, number | null>();
    inventoryRows.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      inventoryByProductId.set(productId, getNumber(row, "quantity_on_hand"));
    });

    const productRows = products
      .map((row) => ({
        id: getString(row, "id") ?? "",
        name: productName(row),
        code: productCode(row),
        unitPrice: productUnitPrice(row),
        stock: inventoryByProductId.get(getString(row, "id") ?? "") ?? null,
        purchasedAmount: purchasedByProductId.get(getString(row, "id") ?? "") ?? 0,
        description: getString(row, "description"),
        active: row.active === false ? false : true,
      }))
      .filter((row) => row.id)
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    const hasPreviousPage = pricePage > 1;
    const hasNextPage = pricePage * PAGE_SIZE < count;
    const loadError = productsError?.message ?? inventoryError?.message ?? movementsError?.message ?? null;

    content = (
      <>
        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מחירון: {loadError}</p>
        ) : (
          <>
            <PriceListClient initialProducts={productRows} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {pricePage} • מוצגים {products.length} מתוך {count}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "pricePage", pricePage - 1, customerId, customerName, customerPage)}>הקודם</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "pricePage", pricePage + 1, customerId, customerName, customerPage)}>הבא</Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  if (activeTab === "inventory") {
    const { products, inventoryRows, movements, count, productsError, inventoryError, movementsError } =
      await loadInventoryPageData(supabase, inventoryPage);

    const hasPreviousPage = inventoryPage > 1;
    const hasNextPage = inventoryPage * PAGE_SIZE < count;
    const loadError = productsError?.message ?? inventoryError?.message ?? movementsError?.message ?? null;

    content = (
      <>
        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {loadError}</p>
        ) : (
          <>
            <SalesInventoryClient
              products={products}
              inventoryRows={inventoryRows}
              movements={movements}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {inventoryPage} • מוצגים {products.length} מתוך {count}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "inventoryPage", inventoryPage - 1, customerId, customerName, customerPage)}>
                      הקודם
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "inventoryPage", inventoryPage + 1, customerId, customerName, customerPage)}>
                      הבא
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  if (activeTab === "deliveries") {
    const { from, to } = pageRange(deliveriesPage);
    let deliveriesQuery = supabase
      .from("delivery_overview_view")
      .select(
        "order_id,customer_id,customer_name,customer_phone,customer_address,customer_city,order_date,created_at,status,total_amount,notes",
        { count: "estimated" }
      )
      .order("order_date", { ascending: false });
    if (customerId) deliveriesQuery = deliveriesQuery.eq("customer_id", customerId);
    const { data, error, count } = await deliveriesQuery.range(from, to);

    const deliveries = ((data ?? []) as Row[])
      .map((row) => ({
        id: getString(row, "order_id") ?? "",
        orderDate: getString(row, "order_date") ?? getString(row, "created_at"),
        status: getString(row, "status") ?? "-",
        totalAmount: getNumber(row, "total_amount"),
        notes: getString(row, "notes"),
        customerName: getString(row, "customer_name") ?? "לקוח",
        customerPhone: getString(row, "customer_phone"),
        city: getString(row, "customer_city") ?? "ללא עיר",
        address: getString(row, "customer_address") ?? "-",
      }))
      .filter((row) => row.id);

    const deliveriesByCity = Array.from(
      deliveries.reduce((map, delivery) => {
        const list = map.get(delivery.city) ?? [];
        list.push(delivery);
        map.set(delivery.city, list);
        return map;
      }, new Map<string, typeof deliveries>())
    ).sort((a, b) => a[0].localeCompare(b[0], "he"));

    const totalCount = typeof count === "number" ? count : deliveries.length;
    const hasPreviousPage = deliveriesPage > 1;
    const hasNextPage = typeof count === "number" ? to + 1 < count : deliveries.length === PAGE_SIZE;

    content = (
      <>
        {error ? (
          <p className="text-sm text-destructive">שגיאה בטעינת משלוחים: {error.message}</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין כרגע הזמנות מקובצות למשלוחים.</p>
        ) : (
          <>
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
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {deliveriesPage} • מוצגים {deliveries.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "deliveriesPage", deliveriesPage - 1, customerId, customerName, customerPage)}>
                      הקודם
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הקודם
                  </Button>
                )}
                {hasNextPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSalesHref(activeTab, "deliveriesPage", deliveriesPage + 1, customerId, customerName, customerPage)}>
                      הבא
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    הבא
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">מכירות</h1>
            {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
            <p className="text-sm text-muted-foreground">
              הזמנות, מלאי, מחירון ותכנון משלוחים לפי עיר.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {customerId ? (
              <Button asChild variant="outline">
                <Link href={buildCustomerReturnHref(customerId, customerName, customerPage)}>חזרה ללקוח</Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/sales/orders/new">הזמנה חדשה</Link>
            </Button>
          </div>
        </div>

        <SalesTabsNav activeTab={activeTab} />
        {content}
      </div>
    </AppShell>
  );
}

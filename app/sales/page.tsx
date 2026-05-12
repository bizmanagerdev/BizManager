import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AppShell from "@/components/layout/AppShell";
import SalesDeliveriesQueue from "@/app/sales/SalesDeliveriesQueue";
import SalesInventoryClient from "@/app/sales/SalesInventoryClient";
import SalesOrdersClient from "@/app/sales/SalesOrdersClient";
import PriceListClient from "@/app/sales/PriceListClient";
import SalesTabsNav from "@/app/sales/SalesTabsNav";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Button } from "@/components/ui/button";

type Row = Record<string, unknown>;

export const revalidate = 30;

const PAGE_SIZE = 50;
const MOVEMENTS_PAGE_SIZE = 200;
const CLOSED_ORDER_STATUSES = [
  "delivered",
  "completed",
  "closed",
  "cancelled",
  "סופקה",
  "הושלמה",
  "סגורה",
  "בוטלה",
];

function applyOpenOrdersFilter<TQuery extends { not: (...args: [string, string, string]) => TQuery }>(
  query: TQuery
) {
  return query.not("status", "in", `(${CLOSED_ORDER_STATUSES.join(",")})`);
}

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

function productCategoryName(row: Row, categoryById: Map<string, string>) {
  const categoryId = getString(row, "category_id");
  if (!categoryId) return null;
  return categoryById.get(categoryId) ?? null;
}

function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
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
    .select("id,name,sku,barcode,description,base_price,base_cost,active,category_id", {
      count: "estimated",
    })
    .order("name", { ascending: true })
    .range(from, to);

  const productIds = ((products ?? []) as Row[])
    .map((row) => getString(row, "id"))
    .filter((value): value is string => Boolean(value));

  const [
    { data: inventoryRows, error: inventoryError },
    { data: purchasedMovements, error: purchasedMovementsError },
    { data: soldMovements, error: soldMovementsError },
    { data: customerReturnMovements, error: customerReturnMovementsError },
    { data: categoryRows, error: categoriesError },
    thresholdResult,
  ] =
    await Promise.all([
      productIds.length > 0
        ? supabase
            .from("inventory")
            .select("product_id,quantity_on_hand,quantity_reserved,updated_at")
            .in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity")
            .eq("movement_type", "in")
            .in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity,source_type")
            .eq("movement_type", "out")
            .eq("source_type", "order")
            .in("product_id", productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase
            .from("inventory_movements")
            .select("product_id,movement_type,quantity,source_type,notes")
            .eq("movement_type", "in")
            .eq("source_type", "manual_adjustment")
            .in("product_id", productIds)
            .or("notes.ilike.%החזרת לקוח%,notes.ilike.%customer return%")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("product_categories").select("id,name,active").order("name", { ascending: true }),
      productIds.length > 0
        ? supabase.from("products").select("id,low_stock_threshold").in("id", productIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const thresholdRows = isMissingColumnError(thresholdResult.error, "low_stock_threshold")
    ? []
    : ((thresholdResult.data ?? []) as Row[]);
  const thresholdsError = isMissingColumnError(thresholdResult.error, "low_stock_threshold")
    ? null
    : thresholdResult.error;

  return {
    products: (products ?? []) as Row[],
    inventoryRows: (inventoryRows ?? []) as Row[],
    purchasedMovements: (purchasedMovements ?? []) as Row[],
    soldMovements: (soldMovements ?? []) as Row[],
    customerReturnMovements: (customerReturnMovements ?? []) as Row[],
    categoryRows: (categoryRows ?? []) as Row[],
    thresholdRows,
    count: typeof count === "number" ? count : ((products ?? []) as Row[]).length,
    productsError,
    inventoryError,
    movementsError:
      purchasedMovementsError?.message
        ? purchasedMovementsError
        : soldMovementsError?.message
          ? soldMovementsError
          : customerReturnMovementsError,
    categoriesError,
    thresholdsError,
  };
}

async function loadInventoryPageData(supabase: SupabaseClient, page: number) {
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
    params.tab === "closed" || params.tab === "inventory" || params.tab === "price-list" || params.tab === "deliveries"
      ? params.tab
      : "orders";

  const ordersPage = parsePage(params.ordersPage);
  const inventoryPage = parsePage(params.inventoryPage);
  const pricePage = parsePage(params.pricePage);
  const deliveriesPage = parsePage(params.deliveriesPage);

  const { profile, supabase } = await requireProfile();
  const [
    { count: openOrdersCount },
    { count: closedOrdersCount },
    { count: productsCount },
    { count: deliveriesCount },
  ] = await Promise.all([
    (() => {
      let query = applyOpenOrdersFilter(
        supabase
        .from("order_overview_view")
        .select("order_id", { count: "estimated", head: true })
      );
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("order_overview_view")
        .select("order_id", { count: "estimated", head: true })
        .in("status", CLOSED_ORDER_STATUSES);
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
    supabase.from("products").select("id", { count: "estimated", head: true }),
    (() => {
      let query = applyOpenOrdersFilter(
        supabase
        .from("delivery_overview_view")
        .select("order_id,status", { count: "estimated", head: true })
      );
      if (customerId) query = query.eq("customer_id", customerId);
      return query;
    })(),
  ]);

  const salesTabCounts = {
    orders: typeof openOrdersCount === "number" ? openOrdersCount : 0,
    closed: typeof closedOrdersCount === "number" ? closedOrdersCount : 0,
    inventory: typeof productsCount === "number" ? productsCount : 0,
    "price-list": typeof productsCount === "number" ? productsCount : 0,
    deliveries: typeof deliveriesCount === "number" ? deliveriesCount : 0,
  } as const;

  let content: ReactNode = null;

  if (activeTab === "orders" || activeTab === "closed") {
    const { from, to } = pageRange(ordersPage);
    let ordersQuery =
      activeTab === "orders"
        ? applyOpenOrdersFilter(
            supabase
              .from("order_overview_view")
              .select(
                "order_id,customer_id,customer_name,customer_email,customer_phone,customer_city,customer_address,order_date,created_at,status,payment_status,total_amount,total_paid,remaining_balance,payment_count",
                { count: "estimated" }
              )
              .order("order_date", { ascending: false })
          )
        : supabase
            .from("order_overview_view")
            .select(
              "order_id,customer_id,customer_name,customer_email,customer_phone,customer_city,customer_address,order_date,created_at,status,payment_status,total_amount,total_paid,remaining_balance,payment_count",
              { count: "estimated" }
            )
            .order("order_date", { ascending: false });

    if (customerId) ordersQuery = ordersQuery.eq("customer_id", customerId);
    if (activeTab === "closed") {
      ordersQuery = ordersQuery.in("status", CLOSED_ORDER_STATUSES);
    }
    if (false && activeTab === "closed") {
      ordersQuery = ordersQuery.in("status", [
        "delivered",
        "completed",
        "closed",
        "cancelled",
        "סופקה",
        "הושלמה",
        "סגורה",
        "בוטלה",
      ]);
    }

    const { data, error, count } = await ordersQuery.range(from, to);
    const rows = (data ?? []) as Row[];
    const totalCount = typeof count === "number" ? count : rows.length;
    const hasPreviousPage = ordersPage > 1;
    const hasNextPage = typeof count === "number" ? to + 1 < count : rows.length === PAGE_SIZE;

    content = (
      <>
        {error ? (
          <p className="text-sm text-destructive">שגיאה בטעינת הזמנות: {error.message}</p>
        ) : (
          <>
            <SalesOrdersClient orders={rows} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {ordersPage} • מציגים {rows.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "ordersPage",
                        ordersPage - 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "ordersPage",
                        ordersPage + 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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

  if (activeTab === "price-list") {
    const {
      products,
      inventoryRows,
      purchasedMovements,
      soldMovements,
      customerReturnMovements,
      categoryRows,
      thresholdRows,
      count,
      productsError,
      inventoryError,
      movementsError,
      categoriesError,
      thresholdsError,
    } =
      await loadProductPageData(supabase, pricePage);

    const purchasedByProductId = new Map<string, number>();
    purchasedMovements.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const qty = getNumber(row, "quantity") ?? 0;
      if (!Number.isFinite(qty)) return;
      purchasedByProductId.set(productId, (purchasedByProductId.get(productId) ?? 0) + qty);
    });

    const soldByProductId = new Map<string, number>();
    soldMovements.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const qty = getNumber(row, "quantity") ?? 0;
      if (!Number.isFinite(qty)) return;
      soldByProductId.set(productId, (soldByProductId.get(productId) ?? 0) + qty);
    });

    customerReturnMovements.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const qty = getNumber(row, "quantity") ?? 0;
      if (!Number.isFinite(qty)) return;
      soldByProductId.set(productId, Math.max(0, (soldByProductId.get(productId) ?? 0) - qty));
    });

    const inventoryByProductId = new Map<string, number | null>();
    inventoryRows.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      inventoryByProductId.set(productId, getNumber(row, "quantity_on_hand"));
    });

    const categoryById = new Map<string, string>();
    categoryRows.forEach((row) => {
      const id = getString(row, "id");
      const name = getString(row, "name");
      if (!id || !name) return;
      categoryById.set(id, name);
    });

    const thresholdById = new Map<string, number | null>();
    thresholdRows.forEach((row) => {
      const id = getString(row, "id");
      if (!id) return;
      thresholdById.set(id, getNumber(row, "low_stock_threshold"));
    });

    const productRows = products
      .map((row) => ({
        id: getString(row, "id") ?? "",
        name: productName(row),
        categoryId: getString(row, "category_id"),
        category: productCategoryName(row, categoryById),
        lowStockThreshold: thresholdById.get(getString(row, "id") ?? "") ?? 5,
        code: productCode(row),
        unitPrice: productUnitPrice(row),
        stock: inventoryByProductId.get(getString(row, "id") ?? "") ?? null,
        purchasedAmount: purchasedByProductId.get(getString(row, "id") ?? "") ?? 0,
        soldAmount: soldByProductId.get(getString(row, "id") ?? "") ?? 0,
        description: getString(row, "description"),
        active: row.active === false ? false : true,
      }))
      .filter((row) => row.id)
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    const categoryOptions = categoryRows
      .map((row) => ({
        id: getString(row, "id") ?? "",
        name: getString(row, "name") ?? "",
        active: row.active !== false,
      }))
      .filter((row) => row.id && row.name);

    const hasPreviousPage = pricePage > 1;
    const hasNextPage = pricePage * PAGE_SIZE < count;
    const loadError =
      productsError?.message ??
      inventoryError?.message ??
      movementsError?.message ??
      categoriesError?.message ??
      thresholdsError?.message ??
      null;

    content = (
      <>
        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מחירון: {loadError}</p>
        ) : (
          <>
            <PriceListClient initialProducts={productRows} initialCategories={categoryOptions} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {pricePage} • מציגים {products.length} מתוך {count}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "pricePage",
                        pricePage - 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "pricePage",
                        pricePage + 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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

  if (activeTab === "inventory") {
    const {
      products,
      inventoryRows,
      soldMovements,
      customerReturnMovements,
      movements,
      thresholdRows,
      count,
      productsError,
      inventoryError,
      movementsError,
      thresholdsError,
    } = await loadInventoryPageData(supabase, inventoryPage);

    const soldAmountByProductId = Object.fromEntries(
      products
        .map((product) => getString(product, "id"))
        .filter((value): value is string => Boolean(value))
        .map((productId) => {
          const soldQty = soldMovements
            .filter((row) => getString(row, "product_id") === productId)
            .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
          const returnedQty = customerReturnMovements
            .filter((row) => getString(row, "product_id") === productId)
            .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
          return [productId, Math.max(0, soldQty - returnedQty)];
        })
    );

    const lowStockThresholdByProductId = Object.fromEntries(
      thresholdRows
        .map((row) => {
          const id = getString(row, "id");
          if (!id) return null;
          return [id, getNumber(row, "low_stock_threshold") ?? 5] as const;
        })
        .filter((entry): entry is readonly [string, number] => entry !== null)
    );

    const hasPreviousPage = inventoryPage > 1;
    const hasNextPage = inventoryPage * PAGE_SIZE < count;
    const loadError =
      productsError?.message ?? inventoryError?.message ?? movementsError?.message ?? thresholdsError?.message ?? null;

    content = (
      <>
        {loadError ? (
          <p className="text-sm text-destructive">שגיאה בטעינת מלאי: {loadError}</p>
        ) : (
          <>
            <SalesInventoryClient
              products={products}
              inventoryRows={inventoryRows}
              soldAmountByProductId={soldAmountByProductId}
              lowStockThresholdByProductId={lowStockThresholdByProductId}
              movements={movements}
            />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {inventoryPage} • מציגים {products.length} מתוך {count}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "inventoryPage",
                        inventoryPage - 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "inventoryPage",
                        inventoryPage + 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
    let deliveriesQuery = applyOpenOrdersFilter(
      supabase
        .from("delivery_overview_view")
        .select(
          "order_id,customer_id,customer_name,customer_phone,customer_address,customer_city,order_date,created_at,status,total_amount,notes",
          { count: "estimated" }
        )
        .order("order_date", { ascending: false })
    );

    if (customerId) deliveriesQuery = deliveriesQuery.eq("customer_id", customerId);

    const { data, error, count } = await deliveriesQuery.range(from, to);

    const deliveries = ((data ?? []) as Row[])
      .map((row) => ({
        id: getString(row, "order_id") ?? "",
        customerId: getString(row, "customer_id") ?? "",
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

    const deliveriesByCityAndCustomer = deliveriesByCity.map(([city, cityDeliveries]) => {
      const customerGroups = Array.from(
        cityDeliveries.reduce((map, delivery) => {
          const customerKey =
            delivery.customerId || `${delivery.customerName}|${delivery.address}|${delivery.customerPhone ?? ""}`;
          const existing = map.get(customerKey);
          if (existing) {
            existing.orders.push(delivery);
            return map;
          }

          map.set(customerKey, {
            customerName: delivery.customerName,
            customerPhone: delivery.customerPhone,
            address: delivery.address,
            orders: [delivery],
          });
          return map;
        }, new Map<string, { customerName: string; customerPhone: string | null; address: string; orders: typeof deliveries }>())
      );

      return [city, customerGroups] as const;
    });

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
            <SalesDeliveriesQueue deliveriesByCityAndCustomer={deliveriesByCityAndCustomer} />
            <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
              <div className="text-muted-foreground">
                עמוד {deliveriesPage} • מציגים {deliveries.length} מתוך {totalCount}
              </div>
              <div className="flex gap-2">
                {hasPreviousPage ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "deliveriesPage",
                        deliveriesPage - 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
                    <Link
                      href={buildSalesHref(
                        activeTab,
                        "deliveriesPage",
                        deliveriesPage + 1,
                        customerId,
                        customerName,
                        customerPage
                      )}
                    >
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
            {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {customerId ? (
              <Button asChild variant="outline">
                <Link href={buildCustomerReturnHref(customerId, customerName, customerPage)}>
                  חזרה ללקוח
                </Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/sales/orders/new">הזמנה חדשה</Link>
            </Button>
          </div>
        </div>

        <SalesTabsNav activeTab={activeTab} counts={salesTabCounts} searchParams={params} />
        {content}
      </div>
    </AppShell>
  );
}

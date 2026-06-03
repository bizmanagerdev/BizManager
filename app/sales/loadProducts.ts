import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export const PRODUCTS_PAGE_SIZE = 50;
const MOVEMENTS_PAGE_SIZE = 200;

export type ProductsFilters = { q: string; category: string };

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

function pageRange(page: number) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return {
    page: safePage,
    from: (safePage - 1) * PRODUCTS_PAGE_SIZE,
    to: safePage * PRODUCTS_PAGE_SIZE - 1,
  };
}

async function loadProductPageData(
  supabase: SupabaseClient,
  page: number,
  filters: ProductsFilters = { q: "", category: "" }
) {
  const { from, to } = pageRange(page);
  let productsQuery = supabase
    .from("products")
    .select("id,name,sku,barcode,description,base_price,base_cost,active,category_id", {
      count: "estimated",
    })
    .order("name", { ascending: true });

  if (filters.q) {
    const escaped = filters.q.replace(/[%,]/g, " ");
    productsQuery = productsQuery.or(
      `name.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%,description.ilike.%${escaped}%`
    );
  }
  if (filters.category) {
    productsQuery = productsQuery.eq("category_id", filters.category);
  }

  const { data: products, error: productsError, count } = await productsQuery.range(from, to);

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
  ] = await Promise.all([
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

export type PriceListProduct = {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  lowStockThreshold: number;
  code: string | null;
  unitPrice: number | null;
  stock: number | null;
  purchasedAmount: number;
  soldAmount: number;
  description: string | null;
  active: boolean;
};

export type PriceListCategory = { id: string; name: string; active: boolean };

export type PriceListPageResult = {
  products: PriceListProduct[];
  categories: PriceListCategory[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

/** Load one page of the price list (products with stock / sold / purchased aggregates). */
export async function loadPriceListPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: ProductsFilters }
): Promise<PriceListPageResult> {
  const { page: safePage } = pageRange(page);
  const data = await loadProductPageData(supabase, safePage, filters);

  const purchasedByProductId = new Map<string, number>();
  data.purchasedMovements.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    const qty = getNumber(row, "quantity") ?? 0;
    if (!Number.isFinite(qty)) return;
    purchasedByProductId.set(productId, (purchasedByProductId.get(productId) ?? 0) + qty);
  });

  const soldByProductId = new Map<string, number>();
  data.soldMovements.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    const qty = getNumber(row, "quantity") ?? 0;
    if (!Number.isFinite(qty)) return;
    soldByProductId.set(productId, (soldByProductId.get(productId) ?? 0) + qty);
  });
  data.customerReturnMovements.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    const qty = getNumber(row, "quantity") ?? 0;
    if (!Number.isFinite(qty)) return;
    soldByProductId.set(productId, Math.max(0, (soldByProductId.get(productId) ?? 0) - qty));
  });

  const inventoryByProductId = new Map<string, number | null>();
  data.inventoryRows.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    inventoryByProductId.set(productId, getNumber(row, "quantity_on_hand"));
  });

  const categoryById = new Map<string, string>();
  data.categoryRows.forEach((row) => {
    const id = getString(row, "id");
    const name = getString(row, "name");
    if (!id || !name) return;
    categoryById.set(id, name);
  });

  const thresholdById = new Map<string, number | null>();
  data.thresholdRows.forEach((row) => {
    const id = getString(row, "id");
    if (!id) return;
    thresholdById.set(id, getNumber(row, "low_stock_threshold"));
  });

  const products = data.products
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

  const categories = data.categoryRows
    .map((row) => ({
      id: getString(row, "id") ?? "",
      name: getString(row, "name") ?? "",
      active: row.active !== false,
    }))
    .filter((row) => row.id && row.name);

  const error =
    data.productsError?.message ??
    data.inventoryError?.message ??
    data.movementsError?.message ??
    data.categoriesError?.message ??
    data.thresholdsError?.message ??
    null;

  return {
    products,
    categories,
    totalCount: data.count,
    // Drive "has more" off page fullness, not the estimated count.
    hasMore: data.products.length === PRODUCTS_PAGE_SIZE,
    error,
  };
}

export type InventoryItem = {
  productId: string;
  productName: string;
  sku: string | null;
  lowStockThreshold: number;
  active: boolean;
  quantityOnHand: number;
  quantityReserved: number;
  available: number;
  soldAmount: number;
};

function buildInventoryItems(
  products: Row[],
  inventoryRows: Row[],
  soldAmountByProductId: Record<string, number>,
  movements: Row[],
  lowStockThresholdByProductId: Record<string, number>
): InventoryItem[] {
  const movementNetByProduct = new Map<string, number>();
  movements.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    const qty = getNumber(row, "quantity") ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) return;
    const movementType = (getString(row, "movement_type") ?? "").toLowerCase();
    const signed =
      movementType === "out"
        ? -qty
        : movementType === "in" || movementType === "adjustment"
          ? qty
          : 0;
    movementNetByProduct.set(productId, (movementNetByProduct.get(productId) ?? 0) + signed);
  });

  const productById = new Map<string, Row>();
  products.forEach((p) => {
    const id = getString(p, "id");
    if (id) productById.set(id, p);
  });

  const byProductId = new Map<string, InventoryItem>();

  productById.forEach((p, id) => {
    const productStockFallback =
      getNumber(p, "stock") ??
      getNumber(p, "quantity") ??
      getNumber(p, "available_quantity") ??
      getNumber(p, "in_stock") ??
      0;
    const movementFallback = movementNetByProduct.get(id) ?? 0;
    const quantityOnHand = productStockFallback !== 0 ? productStockFallback : movementFallback;

    byProductId.set(id, {
      productId: id,
      productName: productName(p),
      sku: getString(p, "sku"),
      lowStockThreshold: lowStockThresholdByProductId[id] ?? 5,
      active: p.active !== false,
      quantityOnHand,
      quantityReserved: 0,
      available: quantityOnHand,
      soldAmount: soldAmountByProductId[id] ?? 0,
    });
  });

  inventoryRows.forEach((row) => {
    const productId = getString(row, "product_id");
    if (!productId) return;
    const p = productById.get(productId);
    const quantityOnHand = getNumber(row, "quantity_on_hand") ?? 0;
    const quantityReserved = getNumber(row, "quantity_reserved") ?? 0;
    byProductId.set(productId, {
      productId,
      productName: p ? productName(p) : productId,
      sku: p ? getString(p, "sku") : null,
      lowStockThreshold: lowStockThresholdByProductId[productId] ?? 5,
      active: p?.active !== false,
      quantityOnHand,
      quantityReserved,
      available: quantityOnHand - quantityReserved,
      soldAmount: soldAmountByProductId[productId] ?? 0,
    });
  });

  return Array.from(byProductId.values()).sort((a, b) =>
    a.productName.localeCompare(b.productName, "he")
  );
}

export type InventoryListPageResult = {
  items: InventoryItem[];
  movements: Row[];
  totalCount: number;
  hasMore: boolean;
  error: string | null;
};

/** Load one page of the inventory (stock) list plus recent movements for its products. */
export async function loadInventoryListPage(
  supabase: SupabaseClient,
  { page, filters }: { page: number; filters: ProductsFilters }
): Promise<InventoryListPageResult> {
  const { page: safePage } = pageRange(page);
  const data = await loadProductPageData(supabase, safePage, filters);

  const productIds = data.products
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

  const soldAmountByProductId = Object.fromEntries(
    productIds.map((productId) => {
      const soldQty = data.soldMovements
        .filter((row) => getString(row, "product_id") === productId)
        .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
      const returnedQty = data.customerReturnMovements
        .filter((row) => getString(row, "product_id") === productId)
        .reduce((sum, row) => sum + (getNumber(row, "quantity") ?? 0), 0);
      return [productId, Math.max(0, soldQty - returnedQty)];
    })
  );

  const lowStockThresholdByProductId = Object.fromEntries(
    data.thresholdRows
      .map((row) => {
        const id = getString(row, "id");
        if (!id) return null;
        return [id, getNumber(row, "low_stock_threshold") ?? 5] as const;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)
  );

  const movementRows = (movements ?? []) as Row[];
  const items = buildInventoryItems(
    data.products,
    data.inventoryRows,
    soldAmountByProductId,
    movementRows,
    lowStockThresholdByProductId
  );

  const error =
    data.productsError?.message ??
    data.inventoryError?.message ??
    (data.movementsError?.message ? data.movementsError.message : movementsError?.message) ??
    data.thresholdsError?.message ??
    null;

  return {
    items,
    movements: movementRows,
    totalCount: data.count,
    // Drive "has more" off page fullness, not the estimated count.
    hasMore: data.products.length === PRODUCTS_PAGE_SIZE,
    error,
  };
}

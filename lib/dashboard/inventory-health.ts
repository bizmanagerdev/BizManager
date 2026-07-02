import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type InventoryItem = { id: string; name: string };

export type InventoryHealth = {
  lowStock: InventoryItem[];
  lowStockCount: number;
  outOfStock: InventoryItem[];
  outOfStockCount: number;
  reservedProducts: number;
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getBoolean(row: Row, key: string) {
  const value = row[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Inventory health from `products` + `inventory` (same join the low-stock rule uses):
 * available = on_hand − reserved. Items at/below threshold but still in stock are
 * "low"; available ≤ 0 is "out". `reservedProducts` = products with live reservations.
 * Back-office only. Best-effort — missing columns/tables resolve to empty.
 */
export async function getInventoryHealth(
  supabase: SupabaseClient
): Promise<InventoryHealth> {
  const empty: InventoryHealth = {
    lowStock: [],
    lowStockCount: 0,
    outOfStock: [],
    outOfStockCount: 0,
    reservedProducts: 0,
  };

  const [productsRes, inventoryRes] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,active,low_stock_threshold")
      .range(0, 1999)
      .then((r) => r, () => ({ data: [] as Row[], error: null })),
    supabase
      .from("inventory")
      .select("product_id,quantity_on_hand,quantity_reserved")
      .range(0, 1999)
      .then((r) => r, () => ({ data: [] as Row[], error: null })),
  ]);

  const products = (productsRes.data ?? []) as Row[];
  if (products.length === 0) return empty;

  const inventoryByProductId = new Map<string, { onHand: number; reserved: number }>();
  for (const row of (inventoryRes.data ?? []) as Row[]) {
    const productId = getString(row, "product_id");
    if (!productId) continue;
    inventoryByProductId.set(productId, {
      onHand: getNumber(row, "quantity_on_hand") ?? 0,
      reserved: getNumber(row, "quantity_reserved") ?? 0,
    });
  }

  const lowStock: InventoryItem[] = [];
  const outOfStock: InventoryItem[] = [];
  let reservedProducts = 0;

  for (const product of products) {
    const id = getString(product, "id");
    if (!id || getBoolean(product, "active") === false) continue;
    const name = getString(product, "name") ?? "מוצר";
    const threshold = getNumber(product, "low_stock_threshold") ?? 5;
    const inv = inventoryByProductId.get(id);
    const available = (inv?.onHand ?? 0) - (inv?.reserved ?? 0);
    if ((inv?.reserved ?? 0) > 0) reservedProducts += 1;

    if (available <= 0) outOfStock.push({ id, name });
    else if (available <= threshold) lowStock.push({ id, name });
  }

  return {
    lowStock,
    lowStockCount: lowStock.length,
    outOfStock,
    outOfStockCount: outOfStock.length,
    reservedProducts,
  };
}

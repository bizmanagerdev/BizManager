import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

/**
 * Attach an `available_quantity` (on_hand − reserved) to each product row from
 * the inventory table, so the order wizard can show live stock and warn when a
 * requested quantity exceeds what's available. Products with no inventory row get
 * `null` (unknown — not zero), so we never falsely warn on untracked items.
 *
 * Shared by the wizard's server load and /api/products/search so both surfaces
 * show the same number.
 */
export async function attachProductStock(supabase: SupabaseClient, rows: Row[]): Promise<Row[]> {
  const ids = Array.from(
    new Set(
      rows
        .map((r) => (typeof r.id === "string" ? r.id : null))
        .filter((v): v is string => Boolean(v))
    )
  );
  if (ids.length === 0) return rows;

  const { data } = await supabase
    .from("inventory")
    .select("product_id,quantity_on_hand,quantity_reserved")
    .in("product_id", ids);

  const availableByProduct = new Map<string, number>();
  for (const r of (data ?? []) as Row[]) {
    const pid = typeof r.product_id === "string" ? r.product_id : null;
    if (!pid) continue;
    const onHand = Number(r.quantity_on_hand ?? 0) || 0;
    const reserved = Number(r.quantity_reserved ?? 0) || 0;
    availableByProduct.set(pid, onHand - reserved);
  }

  return rows.map((r) => {
    const id = typeof r.id === "string" ? r.id : null;
    const available = id ? availableByProduct.get(id) : undefined;
    return { ...r, available_quantity: available ?? null };
  });
}

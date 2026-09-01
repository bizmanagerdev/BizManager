import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { attachProductStock } from "@/lib/orders/productStock";

/**
 * Client-side product search — straight from Supabase, no /api/products/search
 * round trip. RLS on `products_with_last_used` (security_invoker=on, confirmed
 * live 2026-09-01) and `inventory` already scope both reads the same way the
 * old route did with its identical (cookie-bound) client.
 */
export async function searchProducts(
  q: string,
  limit = 50,
  signal?: AbortSignal
): Promise<Record<string, unknown>[]> {
  const cappedLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 50);
  const supabase = createSupabaseBrowserClient();

  let query = supabase
    .from("products_with_last_used")
    .select("id,name,sku,barcode,description,base_price,base_cost,active,order_count,last_used_at")
    .order("order_count", { ascending: false })
    .order("name", { ascending: true })
    .range(0, cappedLimit - 1);

  const trimmed = q.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/,/g, " ");
    query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%`);
  }
  if (signal) query = query.abortSignal(signal);

  const { data, error } = await query;
  if (error) throw error;

  return attachProductStock(supabase, (data ?? []) as Record<string, unknown>[]);
}

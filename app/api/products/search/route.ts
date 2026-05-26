import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "50");
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.floor(parsed), 50);
}

export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = parseLimit(searchParams.get("limit"));

  let query = supabase
    .from("products_with_last_used")
    .select("id,name,sku,barcode,description,base_price,base_cost,active,order_count,last_used_at")
    .order("order_count", { ascending: false })
    .order("name", { ascending: true })
    .range(0, limit - 1);

  if (q) {
    const escaped = q.replace(/,/g, " ");
    query = query.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%,barcode.ilike.%${escaped}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ products: data ?? [] });
}

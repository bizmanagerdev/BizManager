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
    .from("customer_overview_view")
    .select("customer_id,customer_name,phone,email,address")
    .order("customer_name", { ascending: true })
    .range(0, limit - 1);

  if (q) {
    const escaped = q.replace(/,/g, " ");
    query = query.or(
      `customer_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,address.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const customers = (data ?? []).map((row) => ({
    id: row.customer_id,
    name: row.customer_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
  }));

  return NextResponse.json({ customers });
}

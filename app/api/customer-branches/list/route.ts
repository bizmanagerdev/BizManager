import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { searchParams } = new URL(req.url);
  const customerId = (searchParams.get("customer_id") ?? "").trim();
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("customer_branches")
    .select("id,customer_id,name,address,phone,active")
    .eq("customer_id", customerId)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
  }

  return NextResponse.json({ branches: data ?? [] });
}

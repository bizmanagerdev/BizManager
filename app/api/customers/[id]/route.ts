import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { CUSTOMER_CORE_SELECT, withLinkColumn } from "@/lib/customers/workerLink";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing customer id" }, { status: 400 });
  }

  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const { data, error } = await withLinkColumn(CUSTOMER_CORE_SELECT, (select) =>
    supabase.from("customers").select(select).eq("id", id).maybeSingle()
  );

  if (error) {
    return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ customer: data });
}

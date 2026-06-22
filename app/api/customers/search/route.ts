import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { findMatchingCustomers, type MatchedCustomer } from "@/lib/search/findMatchingCustomers";

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

  // No query → return the first page of customers (used to seed the wizards).
  if (!q) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment")
      .order("name", { ascending: true })
      .range(0, limit - 1);
    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }
    const customers: MatchedCustomer[] = (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      name_for_invoice: row.name_for_invoice ?? null,
      registration_number: row.registration_number ?? null,
      phone: row.phone,
      whatsapp: row.whatsapp ?? null,
      email: row.email,
      address: row.address,
      active: row.active !== false,
      notes: row.notes ?? null,
      requires_prepayment: row.requires_prepayment === true,
      contacts: [],
    }));
    return NextResponse.json({ customers });
  }

  try {
    const { customers } = await findMatchingCustomers(supabase, q, { limit });
    return NextResponse.json({ customers });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאת חיפוש לקוחות") }, { status: 400 });
  }
}

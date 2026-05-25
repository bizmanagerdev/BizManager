import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function parseLimit(value: string | null) {
  const parsed = Number(value ?? "50");
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(Math.floor(parsed), 50);
}

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  requires_prepayment: boolean;
  contacts?: Array<{ full_name: string; phone: string | null; email: string | null }>;
};

export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase } = access.value;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = parseLimit(searchParams.get("limit"));

  let baseQuery = supabase
    .from("customers")
    .select("id,name,phone,email,address,requires_prepayment")
    .order("name", { ascending: true })
    .range(0, limit - 1);

  if (q) {
    const escaped = q.replace(/,/g, " ");
    baseQuery = baseQuery.or(
      `name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,address.ilike.%${escaped}%`
    );
  }

  const { data, error } = await baseQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const byId = new Map<string, CustomerRow>(
    (data ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        address: row.address,
        requires_prepayment: row.requires_prepayment === true,
      },
    ])
  );

  // Also search contacts and include their customers
  if (q) {
    const escaped = q.replace(/,/g, " ");
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("customer_id,full_name,phone,email")
      .or(`full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,whatsapp.ilike.%${escaped}%`)
      .eq("active", true)
      .range(0, limit - 1);

    const contactCustomerIds = [
      ...new Set(
        (contactRows ?? [])
          .map((r) => (typeof r.customer_id === "string" ? r.customer_id : ""))
          .filter(Boolean)
      ),
    ].filter((id) => !byId.has(id));

    if (contactCustomerIds.length > 0) {
      const { data: extraCustomers } = await supabase
        .from("customers")
        .select("id,name,phone,email,address,requires_prepayment")
        .in("id", contactCustomerIds);

      for (const row of extraCustomers ?? []) {
        byId.set(row.id, {
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          requires_prepayment: row.requires_prepayment === true,
        });
      }
    }

    // Attach matching contacts to each customer so the client can display them
    for (const c of contactRows ?? []) {
      const cid = typeof c.customer_id === "string" ? c.customer_id : "";
      if (!cid) continue;
      const customer = byId.get(cid);
      if (!customer) continue;
      if (!customer.contacts) customer.contacts = [];
      customer.contacts.push({ full_name: c.full_name, phone: c.phone ?? null, email: c.email ?? null });
    }
  }

  return NextResponse.json({ customers: Array.from(byId.values()).slice(0, limit) });
}

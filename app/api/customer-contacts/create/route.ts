import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

type CreateCustomerContactPayload = {
  customer_id?: string;
  full_name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  is_primary?: boolean;
  active?: boolean;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "customer-contacts/create", async () => {
    const body = (await req.json()) as CreateCustomerContactPayload;

    const customerId =
      typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    const fullName =
      typeof body.full_name === "string" ? body.full_name.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : null;
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const email = typeof body.email === "string" ? body.email.trim() : null;
    const whatsapp =
      typeof body.whatsapp === "string" ? body.whatsapp.trim() : null;
    const isPrimary = Boolean(body.is_primary);
    const active = body.active === false ? false : true;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!customerId) {
      return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });
    }
    if (!fullName) {
      return NextResponse.json({ error: "Missing full_name" }, { status: 400 });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      return NextResponse.json({ error: toHebrewError(customerError.message) }, { status: 400 });
    }
    if (!customer?.id) {
      return NextResponse.json({ error: "Invalid customer_id" }, { status: 400 });
    }

    if (isPrimary) {
      const { error: clearPrimaryError } = await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("customer_id", customerId)
        .eq("is_primary", true);
      if (clearPrimaryError) {
        return NextResponse.json(
          { error: toHebrewError(clearPrimaryError.message) },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("contacts")
      .insert({
        customer_id: customerId,
        full_name: fullName,
        role,
        phone,
        email,
        whatsapp,
        is_primary: isPrimary,
        active,
        notes,
      })
      .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "Contact was not created" }, { status: 400 });
    }

    return NextResponse.json({ contact: data });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

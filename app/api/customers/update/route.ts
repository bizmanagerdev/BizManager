import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type UpdateCustomerPayload = {
  id?: string;
  name?: string;
  name_for_invoice?: string | null;
  registration_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
  requires_prepayment?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateCustomerPayload;

    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const nameForInvoice =
      typeof body.name_for_invoice === "string" ? body.name_for_invoice.trim() : null;
    const registrationNumber =
      typeof body.registration_number === "string"
        ? body.registration_number.trim()
        : null;
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : null;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;
    const active = typeof body.active === "boolean" ? body.active : true;
    const requiresPrepayment = body.requires_prepayment === true;

    if (!id) {
      return NextResponse.json({ error: "Missing customer id" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("customers")
      .update({
        name,
        name_for_invoice: nameForInvoice || name,
        registration_number: registrationNumber,
        phone,
        whatsapp,
        email: email || null,
        address,
        notes,
        active,
        requires_prepayment: requiresPrepayment,
      })
      .eq("id", id)
      .select("id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "Customer was not updated" }, { status: 400 });
    }

    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

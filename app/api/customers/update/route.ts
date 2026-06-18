import { toHebrewError } from "@/lib/error-messages";
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

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateCustomerPayload;

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "Missing customer id" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
      }
      patch.name = name;
    }
    if ("name_for_invoice" in body) {
      const nameForInvoice = trimOrNull(body.name_for_invoice);
      patch.name_for_invoice = nameForInvoice ?? (typeof patch.name === "string" ? patch.name : null);
    } else if ("name" in body) {
      patch.name_for_invoice = patch.name;
    }
    if ("registration_number" in body) patch.registration_number = trimOrNull(body.registration_number);
    if ("phone" in body) patch.phone = trimOrNull(body.phone);
    if ("whatsapp" in body) patch.whatsapp = trimOrNull(body.whatsapp);
    if ("email" in body) patch.email = trimOrNull(body.email);
    if ("address" in body) patch.address = trimOrNull(body.address);
    if ("notes" in body) patch.notes = trimOrNull(body.notes);
    if ("active" in body) patch.active = body.active === true;
    if ("requires_prepayment" in body) patch.requires_prepayment = body.requires_prepayment === true;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase
      .from("customers")
      .update(patch)
      .eq("id", id)
      .select("id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "Customer was not updated" }, { status: 400 });
    }

    return NextResponse.json({ customer: data });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

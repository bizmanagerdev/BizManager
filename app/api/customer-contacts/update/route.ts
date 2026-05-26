import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type UpdateContactPayload = {
  id?: string;
  full_name?: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  is_primary?: boolean;
  active?: boolean;
  notes?: string | null;
};

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateContactPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Missing contact id" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if ("full_name" in body) {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      if (!fullName) {
        return NextResponse.json({ error: "Contact name is required" }, { status: 400 });
      }
      patch.full_name = fullName;
    }
    if ("role" in body) patch.role = trimOrNull(body.role);
    if ("phone" in body) patch.phone = trimOrNull(body.phone);
    if ("email" in body) patch.email = trimOrNull(body.email);
    if ("whatsapp" in body) patch.whatsapp = trimOrNull(body.whatsapp);
    if ("is_primary" in body) patch.is_primary = body.is_primary === true;
    if ("active" in body) patch.active = body.active !== false;
    if ("notes" in body) patch.notes = trimOrNull(body.notes);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: existing, error: lookupError } = await supabase
      .from("contacts")
      .select("id,customer_id")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 400 });
    }
    if (!existing || typeof existing.customer_id !== "string") {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    if (patch.is_primary === true) {
      const { error: clearError } = await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("customer_id", existing.customer_id)
        .eq("is_primary", true)
        .neq("id", id);
      if (clearError) {
        return NextResponse.json({ error: clearError.message }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("id", id)
      .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "Contact was not updated" }, { status: 400 });
    }

    return NextResponse.json({ contact: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

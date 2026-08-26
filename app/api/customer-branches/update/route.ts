import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type UpdateCustomerBranchPayload = {
  id?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean;
};

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as UpdateCustomerBranchPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "Missing branch id" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
      }
      patch.name = name;
    }
    if ("address" in body) patch.address = trimOrNull(body.address);
    if ("phone" in body) patch.phone = trimOrNull(body.phone);
    if ("active" in body) patch.active = body.active !== false;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: existing, error: lookupError } = await supabase
      .from("customer_branches")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      return NextResponse.json({ error: toHebrewError(lookupError.message) }, { status: 400 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("customer_branches")
      .update(patch)
      .eq("id", id)
      .select("id,customer_id,name,address,phone,active")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    }
    if (!data || typeof data.id !== "string") {
      return NextResponse.json({ error: "Branch was not updated" }, { status: 400 });
    }

    return NextResponse.json({ branch: data });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

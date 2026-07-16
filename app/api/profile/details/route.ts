import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

// Self-serve edit of your own name + phone. Writes via the set_my_profile_details
// RPC, which is scoped to auth.uid() — so this route can't be used to touch
// anyone else's row, and users.* needs no broad UPDATE policy.
// Email/role/pay type are intentionally not editable here.
export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json().catch(() => ({}))) as { full_name?: unknown; phone?: unknown };
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!fullName) {
      return NextResponse.json({ error: "יש להזין שם." }, { status: 400 });
    }

    const { error } = await supabase.rpc("set_my_profile_details", {
      p_full_name: fullName,
      p_phone: phone || null,
    });
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({ ok: true, full_name: fullName, phone: phone || null });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}

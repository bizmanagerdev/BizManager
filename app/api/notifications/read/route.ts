import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// Mark a notification read ({ id }) or all of them ({ all: true }). RLS ensures
// the viewer can only touch their own rows.
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { id?: string; all?: boolean };
  const nowIso = new Date().toISOString();

  if (body.all) {
    const { error } = await supabase.from("notifications").update({ read_at: nowIso }).is("read_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else if (typeof body.id === "string" && body.id) {
    const { error } = await supabase.from("notifications").update({ read_at: nowIso }).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    return NextResponse.json({ error: "id or all required" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

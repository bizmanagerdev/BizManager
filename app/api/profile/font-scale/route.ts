import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function clampScale(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(2, Math.max(0.5, n));
}

// GET — the signed-in user's saved text-size multiplier. Tolerant of the
// font_scale column not existing yet (returns null before the migration runs).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const { data, error } = await supabase
    .from("users")
    .select("font_scale")
    .eq("id", profile.id)
    .maybeSingle();

  if (error) return NextResponse.json({ fontScale: null });
  const scale = clampScale((data as { font_scale?: unknown } | null)?.font_scale);
  return NextResponse.json({ fontScale: scale });
}

// POST — persist the choice to the account so it follows the user across
// devices. Non-critical: the client already applied it locally, so we never
// hard-fail — we just report whether it synced (false if the migration/RPC
// isn't in place yet).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { scale?: unknown };
  const scale = clampScale(body.scale);
  if (scale == null) {
    return NextResponse.json({ error: "Invalid scale" }, { status: 400 });
  }

  const { error } = await supabase.rpc("set_my_font_scale", { p_scale: scale });
  return NextResponse.json({ ok: true, synced: !error });
}

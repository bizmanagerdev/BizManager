import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

function clampScale(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(2, Math.max(0.5, n));
}

// GET — the signed-in user's saved text-size multipliers, one per device class.
// Tolerant of either column not existing yet: `font_scale` predates
// `font_scale_mobile` (migration 20260818000000), and both are read in one go
// with a fallback query so an older database still answers.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const { data, error } = await supabase
    .from("users")
    .select("font_scale,font_scale_mobile")
    .eq("id", profile.id)
    .maybeSingle();

  if (error) {
    // Pre-migration: the mobile column isn't there. Ask for the old one alone
    // rather than reporting "no preference" and resetting the user's size.
    const legacy = await supabase.from("users").select("font_scale").eq("id", profile.id).maybeSingle();
    const scale = clampScale((legacy.data as { font_scale?: unknown } | null)?.font_scale);
    return NextResponse.json({ fontScale: scale, fontScaleMobile: null });
  }

  const row = data as { font_scale?: unknown; font_scale_mobile?: unknown } | null;
  return NextResponse.json({
    fontScale: clampScale(row?.font_scale),
    fontScaleMobile: clampScale(row?.font_scale_mobile),
  });
}

// POST — persist a choice to the account so it follows the user across devices.
// `device` says which one: "desktop" (the original font_scale) or "mobile".
// Non-critical: the client already applied it locally, so we never hard-fail —
// we just report whether it synced (false if the migration/RPC isn't in place).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { scale?: unknown; device?: unknown };
  const scale = clampScale(body.scale);
  if (scale == null) {
    return NextResponse.json({ error: "Invalid scale" }, { status: 400 });
  }

  const rpc = body.device === "mobile" ? "set_my_font_scale_mobile" : "set_my_font_scale";
  const { error } = await supabase.rpc(rpc, { p_scale: scale });
  return NextResponse.json({ ok: true, synced: !error });
}

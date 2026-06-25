import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isHexColor } from "@/components/dashboard/InitialsAvatar";

// GET — the signed-in user's saved avatar color. Tolerant of the avatar_color
// column not existing yet (returns null before the migration runs).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const { data, error } = await supabase
    .from("users")
    .select("avatar_color")
    .eq("id", profile.id)
    .maybeSingle();

  if (error) return NextResponse.json({ avatarColor: null });
  const raw = (data as { avatar_color?: unknown } | null)?.avatar_color;
  const color = typeof raw === "string" && isHexColor(raw) ? raw : null;
  return NextResponse.json({ avatarColor: color });
}

// POST — persist the choice to the account so it follows the user everywhere.
// `color: null` clears the choice (back to the auto-assigned color). Non-critical:
// the client already applied it locally, so we report whether it synced (false if
// the migration/RPC isn't in place yet).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { color?: unknown };
  const clear = body.color === null;
  if (!clear && !isHexColor(typeof body.color === "string" ? body.color : null)) {
    return NextResponse.json({ error: "Invalid color" }, { status: 400 });
  }

  const { error } = await supabase.rpc("set_my_avatar_color", {
    p_color: clear ? null : (body.color as string),
  });
  return NextResponse.json({ ok: true, synced: !error });
}

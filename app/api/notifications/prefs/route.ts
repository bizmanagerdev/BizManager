import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// The viewer's notification preferences (mute buckets + pause push).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;
  const { data } = await supabase.from("users").select("notification_prefs").eq("id", profile.id).maybeSingle();
  return NextResponse.json({ prefs: (data as { notification_prefs?: unknown } | null)?.notification_prefs ?? null });
}

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { prefs?: { muted?: unknown; push_paused?: unknown } };
  const muted = Array.isArray(body.prefs?.muted) ? body.prefs.muted.filter((x): x is string => typeof x === "string") : [];
  const prefs = { muted: [...new Set(muted)], push_paused: body.prefs?.push_paused === true };

  const { error } = await supabase.rpc("set_my_notification_prefs", { p_prefs: prefs });
  return NextResponse.json({ ok: true, synced: !error });
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { sanitizeNotificationPrefs } from "@/lib/notifications/prefs";

// The viewer's notification preferences. Always returns a COMPLETE prefs object
// (old rows that only have { muted, push_paused } resolve to defaults), so the
// client never has to know about the legacy shape.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;
  const { data } = await supabase.from("users").select("notification_prefs").eq("id", profile.id).maybeSingle();
  const prefs = sanitizeNotificationPrefs((data as { notification_prefs?: unknown } | null)?.notification_prefs);
  return NextResponse.json({ prefs });
}

export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { prefs?: unknown };
  // Sanitize server-side: unknown keys/buckets/hours never reach the DB.
  const prefs = sanitizeNotificationPrefs(body.prefs);

  const { error } = await supabase.rpc("set_my_notification_prefs", { p_prefs: prefs });
  return NextResponse.json({ ok: true, synced: !error, prefs });
}

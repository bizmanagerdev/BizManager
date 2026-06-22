import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getDashboardPrefs, sanitizePrefs } from "@/lib/dashboard/widgets";

// GET — the signed-in user's saved dashboard layout. Tolerant of the
// dashboard_prefs column not existing yet (returns null before the migration).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const prefs = await getDashboardPrefs(supabase, profile.id);
  return NextResponse.json({ prefs });
}

// POST — persist the user's layout so it follows them across devices. The body
// is sanitized down to known widget ids only; the server still re-filters by
// role at render time, so prefs can never reveal a forbidden widget. Non-critical:
// we never hard-fail — we report whether it synced (false if the RPC isn't in
// place yet, e.g. before the migration runs).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { prefs?: unknown };
  const prefs = sanitizePrefs(body.prefs);

  const { error } = await supabase.rpc("set_my_dashboard_prefs", { p_prefs: prefs });
  return NextResponse.json({ ok: true, synced: !error });
}

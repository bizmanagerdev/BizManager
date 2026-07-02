import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getWorklistPrefs, sanitizeWorklistPrefs } from "@/lib/reminders/worklist";

// GET — the signed-in user's saved worklist section layout (null before migration).
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;
  const prefs = await getWorklistPrefs(supabase, profile.id);
  return NextResponse.json({ prefs });
}

// POST — persist the layout. Sanitized to known section ids only; never hard-fails
// (reports synced=false if the RPC/migration isn't in place yet).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { prefs?: unknown };
  const prefs = sanitizeWorklistPrefs(body.prefs);

  const { error } = await supabase.rpc("set_my_worklist_prefs", { p_prefs: prefs });
  return NextResponse.json({ ok: true, synced: !error });
}

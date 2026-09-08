import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { sanitizeLedgerPrefs } from "@/lib/projectLedgerPrefs";

// POST — persist the user's תנועות group-by/sort-by choice so it follows them
// across devices. Non-critical, like dashboard-prefs: we never hard-fail — we
// report whether it synced (false if the RPC isn't in place yet, e.g. before
// the migration runs).
export async function POST(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const body = (await req.json().catch(() => ({}))) as { prefs?: unknown };
  const prefs = sanitizeLedgerPrefs(body.prefs);

  const { error } = await supabase.rpc("set_my_ledger_prefs", { p_prefs: prefs });
  return NextResponse.json({ ok: true, synced: !error });
}

import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

// POST — mark the digest read: advance digest_seen_at to now so the bar clears.
// Non-critical: reports synced=false if the RPC/migration isn't in place yet.
export async function POST() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const { error } = await supabase.rpc("set_my_digest_seen_at", { p_at: null });
  return NextResponse.json({ ok: true, synced: !error });
}

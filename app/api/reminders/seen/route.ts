import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";

// "סמן הכול כנקרא" — advances users.inbox_seen_at to now, so nothing currently in
// the inbox counts as "new" any more. It does NOT resolve anything: the items stay
// open and actionable; they just stop being highlighted as unseen.
export async function POST() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data, error } = await supabase.rpc("set_my_inbox_seen_at", { p_at: null });
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true, seenAt: data ?? null });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "Unknown error") }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadQuickActionsData } from "@/app/(app)/dashboard/quick-actions-data";

// The dropdown/picker data behind the top-bar quick-create (+) menu — the same
// payload the dashboard streams into its quick actions, but fetched on demand so
// every other page pays nothing for it until the user actually opens the menu.
// `currentUserId`/`role` ride along so the task + expense dialogs can default the
// assignee and gate their manager-only sections without a second round trip.
//
// requireRouteAccess(), like every other API route: it answers with a status
// code (not requireProfile()'s page redirect) and reads the session from the
// cookie. This used to call supabase.auth.getUser() — a round trip to the Auth
// server (~250 ms p75, seconds on a bad day) in front of every + menu open, on
// top of the profile read and the lists. RLS still checks every query below
// against the caller's JWT.
export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const data = await loadQuickActionsData(supabase);
    return NextResponse.json({
      ...data,
      currentUserId: profile.id,
      role: profile.role ?? null,
      locale: profile.locale,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת הנתונים נכשלה.") }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { loadQuickActionsData } from "@/app/(app)/dashboard/quick-actions-data";

// The dropdown/picker data behind the top-bar quick-create (+) menu — the same
// payload the dashboard streams into its quick actions, but fetched on demand so
// every other page pays nothing for it until the user actually opens the menu.
// `currentUserId`/`role` ride along so the task + expense dialogs can default the
// assignee and gate their manager-only sections without a second round trip.
// Auth is checked here rather than via requireProfile(), which redirects (that's
// page behaviour — a fetch() wants a status code).
export async function GET() {
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const authUserId = user?.id;
    if (!authUserId) return NextResponse.json({ error: "לא מחובר." }, { status: 401 });

    let { data: profile } = await supabase
      .from("users")
      .select("id,role,active,system_access,locale")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!profile) {
      // Pre-migration: the `locale` column may not exist yet.
      const legacy = await supabase
        .from("users")
        .select("id,role,active,system_access")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      profile = legacy.data as typeof profile;
    }
    if (!profile || !profile.active || !profile.system_access) {
      return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
    }

    const data = await loadQuickActionsData(supabase, { id: profile.id as string });
    const rawLocale = (profile as { locale?: unknown }).locale;
    return NextResponse.json({
      ...data,
      currentUserId: profile.id,
      role: profile.role ?? null,
      locale: rawLocale === "ar" ? "ar" : "he",
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת הנתונים נכשלה.") }, { status: 500 });
  }
}

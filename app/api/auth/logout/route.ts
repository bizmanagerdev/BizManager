import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  const supabase = await createSupabaseRouteClient();

  // Record the logout in the activity feed while still authenticated (best-effort).
  try {
    const { data: userResult } = await supabase.auth.getUser();
    const authUserId = userResult.user?.id;
    if (authUserId) {
      const { data: profile } = await supabase
        .from("users")
        .select("id,role,email")
        .eq("auth_user_id", authUserId)
        .maybeSingle();

      if (profile?.id) {
        await logAuditEvent({
          supabase,
          tableName: "auth",
          recordId: profile.id,
          action: "logout",
          changedBy: profile.id,
          userRole: profile.role ?? null,
          newData: { email: profile.email ?? null },
        });
      }
    }
  } catch {
    // Auditing must never break sign-out.
  }

  await supabase.auth.signOut();
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}

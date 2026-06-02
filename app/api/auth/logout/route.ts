import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { logAuditEvent } from "@/lib/audit";

export async function POST(req: Request) {
  const cookieStore = await cookies();

  // 303 (See Other) forces the browser to follow with a GET — a default 307
  // would re-POST to /login and yield a 405. Sign-out cookie clearing is written
  // straight onto THIS response so the session is reliably removed.
  const response = NextResponse.redirect(new URL("/login", req.url), { status: 303 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

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
  return response;
}

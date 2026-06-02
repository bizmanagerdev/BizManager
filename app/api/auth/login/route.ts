import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as Partial<{
    email: string;
    password: string;
  }>;

  const trimmedEmail = email?.trim();

  if (!trimmedEmail || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseRouteClient();

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("invalid login credentials")) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Record the login in the activity feed (best-effort — never blocks sign-in).
  try {
    const authUserId = signInData.user?.id;
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
          action: "login",
          changedBy: profile.id,
          userRole: profile.role ?? null,
          newData: { email: profile.email ?? trimmedEmail },
        });
      }
    }
  } catch {
    // Auditing must never break authentication.
  }

  return NextResponse.json({ ok: true });
}


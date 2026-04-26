import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateUserPayload = {
  full_name?: string | null;
  email?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateUserPayload;
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!fullName) {
      return NextResponse.json({ error: "שם עובד הוא שדה חובה." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "אימייל עובד הוא שדה חובה." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: existingUser, error: existingUserError } = await supabase
      .from("users")
      .select("id,full_name,email,role,active")
      .eq("email", email)
      .maybeSingle();

    if (existingUserError) {
      return NextResponse.json({ error: existingUserError.message }, { status: 400 });
    }
    if (existingUser?.id) {
      return NextResponse.json({ user: existingUser });
    }

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        full_name: fullName,
        email,
        active: true,
      })
      .select("id,full_name,email,role,active")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!user?.id) {
      return NextResponse.json({ error: "העובד לא נוצר." }, { status: 500 });
    }

    return NextResponse.json({ user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

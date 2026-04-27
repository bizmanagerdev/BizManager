import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateUserPayload = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  role?: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateUserPayload;
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : "worker";

    if (!fullName) {
      return NextResponse.json({ error: "יש להזין שם עובד." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "יש להזין אימייל." }, { status: 400 });
    }
    if (!password) {
      return NextResponse.json({ error: "יש להזין סיסמה לעובד." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data: existingUser, error: existingUserError } = await supabase
      .from("users")
      .select("id,full_name,email,phone,role,active")
      .eq("email", email)
      .maybeSingle();

    if (existingUserError) {
      return NextResponse.json({ error: existingUserError.message }, { status: 400 });
    }
    if (existingUser?.id) {
      return NextResponse.json({ user: existingUser });
    }

    const signupClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const { error: signUpError } = await signupClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || undefined,
          phone: phone || undefined,
        },
      },
    });

    if (signUpError) {
      return NextResponse.json({ error: signUpError.message }, { status: 400 });
    }

    let user: UserRow | null = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await supabase
        .from("users")
        .update({
          full_name: fullName,
          phone,
          role,
          active: true,
        })
        .eq("email", email)
        .select("id,full_name,email,phone,role,active")
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      if (data?.id) {
        user = data as UserRow;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!user?.id) {
      return NextResponse.json(
        { error: "החשבון נוצר אך רשומת העובד עדיין לא הוכנה. נסו שוב בעוד כמה שניות." },
        { status: 500 }
      );
    }

    return NextResponse.json({ user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

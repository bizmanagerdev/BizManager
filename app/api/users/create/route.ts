import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type CreateUserPayload = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  role?: string | null;
  active?: boolean | null;
  system_access?: boolean | null;
};

type UserRow = {
  id: string;
  auth_user_id?: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
  system_access: boolean | null;
};

const ALLOWED_ROLES = ["admin", "office", "worker", "worker_no_access"] as const;

function isAllowedRole(value: string): value is (typeof ALLOWED_ROLES)[number] {
  return (ALLOWED_ROLES as readonly string[]).includes(value);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateUserPayload;
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : null;
    const roleInput = typeof body.role === "string" && body.role.trim() ? body.role.trim() : "worker";
    const role = isAllowedRole(roleInput) ? roleInput : "worker";
    const active = body.active === false ? false : true;
    const systemAccess =
      role === "worker_no_access" ? false : body.system_access === false ? false : true;
    const rawPassword = typeof body.password === "string" ? body.password.trim() : "";
    const password = rawPassword;

    if (!fullName) {
      return NextResponse.json({ error: "יש להזין שם משתמש." }, { status: 400 });
    }
    if (role !== "worker_no_access" && !email) {
      return NextResponse.json({ error: "יש להזין אימייל." }, { status: 400 });
    }
    if (systemAccess && !password) {
      return NextResponse.json({ error: "יש להזין סיסמה למשתמש." }, { status: 400 });
    }

    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    if (email) {
      const { data: existingUser, error: existingUserError } = await supabase
        .from("users")
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access")
        .eq("email", email)
        .maybeSingle();

      if (existingUserError) {
        return NextResponse.json({ error: existingUserError.message }, { status: 400 });
      }
      if (existingUser?.id) {
        return NextResponse.json({ user: existingUser });
      }
    }

    if (!systemAccess) {
      const { data: insertedUser, error: insertUserError } = await supabase
        .from("users")
        .insert({
          full_name: fullName,
          email: email || null,
          phone,
          role,
          active,
          system_access: false,
          auth_user_id: null,
        })
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access")
        .single();

      if (insertUserError) {
        return NextResponse.json({ error: insertUserError.message }, { status: 400 });
      }

      return NextResponse.json({ user: insertedUser });
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

    const { data: signUpData, error: signUpError } = await signupClient.auth.signUp({
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
          auth_user_id: signUpData.user?.id ?? null,
          full_name: fullName,
          phone,
          role,
          active,
          system_access: systemAccess,
        })
        .eq("email", email)
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access")
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
        { error: "החשבון נוצר אבל רשומת המשתמש עדיין לא הוכנה. נסו שוב בעוד כמה שניות." },
        { status: 500 }
      );
    }

    return NextResponse.json({ user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

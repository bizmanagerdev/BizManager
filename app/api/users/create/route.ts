import { toHebrewError } from "@/lib/error-messages";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  getPayTrackingModeForWorkerType,
  normalizePayrollWorkerType,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";

type CreateUserPayload = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string | null;
  role?: string | null;
  active?: boolean | null;
  system_access?: boolean | null;
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: "session" | "payslip" | null;
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
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: "session" | "payslip" | null;
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
    const payrollWorkerType = normalizePayrollWorkerType(body.payroll_worker_type, body.pay_tracking_mode);
    const payTrackingMode = getPayTrackingModeForWorkerType(payrollWorkerType);
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
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
        .eq("email", email)
        .maybeSingle();

      if (existingUserError) {
        return NextResponse.json({ error: toHebrewError(existingUserError.message) }, { status: 400 });
      }
      if (existingUser?.id) {
        return NextResponse.json({ user: existingUser });
      }
    }

    if (!systemAccess) {
      const { data: insertedUserId, error: insertUserError } = await supabase.rpc(
        "admin_upsert_user_profile",
        {
          p_user_id: null,
          p_auth_user_id: null,
          p_full_name: fullName,
          p_email: email || null,
          p_phone: phone,
          p_role: role,
          p_active: active,
          p_system_access: false,
          p_payroll_worker_type: payrollWorkerType,
          p_pay_tracking_mode: payTrackingMode,
        }
      );

      if (insertUserError) {
        return NextResponse.json({ error: toHebrewError(insertUserError.message) }, { status: 400 });
      }

      const { data: insertedUser, error: insertedUserReadError } = await supabase
        .from("users")
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
        .eq("id", insertedUserId)
        .maybeSingle();

      if (insertedUserReadError) {
        return NextResponse.json({ error: toHebrewError(insertedUserReadError.message) }, { status: 400 });
      }
      const { data: refreshedUser, error: refreshedUserError } = await supabase
        .from("users")
        .select("id,auth_user_id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
        .eq("id", insertedUserId)
        .maybeSingle();

      if (refreshedUserError) {
        return NextResponse.json({ error: toHebrewError(refreshedUserError.message) }, { status: 400 });
      }

      return NextResponse.json({ user: refreshedUser ?? insertedUser });
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
      return NextResponse.json({ error: toHebrewError(signUpError.message) }, { status: 400 });
    }

    let user: UserRow | null = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data: upsertedUserId, error } = await supabase.rpc("admin_upsert_user_profile", {
        p_user_id: null,
        p_auth_user_id: signUpData.user?.id ?? null,
        p_full_name: fullName,
        p_email: email,
        p_phone: phone,
        p_role: role,
        p_active: active,
        p_system_access: systemAccess,
        p_payroll_worker_type: payrollWorkerType,
        p_pay_tracking_mode: payTrackingMode,
      });

      if (error) {
        return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      }

      if (upsertedUserId) {
        const { data, error: readError } = await supabase
          .from("users")
          .select("id,auth_user_id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
          .eq("id", upsertedUserId)
          .maybeSingle();

        if (readError) {
          return NextResponse.json({ error: toHebrewError(readError.message) }, { status: 400 });
        }

        if (data?.id) {
          user = data as UserRow;
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!user?.id) {
      return NextResponse.json(
        { error: "החשבון נוצר אבל רשומת המשתמש עדיין לא הוכנה. נסו שוב בעוד כמה שניות." },
        { status: 500 }
      );
    }
    const { data: refreshedUser, error: refreshedUserError } = await supabase
      .from("users")
      .select("id,auth_user_id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode")
      .eq("id", user.id)
      .maybeSingle();

    if (refreshedUserError) {
      return NextResponse.json({ error: toHebrewError(refreshedUserError.message) }, { status: 400 });
    }

    return NextResponse.json({ user: refreshedUser ?? user });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

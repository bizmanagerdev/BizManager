import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  getPayTrackingModeForWorkerType,
  normalizePayrollWorkerType,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";

type UpdateWorkerPayload = {
  user_id?: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string;
  active?: boolean;
  system_access?: boolean;
  payroll_worker_type?: PayrollWorkerType;
  pay_tracking_mode?: "session" | "payslip";
  locale?: "he" | "ar";
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as UpdateWorkerPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const role =
      body.role === "admin" ||
      body.role === "office" ||
      body.role === "worker" ||
      body.role === "worker_no_access"
        ? body.role
        : null;
    const active = body.active === false ? false : true;
    const systemAccess =
      role === "worker_no_access" ? false : body.system_access === false ? false : true;
    const payrollWorkerType = normalizePayrollWorkerType(body.payroll_worker_type, body.pay_tracking_mode);
    const payTrackingMode = getPayTrackingModeForWorkerType(payrollWorkerType);
    // Only workers are ever offered Arabic; force office/admin back to Hebrew
    // rather than trusting a stray client value for a role that shouldn't have one.
    const locale = role === "worker" && body.locale === "ar" ? "ar" : "he";

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }
    if (!role) {
      return NextResponse.json({ error: "Role must be admin, office, worker or worker_no_access." }, { status: 400 });
    }
    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    const { supabase } = access.value;
    const existingUserResult = await supabase
      .from("users")
      .select("id,auth_user_id")
      .eq("id", userId)
      .maybeSingle();

    if (existingUserResult.error) {
      return NextResponse.json({ error: toHebrewError(existingUserResult.error.message) }, { status: 400 });
    }
    if (!existingUserResult.data?.id) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const rpcResult = await supabase.rpc("admin_upsert_user_profile", {
      p_user_id: userId,
      p_auth_user_id: existingUserResult.data.auth_user_id ?? null,
      p_full_name: fullName,
      p_email: email || null,
      p_phone: phone || null,
      p_role: role,
      p_active: active,
      p_system_access: systemAccess,
      p_payroll_worker_type: payrollWorkerType,
      p_pay_tracking_mode: payTrackingMode,
      p_locale: locale,
    });

    if (rpcResult.error) {
      return NextResponse.json({ error: toHebrewError(rpcResult.error.message) }, { status: 400 });
    }

    const result = await supabase
      .from("users")
      .select("id,full_name,email,phone,role,active,system_access,payroll_worker_type,pay_tracking_mode,locale")
      .eq("id", userId)
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: toHebrewError(result.error.message) }, { status: 400 });
    }

    return NextResponse.json({ user: result.data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

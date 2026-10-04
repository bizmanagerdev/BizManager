import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { syncLoginAccess } from "@/lib/auth/loginAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type DeleteWorkerPayload = {
  user_id?: string;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as DeleteWorkerPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }

    const { supabase } = access.value;
    const existingUserResult = await supabase
      .from("users")
      .select("id,auth_user_id,full_name,email,phone,role,payroll_worker_type,pay_tracking_mode")
      .eq("id", userId)
      .maybeSingle();

    if (existingUserResult.error) {
      return NextResponse.json({ error: toHebrewError(existingUserResult.error.message) }, { status: 400 });
    }
    if (!existingUserResult.data?.id) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const existingRole =
      existingUserResult.data.role === "admin" ||
      existingUserResult.data.role === "office" ||
      existingUserResult.data.role === "worker" ||
      existingUserResult.data.role === "worker_no_access"
        ? existingUserResult.data.role
        : "worker";

    // End their login too, not just the profile — otherwise the session they
    // already have keeps renewing (lib/auth/loginAccess.ts). First, so a
    // failure here leaves the worker exactly as they were.
    const authUserId = existingUserResult.data.auth_user_id;
    if (authUserId) {
      const adminClient = createSupabaseAdminClient();
      if (!adminClient) {
        return NextResponse.json(
          { error: toHebrewError("SUPABASE_SERVICE_ROLE_KEY not configured") },
          { status: 500 }
        );
      }
      const banError = await syncLoginAccess(adminClient, authUserId, false);
      if (banError) {
        return NextResponse.json({ error: toHebrewError(banError) }, { status: 400 });
      }
    }

    const rpcResult = await supabase.rpc("admin_upsert_user_profile", {
      p_user_id: existingUserResult.data.id,
      p_auth_user_id: existingUserResult.data.auth_user_id ?? null,
      p_full_name: existingUserResult.data.full_name ?? "עובד",
      p_email: existingUserResult.data.email ?? null,
      p_phone: existingUserResult.data.phone ?? null,
      p_role: existingRole,
      p_active: false,
      p_system_access: false,
      p_payroll_worker_type: existingUserResult.data.payroll_worker_type ?? null,
      p_pay_tracking_mode: existingUserResult.data.pay_tracking_mode === "payslip" ? "payslip" : "session",
    });

    if (rpcResult.error) {
      return NextResponse.json({ error: toHebrewError(rpcResult.error.message) }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

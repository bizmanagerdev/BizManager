import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import {
  isPayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  payrollWorkerTypeGeneratesPayslips,
} from "@/lib/payroll-worker-type";

// Who am I — for chrome that has no props to hang off (the top-bar user menu, the
// role-aware nav). `role` is the original contract; name/email/canTrackSessions
// were added for the user menu so we don't thread props through every AppShell
// call site. Additive only — existing callers read `role` and are unaffected.
export async function GET() {
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const authUserId = user?.id;
    if (!authUserId) {
      return NextResponse.json({ role: null }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("users")
      .select("role,active,system_access,full_name,email,payroll_worker_type")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error || !data || !data.active || !data.system_access) {
      return NextResponse.json({ role: null }, { status: 403 });
    }

    // MUST mirror ProfileClient's gates exactly, or the user menu links to a tab
    // that doesn't render. Note: do NOT use normalizePayrollWorkerType here — it
    // defaults an unset type to "session_only", whereas ProfileClient treats
    // null as "no sessions". A null type means neither section applies.
    const raw = (data as { payroll_worker_type?: unknown }).payroll_worker_type;
    const workerType = isPayrollWorkerType(raw) ? raw : null;
    return NextResponse.json({
      role: data.role ?? null,
      name: (data as { full_name?: string | null }).full_name ?? null,
      email: (data as { email?: string | null }).email ?? null,
      canTrackSessions: workerType != null && payrollWorkerTypeAllowsSessions(workerType),
      canViewSalary: workerType != null && payrollWorkerTypeGeneratesPayslips(workerType),
    });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

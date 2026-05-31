import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { fetchSalaryCenterProtectedPayload, isSalaryTrackedWorker } from "@/lib/payroll-center";

export async function GET() {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    const { supabase, profile } = access.value;
    const usersResult = await supabase
      .from("users")
      .select("id,role,active,payroll_worker_type,pay_tracking_mode")
      .or("role.eq.admin,role.eq.office,role.eq.worker,role.eq.worker_no_access")
      .eq("active", true)
      .range(0, 999);

    if (usersResult.error) {
      return NextResponse.json({ error: usersResult.error.message }, { status: 400 });
    }

    const allRows = (usersResult.data ?? []) as Array<{
      id: string;
      role: string | null;
      payroll_worker_type: "session_only" | "monthly_payslip" | "hourly_payslip" | null;
      pay_tracking_mode: "session" | "payslip" | null;
    }>;
    // Office may view salaries only of users below them: worker & worker_no_access.
    const rows =
      profile.role === "office"
        ? allRows.filter((row) => row.role === "worker" || row.role === "worker_no_access")
        : allRows;
    const userIds = rows.map((row) => row.id).filter(Boolean);
    const salaryTrackedUserIds = rows.filter((row) => isSalaryTrackedWorker(row)).map((row) => row.id).filter(Boolean);
    const payload = await fetchSalaryCenterProtectedPayload(supabase, userIds, salaryTrackedUserIds);

    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

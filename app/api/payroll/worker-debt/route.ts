import { NextRequest, NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { ensureRecentPayslips, type WorkerDebtItemRow } from "@/lib/payroll-center";
import { fetchAllPagedResult } from "@/lib/supabase/paginate";
import { isMissingColumnError } from "@/lib/financial/utils";

// One worker's debt items — the only thing the "תשלום לעובד" dialog needs to
// show the open balance and spread a payment across it. It used to call
// /api/payroll/center/protected?fresh=1, which builds the whole salary-centre
// payload (~12 queries in several rounds) just to read this one view; on a phone
// that held the amount step for 0.6–2 s every time a worker was picked.
//
// Same access rules as that route: admin/office only, and office only for the
// users below them (worker / worker_no_access) — asking for anyone else returns
// an empty list, as the centre's scoped payload did.

const SELECT_COLUMNS =
  "source_type,source_id,user_id,project_id,payslip_id,payroll_period_id,source_date,due_date,period_month,worked_minutes,earned_amount,paid_amount,owed_amount,payment_status,last_payment_date";
// Before the due_date migration (same fallback as fetchSalaryCenterProtectedPayload).
const SELECT_COLUMNS_NO_DUE_DATE = SELECT_COLUMNS.replace(",due_date", "");

// The centre route's payslip safety net (see ensureRecentPayslips there): for an
// admin, at most every few minutes per warm instance, so a payment made the first
// morning of a month — before the daily cron — still sees last month's payslip.
const ENSURE_PAYSLIPS_INTERVAL_MS = 10 * 60_000;
let lastEnsuredPayslipsAt: number | null = null;

export async function GET(request: NextRequest) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const userId = request.nextUrl.searchParams.get("userId")?.trim() || "";
    if (!userId) return NextResponse.json({ error: "חסר עובד." }, { status: 400 });

    if (profile.role === "admin" && (lastEnsuredPayslipsAt === null || Date.now() - lastEnsuredPayslipsAt > ENSURE_PAYSLIPS_INTERVAL_MS)) {
      lastEnsuredPayslipsAt = Date.now();
      try {
        await ensureRecentPayslips(supabase);
      } catch (error: unknown) {
        console.error("[payroll] ensureRecentPayslips failed", error);
      }
    }

    const debtPage = (columns: string) => (lo: number, hi: number) =>
      supabase.from("worker_debt_items_view").select(columns).eq("user_id", userId).range(lo, hi);

    const [userResult, initialDebtResult] = await Promise.all([
      supabase.from("users").select("id,role").eq("id", userId).eq("active", true).maybeSingle(),
      fetchAllPagedResult<WorkerDebtItemRow>(debtPage(SELECT_COLUMNS)),
    ]);
    if (userResult.error) {
      return NextResponse.json({ error: toHebrewError(userResult.error.message) }, { status: 400 });
    }
    const worker = userResult.data as { id: string; role: string | null } | null;
    const visible =
      worker !== null && (profile.role !== "office" || worker.role === "worker" || worker.role === "worker_no_access");
    if (!visible) return NextResponse.json({ workerDebtItems: [] });

    let debtResult = initialDebtResult;
    if (debtResult.error && isMissingColumnError(debtResult.error, "due_date")) {
      debtResult = await fetchAllPagedResult<WorkerDebtItemRow>(debtPage(SELECT_COLUMNS_NO_DUE_DATE));
    }
    if (debtResult.error) {
      return NextResponse.json({ error: toHebrewError(debtResult.error.message) }, { status: 400 });
    }

    return NextResponse.json({
      workerDebtItems: (debtResult.data ?? []).filter((row) => row.user_id && row.source_id),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת יתרת העובד נכשלה.") }, { status: 500 });
  }
}

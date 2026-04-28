import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { collectLockedSessionIds, regenerateEditablePayslipsForUsers } from "@/lib/payroll-center";
import type { PayrollPeriodRow } from "@/lib/payroll";
import { WORK_SESSIONS_TABLE } from "@/lib/payroll";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as { session_id?: string };
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
    }

    const { supabase } = access.value;
    const [sessionResult, periodsResult] = await Promise.all([
      supabase.from(WORK_SESSIONS_TABLE).select("id,user_id,clock_in").eq("id", sessionId).maybeSingle(),
      supabase.from("payroll_periods").select("id,period_month,start_date,end_date,status").range(0, 119),
    ]);

    if (sessionResult.error) return NextResponse.json({ error: sessionResult.error.message }, { status: 400 });
    if (periodsResult.error) return NextResponse.json({ error: periodsResult.error.message }, { status: 400 });
    if (!sessionResult.data) return NextResponse.json({ error: "Session not found." }, { status: 404 });

    const lockedIds = collectLockedSessionIds([sessionResult.data], (periodsResult.data ?? []) as PayrollPeriodRow[]);
    if (lockedIds.has(sessionId)) {
      return NextResponse.json({ error: "This session belongs to a locked payroll period." }, { status: 409 });
    }

    const deleteResult = await supabase.from(WORK_SESSIONS_TABLE).delete().eq("id", sessionId);
    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    await regenerateEditablePayslipsForUsers(supabase, [sessionResult.data.user_id ?? ""]);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions } from "@/lib/payroll-worker-type";
import { minutesBetween } from "@/lib/payroll";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Manually add a phone-attendance report from the payroll queue — for a worker who forgot to call,
 * came in late, etc. Lands in the SAME queue as phone calls (not straight into a session) so the
 * boss still classifies the domain and approves it.
 *
 *  - clock_in only  → an OPEN shift (worker is present now / from the given time).
 *  - clock_in + out → a completed shift that goes straight to pending_review.
 */

type Body = { user_id?: string; clock_in?: string; clock_out?: string | null };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as Body;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const clockIn = typeof body.clock_in === "string" ? body.clock_in.trim() : "";
    const clockOut = typeof body.clock_out === "string" ? body.clock_out.trim() : "";

    if (!userId) return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    if (!clockIn) return NextResponse.json({ error: "יש להזין שעת כניסה." }, { status: 400 });

    const parsedIn = new Date(clockIn);
    if (Number.isNaN(parsedIn.getTime())) return NextResponse.json({ error: "שעת הכניסה אינה תקינה." }, { status: 400 });
    let parsedOut: Date | null = null;
    if (clockOut) {
      parsedOut = new Date(clockOut);
      if (Number.isNaN(parsedOut.getTime())) return NextResponse.json({ error: "שעת היציאה אינה תקינה." }, { status: 400 });
      if (parsedOut <= parsedIn) return NextResponse.json({ error: "שעת היציאה חייבת להיות אחרי הכניסה." }, { status: 400 });
    }

    const { data: worker, error: workerError } = await supabase
      .from("users")
      .select("id,active,role,payroll_worker_type,pay_tracking_mode")
      .eq("id", userId)
      .maybeSingle();
    if (workerError) return NextResponse.json({ error: toHebrewError(workerError.message) }, { status: 400 });
    if (!worker?.id) return NextResponse.json({ error: "העובד לא נמצא." }, { status: 404 });
    if (worker.active === false) return NextResponse.json({ error: "העובד אינו פעיל." }, { status: 400 });
    if (worker.role !== "worker" && worker.role !== "worker_no_access") {
      return NextResponse.json({ error: "ניתן לבחור רק עובד." }, { status: 400 });
    }
    const workerType = normalizePayrollWorkerType(worker.payroll_worker_type, worker.pay_tracking_mode);
    if (!payrollWorkerTypeAllowsSessions(workerType)) {
      return NextResponse.json({ error: "סוג העובד הזה לא מתעד משמרות." }, { status: 409 });
    }

    const row = parsedOut
      ? {
          user_id: userId,
          clock_in: parsedIn.toISOString(),
          clock_out: parsedOut.toISOString(),
          worked_minutes: minutesBetween(parsedIn, parsedOut),
          status: "pending_review",
          source: "phone_manual",
          notes: "נוסף ידנית",
        }
      : {
          user_id: userId,
          clock_in: parsedIn.toISOString(),
          status: "open",
          source: "phone_manual",
          notes: "נוסף ידנית",
        };

    const { data: inserted, error: insertError } = await supabase.from(PHONE_ATTENDANCE_TABLE).insert(row).select("id").maybeSingle();
    if (insertError) {
      // Unique "one open per user" index — a shift is already open for this worker.
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "כבר קיימת משמרת פתוחה לעובד זה." }, { status: 409 });
      }
      return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
    }

    if (inserted?.id) {
      await logAuditEvent({
        supabase,
        tableName: PHONE_ATTENDANCE_TABLE,
        recordId: inserted.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({ ok: true, id: inserted?.id ?? null, opened: !parsedOut });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בהוספת המשמרת.") }, { status: 500 });
  }
}

import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * Reject a pending phone-attendance report — it never becomes a session. Guarded on pending_review
 * so a report that was already approved/rejected can't be flipped.
 */

type RejectPayload = { report_id?: string; reason?: string | null };

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as RejectPayload;
    const reportId = typeof body.report_id === "string" ? body.report_id.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reportId) return NextResponse.json({ error: "חסר מזהה דיווח." }, { status: 400 });

    const { data: rejected, error } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .update({
        status: "rejected",
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: reason ? `נדחה: ${reason}` : "נדחה",
      })
      .eq("id", reportId)
      .eq("status", "pending_review")
      .select("id")
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
    if (!rejected?.id) return NextResponse.json({ error: "הדיווח כבר טופל." }, { status: 409 });

    await logAuditEvent({
      supabase,
      tableName: PHONE_ATTENDANCE_TABLE,
      recordId: reportId,
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בדחיית הדיווח.") }, { status: 500 });
  }
}

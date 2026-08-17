import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import {
  WORKER_ABSENCE_COLUMNS,
  WORKER_ABSENCES_TABLE,
  isWorkerAbsenceType,
  parseBonusDate,
} from "@/lib/payroll-bonuses";

/**
 * ימי חופש / היעדרות — "he wasn't here that day".
 *
 * Records nothing about money: a global worker is paid the full month either
 * way. The one consumer is the salaried-hours export, which prints the day with
 * empty hours instead of the standard workday it otherwise assumes for every
 * Sun–Thu. That's why office may write here while it may not touch bonuses.
 *
 * POST takes a LIST of workers so "the whole crew was off on Sunday" is one
 * action rather than one dialog per person. Days already marked are skipped, not
 * treated as an error — re-marking a day is a no-op, not a mistake.
 */

type AbsencePayload = {
  absence_id?: string;
  user_id?: string;
  user_ids?: string[];
  absence_date?: string;
  absence_type?: string | null;
  paid?: boolean | null;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as AbsencePayload;
    const requestedIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    const singleId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const userIds = Array.from(
      new Set([...requestedIds, singleId].map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean))
    );
    const absenceDate = parseBonusDate(body.absence_date);
    const absenceType = isWorkerAbsenceType(body.absence_type) ? body.absence_type : "day_off";
    const paid = body.paid === false ? false : true;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null;

    if (userIds.length === 0) return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    if (!absenceDate) return NextResponse.json({ error: "יש לבחור תאריך תקין." }, { status: 400 });

    const workersResult = await supabase.from("users").select("id").in("id", userIds);
    if (workersResult.error) {
      return NextResponse.json({ error: toHebrewError(workersResult.error.message) }, { status: 400 });
    }
    const knownIds = new Set(((workersResult.data ?? []) as Array<{ id: string }>).map((row) => row.id));
    const validIds = userIds.filter((id) => knownIds.has(id));
    if (validIds.length === 0) return NextResponse.json({ error: "העובד לא נמצא." }, { status: 404 });

    const existingResult = await supabase
      .from(WORKER_ABSENCES_TABLE)
      .select("user_id")
      .eq("absence_date", absenceDate)
      .in("user_id", validIds);
    if (existingResult.error) {
      return NextResponse.json({ error: toHebrewError(existingResult.error.message) }, { status: 400 });
    }
    const alreadyMarked = new Set(((existingResult.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
    const toInsert = validIds.filter((id) => !alreadyMarked.has(id));

    if (toInsert.length === 0) {
      return NextResponse.json({ absences: [], skipped: validIds.length });
    }

    const insertResult = await supabase
      .from(WORKER_ABSENCES_TABLE)
      .insert(
        toInsert.map((userId) => ({
          user_id: userId,
          absence_date: absenceDate,
          absence_type: absenceType,
          paid,
          notes,
          created_by: profile.id,
        }))
      )
      .select(WORKER_ABSENCE_COLUMNS);

    if (insertResult.error) {
      return NextResponse.json({ error: toHebrewError(insertResult.error.message) }, { status: 400 });
    }

    for (const row of (insertResult.data ?? []) as Array<{ id: string }>) {
      await logAuditEvent({
        supabase,
        tableName: WORKER_ABSENCES_TABLE,
        recordId: row.id,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }

    return NextResponse.json({
      absences: insertResult.data ?? [],
      skipped: validIds.length - toInsert.length,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בשמירת ההיעדרות.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as AbsencePayload;
    const absenceId = typeof body.absence_id === "string" ? body.absence_id.trim() : "";
    if (!absenceId) return NextResponse.json({ error: "חסר מזהה היעדרות." }, { status: 400 });

    const deleteResult = await supabase.from(WORKER_ABSENCES_TABLE).delete().eq("id", absenceId);
    if (deleteResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteResult.error.message) }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: WORKER_ABSENCES_TABLE,
      recordId: absenceId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה במחיקת ההיעדרות.") }, { status: 500 });
  }
}

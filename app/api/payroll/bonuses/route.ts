import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { regenerateEditablePayslipsForUsers, resolveBonusPayslip } from "@/lib/payroll-center";
import {
  BONUS_ITEM_TYPE,
  PAYSLIP_ITEM_COLUMNS,
  PAYSLIP_ITEMS_TABLE,
  parseBonusAmount,
  parseBonusDate,
} from "@/lib/payroll-bonuses";

/**
 * בונוס — a רכיב שכר with a date on it.
 *
 * There is no bonus table and no approval step. This writes a `payslip_items` row
 * (`item_type = 'bonus'`) carrying the worker and the day it's for. If that month's
 * payslip already exists the row is attached to it right away; otherwise it waits
 * unattached and `generatePayslipsForPeriod` adopts it when the payslip is made.
 * Either way it ends up in the ברוטו like every other רכיב שכר.
 *
 * POST/DELETE here are the ADMIN entry point (adding a bonus from a worker's card).
 * The worker's own is /api/payroll/bonuses/my.
 */

type BonusPayload = {
  item_id?: string;
  user_id?: string;
  bonus_date?: string;
  amount?: number | string;
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as BonusPayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const bonusDate = parseBonusDate(body.bonus_date);
    const amount = parseBonusAmount(body.amount);
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null;

    if (!userId) return NextResponse.json({ error: "יש לבחור עובד." }, { status: 400 });
    if (!bonusDate) return NextResponse.json({ error: "יש לבחור תאריך תקין." }, { status: 400 });
    if (amount === null) return NextResponse.json({ error: "יש להזין סכום בונוס חיובי." }, { status: 400 });

    const target = await resolveBonusPayslip(supabase, userId, bonusDate);
    if (target.error) return NextResponse.json({ error: target.error }, { status: 409 });

    const insertResult = await supabase
      .from(PAYSLIP_ITEMS_TABLE)
      .insert({
        payslip_id: target.payslipId ?? null,
        user_id: userId,
        item_type: BONUS_ITEM_TYPE,
        amount,
        item_date: bonusDate,
        notes,
        created_by: profile.id,
      })
      .select(PAYSLIP_ITEM_COLUMNS)
      .maybeSingle();

    if (insertResult.error) {
      return NextResponse.json({ error: toHebrewError(insertResult.error.message) }, { status: 400 });
    }

    if (insertResult.data?.id) {
      await logAuditEvent({
        supabase,
        tableName: PAYSLIP_ITEMS_TABLE,
        recordId: insertResult.data.id as string,
        action: "create",
        changedBy: profile.id,
        userRole: profile.role,
      });
    }
    // Rewrites the month's ברוטו so the new line is in the total immediately.
    await regenerateEditablePayslipsForUsers(supabase, [userId]);

    return NextResponse.json({ item: insertResult.data });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בשמירת הבונוס.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as BonusPayload;
    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    if (!itemId) return NextResponse.json({ error: "חסר מזהה רכיב." }, { status: 400 });

    const existing = await supabase
      .from(PAYSLIP_ITEMS_TABLE)
      .select("id,user_id,payslip_id")
      .eq("id", itemId)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ error: toHebrewError(existing.error.message) }, { status: 400 });
    }
    if (!existing.data?.id) return NextResponse.json({ error: "הרכיב לא נמצא." }, { status: 404 });

    const deleteResult = await supabase.from(PAYSLIP_ITEMS_TABLE).delete().eq("id", itemId);
    if (deleteResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteResult.error.message) }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: PAYSLIP_ITEMS_TABLE,
      recordId: itemId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });
    await regenerateEditablePayslipsForUsers(supabase, [existing.data.user_id as string]);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה במחיקת הבונוס.") }, { status: 500 });
  }
}

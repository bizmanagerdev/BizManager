import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { logAuditEvent } from "@/lib/audit";
import { resolveBonusPayslip } from "@/lib/payroll-center";
import {
  BONUS_ITEM_TYPE,
  PAYSLIP_ITEM_COLUMNS,
  PAYSLIP_ITEMS_TABLE,
  parseBonusAmount,
  validateSelfReportedBonusDate,
} from "@/lib/payroll-bonuses";

/**
 * "הוספת בונוס" — the worker recording his own.
 *
 * No approval queue: he writes it and it counts (user decision — "we trust the
 * workers"). It's the same `payslip_items` row an admin would add, so at the end of
 * the month it's simply part of his ברוטו.
 *
 * The RLS policy is the real boundary — it only lets him insert a POSITIVE `bonus`
 * for HIMSELF with no payslip_id, so he can't write himself a deduction, a travel
 * allowance, someone else's row, or anything straight onto an existing payslip.
 * The checks here are about the entry being sane (real amount, recent date).
 *
 * DELETE takes it back, and only while it hasn't been rolled into a payslip yet —
 * once the month is generated it's payroll, and that's the boss's.
 */

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as {
      bonus_date?: string;
      amount?: number | string;
      notes?: string | null;
    };

    const parsedDate = validateSelfReportedBonusDate(body.bonus_date);
    if ("error" in parsedDate) return NextResponse.json({ error: parsedDate.error }, { status: 400 });

    const amount = parseBonusAmount(body.amount);
    if (amount === null) return NextResponse.json({ error: "יש להזין סכום בונוס חיובי." }, { status: 400 });

    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null;
    if (!notes) return NextResponse.json({ error: "יש לכתוב על מה הבונוס." }, { status: 400 });

    const meResult = await supabase.from("users").select("id,active").eq("id", profile.id).maybeSingle();
    if (meResult.error) return NextResponse.json({ error: toHebrewError(meResult.error.message) }, { status: 400 });
    if (!meResult.data?.id) return NextResponse.json({ error: "המשתמש לא נמצא." }, { status: 404 });
    if (meResult.data.active === false) return NextResponse.json({ error: "החשבון אינו פעיל." }, { status: 403 });

    // A locked month can't take it — say so rather than saving a row that would
    // never reach a payslip.
    const target = await resolveBonusPayslip(supabase, profile.id, parsedDate.date);
    if (target.error) return NextResponse.json({ error: target.error }, { status: 409 });

    // He always inserts UNATTACHED — that's what his RLS policy allows, and it's
    // all he may do. Do NOT try to regenerate his payslip from here: that writes
    // to `payslips`, which a worker has no access to, and the RLS failure aborted
    // the whole request even though the bonus row itself had saved fine. The row
    // is adopted into the month's ברוטו when the payslip is next generated.
    const insertResult = await supabase
      .from(PAYSLIP_ITEMS_TABLE)
      .insert({
        payslip_id: null,
        user_id: profile.id,
        item_type: BONUS_ITEM_TYPE,
        amount,
        item_date: parsedDate.date,
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

    return NextResponse.json({ item: insertResult.data });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה בשמירת הבונוס.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const body = (await req.json().catch(() => ({}))) as { item_id?: string };
    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    if (!itemId) return NextResponse.json({ error: "חסר מזהה רכיב." }, { status: 400 });

    const deleteResult = await supabase
      .from(PAYSLIP_ITEMS_TABLE)
      .delete()
      .eq("id", itemId)
      .eq("user_id", profile.id)
      .eq("item_type", BONUS_ITEM_TYPE)
      .is("payslip_id", null)
      .select("id")
      .maybeSingle();

    if (deleteResult.error) {
      return NextResponse.json({ error: toHebrewError(deleteResult.error.message) }, { status: 400 });
    }
    if (!deleteResult.data?.id) {
      return NextResponse.json(
        { error: "לא ניתן למחוק — הבונוס כבר נכנס לתלוש. יש לפנות למנהל." },
        { status: 409 }
      );
    }

    await logAuditEvent({
      supabase,
      tableName: PAYSLIP_ITEMS_TABLE,
      recordId: itemId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה לא צפויה במחיקת הבונוס.") }, { status: 500 });
  }
}

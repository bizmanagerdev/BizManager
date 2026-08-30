import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCurrentCcFeeRate, normalizeCcFeeRate, setCurrentCcFeeRate } from "@/lib/settings/ccFee";

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;
    const rate = await getCurrentCcFeeRate(supabase);
    return NextResponse.json({ cc_fee_rate: rate });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "אין הרשאה לעדכן את שיעור עמלת הסליקה." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { cc_fee_rate?: number | string };
    const raw = body.cc_fee_rate;
    if (raw === undefined || raw === null || raw === "") {
      return NextResponse.json({ error: "חסר שיעור עמלה." }, { status: 400 });
    }
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return NextResponse.json({ error: "שיעור עמלה אינו תקין." }, { status: 400 });
    }

    const rate = normalizeCcFeeRate(numeric);
    await setCurrentCcFeeRate(supabase, rate, user.id);

    await logAuditEvent({
      supabase,
      tableName: "business_settings",
      recordId: "cc_fee_rate",
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: { cc_fee_rate: rate },
    });

    return NextResponse.json({ cc_fee_rate: rate });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

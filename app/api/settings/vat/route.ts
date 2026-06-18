import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getCurrentVatRate, normalizeVatRate, setCurrentVatRate } from "@/lib/settings/vat";

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;
    const rate = await getCurrentVatRate(supabase);
    return NextResponse.json({ vat_rate: rate });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "אין הרשאה לעדכן את שיעור המע״מ." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { vat_rate?: number | string };
    const raw = body.vat_rate;
    if (raw === undefined || raw === null || raw === "") {
      return NextResponse.json({ error: "חסר שיעור מע״מ." }, { status: 400 });
    }
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return NextResponse.json({ error: "שיעור מע״מ אינו תקין." }, { status: 400 });
    }

    const rate = normalizeVatRate(numeric);
    await setCurrentVatRate(supabase, rate, user.id);

    await logAuditEvent({
      supabase,
      tableName: "business_settings",
      recordId: "vat_rate",
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: { vat_rate: rate },
    });

    return NextResponse.json({ vat_rate: rate });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

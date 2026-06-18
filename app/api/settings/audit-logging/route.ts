import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { toHebrewError } from "@/lib/error-messages";
import { invalidateAuditFlagCache } from "@/lib/audit";

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const { data } = await supabase
      .from("business_settings")
      .select("audit_logging_enabled")
      .eq("id", true)
      .maybeSingle();

    const enabled = (data as { audit_logging_enabled?: boolean } | null)?.audit_logging_enabled ?? true;
    return NextResponse.json({ enabled });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "טעינת מצב התיעוד נכשלה.") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "אין הרשאה לשנות את הגדרות התיעוד." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "ערך לא תקין." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("set_audit_logging", { p_enabled: body.enabled });
    if (error) {
      return NextResponse.json({ error: toHebrewError(error.message, "עדכון מצב התיעוד נכשל.") }, { status: 400 });
    }

    invalidateAuditFlagCache();
    return NextResponse.json({ enabled: typeof data === "boolean" ? data : body.enabled });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "עדכון מצב התיעוד נכשל.") }, { status: 500 });
  }
}

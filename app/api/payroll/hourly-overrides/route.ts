import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";

type HourlyOverridePayload = {
  user_id?: string;
  start_time?: string | null;
  end_time?: string | null;
  override_hourly_rate?: number | string | null;
  reason?: string | null;
  notes?: string | null;
};

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;

    const body = (await req.json().catch(() => ({}))) as HourlyOverridePayload;
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    const overrideHourlyRate = toNullableNumber(body.override_hourly_rate);
    const startTime = typeof body.start_time === "string" && body.start_time.trim() ? body.start_time.trim() : new Date().toISOString();
    const endTime = typeof body.end_time === "string" && body.end_time.trim() ? body.end_time.trim() : null;
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

    if (!userId || overrideHourlyRate === null || overrideHourlyRate <= 0) {
      return NextResponse.json({ error: "User and override hourly rate are required." }, { status: 400 });
    }

    const { supabase } = access.value;
    const result = await supabase
      .from("hourly_salary_overrides")
      .insert({
        user_id: userId,
        start_time: startTime,
        end_time: endTime,
        override_hourly_rate: overrideHourlyRate,
        reason,
        notes,
      })
      .select("id,user_id,start_time,end_time,override_hourly_rate,reason,notes,created_at,updated_at")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: toHebrewError(result.error.message) }, { status: 400 });
    }

    await recalculateUserSessionCostsFromRules(supabase, userId);

    return NextResponse.json({ override: result.data });
  } catch (error: unknown) {
    const message = toHebrewError(error, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

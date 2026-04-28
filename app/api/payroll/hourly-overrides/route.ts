import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { recalculateUserSessionCostsFromRules } from "@/lib/payroll-center";

type HourlyOverridePayload = {
  user_id?: string;
  override_hourly_rate?: number | string | null;
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
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!userId || overrideHourlyRate === null || overrideHourlyRate <= 0) {
      return NextResponse.json({ error: "User and override hourly rate are required." }, { status: 400 });
    }

    const { supabase } = access.value;
    const result = await supabase
      .from("hourly_salary_overrides")
      .insert({
        user_id: userId,
        override_hourly_rate: overrideHourlyRate,
        notes,
      })
      .select("id,user_id,override_hourly_rate,notes,created_at,updated_at")
      .maybeSingle();

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    await recalculateUserSessionCostsFromRules(supabase, userId);

    return NextResponse.json({ override: result.data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

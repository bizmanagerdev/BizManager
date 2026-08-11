import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * "Where is this worker holding?" — the current attendance state for the quick log dialog, so it
 * can offer sign-in vs sign-out. Returns the worker's open (in-progress) phone shift, if any.
 */
export async function GET(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office", "worker"] });
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const userId = new URL(req.url).searchParams.get("user_id")?.trim() ?? "";
    if (!userId) return NextResponse.json({ error: "חסר מזהה עובד." }, { status: 400 });

    const { data, error } = await supabase
      .from(PHONE_ATTENDANCE_TABLE)
      .select("id,clock_in")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({ open: data ? { id: data.id, clock_in: data.clock_in } : null });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "שגיאה בטעינת מצב העובד.") }, { status: 500 });
  }
}

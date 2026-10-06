import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateRecurringTasksNow } from "@/lib/recurring-tasks";

// Daily: creates this month's tasks from the recurring templates whose day has
// come. Pages used to do this on load (the dashboard and the tasks board); it
// moved here (2026-10-06) so the dashboard can open from the on-device copy.
// Saving a template still generates at once (api/recurring-tasks/save).
//
// Runs at 01:00 UTC (03:00/04:00 Israel): the generator works on the UTC date,
// and at that hour it's the same date as Israel's — so the 1st's tasks exist
// from the 1st's morning. Safe to repeat: templates already done this month
// are skipped.
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  try {
    const result = await generateRecurringTasksNow(supabase);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });
    return NextResponse.json({ ok: true, created: result.createdCount });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

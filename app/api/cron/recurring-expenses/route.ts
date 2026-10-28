import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/requireCronSecret";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";

// Daily: creates the recurring bills whose day has come (the database's
// generate_recurring_expenses_for_date, for Israel's date). Pages did this on
// load — the cash-flow page and the payments calendar — and still do when
// opened with a connection; it runs here too (2026-10-28) since the cash-flow
// page now opens from the on-device copy without asking the server (owner:
// "go on with תזרים"). Saving a template still generates at once
// (api/recurring-expenses/save). The recurring tasks went the same way (cron/recurring-tasks).
//
// Runs at 22:15 UTC — just after midnight in Israel (00:15 in winter, 01:15 in
// summer), so the new day's bills are there from its start. Safe to repeat:
// an occurrence already made is skipped.
export async function GET(req: Request) {
  const cron = requireCronSecret(req);
  if (!cron.ok) return cron.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });

  try {
    const result = await ensureRecurringExpensesForDate(supabase);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });
    return NextResponse.json({ ok: true, created: result.createdCount });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

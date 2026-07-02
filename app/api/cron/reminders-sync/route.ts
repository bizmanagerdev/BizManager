import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSystemReminders } from "@/lib/reminders/system-rules";

// Reminders/Alerts unification — Phase 2 cron.
// Evaluates every system rule and reconciles the resulting system reminders
// (create new problems, auto-close resolved ones). Hit on a schedule with the
// CRON_SECRET bearer token. Requires SUPABASE_SERVICE_ROLE_KEY (it reads across
// tables and writes system reminders, bypassing RLS by design).
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const results = await syncSystemReminders(supabase, new Date());
  const totals = results.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      resolved: acc.resolved + r.resolved,
      refreshed: acc.refreshed + r.refreshed,
      errors: acc.errors + (r.error ? 1 : 0),
    }),
    { inserted: 0, resolved: 0, refreshed: 0, errors: 0 }
  );

  return NextResponse.json({ ok: true, totals, results });
}

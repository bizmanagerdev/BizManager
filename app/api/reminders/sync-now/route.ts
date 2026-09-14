import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSystemReminders } from "@/lib/reminders/system-rules";

// Manually run the system-reminder sync (same work as the hourly cron), so
// admin/office can populate the worklist on demand instead of waiting. Uses the
// service-role client because the rules read across RLS-protected tables.
//
// syncSystemReminders evaluates all ~16 rules SEQUENTIALLY, each scanning its
// own slice of the business's tables — this route is called fire-and-forget
// (`void resyncAlerts()`) from several project-save call sites with no
// throttling of its own, so a normal burst of saves (one person editing
// several tabs, or a few people saving around the same time) used to stack up
// that many full sequential scans running concurrently, competing for the
// same DB resources as everything else. Confirmed live 2026-09-14 alongside
// unrelated pages hitting real Postgres "canceling statement due to statement
// timeout" errors during ordinary use.
//
// COOLDOWN_MS: a second trigger within the window gets the LAST result
// instead of starting a fresh scan — the worklist is already this fresh, so
// there's nothing to gain from re-running it, only DB load to lose. IN_FLIGHT
// dedupes true concurrency (two requests landing before either finishes) by
// having the second one just await the first's promise instead of starting
// its own. Both guards are per-warm-instance (module-level, not cross-
// instance) — a partial mitigation, not a hard global limit; the hourly cron
// (app/api/cron/reminders-sync) calls syncSystemReminders directly and is
// deliberately NOT gated by this, since it must always actually run.
const COOLDOWN_MS = 30_000;
let lastRunAt = 0;
let lastResult: { totals: { inserted: number; resolved: number; errors: number } } | null = null;
let inFlight: Promise<{ totals: { inserted: number; resolved: number; errors: number } }> | null = null;

export async function POST() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;

  if (inFlight) {
    const totals = (await inFlight).totals;
    return NextResponse.json({ ok: true, totals, deduped: true });
  }
  if (lastResult && Date.now() - lastRunAt < COOLDOWN_MS) {
    return NextResponse.json({ ok: true, totals: lastResult.totals, skipped: true });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  inFlight = (async () => {
    const results = await syncSystemReminders(supabase, new Date());
    const totals = results.reduce(
      (acc, r) => ({ inserted: acc.inserted + r.inserted, resolved: acc.resolved + r.resolved, errors: acc.errors + (r.error ? 1 : 0) }),
      { inserted: 0, resolved: 0, errors: 0 }
    );
    return { totals };
  })();

  try {
    const result = await inFlight;
    lastResult = result;
    lastRunAt = Date.now();
    return NextResponse.json({ ok: true, totals: result.totals });
  } finally {
    inFlight = null;
  }
}

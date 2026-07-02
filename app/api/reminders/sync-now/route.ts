import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { syncSystemReminders } from "@/lib/reminders/system-rules";

// Manually run the system-reminder sync (same work as the hourly cron), so
// admin/office can populate the worklist on demand instead of waiting. Uses the
// service-role client because the rules read across RLS-protected tables.
export async function POST() {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 500 });
  }

  const results = await syncSystemReminders(supabase, new Date());
  const totals = results.reduce(
    (acc, r) => ({ inserted: acc.inserted + r.inserted, resolved: acc.resolved + r.resolved, errors: acc.errors + (r.error ? 1 : 0) }),
    { inserted: 0, resolved: 0, errors: 0 }
  );
  return NextResponse.json({ ok: true, totals });
}

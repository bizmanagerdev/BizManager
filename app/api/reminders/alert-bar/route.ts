import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getAlertBarAlerts } from "@/lib/reminders/alert-bar";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";

// Powers the shared AlertBar strip (mounted once in AppShell) — the viewer's open
// system-detected alerts, unfiltered by page; the component itself buckets them by
// module client-side. See lib/reminders/alert-bar.ts for the read model.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const alerts = await getAlertBarAlerts(supabase, { userId: profile.id, role: profile.role });

  // Titles are computed server-side in Hebrew only — translated on the fly for an
  // Arabic-locale worker, same as /api/reminders/page-alerts and /api/reminders/worklist.
  if (profile.locale !== "ar" || alerts.length === 0) {
    return NextResponse.json({ alerts });
  }
  const translated = await Promise.all(
    alerts.map(async (a) => ({ ...a, title: (await translateToArabic(a.title)) ?? a.title }))
  );
  return NextResponse.json({ alerts: translated });
}

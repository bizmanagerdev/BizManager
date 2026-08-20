import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getPageAlerts } from "@/lib/reminders/worklist";
import { translateToArabic } from "@/lib/i18n/translateToHebrew";

// Contextual page banners: the viewer's open alerts for a given set of rule keys
// (e.g. ?keys=low_stock on the sales page). Scoped to the viewer's visibility.
export async function GET(req: Request) {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const keys = (new URL(req.url).searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const alerts = await getPageAlerts(supabase, { userId: profile.id, role: profile.role, keys });

  // These titles are computed server-side from live data, in Hebrew only — an
  // Arabic-locale worker (the only role ever offered that locale) gets them
  // translated on the fly here rather than stored per-locale.
  if (profile.locale !== "ar" || alerts.length === 0) {
    return NextResponse.json({ alerts });
  }
  const translated = await Promise.all(
    alerts.map(async (a) => ({ ...a, title: (await translateToArabic(a.title)) ?? a.title }))
  );
  return NextResponse.json({ alerts: translated });
}

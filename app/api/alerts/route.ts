import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getAlertsData } from "@/lib/alerts";

export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;

  const { supabase, profile } = access.value;
  const { alerts, errors } = await getAlertsData(supabase, { viewerRole: profile.role, userId: profile.id });

  return NextResponse.json({
    alerts,
    totalCount: alerts.reduce((sum, alert) => sum + alert.count, 0),
    errors,
  });
}

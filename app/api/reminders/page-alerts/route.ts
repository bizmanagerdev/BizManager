import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getPageAlerts } from "@/lib/reminders/worklist";

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
  return NextResponse.json({ alerts });
}

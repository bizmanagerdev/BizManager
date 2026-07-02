import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getWorklistView } from "@/lib/reminders/worklist";

// Powers the navbar bell: the viewer's discrete per-item actions across all
// sections. Collapsed summaries (collections, inventory…) are NOT counted — they
// have their own pages and shouldn't inflate the badge.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const sections = await getWorklistView(supabase, { userId: profile.id, role: profile.role });
  // Snoozed items are deferred — they shouldn't count toward the bell badge.
  const items = sections.filter((s) => s.key !== "snoozed").flatMap((s) => s.items);

  const alerts = items.slice(0, 30).map((i) => ({
    id: i.id,
    title: i.title,
    description: i.content ?? "",
    href: i.url,
    count: 1,
    severity: i.severity,
    countsAsActiveAlert: true,
  }));

  return NextResponse.json({ alerts, count: items.length });
}

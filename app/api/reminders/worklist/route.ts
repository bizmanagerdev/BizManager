import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getInboxView, inboxOrigin } from "@/lib/reminders/worklist";

// Powers the navbar bell: a preview of the viewer's open inbox + the count.
// The count here IS the inbox count (same read model as /inbox), so the badge
// and the page can never disagree. Collapsed summaries (collections, inventory…)
// are not counted — they have their own pages and shouldn't inflate the badge.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const inbox = await getInboxView(supabase, { userId: profile.id, role: profile.role });

  const alerts = inbox.items.slice(0, 30).map((i) => ({
    id: i.id,
    title: i.title,
    description: i.content ?? "",
    href: i.url,
    count: 1,
    severity: i.severity,
    origin: inboxOrigin(i),
    countsAsActiveAlert: true,
  }));

  return NextResponse.json({ alerts, count: inbox.items.length });
}

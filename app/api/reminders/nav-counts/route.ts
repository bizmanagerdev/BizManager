import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getWorklistNavCounts } from "@/lib/reminders/worklist";

// Powers the sidebar count badges: open worklist items grouped by the nav entry
// they belong to (tasks → /tasks, money → /collections, …), scoped to the
// viewer's own visibility. Contextual "what needs me here" indicators.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const counts = await getWorklistNavCounts(supabase, { userId: profile.id, role: profile.role });
  return NextResponse.json({ counts });
}

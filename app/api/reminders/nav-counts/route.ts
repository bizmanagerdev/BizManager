import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getWorklistNavCounts } from "@/lib/reminders/worklist";
import { countPendingPhoneReports } from "@/lib/attendance/phone-reports";

// Powers the sidebar count badges: open worklist items grouped by the nav entry
// they belong to (tasks → /tasks, money → /collections, …), scoped to the
// viewer's own visibility. Contextual "what needs me here" indicators.
export async function GET() {
  const access = await requireRouteAccess();
  if (!access.ok) return access.response;
  const { supabase, profile } = access.value;

  const isStaff = profile.role === "admin" || profile.role === "office";
  const [counts, pendingAttendance] = await Promise.all([
    getWorklistNavCounts(supabase, { userId: profile.id, role: profile.role }),
    // Attendance reports aren't worklist items (they have no reminder row), but
    // they're the same kind of "waiting for you" queue — so they badge the same way.
    isStaff ? countPendingPhoneReports(supabase) : Promise.resolve(0),
  ]);

  if (pendingAttendance > 0) {
    counts["/payroll/attendance"] = { count: pendingAttendance, severity: "warning" };
  }

  return NextResponse.json({ counts });
}

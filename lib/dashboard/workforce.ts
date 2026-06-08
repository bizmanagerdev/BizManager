import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type WorkforceOverview = {
  activeToday: number;
  clockedInNow: number;
  missingClockOuts: number;
  sessionsToday: number;
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * Live workforce snapshot from `attendance_sessions`:
 *   - activeToday      — distinct workers with a session that started today,
 *   - clockedInNow     — distinct workers with an open session (no clock_out),
 *   - missingClockOuts — open sessions left over from a previous day,
 *   - sessionsToday    — sessions started today.
 * Back-office only (gated by caller). Best-effort — failures resolve to zeros.
 */
export async function getWorkforceOverview(
  supabase: SupabaseClient
): Promise<WorkforceOverview> {
  const todayDate = new Date().toISOString().slice(0, 10);

  const [openRes, todayRes] = await Promise.all([
    supabase
      .from("attendance_sessions")
      .select("user_id,clock_in")
      .is("clock_out", null)
      .range(0, 999)
      .then((r) => r, () => ({ data: [] as Row[] })),
    supabase
      .from("attendance_sessions")
      .select("user_id,clock_in")
      .gte("clock_in", `${todayDate}T00:00:00`)
      .range(0, 999)
      .then((r) => r, () => ({ data: [] as Row[] })),
  ]);

  const openSessions = (openRes.data ?? []) as Row[];
  const todaySessions = (todayRes.data ?? []) as Row[];

  const clockedInUsers = new Set(
    openSessions.map((r) => getString(r, "user_id")).filter((v): v is string => Boolean(v))
  );
  const activeTodayUsers = new Set(
    todaySessions.map((r) => getString(r, "user_id")).filter((v): v is string => Boolean(v))
  );
  const missingClockOuts = openSessions.filter((r) => {
    const clockIn = getString(r, "clock_in");
    return clockIn !== null && clockIn.slice(0, 10) < todayDate;
  }).length;

  return {
    activeToday: activeTodayUsers.size,
    clockedInNow: clockedInUsers.size,
    missingClockOuts,
    sessionsToday: todaySessions.length,
  };
}

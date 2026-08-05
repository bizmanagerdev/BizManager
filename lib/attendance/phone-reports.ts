import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pending phone-attendance reports for the payroll approval queue.
 *
 * A report is a raw phone clock in/out (see app/api/attendance/call). It waits in `pending_review`
 * until an admin approves it — assigning a business_domain and creating the real attendance_sessions
 * row — or rejects it. Nothing here counts toward payroll until approved.
 */

export const PHONE_ATTENDANCE_TABLE = "phone_attendance_reports";

export type PendingPhoneReport = {
  id: string;
  user_id: string;
  worker_name: string | null;
  worker_phone: string | null;
  clock_in: string;
  clock_out: string;
  worked_minutes: number | null;
  created_at: string;
};

export async function loadPendingPhoneReports(supabase: SupabaseClient): Promise<PendingPhoneReport[]> {
  const { data: reports, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,user_id,clock_in,clock_out,worked_minutes,created_at")
    .eq("status", "pending_review")
    .not("clock_out", "is", null)
    .order("created_at", { ascending: true })
    .range(0, 199);

  if (error || !reports?.length) return [];

  const userIds = Array.from(new Set(reports.map((row) => row.user_id).filter(Boolean)));
  const nameById = new Map<string, { name: string | null; phone: string | null }>();
  if (userIds.length) {
    const { data: users } = await supabase.from("users").select("id,full_name,phone").in("id", userIds);
    for (const user of users ?? []) {
      nameById.set(user.id as string, {
        name: (user.full_name as string) ?? null,
        phone: (user.phone as string) ?? null,
      });
    }
  }

  return reports.map((row) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    worker_name: nameById.get(row.user_id as string)?.name ?? null,
    worker_phone: nameById.get(row.user_id as string)?.phone ?? null,
    clock_in: row.clock_in as string,
    clock_out: row.clock_out as string,
    worked_minutes: (row.worked_minutes as number) ?? null,
    created_at: row.created_at as string,
  }));
}

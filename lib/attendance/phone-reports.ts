import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phone-attendance reports for the payroll queue.
 *
 * A report is a raw phone clock in/out (see app/api/attendance/call):
 *  - `open`           → the worker clocked IN and hasn't clocked out yet (currently present).
 *  - `pending_review` → clocked out; waits for an admin to classify + approve into a real session.
 * Nothing counts toward payroll until an admin approves a pending report.
 */

export const PHONE_ATTENDANCE_TABLE = "phone_attendance_reports";

type BasePhoneReport = {
  id: string;
  user_id: string;
  worker_name: string | null;
  worker_phone: string | null;
  clock_in: string;
  created_at: string;
};

/** Clocked out, awaiting admin approval. */
export type PendingPhoneReport = BasePhoneReport & {
  clock_out: string;
  worked_minutes: number | null;
};

/** Clocked in, still open (no clock-out yet). */
export type OpenPhoneReport = BasePhoneReport;

export type PhoneQueueData = {
  pending: PendingPhoneReport[];
  open: OpenPhoneReport[];
};

export async function loadPhoneQueueData(supabase: SupabaseClient): Promise<PhoneQueueData> {
  const { data: reports, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,user_id,clock_in,clock_out,worked_minutes,status,created_at")
    .in("status", ["open", "pending_review"])
    .order("created_at", { ascending: true })
    .range(0, 199);

  if (error || !reports?.length) return { pending: [], open: [] };

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

  const base = (row: (typeof reports)[number]): BasePhoneReport => ({
    id: row.id as string,
    user_id: row.user_id as string,
    worker_name: nameById.get(row.user_id as string)?.name ?? null,
    worker_phone: nameById.get(row.user_id as string)?.phone ?? null,
    clock_in: row.clock_in as string,
    created_at: row.created_at as string,
  });

  const pending: PendingPhoneReport[] = [];
  const open: OpenPhoneReport[] = [];
  for (const row of reports) {
    if (row.status === "pending_review" && row.clock_out) {
      pending.push({ ...base(row), clock_out: row.clock_out as string, worked_minutes: (row.worked_minutes as number) ?? null });
    } else if (row.status === "open") {
      open.push(base(row));
    }
  }
  // Most-recent clock-in first for the "currently present" list.
  open.sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime());
  return { pending, open };
}

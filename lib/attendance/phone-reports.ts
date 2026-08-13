import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateSessionLaborCost, getActiveSalaryAgreementForDate, type SalaryAgreementRow } from "@/lib/payroll";

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
  /** phone | phone_manual | app — how the shift got here. */
  source: string;
  /** What the worker (or the person logging it) said about the shift. */
  notes: string | null;
  /**
   * Who FILED it, when that isn't the worker himself — a colleague or the office
   * clocking him in. Null for a self-report (or a row predating the column), so
   * the UI can show it only when it's actually news.
   */
  reported_by_name: string | null;
};

/** Clocked out, awaiting admin approval. */
export type PendingPhoneReport = BasePhoneReport & {
  clock_out: string;
  worked_minutes: number | null;
  // The worker's pay for this shift, from their salary agreement. Only populated for viewers who
  // may see salary (opts.includeCost) — null otherwise, which also hides it in the UI.
  labor_cost: number | null;
};

/** Clocked in, still open (no clock-out yet). */
export type OpenPhoneReport = BasePhoneReport;

export type PhoneQueueData = {
  pending: PendingPhoneReport[];
  open: OpenPhoneReport[];
};

export async function loadPhoneQueueData(
  supabase: SupabaseClient,
  opts?: { includeCost?: boolean }
): Promise<PhoneQueueData> {
  const { data: reports, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select("id,user_id,clock_in,clock_out,worked_minutes,status,source,notes,reported_by,created_at")
    .in("status", ["open", "pending_review"])
    .order("created_at", { ascending: true })
    .range(0, 199);

  if (error || !reports?.length) return { pending: [], open: [] };

  const userIds = Array.from(new Set(reports.map((row) => row.user_id).filter(Boolean)));
  // Reporters are looked up in the SAME round-trip as the subjects — usually the
  // same people, and one `in` beats a second query per screen.
  const lookupIds = Array.from(
    new Set([...userIds, ...reports.map((row) => row.reported_by as string | null).filter(Boolean)])
  ) as string[];
  const nameById = new Map<string, { name: string | null; phone: string | null }>();
  if (lookupIds.length) {
    const { data: users } = await supabase.from("users").select("id,full_name,phone").in("id", lookupIds);
    for (const user of users ?? []) {
      nameById.set(user.id as string, {
        name: (user.full_name as string) ?? null,
        phone: (user.phone as string) ?? null,
      });
    }
  }

  // Salary agreements → per-shift cost. Only fetched when the viewer may see salary.
  const agreementsByUser = new Map<string, SalaryAgreementRow[]>();
  if (opts?.includeCost && userIds.length) {
    const { data: agreements } = await supabase
      .from("salary_agreements")
      .select("id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id")
      .in("user_id", userIds)
      .order("valid_from", { ascending: false });
    for (const agreement of (agreements ?? []) as SalaryAgreementRow[]) {
      const list = agreementsByUser.get(agreement.user_id) ?? [];
      list.push(agreement);
      agreementsByUser.set(agreement.user_id, list);
    }
  }

  const costFor = (userId: string, clockIn: string, minutes: number | null): number | null => {
    const list = agreementsByUser.get(userId);
    if (!list?.length || !minutes || minutes <= 0) return null;
    return calculateSessionLaborCost(getActiveSalaryAgreementForDate(list, new Date(clockIn)), minutes);
  };

  const base = (row: (typeof reports)[number]): BasePhoneReport => {
    const reportedBy = typeof row.reported_by === "string" ? row.reported_by : null;
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      worker_name: nameById.get(row.user_id as string)?.name ?? null,
      worker_phone: nameById.get(row.user_id as string)?.phone ?? null,
      clock_in: row.clock_in as string,
      created_at: row.created_at as string,
      source: typeof row.source === "string" ? row.source : "phone",
      notes: typeof row.notes === "string" ? row.notes : null,
      // Only when someone ELSE filed it — a worker reporting his own shift is the
      // norm and needs no caption.
      reported_by_name:
        reportedBy && reportedBy !== row.user_id ? nameById.get(reportedBy)?.name ?? null : null,
    };
  };

  const pending: PendingPhoneReport[] = [];
  const open: OpenPhoneReport[] = [];
  for (const row of reports) {
    if (row.status === "pending_review" && row.clock_out) {
      const workedMinutes = (row.worked_minutes as number) ?? null;
      pending.push({
        ...base(row),
        clock_out: row.clock_out as string,
        worked_minutes: workedMinutes,
        labor_cost: costFor(row.user_id as string, row.clock_in as string, workedMinutes),
      });
    } else if (row.status === "open") {
      open.push(base(row));
    }
  }
  // Most-recent clock-in first for the "currently present" list.
  open.sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime());
  return { pending, open };
}

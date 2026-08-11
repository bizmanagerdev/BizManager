import type { SupabaseClient } from "@supabase/supabase-js";
import { PHONE_ATTENDANCE_TABLE } from "@/lib/attendance/phone-reports";

/**
 * The signed-in worker's own side of the attendance queue.
 *
 * He opens a shift and submits it; that is the whole of his power. The row lands
 * in the same table a kosher-phone call-in writes to (source = 'app'), so the
 * admin queue in /payroll classifies the business domain and approves it before
 * anything reaches attendance_sessions and payroll. See
 * supabase/migrations/20260810000000_worker_self_service.sql for the policies
 * that hold that line at the database.
 */

/** Reports written by the worker himself, as opposed to a phone call-in. */
export const APP_ATTENDANCE_SOURCE = "app";

/**
 * How far back a worker may date his own attendance. A week covers "I forgot to
 * clock in on Tuesday"; anything older is a payroll correction, which the boss
 * makes from the queue's manual entry.
 */
export const MAX_BACKDATE_DAYS = 7;

/** Phone-vs-server clock skew that shouldn't be read as "in the future". */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Parse a worker-supplied timestamp under the self-reporting rules, returning
 * either the date or a ready-to-show Hebrew reason. Shared by start/close/log so
 * "what counts as a valid time" is decided in exactly one place.
 */
export function parseSelfReportedTime(
  value: unknown,
  label: string,
  now: Date = new Date()
): { date: Date } | { error: string } {
  if (typeof value !== "string" || !value.trim()) return { error: `יש להזין ${label}.` };
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return { error: `${label} אינה תקינה.` };
  if (parsed.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { error: `${label} לא יכולה להיות בעתיד.` };
  }
  if (parsed.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `לא ניתן לדווח יותר מ-${MAX_BACKDATE_DAYS} ימים אחורה. פנה למנהל.` };
  }
  return { date: parsed };
}

export type MyShiftStatus = "open" | "pending_review" | "approved" | "rejected";

export type MyShiftReport = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  worked_minutes: number | null;
  status: MyShiftStatus;
  source: string;
  notes: string | null;
  created_at: string;
};

export type MyShiftState = {
  /** The shift running right now, if any. At most one (unique partial index). */
  open: MyShiftReport | null;
  /** Submitted, waiting for the boss to classify + approve. */
  pending: MyShiftReport[];
  /** Everything else, newest first — approved and rejected alike. */
  history: MyShiftReport[];
};

const REPORT_COLUMNS = "id,clock_in,clock_out,worked_minutes,status,source,notes,created_at";

function toReport(row: Record<string, unknown>): MyShiftReport {
  return {
    id: String(row.id ?? ""),
    clock_in: String(row.clock_in ?? ""),
    clock_out: typeof row.clock_out === "string" ? row.clock_out : null,
    worked_minutes: typeof row.worked_minutes === "number" ? row.worked_minutes : null,
    status: (row.status as MyShiftStatus) ?? "open",
    source: typeof row.source === "string" ? row.source : "app",
    notes: typeof row.notes === "string" ? row.notes : null,
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Load the caller's own shift reports. RLS scopes the read to their rows
 * (phone_attendance_worker_select_own), and the explicit user_id filter keeps it
 * honest for staff, whose broader policy would otherwise return the whole queue.
 */
export async function loadMyShiftState(
  supabase: SupabaseClient,
  userId: string,
  opts?: { limit?: number }
): Promise<MyShiftState> {
  const limit = opts?.limit ?? 60;
  const { data, error } = await supabase
    .from(PHONE_ATTENDANCE_TABLE)
    .select(REPORT_COLUMNS)
    .eq("user_id", userId)
    .order("clock_in", { ascending: false })
    .range(0, Math.max(limit, 1) - 1);

  if (error || !data) return { open: null, pending: [], history: [] };

  const reports = (data as Record<string, unknown>[]).map(toReport).filter((row) => row.id);

  return {
    open: reports.find((row) => row.status === "open") ?? null,
    pending: reports.filter((row) => row.status === "pending_review"),
    history: reports.filter((row) => row.status === "approved" || row.status === "rejected"),
  };
}

/** Hebrew label for a report's origin, for both the worker's list and the queue. */
export function attendanceSourceLabel(source: string | null | undefined): string {
  if (source === "app") return "דיווח מהאפליקציה";
  if (source === "phone_manual") return "נוסף ידנית";
  return "דיווח טלפוני";
}

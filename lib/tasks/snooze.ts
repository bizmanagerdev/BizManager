import type { SupabaseClient } from "@supabase/supabase-js";
import { israelDateKey } from "@/lib/timezone";

// "לטיפול בהמשך" — a task handled later, like Gmail's snooze — per person
// (owner, 2026-10-09: "only for you"; table task_snoozes). A task this person
// snoozed is off THEIR board, dashboard and today list until `until`; then it
// comes back, with a push (app/api/cron/reminders). A search still finds it.

/**
 * The tasks this person has snoozed that aren't back yet: task id → until.
 * Empty when the snoozes can't be read (the table isn't there yet, or the
 * phone's copy lacks it) — nothing is hidden then, rather than the page failing.
 */
export async function snoozedTasks(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  now: Date = new Date()
): Promise<Map<string, string>> {
  const snoozed = new Map<string, string>();
  if (!userId) return snoozed;
  try {
    const { data, error } = await supabase
      .from("task_snoozes")
      .select("task_id,until")
      .eq("user_id", userId)
      .gt("until", now.toISOString())
      .range(0, 4999);
    if (error) return snoozed;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.task_id === "string" && typeof row.until === "string") snoozed.set(row.task_id, row.until);
    }
  } catch {
    // Not readable here — nothing hidden.
  }
  return snoozed;
}

/** The hour a snoozed task comes back on its day (Israel time) — the start of the working day. */
export const SNOOZE_RETURN_HOUR = 8;

/** 08:00 in Israel on the Israel date `dateKey` (YYYY-MM-DD), as an ISO instant — whatever the season's offset. */
export function israelMorning(dateKey: string, hour: number = SNOOZE_RETURN_HOUR): string {
  const [y, m, d] = dateKey.slice(0, 10).split("-").map(Number);
  // Israel is UTC+2 or +3: try both, keep the one that reads `hour` on that date there.
  for (const offset of [3, 2]) {
    const at = new Date(Date.UTC(y, m - 1, d, hour - offset));
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(at);
    if (Number(parts) % 24 === hour && israelDateKey(at) === dateKey.slice(0, 10)) return at.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d, hour - 2)).toISOString();
}

/** The Israel date `days` after today (or after `from`). */
export function israelDateAfter(days: number, from: Date = new Date()): string {
  const today = israelDateKey(from);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The quick choices in the clock's menu: days from today (a month counted as 30). */
export const SNOOZE_CHOICES = [
  { key: "snoozeTomorrow", days: 1 },
  { key: "snoozeWeek", days: 7 },
  { key: "snoozeMonth", days: 30 },
  { key: "snoozeTwoMonths", days: 60 },
] as const;

import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverPush } from "@/lib/notifications/deliver";

// A snoozed task that's back ("לטיפול בהמשך" — lib/tasks/snooze.ts) pings the
// person who snoozed it, once (owner, 2026-10-09: "it should ping when it
// comes back"). Run by the reminders cron inside its 08:00–21:00 window; a
// snooze that ended at night is announced in the morning.

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);

/** Pushes every snooze that has ended and hasn't been announced; marks them announced. */
export async function announceReturnedSnoozes(supabase: SupabaseClient, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const nowIso = now.toISOString();
  const { data, error } = await supabase
    .from("task_snoozes")
    .select("id,task_id,user_id")
    .lte("until", nowIso)
    .is("notified_at", null)
    .order("until", { ascending: true })
    .range(0, 199);
  // The table not there yet (or unreadable): nothing to announce.
  if (error || !data || data.length === 0) return { sent: 0, failed: 0 };
  const rows = data as Row[];

  const taskIds = [...new Set(rows.map((r) => str(r, "task_id")).filter((v): v is string => Boolean(v)))];
  const userIds = [...new Set(rows.map((r) => str(r, "user_id")).filter((v): v is string => Boolean(v)))];
  const [{ data: tasks }, { data: users }] = await Promise.all([
    supabase.from("tasks").select("id,subject,status").in("id", taskIds),
    supabase.from("users").select("id,auth_user_id").in("id", userIds),
  ]);
  const taskById = new Map(((tasks ?? []) as Row[]).map((t) => [str(t, "id"), t] as const));
  const authByUser = new Map(((users ?? []) as Row[]).map((u) => [str(u, "id"), str(u, "auth_user_id")] as const));

  let sent = 0;
  let failed = 0;
  await Promise.all(
    rows.map(async (row) => {
      const taskId = str(row, "task_id") ?? "";
      const task = taskById.get(taskId);
      const authId = authByUser.get(str(row, "user_id"));
      // Done or cancelled meanwhile: nothing to come back to.
      const status = task ? str(task, "status") : null;
      if (!task || !authId || status === "done" || status === "cancelled") return;
      const subject = str(task, "subject") ?? "משימה";
      const result = await deliverPush(
        supabase,
        [authId],
        { title: `⏰ לטיפול: ${subject}`, body: "המשימה חזרה לרשימה שלך.", url: `/tasks/${taskId}`, tag: `snooze-${str(row, "id")}` },
        "tasks",
        // The person chose this time — like a reminder they set, it pings then.
        { alwaysPush: true }
      );
      sent += result.sent;
      failed += result.failed;
    })
  );

  // Announced (or nothing to announce): never again for this snooze.
  await supabase
    .from("task_snoozes")
    .update({ notified_at: nowIso })
    .in("id", rows.map((r) => str(r, "id")).filter((v): v is string => Boolean(v)));
  return { sent, failed };
}

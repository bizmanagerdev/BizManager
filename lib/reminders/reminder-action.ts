// What acting on a reminder does to its row — the worklist's actions, worked
// out the SAME way on the server (app/api/reminders/action) and on the phone
// (lib/reminders/device-reminder-saves.ts, acting on the device copy first),
// so what the phone shows at once is what the server then keeps.
//   done    -> close it (manual + system alike)
//   dismiss -> manual: cancel; system: snooze to tomorrow (re-appears daily
//              until the underlying issue is resolved by the sync job)
//   snooze  -> hide until a caller-provided timestamp
//   reopen  -> back to the active worklist

export const REMINDER_ACTIONS = ["done", "dismiss", "snooze", "reopen"] as const;
export type ReminderAction = (typeof REMINDER_ACTIONS)[number];

export function isReminderAction(value: unknown): value is ReminderAction {
  return typeof value === "string" && (REMINDER_ACTIONS as readonly string[]).includes(value);
}

export const INVALID_SNOOZE = "מועד דחייה לא תקין.";

/** The row's new values, or why the action can't be done. */
export function reminderActionUpdates(
  row: { source: string | null | undefined },
  action: ReminderAction,
  options: { snoozeUntil?: unknown; userId: string; now?: Date }
): { updates: Record<string, unknown> } | { error: string } {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const isSystem = row.source === "system";
  const updates: Record<string, unknown> = { updated_by: options.userId, updated_at: nowIso };

  if (action === "done") {
    updates.status = isSystem ? "auto_resolved" : "done";
    updates.resolved_at = nowIso;
  } else if (action === "reopen") {
    updates.status = "pending";
    updates.snoozed_until = null;
  } else if (action === "snooze") {
    const until = typeof options.snoozeUntil === "string" ? new Date(options.snoozeUntil) : null;
    if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return { error: INVALID_SNOOZE };
    updates.snoozed_until = until.toISOString();
    updates.snoozed_by = options.userId;
  } else if (isSystem) {
    // Dismissed: cleared for today; the hourly sync re-opens it tomorrow if the
    // issue still exists. Tomorrow ~06:00 Israel ≈ 04:00 UTC.
    const t = new Date(now);
    t.setUTCHours(4, 0, 0, 0);
    if (t.getTime() <= now.getTime()) t.setUTCDate(t.getUTCDate() + 1);
    updates.snoozed_until = t.toISOString();
    updates.snoozed_by = options.userId;
  } else {
    updates.status = "cancelled";
    updates.resolved_at = nowIso;
  }
  return { updates };
}

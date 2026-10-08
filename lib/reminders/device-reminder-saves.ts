import { readyDeviceSaves } from "@/lib/powersync/store";
import { actOnReminderOnDevice } from "@/lib/powersync/local-writes";
import type { ReminderAction } from "@/lib/reminders/reminder-action";

// Acting on a reminder on the phone first (lib/powersync/local-writes.ts):
// done, snoozed, dismissed or reopened, it's off the lists drawn from the
// device copy — the dashboard's today list and alerts — the moment it's
// tapped, with no connection too, and the action goes to the server in the
// background (the same route, /api/reminders/action). For the people whose
// dashboard is drawn from the copy, and a reminder the copy holds; everyone
// and everything else acts on the server as before.

/** True when it was done on the phone; false: do it on the server. */
export async function reminderActionOnDevice(
  id: string,
  action: ReminderAction,
  snoozeUntil?: string
): Promise<boolean> {
  const ready = readyDeviceSaves("dashboard");
  if (!ready) return false;
  try {
    return await actOnReminderOnDevice(ready.db, { id, action, snoozeUntil, userId: ready.viewerId });
  } catch {
    return false;
  }
}

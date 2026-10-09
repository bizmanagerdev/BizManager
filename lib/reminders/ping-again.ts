// A reminder pushes once: the push cron (app/api/cron/reminders) skips any row
// with notified_at set. Moved to a later time, or snoozed, it should push again
// at that time (owner, 2026-10-09: it never did — the mark was never cleared).
// Server-only: the phone's copy of reminders has no notified_at.

/** notified_at: null when the reminder's new time is still ahead — so it pushes again then. */
export function pingAgainAt(nextTime: unknown, now: Date = new Date()): { notified_at: null } | Record<string, never> {
  if (typeof nextTime !== "string" || !nextTime.trim()) return {};
  const at = new Date(nextTime.trim()).getTime();
  return Number.isFinite(at) && at > now.getTime() ? { notified_at: null } : {};
}

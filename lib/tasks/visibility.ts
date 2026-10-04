import { israelDateKey } from "@/lib/timezone";

// Far-future tasks wait off the board until it's time to deal with them (user,
// 2026-10-04): a to-do task due more than FAR_FUTURE_DAYS from today stays
// hidden until its reminder (the earliest one still pending) — or, with no
// reminder, until FAR_FUTURE_DAYS before it's due. Whichever comes first: once
// it's due within FAR_FUTURE_DAYS it always shows.
//
// Only "לביצוע" (todo, or the legacy null status) waits — a task someone has
// started or flagged as blocked is being dealt with, so it stays in its list.
// Searching the board still finds a waiting task (see loadTasksBoard).
export const FAR_FUTURE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Earliest pending reminder per task, from rows of { task_id, remind_at }. */
export function earliestReminderByTask(rows: Array<Record<string, unknown>>): Map<string, string> {
  const earliest = new Map<string, string>();
  for (const row of rows) {
    const taskId = typeof row.task_id === "string" ? row.task_id : null;
    const remindAt = typeof row.remind_at === "string" ? row.remind_at : null;
    if (!taskId || !remindAt) continue;
    const current = earliest.get(taskId);
    if (!current || new Date(remindAt).getTime() < new Date(current).getTime()) earliest.set(taskId, remindAt);
  }
  return earliest;
}

/**
 * The Israel date (YYYY-MM-DD) a waiting task comes back onto the board — its
 * reminder's day or 30 days before it's due, whichever is sooner. Null when it
 * isn't waiting (it shows now).
 */
export function taskShowsFromDate(args: Parameters<typeof isTaskWaitingForLater>[0]): string | null {
  if (!isTaskWaitingForLater(args) || !args.dueDate) return null;
  const byDueDate = addDays(args.dueDate, -FAR_FUTURE_DAYS);
  const remindAt = args.nextReminderAt ? new Date(args.nextReminderAt) : null;
  const byReminder = remindAt && Number.isFinite(remindAt.getTime()) ? israelDateKey(remindAt) : null;
  return byReminder && byReminder < byDueDate ? byReminder : byDueDate;
}

/**
 * Is this task still waiting for its time — i.e. hidden from the board and the
 * dashboard's "המשימות שלי" for now?
 */
export function isTaskWaitingForLater(args: {
  status: string | null | undefined;
  dueDate: string | null | undefined;
  /** Earliest pending reminder (ISO timestamp), if any. */
  nextReminderAt: string | null | undefined;
  now?: Date;
}): boolean {
  const status = args.status || "todo";
  if (status !== "todo" || !args.dueDate) return false;
  const now = args.now ?? new Date();
  const today = israelDateKey(now);
  // Due within FAR_FUTURE_DAYS (or already overdue) → always shows.
  const showsFrom = addDays(args.dueDate, -FAR_FUTURE_DAYS);
  if (today >= showsFrom) return false;
  // Further out than that: a reminder that has come brings it back early.
  if (args.nextReminderAt) {
    const remindAt = new Date(args.nextReminderAt).getTime();
    if (Number.isFinite(remindAt) && now.getTime() >= remindAt) return false;
  }
  return true;
}

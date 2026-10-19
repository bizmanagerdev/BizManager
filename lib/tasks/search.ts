import type { TaskBoardItem } from "@/app/(app)/tasks/loadTasks";
import type { Locale } from "@/lib/i18n/types";
import { hourOf, type SearchRecord } from "@/lib/search/listSearch";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";

// The tasks board's search, by the global search's rules (owner, 2026-10-19:
// "tasks search the subject only — not the description, replies, project,
// assignee or due date"). What the card shows (subject, due day and hour,
// project, property, customer and phone, city) is painted there; the rest —
// the description, notes, replies, who it's on, its status — is said under it.

/** What the board's card doesn't carry, read only while searching. */
export type TaskSearchExtras = {
  description?: string | null;
  notes?: string | null;
  /** Every reply, joined. */
  comments?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

export function taskSearchRecord(task: TaskBoardItem, extras: TaskSearchExtras = {}, locale: Locale = "he"): SearchRecord {
  const others = task.members.filter((member) => member.id !== task.assigned_user_id).map((member) => member.name);
  return {
    text: [
      [null, task.subject],
      [null, task.subject_he],
      [null, task.subject_ar],
      [null, task.project_name],
      [null, task.property_name],
      [null, task.customer_name],
      [null, task.city],
      [null, task.due_time],
      ["כתובת", task.address],
      ["תיאור", extras.description],
      ["הערה", extras.notes],
      ["תגובה", extras.comments],
      ["אחראי", task.assigned_user_name],
      ["משתתפים", others.filter(Boolean).join(", ")],
      ["סטטוס", task.status ? getTaskStatusLabel(task.status, locale) : null],
      ["עדיפות", task.priority ? getTaskPriorityLabel(task.priority, locale) : null],
      ["שעת יצירה", hourOf(extras.createdAt)],
      ["שעת ביצוע", hourOf(extras.completedAt)],
    ],
    dates: [
      [null, task.due_date],
      ["נוצרה", extras.createdAt],
      ["בוצעה", extras.completedAt],
    ],
    phones: [[null, task.customer_phone]],
  };
}

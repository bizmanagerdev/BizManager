// Coarse notification buckets — what a user can mute. Every push is tagged with
// one of these so "mute גבייה" actually silences the right things.
export const NOTIF_BUCKETS: Array<{ key: string; label: string }> = [
  { key: "money", label: "גבייה ותשלומים" },
  { key: "tasks", label: "משימות" },
  { key: "projects", label: "פרויקטים" },
  { key: "ops", label: "מלאי ותפעול" },
  { key: "payroll", label: "שכר עובדים" },
  { key: "updates", label: "הזמנות/פרויקטים חדשים" },
  { key: "nightly", label: "סיכום לילה" },
  { key: "digests", label: "סיכומים מתוזמנים" },
  { key: "reminders", label: "תזכורות אישיות" },
];

const MONEY = new Set(["collection_overdue", "check_deposit_due", "payment_due_today", "promise_broken", "recurring_expense_confirm"]);
const TASKS = new Set(["task_overdue", "task_due_soon"]);
const PROJECTS = new Set(["project_deadline", "project_starting", "stale_quote"]);
const OPS = new Set(["low_stock", "unprocessed_items", "vehicle_expiry"]);
const PAYROLL = new Set(["wage_overdue", "session_unallocated"]);

/** Map a reminder (source + category + dedupe_key) to a mute bucket. */
export function reminderBucket(opts: { source: string | null; category: string | null; dedupeKey: string | null }): string {
  if (opts.source !== "system") {
    if (opts.category === "task") return "tasks";
    if (opts.category === "order" || opts.category === "collection") return "money";
    return "reminders";
  }
  const rule = (opts.dedupeKey ?? "").split(":")[0];
  if (rule === "nightly_review") return "nightly";
  if (MONEY.has(rule)) return "money";
  if (TASKS.has(rule)) return "tasks";
  if (PROJECTS.has(rule)) return "projects";
  if (OPS.has(rule)) return "ops";
  if (PAYROLL.has(rule)) return "payroll";
  return "reminders";
}

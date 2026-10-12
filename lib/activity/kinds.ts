import type { AuditFeedItem } from "@/lib/audit";
import { isDelete } from "@/lib/activity/sentence";

// What kind of thing an entry is, for its icon and colour: a payment is green,
// an order blue, a task purple, a deletion red — so the feed reads at a glance
// before a word of it is read.

export type ActivityKind =
  | "payment"
  | "order"
  | "delivery"
  | "task"
  | "taskDone"
  | "customer"
  | "project"
  | "expense"
  | "document"
  | "attendance"
  | "payroll"
  | "login"
  | "logout"
  | "system"
  | "delete"
  | "other";

const PAYROLL_TABLES = new Set([
  "worker_payments",
  "worker_payment_allocations",
  "payslips",
  "payslip_items",
  "salary_agreements",
  "payroll_periods",
  "hourly_salary_overrides",
  "worker_absences",
]);

export function activityKind(item: AuditFeedItem): ActivityKind {
  const { tableName, action } = item;
  if (tableName === "auth") return action === "logout" ? "logout" : "login";
  if (tableName === "system" || item.actorName === "מערכת") return "system";
  // A deletion is red whatever was deleted: it's the one thing to notice.
  if (isDelete(action)) return "delete";
  const statusTo = item.facts?.statusTo ?? null;
  switch (tableName) {
    case "payments":
    case "payment_promises":
      return "payment";
    case "orders":
    case "order_items":
      return statusTo === "delivered" ? "delivery" : "order";
    case "tasks":
    case "task_comments":
    case "recurring_task_templates":
      return statusTo === "done" || statusTo === "completed" ? "taskDone" : "task";
    case "customers":
    case "contacts":
      return "customer";
    case "projects":
    case "project_expenses":
      return "project";
    case "expenses":
    case "recurring_expense_templates":
      return "expense";
    case "documents":
    case "document_links":
      return "document";
    case "attendance_sessions":
    case "phone_attendance_reports":
      return "attendance";
  }
  if (PAYROLL_TABLES.has(tableName)) return "payroll";
  return "other";
}


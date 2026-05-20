export type StatusColor = "success" | "warning" | "danger" | "info" | "neutral";

export type StatusBadgeType = "payment" | "project" | "task" | "priority" | "order";

export type PaymentStatus =
  | "not_due"
  | "pending"
  | "cleared"
  | "rejected"
  | "paid"
  | "partial"
  | "unpaid"
  | "overpaid";
export type ProjectStatus = "quote" | "planned" | "active" | "on_hold" | "completed" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type OrderStatus = "draft" | "reserved" | "delivered" | "closed" | "cancelled";

function normalizeValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeOrderStatus(status: string | null | undefined): OrderStatus | string {
  switch (normalizeValue(status)) {
    case "draft":
    case "פתוחה":
      return "draft";
    case "reserved":
    case "confirmed":
    case "processing":
    case "out_for_delivery":
    case "מאושרת":
    case "בטיפול":
    case "במשלוח":
      return "reserved";
    case "delivered":
    case "סופקה":
      return "delivered";
    case "closed":
    case "completed":
    case "הושלמה":
    case "סגורה":
      return "closed";
    case "cancelled":
    case "בוטלה":
      return "cancelled";
    default:
      return normalizeValue(status) || "";
  }
}

export function getPaymentStatusColor(status: string): StatusColor {
  switch (normalizeValue(status)) {
    case "paid":
    case "cleared":
      return "success";
    case "partial":
      return "warning";
    case "not_due":
      return "neutral";
    case "not_paid":
    case "unpaid":
    case "overpaid":
    case "rejected":
      return "danger";
    case "pending":
      return "warning";
    default:
      return "neutral";
  }
}

export function getProjectStatusColor(status: string): StatusColor {
  switch (normalizeValue(status)) {
    case "quote":
      return "neutral";
    case "planned":
    case "planning":
      return "neutral";
    case "active":
      return "info";
    case "on_hold":
      return "warning";
    case "completed":
      return "success";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function getTaskStatusColor(status: string): StatusColor {
  switch (normalizeValue(status)) {
    case "todo":
      return "neutral";
    case "in_progress":
      return "info";
    case "blocked":
      return "danger";
    case "done":
      return "success";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function getTaskPriorityColor(priority: string): StatusColor {
  switch (normalizeValue(priority)) {
    case "low":
      return "neutral";
    case "medium":
      return "info";
    case "high":
      return "warning";
    case "urgent":
      return "danger";
    default:
      return "neutral";
  }
}

export function getOrderStatusColor(status: string): StatusColor {
  switch (normalizeOrderStatus(status)) {
    case "draft":
      return "danger";
    case "reserved":
      return "warning";
    case "delivered":
      return "success";
    case "closed":
      return "success";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export function getPaymentStatusLabel(status: string) {
  switch (normalizeValue(status)) {
    case "paid":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    case "not_due":
      return "טרם הגיע מועד התשלום";
    case "not_paid":
    case "unpaid":
      return "לא שולם";
    case "overpaid":
      return "שולם יתר";
    case "pending":
      return "ממתין לפירעון";
    case "cleared":
      return "התקבל";
    case "rejected":
      return "נדחה";
    default:
      return status || "-";
  }
}

export function getProjectStatusLabel(status: string) {
  switch (normalizeValue(status)) {
    case "quote":
      return "הצעת מחיר";
    case "planned":
    case "planning":
      return "מתוכנן";
    case "active":
      return "פעיל";
    case "on_hold":
      return "בהמתנה";
    case "completed":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return status || "-";
  }
}

export function getTaskStatusLabel(status: string) {
  switch (normalizeValue(status)) {
    case "todo":
      return "לביצוע";
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "חסום";
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return status || "-";
  }
}

export function getTaskPriorityLabel(priority: string) {
  switch (normalizeValue(priority)) {
    case "low":
      return "נמוכה";
    case "medium":
      return "בינונית";
    case "high":
      return "גבוהה";
    case "urgent":
      return "דחופה";
    default:
      return priority || "-";
  }
}

export function getOrderStatusLabel(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "draft":
      return "פתוחה";
    case "reserved":
      return "בהזמנה";
    case "delivered":
      return "סופקה";
    case "closed":
      return "סגורה";
    case "cancelled":
      return "בוטלה";
    default:
      return status || "-";
  }
}

export function getStatusLabel(type: StatusBadgeType, value: string) {
  switch (type) {
    case "payment":
      return getPaymentStatusLabel(value);
    case "project":
      return getProjectStatusLabel(value);
    case "task":
      return getTaskStatusLabel(value);
    case "priority":
      return getTaskPriorityLabel(value);
    case "order":
      return getOrderStatusLabel(value);
  }
}

export function getStatusColor(type: StatusBadgeType, value: string): StatusColor {
  switch (type) {
    case "payment":
      return getPaymentStatusColor(value);
    case "project":
      return getProjectStatusColor(value);
    case "task":
      return getTaskStatusColor(value);
    case "priority":
      return getTaskPriorityColor(value);
    case "order":
      return getOrderStatusColor(value);
  }
}

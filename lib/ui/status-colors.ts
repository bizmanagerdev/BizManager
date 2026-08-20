import type { Locale } from "@/lib/i18n/types";

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
export type OrderStatus =
  | "draft"
  | "reserved"
  | "partially_delivered"
  | "delivered"
  | "closed"
  | "cancelled";

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
    case "partially_delivered":
    case "סופק חלקית":
    case "סופקה חלקית":
      return "partially_delivered";
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
    case "partially_delivered":
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

export type Gender = "m" | "f";

// Statuses are always masculine across the app (project-wide convention).
// `locale` defaults to "he" everywhere except worker-facing pages that thread
// through the signed-in worker's own locale — office/admin call sites are
// unaffected by passing nothing.
export function getPaymentStatusLabel(status: string, locale: Locale = "he") {
  if (locale === "ar") {
    switch (normalizeValue(status)) {
      case "paid":
        return "مدفوع";
      case "partial":
        return "مدفوع جزئياً";
      case "not_due":
        return "لم يحن موعد الدفع بعد";
      case "not_paid":
      case "unpaid":
        return "غير مدفوع";
      case "overpaid":
        return "مدفوع بزيادة";
      case "pending":
        return "دفع متوقع";
      case "cleared":
        return "تم الاستلام";
      case "rejected":
        return "مرفوض";
      default:
        return status || "-";
    }
  }
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
      return "תשלום צפוי";
    case "cleared":
      return "התקבל";
    case "rejected":
      return "נדחה";
    default:
      return status || "-";
  }
}

export function getProjectStatusLabel(status: string, locale: Locale = "he") {
  if (locale === "ar") {
    switch (normalizeValue(status)) {
      case "quote":
        return "عرض سعر";
      case "planned":
      case "planning":
        return "مخطط";
      case "active":
        return "نشط";
      case "on_hold":
        return "متوقف مؤقتاً";
      case "completed":
        return "مكتمل";
      case "cancelled":
        return "ملغى";
      default:
        return status || "-";
    }
  }
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

export function getTaskStatusLabel(status: string, locale: Locale = "he") {
  if (locale === "ar") {
    switch (normalizeValue(status)) {
      case "overdue":
        return "متأخر";
      case "todo":
        return "للتنفيذ";
      case "in_progress":
        return "قيد التنفيذ";
      case "blocked":
        return "معلّق";
      case "done":
        return "منجز";
      case "cancelled":
        return "ملغى";
      default:
        return status || "-";
    }
  }
  switch (normalizeValue(status)) {
    case "overdue":
      return "באיחור";
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

export function getTaskPriorityLabel(priority: string, locale: Locale = "he") {
  if (locale === "ar") {
    switch (normalizeValue(priority)) {
      case "low":
        return "منخفضة";
      case "medium":
        return "متوسطة";
      case "high":
        return "عالية";
      case "urgent":
        return "عاجلة";
      default:
        return priority || "-";
    }
  }
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

export function getOrderStatusLabel(status: string, locale: Locale = "he") {
  if (locale === "ar") {
    switch (normalizeOrderStatus(status)) {
      case "draft":
        return "مفتوح";
      case "reserved":
        return "محجوز";
      case "partially_delivered":
        return "تم التسليم جزئياً";
      case "delivered":
        return "تم التسليم";
      case "closed":
        return "مغلق";
      case "cancelled":
        return "ملغى";
      default:
        return status || "-";
    }
  }
  switch (normalizeOrderStatus(status)) {
    case "draft":
      return "פתוח";
    case "reserved":
      return "בהזמנה";
    case "partially_delivered":
      return "סופק חלקית";
    case "delivered":
      return "סופק";
    case "closed":
      return "סגור";
    case "cancelled":
      return "בוטל";
    default:
      return status || "-";
  }
}

export function getStatusLabel(type: StatusBadgeType, value: string, locale: Locale = "he") {
  switch (type) {
    case "payment":
      return getPaymentStatusLabel(value, locale);
    case "project":
      return getProjectStatusLabel(value, locale);
    case "task":
      return getTaskStatusLabel(value, locale);
    case "priority":
      return getTaskPriorityLabel(value, locale);
    case "order":
      return getOrderStatusLabel(value, locale);
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

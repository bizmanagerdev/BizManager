import type { Dictionary } from "../types";

// The "+" quick-create tile grid (components/layout/QuickCreateMenu.tsx).
// Only task/reminder/attendance are ever shown to a worker (the rest are
// admin/office-only, who never run this in "ar") but every tile gets a real
// translation for consistency.
export type QuickCreateKey =
  | "reminder"
  | "task"
  | "attendance"
  | "income"
  | "expense"
  | "transfer"
  | "project"
  | "order"
  | "customer"
  | "collect"
  | "workerPayment"
  | "manualSession";

export const quickCreateDict: Dictionary<QuickCreateKey> = {
  he: {
    reminder: "תזכורת",
    task: "משימה",
    attendance: "דיווח נוכחות",
    income: "הכנסה",
    expense: "הוצאה",
    transfer: "העברה בין חשבונות",
    project: "פרויקט",
    order: "הזמנה",
    customer: "לקוח",
    collect: "קליטת תשלום",
    workerPayment: "תשלום לעובד",
    manualSession: "משמרת ידנית",
  },
  ar: {
    reminder: "تذكير",
    task: "مهمة",
    attendance: "تسجيل حضور",
    income: "إيراد",
    expense: "مصروف",
    transfer: "تحويل بين الحسابات",
    project: "مشروع",
    order: "طلبية",
    customer: "عميل",
    collect: "استلام دفعة",
    workerPayment: "دفعة لعامل",
    manualSession: "مناوبة يدوية",
  },
};

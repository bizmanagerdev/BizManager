import type { Dictionary } from "../types";

// Static chrome for /notifications (page.tsx + NotificationsClient). Category
// labels come from lib/notifications/categories.ts (out of scope) and
// individual notification title/body text is dynamic content from elsewhere.
export type NotificationsKey =
  | "pageTitle"
  | "pageDescription"
  | "emptyState"
  | "unreadCount"
  | "allRead"
  | "markAllRead"
  | "loadMore";

export const notificationsDict: Dictionary<NotificationsKey> = {
  he: {
    pageTitle: "התראות",
    pageDescription: "כל ההתראות שקיבלת — נקראו ושלא נקראו.",
    emptyState: "אין התראות עדיין.",
    unreadCount: "{n} שלא נקראו",
    allRead: "הכול נקרא",
    markAllRead: "סמן הכל כנקרא",
    loadMore: "טען עוד",
  },
  ar: {
    pageTitle: "الإشعارات",
    pageDescription: "جميع الإشعارات التي تلقيتها — المقروءة وغير المقروءة.",
    emptyState: "لا توجد إشعارات بعد.",
    unreadCount: "{n} غير مقروءة",
    allRead: "تم قراءة الكل",
    markAllRead: "تحديد الكل كمقروء",
    loadMore: "تحميل المزيد",
  },
};

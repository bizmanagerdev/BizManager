import type { Dictionary } from "../types";

// Static chrome for /inbox (InboxClient). Item titles/content themselves are
// dynamic content generated elsewhere in the app and are NOT covered here.
export type InboxKey =
  | "title"
  | "newLabel"
  | "totalLabel"
  | "markAllRead"
  | "preferences"
  | "syncing"
  | "refresh"
  | "allChip"
  | "allCleanTitle"
  | "allCleanSubtitle"
  | "summariesTitle"
  | "assignedByMeTitle"
  | "snoozedToggle"
  | "snoozedReturnsPrefix"
  | "snoozedLabel"
  | "restore"
  | "done"
  | "historyLink"
  | "mine"
  | "newIndicator"
  | "editReminder"
  | "markDoneAria"
  | "snoozeTitle"
  | "snoozeAria"
  | "presetHour"
  | "presetTomorrow"
  | "presetWeek"
  | "actionOpen"
  | "actionOpenTask"
  | "actionOpenProject"
  | "actionOpenChecks"
  | "actionOrderStock"
  | "actionOpenCreditPage"
  | "actionOpenVehicle"
  | "actionOpenPayroll"
  | "actionOpenExpense"
  | "timeNow"
  | "timeMinutesAgo"
  | "timeYesterday"
  | "timeHoursAgo"
  | "timeDaysAgo"
  | "groupEarlier"
  | "toastDone"
  | "toastReopened"
  | "toastDismissed"
  | "toastActionFailed"
  | "toastSynced"
  | "toastSyncFailed";

export const inboxDict: Dictionary<InboxKey> = {
  he: {
    title: "התראות",
    newLabel: "חדשות",
    totalLabel: "סה״כ",
    markAllRead: "סמן הכול כנקרא",
    preferences: "העדפות",
    syncing: "מעדכן…",
    refresh: "רענן",
    allChip: "הכול",
    allCleanTitle: "הכול נקי",
    allCleanSubtitle: "אין מה לטפל כרגע.",
    summariesTitle: "סיכומים",
    assignedByMeTitle: "תזכורות שהקצאתי לאחרים",
    snoozedToggle: "נדחו לזמן מאוחר ({n})",
    snoozedReturnsPrefix: "חוזר",
    snoozedLabel: "נדחה",
    restore: "החזר",
    done: "בוצע",
    historyLink: "היסטוריית התראות שנשלחו",
    mine: "שלי",
    newIndicator: "חדש",
    editReminder: "עריכת תזכורת",
    markDoneAria: "סמן כבוצע",
    snoozeTitle: "דחה",
    snoozeAria: "דחיית התראה",
    presetHour: "שעה",
    presetTomorrow: "מחר",
    presetWeek: "שבוע",
    actionOpen: "פתח",
    actionOpenTask: "פתח משימה",
    actionOpenProject: "פתח פרויקט",
    actionOpenChecks: "פתח צ׳קים",
    actionOrderStock: "הזמן מלאי",
    actionOpenCreditPage: "פתח דף אשראי",
    actionOpenVehicle: "פתח רכב",
    actionOpenPayroll: "פתח שכר",
    actionOpenExpense: "פתח הוצאה",
    timeNow: "עכשיו",
    timeMinutesAgo: "לפני {n} דק׳",
    timeYesterday: "אתמול",
    timeHoursAgo: "לפני {n} שעות",
    timeDaysAgo: "לפני {n} ימים",
    groupEarlier: "קודם",
    toastDone: "סומן כבוצע",
    toastReopened: "הוחזר",
    toastDismissed: "הוסתר",
    toastActionFailed: "הפעולה נכשלה.",
    toastSynced: "עודכן",
    toastSyncFailed: "העדכון נכשל.",
  },
  ar: {
    title: "الإشعارات",
    newLabel: "جديدة",
    totalLabel: "الإجمالي",
    markAllRead: "تحديد الكل كمقروء",
    preferences: "التفضيلات",
    syncing: "جارٍ التحديث…",
    refresh: "تحديث",
    allChip: "الكل",
    allCleanTitle: "لقد اطلعت على كل شيء",
    allCleanSubtitle: "لا يوجد ما يستدعي المتابعة الآن.",
    summariesTitle: "ملخصات",
    assignedByMeTitle: "تذكيرات أسندتها للآخرين",
    snoozedToggle: "تم تأجيلها لوقت لاحق ({n})",
    snoozedReturnsPrefix: "يعود",
    snoozedLabel: "مؤجل",
    restore: "استعادة",
    done: "تم",
    historyLink: "سجل الإشعارات المرسلة",
    mine: "لي",
    newIndicator: "جديد",
    editReminder: "تعديل التذكير",
    markDoneAria: "تحديد كمنجز",
    snoozeTitle: "تأجيل",
    snoozeAria: "تأجيل التنبيه",
    presetHour: "ساعة",
    presetTomorrow: "غدًا",
    presetWeek: "أسبوع",
    actionOpen: "فتح",
    actionOpenTask: "فتح المهمة",
    actionOpenProject: "فتح المشروع",
    actionOpenChecks: "فتح الشيكات",
    actionOrderStock: "طلب مخزون",
    actionOpenCreditPage: "فتح صفحة الائتمان",
    actionOpenVehicle: "فتح المركبة",
    actionOpenPayroll: "فتح الراتب",
    actionOpenExpense: "فتح المصروف",
    timeNow: "الآن",
    timeMinutesAgo: "منذ {n} دقيقة",
    timeYesterday: "أمس",
    timeHoursAgo: "منذ {n} ساعة",
    timeDaysAgo: "منذ {n} يوم",
    groupEarlier: "سابقًا",
    toastDone: "تم التحديد كمنجز",
    toastReopened: "تمت الاستعادة",
    toastDismissed: "تم الإخفاء",
    toastActionFailed: "فشلت العملية.",
    toastSynced: "تم التحديث",
    toastSyncFailed: "فشل التحديث.",
  },
};

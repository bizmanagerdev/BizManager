import type { Dictionary } from "../types";

// Dashboard board — the "היום" hero + every card widget below it. Shared by
// admin/office/worker (each sees a different subset of widgets), but only the
// worker role ever runs this in "ar".
export type DashboardKey =
  | "noCardsMessage"
  // TodayScheduleCard
  | "toCalendarLabel"
  | "addToday"
  | "addKindPrefix"
  | "todayFreeLabel"
  | "ongoingProjectsLabel"
  | "filterAll"
  | "emptyTodayLabel"
  | "kindReminder"
  | "kindReminderPlural"
  | "kindProject"
  | "kindProjectPlural"
  | "kindTask"
  | "kindTaskPlural"
  | "markReminderDoneTitle"
  | "reminderMarkedDone"
  // UpcomingPayments
  | "paymentsCardTitle"
  | "paymentsEmptyNote"
  | "paymentsAria"
  | "stagePending"
  | "stageScheduled"
  | "variableAmountLabel"
  | "todayNoPaymentsLabel"
  | "noLatePaymentsLabel"
  | "noUpcomingAlertingLabel"
  | "paymentsFooterLabel"
  // Shared between payments / collections / tasks
  | "lateLabel"
  // CollectionsCard
  | "collectionsCardTitle"
  | "collectionsEmptyNote"
  | "collectionsAria"
  | "collectingTodayLabel"
  | "markCollectedError"
  | "markCollectedSuccess"
  | "checkAbbrev"
  | "markCollectedTitle"
  | "collectedButtonLabel"
  | "noCollectionsToday"
  | "collectionsFooterLabel"
  | "daysLateSuffix"
  | "sourcesCountSuffix"
  | "callPrefix"
  // PropertiesCard
  | "propertiesCardTitle"
  | "propertiesEmptyNote"
  | "propertiesAria"
  | "vacantSectionLabel"
  | "vacantBadgeLabel"
  | "expiringSectionLabel"
  | "leaseEndedLabel"
  | "daysLeftSuffix"
  | "propertiesFooterLabel"
  // MissedDigestCard
  | "digestTypeOrders"
  | "digestTypeProjects"
  | "digestTypeCustomers"
  | "digestTypePayments"
  | "digestTypeExpenses"
  | "digestTypeAttendance"
  | "digestTypeWorkerPayments"
  | "digestTypeAccounts"
  | "digestTypeUsers"
  | "digestCardTitle"
  | "digestAria"
  | "markReadLabel"
  | "digestFooterLabel"
  // Shared with AttendanceApprovals (UpcomingDeliveries no longer uses this —
  // deliveries stays Hebrew-only, see dashboard/DashboardSections.tsx)
  | "last7DaysLabel"
  // TodayAlertsCard
  | "alertsCardTitle"
  | "alertsEmptyNote"
  | "toInboxAria"
  | "allAlertsFooterLabel"
  // MyTasksPanel
  | "tabAll"
  | "tabToday"
  | "tabInProgress"
  | "priorityUrgent"
  | "priorityHigh"
  | "statusBlocked"
  | "markTaskDoneQueued"
  | "actionFailed"
  | "taskMarkedDone"
  | "myTasksCardTitle"
  | "myTasksEmptyNote"
  | "toTasksBoardAria"
  | "markTaskDoneTitle"
  | "doneButtonLabel"
  | "noTasksInView"
  | "allTasksFooterLabel"
  // DomainChartCard
  | "toFinancialLabel"
  | "incomeExpensesTitle"
  | "selectMonthAria"
  | "loadingDataLabel"
  | "noCashMovementsLabel"
  // AttendanceApprovals
  | "attendanceCardTitle"
  | "attendanceEmptyNote"
  | "attendanceQueueAria"
  | "onShiftLabel"
  | "workerFallback"
  | "workerUnknownFallback"
  | "hoursAbbrev"
  | "attendanceFooterLabel";

export const dashboardDict: Dictionary<DashboardKey> = {
  he: {
    noCardsMessage: "אין כרטיסים להצגה. ניתן להוסיף כרטיסים דרך «התאמת לוח».",
    toCalendarLabel: "ליומן",
    addToday: "הוספה ליום זה",
    addKindPrefix: "הוסף",
    todayFreeLabel: "היום פנוי",
    ongoingProjectsLabel: "פרויקטים שוטפים:",
    filterAll: "הכל",
    emptyTodayLabel: "אין משימות או פרויקטים להיום.",
    kindReminder: "תזכורת",
    kindReminderPlural: "תזכורות",
    kindProject: "פרויקט",
    kindProjectPlural: "פרויקטים",
    kindTask: "משימה",
    kindTaskPlural: "משימות",
    markReminderDoneTitle: "סימון התזכורת כבוצעה",
    reminderMarkedDone: "התזכורת סומנה כבוצעה.",
    paymentsCardTitle: "תשלומים קרובים",
    paymentsEmptyNote: "אין תשלומים בקרוב",
    paymentsAria: "ללוח התשלומים",
    stagePending: "ממתין",
    stageScheduled: "צפוי",
    variableAmountLabel: "משתנה",
    todayNoPaymentsLabel: "אין תשלומים להיום",
    noLatePaymentsLabel: "אין תשלומים באיחור.",
    noUpcomingAlertingLabel: "אין תשלומים שמתריעים כעת.",
    paymentsFooterLabel: "כל התשלומים",
    lateLabel: "באיחור",
    collectionsCardTitle: "גבייה",
    collectionsEmptyNote: "אין חובות פתוחים",
    collectionsAria: "לגבייה",
    collectingTodayLabel: "לגבייה היום",
    markCollectedError: "סימון הגבייה נכשל.",
    markCollectedSuccess: "התשלום סומן כנגבה.",
    checkAbbrev: "צ׳ק",
    markCollectedTitle: "סימון התשלום כנגבה",
    collectedButtonLabel: "נגבה",
    noCollectionsToday: "אין גבייה להיום",
    collectionsFooterLabel: "כל הגבייה",
    daysLateSuffix: "יום באיחור",
    sourcesCountSuffix: "חובות",
    callPrefix: "חיוג ל",
    propertiesCardTitle: "נכסים",
    propertiesEmptyNote: "אין נכסים פנויים או חוזים שמסתיימים בקרוב",
    propertiesAria: "לנכסים",
    vacantSectionLabel: "נכסים פנויים",
    vacantBadgeLabel: "פנוי",
    expiringSectionLabel: "חוזים שמסתיימים בקרוב",
    leaseEndedLabel: "הסתיים",
    daysLeftSuffix: "ימים לסיום החוזה",
    propertiesFooterLabel: "כל הנכסים",
    digestTypeOrders: "הזמנות",
    digestTypeProjects: "פרויקטים",
    digestTypeCustomers: "לקוחות",
    digestTypePayments: "תשלומים",
    digestTypeExpenses: "הוצאות",
    digestTypeAttendance: "שעות עבודה",
    digestTypeWorkerPayments: "תשלומי עובדים",
    digestTypeAccounts: "חשבונות",
    digestTypeUsers: "משתמשים",
    digestCardTitle: "פעילות חדשה",
    digestAria: "ליומן הפעילות",
    markReadLabel: "סימון כנקרא",
    digestFooterLabel: "כל הפעילות",
    last7DaysLabel: "7 הימים האחרונים",
    alertsCardTitle: "התראות",
    alertsEmptyNote: "אין התראות להיום",
    toInboxAria: "לתיבה",
    allAlertsFooterLabel: "כל ההתראות",
    tabAll: "הכול",
    tabToday: "להיום",
    tabInProgress: "בתהליך",
    priorityUrgent: "דחופה",
    priorityHigh: "גבוהה",
    statusBlocked: "תקוע",
    markTaskDoneQueued: "סימון משימה כבוצעה",
    actionFailed: "הפעולה נכשלה.",
    taskMarkedDone: "המשימה סומנה כבוצעה.",
    myTasksCardTitle: "המשימות שלי",
    myTasksEmptyNote: "אין משימות פתוחות",
    toTasksBoardAria: "ללוח המשימות",
    markTaskDoneTitle: "סימון המשימה כבוצעה",
    doneButtonLabel: "בוצע",
    noTasksInView: "אין משימות בתצוגה זו.",
    allTasksFooterLabel: "כל המשימות",
    toFinancialLabel: "לניהול הכספים",
    incomeExpensesTitle: "הכנסות והוצאות",
    selectMonthAria: "בחירת חודש",
    loadingDataLabel: "טוען נתונים…",
    noCashMovementsLabel: "אין תנועות כספים בחודש זה.",
    attendanceCardTitle: "נוכחות עובדים",
    attendanceEmptyNote: "אין דיווחים לאישור",
    attendanceQueueAria: "פתיחת תור דיווחי הנוכחות",
    onShiftLabel: "במשמרת",
    workerFallback: "עובד",
    workerUnknownFallback: "עובד לא ידוע",
    hoursAbbrev: "ש׳",
    attendanceFooterLabel: "כל הנוכחות",
  },
  ar: {
    noCardsMessage: "لا توجد بطاقات لعرضها. يمكن إضافة بطاقات من خلال «تخصيص اللوحة».",
    toCalendarLabel: "إلى التقويم",
    addToday: "إضافة لهذا اليوم",
    addKindPrefix: "إضافة",
    todayFreeLabel: "اليوم خالٍ",
    ongoingProjectsLabel: "مشاريع جارية:",
    filterAll: "الكل",
    emptyTodayLabel: "لا توجد مهام أو مشاريع لهذا اليوم.",
    kindReminder: "تذكير",
    kindReminderPlural: "تذكيرات",
    kindProject: "مشروع",
    kindProjectPlural: "مشاريع",
    kindTask: "مهمة",
    kindTaskPlural: "مهام",
    markReminderDoneTitle: "تحديد التذكير كمنجز",
    reminderMarkedDone: "تم تحديد التذكير كمنجز.",
    paymentsCardTitle: "مدفوعات قادمة",
    paymentsEmptyNote: "لا مدفوعات قريبة",
    paymentsAria: "إلى جدول المدفوعات",
    stagePending: "قيد الانتظار",
    stageScheduled: "متوقع",
    variableAmountLabel: "متغير",
    todayNoPaymentsLabel: "لا مدفوعات اليوم",
    noLatePaymentsLabel: "لا مدفوعات متأخرة.",
    noUpcomingAlertingLabel: "لا مدفوعات تستدعي التنبيه حاليًا.",
    paymentsFooterLabel: "كل المدفوعات",
    lateLabel: "متأخر",
    collectionsCardTitle: "التحصيل",
    collectionsEmptyNote: "لا ديون مفتوحة",
    collectionsAria: "إلى التحصيل",
    collectingTodayLabel: "للتحصيل اليوم",
    markCollectedError: "فشل تسجيل التحصيل.",
    markCollectedSuccess: "تم تسجيل الدفعة كمُحصَّلة.",
    checkAbbrev: "شيك",
    markCollectedTitle: "تسجيل الدفعة كمُحصَّلة",
    collectedButtonLabel: "تم التحصيل",
    noCollectionsToday: "لا تحصيل اليوم",
    collectionsFooterLabel: "كل التحصيلات",
    daysLateSuffix: "يوم تأخير",
    sourcesCountSuffix: "ديون",
    callPrefix: "اتصال بـ",
    propertiesCardTitle: "العقارات",
    propertiesEmptyNote: "لا عقارات شاغرة أو عقود تنتهي قريبًا",
    propertiesAria: "إلى العقارات",
    vacantSectionLabel: "عقارات شاغرة",
    vacantBadgeLabel: "شاغر",
    expiringSectionLabel: "عقود تنتهي قريبًا",
    leaseEndedLabel: "انتهى",
    daysLeftSuffix: "أيام لانتهاء العقد",
    propertiesFooterLabel: "كل العقارات",
    digestTypeOrders: "طلبات",
    digestTypeProjects: "مشاريع",
    digestTypeCustomers: "عملاء",
    digestTypePayments: "مدفوعات",
    digestTypeExpenses: "مصروفات",
    digestTypeAttendance: "ساعات العمل",
    digestTypeWorkerPayments: "مدفوعات العمال",
    digestTypeAccounts: "حسابات",
    digestTypeUsers: "مستخدمون",
    digestCardTitle: "نشاط جديد",
    digestAria: "إلى سجل النشاط",
    markReadLabel: "تحديد كمقروء",
    digestFooterLabel: "كل النشاط",
    last7DaysLabel: "آخر 7 أيام",
    alertsCardTitle: "تنبيهات",
    alertsEmptyNote: "لا تنبيهات اليوم",
    toInboxAria: "إلى صندوق الوارد",
    allAlertsFooterLabel: "كل التنبيهات",
    tabAll: "الكل",
    tabToday: "لليوم",
    tabInProgress: "قيد التنفيذ",
    priorityUrgent: "عاجلة",
    priorityHigh: "عالية",
    statusBlocked: "معلقة",
    markTaskDoneQueued: "تحديد المهمة كمنجزة",
    actionFailed: "فشلت العملية.",
    taskMarkedDone: "تم تحديد المهمة كمنجزة.",
    myTasksCardTitle: "مهامي",
    myTasksEmptyNote: "لا توجد مهام مفتوحة",
    toTasksBoardAria: "إلى لوحة المهام",
    markTaskDoneTitle: "تحديد المهمة كمنجزة",
    doneButtonLabel: "تم الإنجاز",
    noTasksInView: "لا توجد مهام في هذا العرض.",
    allTasksFooterLabel: "كل المهام",
    toFinancialLabel: "إلى إدارة الأموال",
    incomeExpensesTitle: "الإيرادات والمصروفات",
    selectMonthAria: "اختيار الشهر",
    loadingDataLabel: "جارٍ تحميل البيانات…",
    noCashMovementsLabel: "لا حركات مالية في هذا الشهر.",
    attendanceCardTitle: "حضور العمال",
    attendanceEmptyNote: "لا تقارير للموافقة",
    attendanceQueueAria: "فتح قائمة تقارير الحضور",
    onShiftLabel: "في المناوبة",
    workerFallback: "عامل",
    workerUnknownFallback: "عامل غير معروف",
    hoursAbbrev: "س",
    attendanceFooterLabel: "كل سجلات الحضور",
  },
};

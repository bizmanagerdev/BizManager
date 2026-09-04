import type { Dictionary } from "../types";

// Worker-facing profile page: details/password/appearance/notifications cards,
// the attendance clock (MyShiftCard), the colleague sign-in dialog
// (AttendanceLogDialog), the shift list (SessionList), bonuses (MyBonusCard)
// and notification preferences (NotificationPrefs). Generic save/cancel/delete
// terms come from commonDict instead of being redefined here.
export type ProfileKey =
  // Page
  | "pageTitle"
  | "loadErrorPrefix"
  // Details card
  | "editDetailsLabel"
  | "nameLabel"
  | "phoneLabel"
  | "emailLabel"
  | "errNameRequired"
  | "detailsSavedToast"
  | "detailsSaveFailed"
  | "savingEllipsis"
  // Password card
  | "passwordSectionTitle"
  | "changePasswordLabel"
  | "newPasswordLabel"
  | "confirmPasswordLabel"
  | "showPasswordLabel"
  | "hidePasswordLabel"
  | "errPasswordTooShort"
  | "errPasswordMismatch"
  | "passwordChangeFailed"
  | "passwordChangeFailedPrefix"
  | "passwordUpdatedToast"
  | "passwordUpdatedNote"
  | "passwordHint"
  // Dashboard customizer card
  | "dashboardCustomizerTitle"
  | "dashboardCustomizerHint"
  // Locale card
  | "localeTitle"
  | "localeDescription"
  // Font size card
  | "fontSizeTitle"
  | "fontSizeHint"
  | "fontScaleSmall"
  | "fontScaleNormal"
  | "fontScaleLarge"
  | "fontScaleXLarge"
  | "fontScaleHuge"
  | "deviceDesktop"
  | "deviceMobile"
  // Avatar color card
  | "avatarColorTitle"
  | "avatarColorHint"
  | "selectColorAriaPrefix"
  | "customColorLabel"
  | "autoColorLabel"
  // Notifications tab wrapper
  | "pushTitle"
  | "pushHint"
  | "prefsTitle"
  | "prefsHint"
  // Sessions tab — worker (approval-queue) view
  | "pendingApprovalTitle"
  | "pendingApprovalHint"
  | "hoursSuffix"
  // Sessions tab — staff self-service clock
  | "startShiftLabel"
  | "endShiftLabel"
  | "shiftNotesPlaceholder"
  | "openTimePrefix"
  // Session list card
  | "addManualShiftLabel"
  | "totalHoursStatLabel"
  | "sessionCountLabel"
  | "openSessionCountLabel"
  | "noHoursDataYet"
  // Session list card — monthly export/print
  | "exportShareLabel"
  | "exportPrintLabel"
  | "exportReportTitle"
  | "exportGeneratedAtLabel"
  // Salary tab
  | "currentSalaryTitle"
  | "hourlySuffix"
  | "salaryTypePrefix"
  | "noActiveSalary"
  | "lastPayslipTitle"
  | "noPayslipsAvailable"
  | "earnedLabel"
  | "paidLabel"
  | "owedLabel"
  | "salaryHistoryTitle"
  | "noSalaryHistory"
  | "standardHoursPrefix"
  | "overtimePrefix"
  | "typeHeader"
  | "validHeader"
  | "salaryHeader"
  | "standardHoursHeader"
  | "overtimeHeader"
  | "payslipsTitle"
  | "noPayslipsNow"
  | "baseLabelPrefix"
  | "bonusesPrefix"
  | "adjustmentsPrefix"
  | "dueDatePrefix"
  | "periodHeader"
  | "hoursHeader"
  | "baseSalaryHeader"
  | "bonusesHeader"
  | "adjustmentsHeader"
  | "amountHeader"
  | "payPeriodFallback"
  // Editor dialog (renderEditor)
  | "manualShiftTitle"
  | "editShiftTitle"
  | "saveShiftLabel"
  | "saveChangesLabel"
  | "closeShort"
  | "startTimeLabel"
  | "totalHoursFieldLabel"
  | "hoursPlaceholderExample"
  | "endTimeLabel"
  | "dateLabel"
  | "domainLabel"
  | "projectLabel"
  | "propertyLabel"
  | "notesLabel"
  | "noSelectionNeeded"
  | "billCustomerTitle"
  | "billToCustomerLabel"
  | "billAmountLabel"
  | "billAmountPlaceholderExample"
  | "durationPrefix"
  | "originalDurationPrefix"
  | "suggestedAmountPrefix"
  | "splitShiftLabel"
  | "splitHint"
  | "addPartLabel"
  | "partLabelTemplate"
  | "removePartLabel"
  | "entryLabel"
  | "exitLabel"
  | "untilShiftEndPrefix"
  | "saveSplitLabel"
  | "selectPlaceholder"
  // Form validation errors
  | "errStartTimeRequired"
  | "errEndTimeRequired"
  | "errStartTimeInvalid"
  | "errEndTimeInvalid"
  | "errEndAfterStart"
  | "errSelectProject"
  | "errSelectProperty"
  | "errBillAmountRequired"
  | "errNoWorkerForSave"
  | "actionFailed"
  | "deleteSessionFailed"
  | "updateSessionFailed"
  | "createSessionFailed"
  | "splitSessionFailed"
  | "splitErrNeedShift"
  | "splitErrMin2"
  | "splitErrMax5"
  | "splitErrExitTimeRequiredTemplate"
  | "splitErrExitAfterStartTemplate"
  | "splitErrExitBeforeEndTemplate"
  | "splitErrNoTimeLast"
  | "splitErrSelectProjectPartTemplate"
  | "splitErrSelectPropertyPartTemplate"
  // Tabs
  | "tabProfile"
  | "tabNotifications"
  | "tabAttendance"
  | "tabSalary"
  // Bottom dialogs
  | "manualShiftDialogDescription"
  | "editShiftDialogDescription"
  | "deleteShiftTitle"
  | "deleteShiftDescription"
  // Shared across files
  | "noServerConnection"
  | "loadingEllipsis"
  // MyShiftCard
  | "shiftOpenedToast"
  | "errSelectStartTime"
  | "errSelectEndTime"
  | "shiftSubmittedToast"
  | "openShiftSincePrefix"
  | "attendanceClockTitle"
  | "pendingShiftsBadgeTemplate"
  | "elapsedPrefix"
  | "endTimeAriaLabel"
  | "finishedNowOption"
  | "finishedOtherTimeOption"
  | "whatDidYouDoLabel"
  | "submitForApprovalLabel"
  | "startTimeAriaLabel"
  | "startedNowOption"
  | "startedOtherTimeOption"
  | "forgotToReportOption"
  // MyBonusCard
  | "errSelectDate"
  | "errPositiveBonusAmount"
  | "errBonusReasonRequired"
  | "saveFailedGeneric"
  | "bonusAddedToast"
  | "deleteFailedGeneric"
  | "bonusDeletedToast"
  | "bonusesTitle"
  | "addBonusLabel"
  | "addedToSalaryOfTemplate"
  | "whichDayLabel"
  | "bonusDateAriaLabel"
  | "amountLabel"
  | "bonusAmountAriaLabel"
  | "whatForLabel"
  | "noBonusesYetHint"
  | "includedInPayslipLabel"
  | "deleteBonusLabel"
  | "deleteBonusTitle"
  | "deleteBonusDescription"
  // SessionList
  | "paidStatus"
  | "partialStatus"
  | "unpaidStatus"
  | "pendingStatus"
  | "overpaidStatus"
  | "noSessionsThisMonth"
  | "dateHeader"
  | "linkHeader"
  | "paymentHeader"
  | "editActionLabel"
  | "correctionActionLabel"
  // AttendanceLogDialog
  | "logAttendanceTitle"
  | "logAttendanceDescription"
  | "selectWorkerPlaceholder"
  | "workerAriaLabel"
  | "theWorkerFallback"
  | "errLoadWorkerState"
  | "shiftOpenedForTemplate"
  | "clockInReportFailed"
  | "errInvalidClockOutTime"
  | "shiftClosedForTemplate"
  | "clockOutReportFailed"
  | "errInvalidClockInTime"
  | "errClockInFuture"
  | "updateClockInFailed"
  | "clockInUpdatedTemplate"
  | "errClockOutAfterClockIn"
  | "shiftAddedForTemplate"
  | "addFailedGeneric"
  | "loadingAttendanceState"
  | "currentlyOnShiftLabel"
  | "clockedInAtPrefix"
  | "alreadyPrefix"
  | "hoursShort"
  | "whatDidWorkerDoLabel"
  | "atOtherTimeLabel"
  | "editClockInLabel"
  | "clockInTimeLabelColon"
  | "saveShortLabel"
  | "notCurrentlyOnShift"
  | "manualEntryLabel"
  | "exitOptionalLabel"
  // NotificationPrefs
  | "whatReachesPhoneLabel"
  | "customReminderHint"
  | "dailySummaryTimeLabel"
  | "notMineNotificationsTitle"
  | "extraSubscribeHint"
  | "whatToShowInInboxLabel"
  | "muteHint"
  | "pausePushLabel"
  | "saveDeliveryPrefsLabel"
  | "savedLocallyNotSynced"
  | "prefsSavedToast"
  | "saveFailedNoPeriod";

export const profileDict: Dictionary<ProfileKey> = {
  he: {
    pageTitle: "הפרופיל שלי",
    loadErrorPrefix: "שגיאה בטעינת נתוני העובד: ",
    editDetailsLabel: "עריכת פרטים",
    nameLabel: "שם",
    phoneLabel: "טלפון",
    emailLabel: "אימייל",
    errNameRequired: "יש להזין שם.",
    detailsSavedToast: "הפרטים נשמרו",
    detailsSaveFailed: "שמירה נכשלה.",
    savingEllipsis: "שומר…",
    passwordSectionTitle: "סיסמה",
    changePasswordLabel: "שינוי סיסמה",
    newPasswordLabel: "סיסמה חדשה",
    confirmPasswordLabel: "אימות סיסמה",
    showPasswordLabel: "הצג סיסמה",
    hidePasswordLabel: "הסתר סיסמה",
    errPasswordTooShort: "הסיסמה חייבת להכיל לפחות 6 תווים.",
    errPasswordMismatch: "הסיסמאות אינן תואמות.",
    passwordChangeFailed: "שינוי הסיסמה נכשל.",
    passwordChangeFailedPrefix: "שינוי הסיסמה נכשל: ",
    passwordUpdatedToast: "הסיסמה עודכנה",
    passwordUpdatedNote: "הסיסמה עודכנה.",
    passwordHint: "מומלץ להחליף סיסמה מדי פעם.",
    dashboardCustomizerTitle: "התאמת לוח",
    dashboardCustomizerHint: "בחרו אילו כרטיסים יופיעו בדשבורד וגררו לשינוי הסדר. הבחירה נשמרת בחשבון שלך.",
    localeTitle: "שפת התצוגה",
    localeDescription:
      "המסכים שלך — דשבורד, משלוחים, משימות, יומן והפרופיל — יוצגו בשפה שתבחר. הצוות במשרד ימשיך לראות הכל בעברית, וכל טקסט שתכתוב יתורגם עבורם אוטומטית.",
    fontSizeTitle: "גודל טקסט",
    fontSizeHint: "גודל נפרד למחשב ולטלפון — כל מסך מקבל את מה שנוח לקרוא בו. הבחירה נשמרת בחשבון שלך ומגיעה איתך לכל מכשיר.",
    fontScaleSmall: "קטן",
    fontScaleNormal: "רגיל",
    fontScaleLarge: "גדול",
    fontScaleXLarge: "גדול מאוד",
    fontScaleHuge: "ענק",
    deviceDesktop: "במחשב",
    deviceMobile: "בטלפון",
    avatarColorTitle: "הצבע שלי",
    avatarColorHint: "הצבע של עיגול ראשי התיבות שלך בכל המערכת. הבחירה נשמרת בחשבון שלך.",
    selectColorAriaPrefix: "בחירת צבע ",
    customColorLabel: "צבע מותאם אישית",
    autoColorLabel: "אוטומטי",
    pushTitle: "התראות לטלפון",
    pushHint: "הפעל התראות כדי לקבל עדכונים ישירות לטלפון שלך.",
    prefsTitle: "העדפות התראות",
    prefsHint: "כמה להתריע, מתי, ומה בכלל להציג בתיבה.",
    pendingApprovalTitle: "ממתינות לאישור",
    pendingApprovalHint: "משמרת נכנסת לשעות ולשכר רק אחרי שהלר מאשר אותה.",
    hoursSuffix: "שעות",
    startShiftLabel: "פתיחת משמרת",
    endShiftLabel: "סיום משמרת",
    shiftNotesPlaceholder: "הערות למשמרת",
    openTimePrefix: "זמן פתיחה: ",
    addManualShiftLabel: "הוספת משמרת ידנית",
    totalHoursStatLabel: 'סה"כ שעות',
    sessionCountLabel: "כמות משמרות",
    openSessionCountLabel: "משמרות פתוחות",
    noHoursDataYet: "עדיין אין נתוני שעות.",
    exportShareLabel: "שיתוף / הורדה",
    exportPrintLabel: "הדפסה",
    exportReportTitle: "דוח נוכחות חודשי",
    exportGeneratedAtLabel: "הופק ב",
    currentSalaryTitle: "שכר נוכחי",
    hourlySuffix: "לשעה",
    salaryTypePrefix: "סוג שכר: ",
    noActiveSalary: "אין משכורת פעילה",
    lastPayslipTitle: "תלוש אחרון",
    noPayslipsAvailable: "אין תלושים זמינים",
    earnedLabel: "נצבר",
    paidLabel: "שולם",
    owedLabel: "נותר לתשלום",
    salaryHistoryTitle: "היסטוריית שכר",
    noSalaryHistory: "אין היסטוריית שכר זמינה.",
    standardHoursPrefix: "שעות תקן: ",
    overtimePrefix: " · נוספות: ",
    typeHeader: "סוג",
    validHeader: "בתוקף",
    salaryHeader: "שכר",
    standardHoursHeader: "שעות תקן",
    overtimeHeader: "נוספות",
    payslipsTitle: "תלושי שכר",
    noPayslipsNow: "אין תלושי שכר זמינים כרגע.",
    baseLabelPrefix: "בסיס ",
    bonusesPrefix: " · בונוסים ",
    adjustmentsPrefix: " · התאמות ",
    dueDatePrefix: "צפי תשלום: ",
    periodHeader: "תקופה",
    hoursHeader: "שעות",
    baseSalaryHeader: "שכר בסיס",
    bonusesHeader: "בונוסים",
    adjustmentsHeader: "התאמות",
    amountHeader: "סכום",
    payPeriodFallback: "תקופת שכר",
    manualShiftTitle: "משמרת ידנית",
    editShiftTitle: "עריכת משמרת",
    saveShiftLabel: "שמירת משמרת",
    saveChangesLabel: "שמירת שינויים",
    closeShort: "סגור",
    startTimeLabel: "שעת התחלה",
    totalHoursFieldLabel: "סה״כ שעות",
    hoursPlaceholderExample: "למשל 8",
    endTimeLabel: "שעת סיום",
    dateLabel: "תאריך",
    domainLabel: "תחום",
    projectLabel: "פרויקט",
    propertyLabel: "נכס",
    notesLabel: "הערות",
    noSelectionNeeded: "אין צורך בבחירה נוספת.",
    billCustomerTitle: "חיוב הלקוח",
    billToCustomerLabel: "לחיוב לקוח",
    billAmountLabel: "סכום לחיוב לקוח",
    billAmountPlaceholderExample: "למשל 650",
    durationPrefix: "משך: ",
    originalDurationPrefix: "משך מקורי: ",
    suggestedAmountPrefix: "מגיע לפי המשמרת: ",
    splitShiftLabel: "פיצול המשמרת לחלקים",
    splitHint: "כל חלק מתחיל בשעת היציאה של החלק הקודם. בחרו שעת יציאה לכל חלק — החלק האחרון נמשך עד סוף המשמרת.",
    addPartLabel: "הוספת חלק",
    partLabelTemplate: "חלק {n}",
    removePartLabel: "הסרת חלק",
    entryLabel: "כניסה",
    exitLabel: "יציאה",
    untilShiftEndPrefix: "עד סוף המשמרת (",
    saveSplitLabel: "שמירת פיצול",
    selectPlaceholder: "בחירה",
    errStartTimeRequired: "יש להזין שעת התחלה.",
    errEndTimeRequired: "יש להזין שעת סיום.",
    errStartTimeInvalid: "שעת ההתחלה לא תקינה.",
    errEndTimeInvalid: "שעת הסיום לא תקינה.",
    errEndAfterStart: "שעת הסיום חייבת להיות אחרי שעת ההתחלה.",
    errSelectProject: "יש לבחור פרויקט.",
    errSelectProperty: "יש לבחור נכס.",
    errBillAmountRequired: "יש להזין סכום לחיוב לקוח.",
    errNoWorkerForSave: "לא נמצא עובד לשמירת המשמרת.",
    actionFailed: "הפעולה נכשלה.",
    deleteSessionFailed: "מחיקת המשמרת נכשלה.",
    updateSessionFailed: "עדכון המשמרת נכשל.",
    createSessionFailed: "יצירת המשמרת נכשלה.",
    splitSessionFailed: "פיצול המשמרת נכשל.",
    splitErrNeedShift: "צריך משמרת עם שעת התחלה וסיום כדי לפצל.",
    splitErrMin2: "צריך לפחות שני חלקים.",
    splitErrMax5: "אפשר לפצל לכל היותר לחמישה חלקים.",
    splitErrExitTimeRequiredTemplate: "יש להזין שעת יציאה לחלק {n}.",
    splitErrExitAfterStartTemplate: "שעת היציאה של חלק {n} חייבת להיות אחרי תחילת החלק.",
    splitErrExitBeforeEndTemplate: "שעת היציאה של חלק {n} חייבת להיות לפני סוף המשמרת.",
    splitErrNoTimeLast: "לא נשאר זמן לחלק האחרון.",
    splitErrSelectProjectPartTemplate: "יש לבחור פרויקט בחלק {n}.",
    splitErrSelectPropertyPartTemplate: "יש לבחור נכס בחלק {n}.",
    tabProfile: "פרופיל",
    tabNotifications: "התראות",
    tabAttendance: "נוכחות",
    tabSalary: "משכורת",
    manualShiftDialogDescription: "דיווח משמרת שלא נרשמה בשעון.",
    editShiftDialogDescription: "עדכון שעות, פרויקט והערות למשמרת שדיווחת.",
    deleteShiftTitle: "מחיקת משמרת",
    deleteShiftDescription: "המשמרת תימחק מהדיווח שלך.",
    noServerConnection: "אין חיבור לשרת.",
    loadingEllipsis: "...",
    shiftOpenedToast: "המשמרת נפתחה.",
    errSelectStartTime: "יש לבחור שעת התחלה.",
    errSelectEndTime: "יש לבחור שעת סיום.",
    shiftSubmittedToast: "המשמרת נשלחה לאישור.",
    openShiftSincePrefix: "משמרת פתוחה מ־",
    attendanceClockTitle: "שעון נוכחות",
    pendingShiftsBadgeTemplate: "{n} משמרות ממתינות לאישור",
    elapsedPrefix: "עד עכשיו: ",
    endTimeAriaLabel: "שעת סיום המשמרת",
    finishedNowOption: "סיימתי עכשיו",
    finishedOtherTimeOption: "סיימתי בשעה אחרת",
    whatDidYouDoLabel: "מה עשית במשמרת?",
    submitForApprovalLabel: "שליחה לאישור",
    startTimeAriaLabel: "שעת תחילת המשמרת",
    startedNowOption: "התחלתי עכשיו",
    startedOtherTimeOption: "התחלתי בשעה אחרת",
    forgotToReportOption: "שכחתי לדווח — משמרת שהסתיימה",
    errSelectDate: "יש לבחור תאריך.",
    errPositiveBonusAmount: "יש להזין סכום בונוס חיובי.",
    errBonusReasonRequired: "יש לכתוב על מה הבונוס.",
    saveFailedGeneric: "השמירה נכשלה.",
    bonusAddedToast: "הבונוס נוסף לשכר של החודש.",
    deleteFailedGeneric: "המחיקה נכשלה.",
    bonusDeletedToast: "הבונוס נמחק.",
    bonusesTitle: "בונוסים",
    addBonusLabel: "הוספת בונוס",
    addedToSalaryOfTemplate: "נוסף לשכר של {month}: ",
    whichDayLabel: "על איזה יום",
    bonusDateAriaLabel: "תאריך הבונוס",
    amountLabel: "סכום",
    bonusAmountAriaLabel: "סכום הבונוס",
    whatForLabel: "על מה הבונוס",
    noBonusesYetHint: "עוד לא הוספת בונוס. בונוס שתוסיף נכנס לשכר של החודש שבו התאריך נמצא.",
    includedInPayslipLabel: "נכנס לתלוש",
    deleteBonusLabel: "מחיקת הבונוס",
    deleteBonusTitle: "מחיקת בונוס",
    deleteBonusDescription: "הבונוס יימחק ולא ייכנס לשכר.",
    paidStatus: "שולם",
    partialStatus: "שולם חלקית",
    unpaidStatus: "לא שולם",
    pendingStatus: "טרם הגיע מועד",
    overpaidStatus: "שולם ביתר",
    noSessionsThisMonth: "אין עדיין משמרות בחודש הזה.",
    dateHeader: "תאריך",
    linkHeader: "שיוך",
    paymentHeader: "תשלום",
    editActionLabel: "עריכה",
    correctionActionLabel: "תיקון",
    logAttendanceTitle: "דיווח נוכחות לעובד",
    logAttendanceDescription: "בחרו עובד, ואז דווחו כניסה או יציאה — הדיווח ייכנס לתור לשיוך תחום ואישור.",
    selectWorkerPlaceholder: "בחירת עובד",
    workerAriaLabel: "עובד",
    theWorkerFallback: "העובד",
    errLoadWorkerState: "שגיאה בטעינת מצב העובד.",
    shiftOpenedForTemplate: "נפתחה משמרת עבור {name}.",
    clockInReportFailed: "דיווח הכניסה נכשל.",
    errInvalidClockOutTime: "שעת יציאה אינה תקינה.",
    shiftClosedForTemplate: "המשמרת של {name} נסגרה וממתינה לאישור.",
    clockOutReportFailed: "דיווח היציאה נכשל.",
    errInvalidClockInTime: "שעת כניסה אינה תקינה.",
    errClockInFuture: "שעת הכניסה לא יכולה להיות בעתיד.",
    updateClockInFailed: "עדכון שעת הכניסה נכשל.",
    clockInUpdatedTemplate: "שעת הכניסה של {name} עודכנה.",
    errClockOutAfterClockIn: "שעת היציאה חייבת להיות אחרי הכניסה.",
    shiftAddedForTemplate: "המשמרת של {name} נוספה וממתינה לאישור.",
    addFailedGeneric: "ההוספה נכשלה.",
    loadingAttendanceState: "טוען מצב נוכחות...",
    currentlyOnShiftLabel: "כרגע במשמרת",
    clockedInAtPrefix: " · נכנס ",
    alreadyPrefix: " · כבר ",
    hoursShort: "ש׳",
    whatDidWorkerDoLabel: "מה העובד עשה במשמרת?",
    atOtherTimeLabel: "בשעה אחרת",
    editClockInLabel: "עריכת כניסה",
    clockInTimeLabelColon: "שעת כניסה:",
    saveShortLabel: "שמור",
    notCurrentlyOnShift: "כרגע לא במשמרת.",
    manualEntryLabel: "רישום ידני",
    exitOptionalLabel: "יציאה (לא חובה)",
    whatReachesPhoneLabel: "מה יגיע לנייד?",
    customReminderHint: "תזכורת שקבעת בעצמך עם שעה — תמיד תתריע בזמן שקבעת, בכל מצב.",
    dailySummaryTimeLabel: "שעת הסיכום היומי",
    notMineNotificationsTitle: "התראות לנייד גם על דברים שאינם שלי",
    extraSubscribeHint:
      "כברירת מחדל רק דברים ששייכים לך מתריעים לנייד. סמן נושאים שתרצה לקבל עליהם התראה בנוסף. בכל מקרה הכול מופיע בתיבה — הסימון משפיע רק על ההתראה לנייד.",
    whatToShowInInboxLabel: "מה להציג בתיבה",
    muteHint: "נושא שיוסר מהסימון ייעלם לגמרי — לא בתיבה, לא בלוח ולא בנייד.",
    pausePushLabel: "השהה לגמרי התראות לנייד (הכול עדיין יופיע בתיבה)",
    saveDeliveryPrefsLabel: "שמור העדפות",
    savedLocallyNotSynced: "נשמר מקומית אך טרם סונכרן",
    prefsSavedToast: "ההעדפות נשמרו",
    saveFailedNoPeriod: "שמירה נכשלה",
  },
  ar: {
    pageTitle: "ملفي الشخصي",
    loadErrorPrefix: "خطأ في تحميل بيانات الموظف: ",
    editDetailsLabel: "تعديل البيانات",
    nameLabel: "الاسم",
    phoneLabel: "الهاتف",
    emailLabel: "البريد الإلكتروني",
    errNameRequired: "يجب إدخال الاسم.",
    detailsSavedToast: "تم حفظ البيانات",
    detailsSaveFailed: "فشل الحفظ.",
    savingEllipsis: "جارٍ الحفظ…",
    passwordSectionTitle: "كلمة المرور",
    changePasswordLabel: "تغيير كلمة المرور",
    newPasswordLabel: "كلمة مرور جديدة",
    confirmPasswordLabel: "تأكيد كلمة المرور",
    showPasswordLabel: "إظهار كلمة المرور",
    hidePasswordLabel: "إخفاء كلمة المرور",
    errPasswordTooShort: "يجب أن تحتوي كلمة المرور على 6 أحرف على الأقل.",
    errPasswordMismatch: "كلمتا المرور غير متطابقتين.",
    passwordChangeFailed: "فشل تغيير كلمة المرور.",
    passwordChangeFailedPrefix: "فشل تغيير كلمة المرور: ",
    passwordUpdatedToast: "تم تحديث كلمة المرور",
    passwordUpdatedNote: "تم تحديث كلمة المرور.",
    passwordHint: "يُنصح بتغيير كلمة المرور بين الحين والآخر.",
    dashboardCustomizerTitle: "تخصيص اللوحة",
    dashboardCustomizerHint: "اختر البطاقات التي ستظهر في لوحة التحكم واسحبها لتغيير الترتيب. يُحفظ اختيارك في حسابك.",
    localeTitle: "لغة العرض",
    localeDescription:
      "شاشاتك — لوحة التحكم، الشحنات، المهام، التقويم والملف الشخصي — ستُعرض باللغة التي تختارها. الطاقم في المكتب سيستمر في رؤية كل شيء بالعبرية، وأي نص تكتبه سيُترجم لهم تلقائيًا.",
    fontSizeTitle: "حجم النص",
    fontSizeHint: "حجم منفصل للكمبيوتر والهاتف — كل شاشة تحصل على ما يناسبها للقراءة. يُحفظ اختيارك في حسابك ويصل معك إلى كل جهاز.",
    fontScaleSmall: "صغير",
    fontScaleNormal: "عادي",
    fontScaleLarge: "كبير",
    fontScaleXLarge: "كبير جدًا",
    fontScaleHuge: "ضخم",
    deviceDesktop: "على الكمبيوتر",
    deviceMobile: "على الهاتف",
    avatarColorTitle: "لوني",
    avatarColorHint: "لون دائرة الأحرف الأولى من اسمك في كل أنحاء النظام. يُحفظ اختيارك في حسابك.",
    selectColorAriaPrefix: "اختيار اللون ",
    customColorLabel: "لون مخصص",
    autoColorLabel: "تلقائي",
    pushTitle: "إشعارات الهاتف",
    pushHint: "فعّل الإشعارات لتصلك التحديثات مباشرة إلى هاتفك.",
    prefsTitle: "تفضيلات الإشعارات",
    prefsHint: "ما مقدار التنبيهات، متى، وما الذي يُعرض في صندوق الوارد أصلًا.",
    pendingApprovalTitle: "بانتظار الموافقة",
    pendingApprovalHint: "المناوبة تُحتسب في الساعات والراتب فقط بعد موافقة هيلر عليها.",
    hoursSuffix: "ساعات",
    startShiftLabel: "بدء المناوبة",
    endShiftLabel: "إنهاء المناوبة",
    shiftNotesPlaceholder: "ملاحظات للمناوبة",
    openTimePrefix: "وقت البدء: ",
    addManualShiftLabel: "إضافة مناوبة يدويًا",
    totalHoursStatLabel: "إجمالي الساعات",
    sessionCountLabel: "عدد المناوبات",
    openSessionCountLabel: "مناوبات مفتوحة",
    noHoursDataYet: "لا توجد بعد بيانات ساعات.",
    exportShareLabel: "مشاركة / تنزيل",
    exportPrintLabel: "طباعة",
    exportReportTitle: "تقرير حضور شهري",
    exportGeneratedAtLabel: "صدر في",
    currentSalaryTitle: "الراتب الحالي",
    hourlySuffix: "لكل ساعة",
    salaryTypePrefix: "نوع الراتب: ",
    noActiveSalary: "لا يوجد راتب نشط",
    lastPayslipTitle: "آخر قسيمة راتب",
    noPayslipsAvailable: "لا توجد قسائم راتب متاحة",
    earnedLabel: "المُستحق",
    paidLabel: "المدفوع",
    owedLabel: "المتبقي للدفع",
    salaryHistoryTitle: "سجل الرواتب",
    noSalaryHistory: "لا يوجد سجل رواتب متاح.",
    standardHoursPrefix: "ساعات العمل الأساسية: ",
    overtimePrefix: " · ساعات إضافية: ",
    typeHeader: "النوع",
    validHeader: "سارٍ",
    salaryHeader: "الراتب",
    standardHoursHeader: "ساعات أساسية",
    overtimeHeader: "ساعات إضافية",
    payslipsTitle: "قسائم الراتب",
    noPayslipsNow: "لا توجد قسائم راتب متاحة حاليًا.",
    baseLabelPrefix: "أساسي ",
    bonusesPrefix: " · مكافآت ",
    adjustmentsPrefix: " · تعديلات ",
    dueDatePrefix: "موعد الدفع المتوقع: ",
    periodHeader: "الفترة",
    hoursHeader: "ساعات",
    baseSalaryHeader: "الراتب الأساسي",
    bonusesHeader: "مكافآت",
    adjustmentsHeader: "تعديلات",
    amountHeader: "المبلغ",
    payPeriodFallback: "فترة الراتب",
    manualShiftTitle: "مناوبة يدوية",
    editShiftTitle: "تعديل المناوبة",
    saveShiftLabel: "حفظ المناوبة",
    saveChangesLabel: "حفظ التغييرات",
    closeShort: "إغلاق",
    startTimeLabel: "وقت البدء",
    totalHoursFieldLabel: "إجمالي الساعات",
    hoursPlaceholderExample: "مثال: 8",
    endTimeLabel: "وقت الانتهاء",
    dateLabel: "التاريخ",
    domainLabel: "المجال",
    projectLabel: "المشروع",
    propertyLabel: "العقار",
    notesLabel: "ملاحظات",
    noSelectionNeeded: "لا حاجة لاختيار إضافي.",
    billCustomerTitle: "الفوترة على العميل",
    billToCustomerLabel: "للفوترة على العميل",
    billAmountLabel: "المبلغ المطلوب من العميل",
    billAmountPlaceholderExample: "مثال: 650",
    durationPrefix: "المدة: ",
    originalDurationPrefix: "المدة الأصلية: ",
    suggestedAmountPrefix: "المستحق عن هذه المناوبة: ",
    splitShiftLabel: "تقسيم المناوبة إلى أجزاء",
    splitHint: "كل جزء يبدأ من وقت خروج الجزء السابق. اختر وقت الخروج لكل جزء — الجزء الأخير يستمر حتى نهاية المناوبة.",
    addPartLabel: "إضافة جزء",
    partLabelTemplate: "الجزء {n}",
    removePartLabel: "إزالة الجزء",
    entryLabel: "دخول",
    exitLabel: "خروج",
    untilShiftEndPrefix: "حتى نهاية المناوبة (",
    saveSplitLabel: "حفظ التقسيم",
    selectPlaceholder: "اختيار",
    errStartTimeRequired: "يجب إدخال وقت البدء.",
    errEndTimeRequired: "يجب إدخال وقت الانتهاء.",
    errStartTimeInvalid: "وقت البدء غير صالح.",
    errEndTimeInvalid: "وقت الانتهاء غير صالح.",
    errEndAfterStart: "يجب أن يكون وقت الانتهاء بعد وقت البدء.",
    errSelectProject: "يجب اختيار مشروع.",
    errSelectProperty: "يجب اختيار عقار.",
    errBillAmountRequired: "يجب إدخال مبلغ الفوترة على العميل.",
    errNoWorkerForSave: "لم يتم العثور على موظف لحفظ المناوبة.",
    actionFailed: "فشلت العملية.",
    deleteSessionFailed: "فشل حذف المناوبة.",
    updateSessionFailed: "فشل تحديث المناوبة.",
    createSessionFailed: "فشل إنشاء المناوبة.",
    splitSessionFailed: "فشل تقسيم المناوبة.",
    splitErrNeedShift: "يلزم وجود مناوبة بوقت بدء وانتهاء لتقسيمها.",
    splitErrMin2: "يلزم جزءان على الأقل.",
    splitErrMax5: "يمكن التقسيم إلى خمسة أجزاء كحد أقصى.",
    splitErrExitTimeRequiredTemplate: "يجب إدخال وقت خروج للجزء {n}.",
    splitErrExitAfterStartTemplate: "يجب أن يكون وقت خروج الجزء {n} بعد بداية الجزء.",
    splitErrExitBeforeEndTemplate: "يجب أن يكون وقت خروج الجزء {n} قبل نهاية المناوبة.",
    splitErrNoTimeLast: "لم يتبقَّ وقت للجزء الأخير.",
    splitErrSelectProjectPartTemplate: "يجب اختيار مشروع للجزء {n}.",
    splitErrSelectPropertyPartTemplate: "يجب اختيار عقار للجزء {n}.",
    tabProfile: "الملف الشخصي",
    tabNotifications: "الإشعارات",
    tabAttendance: "الحضور",
    tabSalary: "الراتب",
    manualShiftDialogDescription: "تسجيل مناوبة لم تُسجَّل عبر الساعة.",
    editShiftDialogDescription: "تحديث الساعات والمشروع والملاحظات للمناوبة التي سجّلتها.",
    deleteShiftTitle: "حذف المناوبة",
    deleteShiftDescription: "ستُحذف المناوبة من تقريرك.",
    noServerConnection: "لا يوجد اتصال بالخادم.",
    loadingEllipsis: "...",
    shiftOpenedToast: "تم فتح المناوبة.",
    errSelectStartTime: "يجب اختيار وقت البدء.",
    errSelectEndTime: "يجب اختيار وقت الانتهاء.",
    shiftSubmittedToast: "أُرسلت المناوبة للموافقة.",
    openShiftSincePrefix: "مناوبة مفتوحة منذ ",
    attendanceClockTitle: "ساعة الحضور",
    pendingShiftsBadgeTemplate: "{n} مناوبات بانتظار الموافقة",
    elapsedPrefix: "حتى الآن: ",
    endTimeAriaLabel: "وقت انتهاء المناوبة",
    finishedNowOption: "انتهيت الآن",
    finishedOtherTimeOption: "انتهيت في وقت آخر",
    whatDidYouDoLabel: "ماذا فعلت خلال المناوبة؟",
    submitForApprovalLabel: "إرسال للموافقة",
    startTimeAriaLabel: "وقت بدء المناوبة",
    startedNowOption: "بدأت الآن",
    startedOtherTimeOption: "بدأت في وقت آخر",
    forgotToReportOption: "نسيت التسجيل — مناوبة انتهت",
    errSelectDate: "يجب اختيار تاريخ.",
    errPositiveBonusAmount: "يجب إدخال مبلغ مكافأة موجب.",
    errBonusReasonRequired: "يجب كتابة سبب المكافأة.",
    saveFailedGeneric: "فشل الحفظ.",
    bonusAddedToast: "أُضيفت المكافأة إلى راتب هذا الشهر.",
    deleteFailedGeneric: "فشل الحذف.",
    bonusDeletedToast: "تم حذف المكافأة.",
    bonusesTitle: "المكافآت",
    addBonusLabel: "إضافة مكافأة",
    addedToSalaryOfTemplate: "أُضيفت إلى راتب {month}: ",
    whichDayLabel: "في أي يوم",
    bonusDateAriaLabel: "تاريخ المكافأة",
    amountLabel: "المبلغ",
    bonusAmountAriaLabel: "مبلغ المكافأة",
    whatForLabel: "سبب المكافأة",
    noBonusesYetHint: "لم تُضِف مكافأة بعد. أي مكافأة تُضيفها تدخل في راتب الشهر الذي يقع فيه التاريخ.",
    includedInPayslipLabel: "أُدرجت في القسيمة",
    deleteBonusLabel: "حذف المكافأة",
    deleteBonusTitle: "حذف مكافأة",
    deleteBonusDescription: "ستُحذف المكافأة ولن تُدرج في الراتب.",
    paidStatus: "مدفوع",
    partialStatus: "مدفوع جزئيًا",
    unpaidStatus: "غير مدفوع",
    pendingStatus: "لم يحن موعده بعد",
    overpaidStatus: "دُفع بالزيادة",
    noSessionsThisMonth: "لا توجد مناوبات بعد هذا الشهر.",
    dateHeader: "التاريخ",
    linkHeader: "الجهة",
    paymentHeader: "الدفع",
    editActionLabel: "تعديل",
    correctionActionLabel: "تصحيح",
    logAttendanceTitle: "تسجيل حضور لموظف",
    logAttendanceDescription: "اختر موظفًا، ثم سجّل دخولًا أو خروجًا — سيدخل التسجيل إلى قائمة الانتظار لتحديد المجال والموافقة.",
    selectWorkerPlaceholder: "اختيار موظف",
    workerAriaLabel: "موظف",
    theWorkerFallback: "الموظف",
    errLoadWorkerState: "خطأ في تحميل حالة الموظف.",
    shiftOpenedForTemplate: "فُتحت مناوبة لـ{name}.",
    clockInReportFailed: "فشل تسجيل الدخول.",
    errInvalidClockOutTime: "وقت الخروج غير صالح.",
    shiftClosedForTemplate: "أُغلقت مناوبة {name} وهي بانتظار الموافقة.",
    clockOutReportFailed: "فشل تسجيل الخروج.",
    errInvalidClockInTime: "وقت الدخول غير صالح.",
    errClockInFuture: "لا يمكن أن يكون وقت الدخول في المستقبل.",
    updateClockInFailed: "فشل تحديث وقت الدخول.",
    clockInUpdatedTemplate: "تم تحديث وقت دخول {name}.",
    errClockOutAfterClockIn: "يجب أن يكون وقت الخروج بعد وقت الدخول.",
    shiftAddedForTemplate: "أُضيفت مناوبة {name} وهي بانتظار الموافقة.",
    addFailedGeneric: "فشلت الإضافة.",
    loadingAttendanceState: "جارٍ تحميل حالة الحضور...",
    currentlyOnShiftLabel: "في مناوبة الآن",
    clockedInAtPrefix: " · دخل ",
    alreadyPrefix: " · منذ ",
    hoursShort: "س",
    whatDidWorkerDoLabel: "ماذا فعل الموظف خلال المناوبة؟",
    atOtherTimeLabel: "في وقت آخر",
    editClockInLabel: "تعديل وقت الدخول",
    clockInTimeLabelColon: "وقت الدخول:",
    saveShortLabel: "حفظ",
    notCurrentlyOnShift: "ليس في مناوبة حاليًا.",
    manualEntryLabel: "تسجيل يدوي",
    exitOptionalLabel: "الخروج (اختياري)",
    whatReachesPhoneLabel: "ما الذي يصل إلى الهاتف؟",
    customReminderHint: "التذكير الذي تحدده بنفسك مع وقت — سيُنبّهك دائمًا في الوقت الذي حددته، في كل الأحوال.",
    dailySummaryTimeLabel: "وقت الملخص اليومي",
    notMineNotificationsTitle: "إشعارات على الهاتف حتى بشأن أمور ليست لي",
    extraSubscribeHint:
      "افتراضيًا، فقط الأمور الخاصة بك تُنبّه على الهاتف. حدّد المواضيع التي تريد تلقي إشعار إضافي بشأنها. على أي حال يظهر كل شيء في صندوق الوارد — التحديد يؤثر فقط على إشعار الهاتف.",
    whatToShowInInboxLabel: "ما الذي يُعرض في صندوق الوارد",
    muteHint: "الموضوع الذي يُلغى تحديده يختفي تمامًا — لا في الصندوق، ولا في اللوحة، ولا على الهاتف.",
    pausePushLabel: "إيقاف إشعارات الهاتف تمامًا (سيظل كل شيء يظهر في صندوق الوارد)",
    saveDeliveryPrefsLabel: "حفظ التفضيلات",
    savedLocallyNotSynced: "حُفظ محليًا لكن لم تتم المزامنة بعد",
    prefsSavedToast: "تم حفظ التفضيلات",
    saveFailedNoPeriod: "فشل الحفظ",
  },
};

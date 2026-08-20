import type { Dictionary } from "../types";

// Persistent chrome (top bar avatar menu, inbox bell preview, PWA install
// prompt) rendered on every page via AppShell — shared by admin/office/worker,
// but only the worker role ever runs this in "ar".
export type TopbarKey =
  | "myAccount"
  | "userFallback"
  | "profileLabel"
  | "notificationsLabel"
  | "attendanceLabel"
  | "salaryLabel"
  | "logout"
  | "myInbox"
  | "waitingForAction"
  | "allClear"
  | "openInbox"
  | "more"
  | "installApp"
  | "installBizhTitle"
  | "installBizhDescription"
  | "iosStep1Prefix"
  | "iosStep1Suffix"
  | "iosStep2Prefix"
  | "iosStep2Bold"
  | "iosStep3Prefix"
  | "iosStep3Bold"
  | "iosStep3Suffix";

export const topbarDict: Dictionary<TopbarKey> = {
  he: {
    myAccount: "החשבון שלי",
    userFallback: "משתמש",
    profileLabel: "פרופיל",
    notificationsLabel: "התראות",
    attendanceLabel: "נוכחות",
    salaryLabel: "משכורת",
    logout: "התנתקות",
    myInbox: "התיבה שלי",
    waitingForAction: "ממתינים לטיפול",
    allClear: "הכול נקי.",
    openInbox: "פתח את התיבה",
    more: "עוד",
    installApp: "התקנת האפליקציה",
    installBizhTitle: "התקנת BizH",
    installBizhDescription: "באייפון ובאייפד, ספארי מתקין אפליקציות מתפריט השיתוף במקום להציג חלון קופץ.",
    iosStep1Prefix: "1. הקישו על כפתור השיתוף",
    iosStep1Suffix: "בספארי.",
    iosStep2Prefix: "2. בחרו באפשרות",
    iosStep2Bold: "הוספה למסך הבית",
    iosStep3Prefix: "3. הקישו על",
    iosStep3Bold: "הוספה",
    iosStep3Suffix: "כדי להוסיף את BizH למסך הבית.",
  },
  ar: {
    myAccount: "حسابي",
    userFallback: "مستخدم",
    profileLabel: "الملف الشخصي",
    notificationsLabel: "الإشعارات",
    attendanceLabel: "الحضور",
    salaryLabel: "الراتب",
    logout: "تسجيل الخروج",
    myInbox: "صندوق الوارد الخاص بي",
    waitingForAction: "بانتظار المعالجة",
    allClear: "لا يوجد شيء يتطلب المعالجة.",
    openInbox: "فتح صندوق الوارد",
    more: "المزيد",
    installApp: "تثبيت التطبيق",
    installBizhTitle: "تثبيت BizH",
    installBizhDescription: "على آيفون وآيباد، يقوم Safari بتثبيت التطبيقات من قائمة المشاركة بدلاً من عرض نافذة منبثقة.",
    iosStep1Prefix: "1. اضغط على زر المشاركة",
    iosStep1Suffix: "في Safari.",
    iosStep2Prefix: "2. اختر خيار",
    iosStep2Bold: "الإضافة إلى الشاشة الرئيسية",
    iosStep3Prefix: "3. اضغط على",
    iosStep3Bold: "إضافة",
    iosStep3Suffix: "لإضافة BizH إلى الشاشة الرئيسية.",
  },
};

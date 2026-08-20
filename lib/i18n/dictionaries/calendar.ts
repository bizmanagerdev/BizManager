import type { Dictionary } from "../types";

export type CalendarKey =
  | "scheduleLoadError"
  | "kindReminderLabel"
  | "kindReminderPlural"
  | "kindProjectLabel"
  | "kindProjectPlural"
  | "kindTaskLabel"
  | "kindTaskPlural"
  | "weekDaySun"
  | "weekDayMon"
  | "weekDayTue"
  | "weekDayWed"
  | "weekDayThu"
  | "weekDayFri"
  | "weekDaySat"
  | "optionsAria"
  | "searchPlaceholder"
  | "typeToSearchCalendar"
  | "noSearchResults"
  | "scopeMine"
  | "all"
  | "items"
  | "noItems"
  | "noItemsOfKind"
  | "noItemsThisDay"
  | "addToThisDay"
  | "addKindPrefix"
  | "viewDetails"
  | "addEvent";

export const calendarDict: Dictionary<CalendarKey> = {
  he: {
    scheduleLoadError: "שגיאה בטעינת לוח הזמנים",
    kindReminderLabel: "תזכורת",
    kindReminderPlural: "תזכורות",
    kindProjectLabel: "פרויקט",
    kindProjectPlural: "פרויקטים",
    kindTaskLabel: "משימה",
    kindTaskPlural: "משימות",
    weekDaySun: "ראשון",
    weekDayMon: "שני",
    weekDayTue: "שלישי",
    weekDayWed: "רביעי",
    weekDayThu: "חמישי",
    weekDayFri: "שישי",
    weekDaySat: "שבת",
    optionsAria: "אפשרויות",
    searchPlaceholder: "חיפוש...",
    typeToSearchCalendar: "הקלד כדי לחפש ביומן",
    noSearchResults: "לא נמצאו תוצאות",
    scopeMine: "שלי",
    all: "הכל",
    items: "פריטים",
    noItems: "אין פריטים",
    noItemsOfKind: "אין פריטים מסוג זה",
    noItemsThisDay: "אין פריטים ביום זה",
    addToThisDay: "הוספה ליום זה",
    addKindPrefix: "הוסף",
    viewDetails: "ראה פרטים",
    addEvent: "הוסף אירוע",
  },
  ar: {
    scheduleLoadError: "خطأ في تحميل الجدول الزمني",
    kindReminderLabel: "تذكير",
    kindReminderPlural: "تذكيرات",
    kindProjectLabel: "مشروع",
    kindProjectPlural: "مشاريع",
    kindTaskLabel: "مهمة",
    kindTaskPlural: "مهام",
    weekDaySun: "الأحد",
    weekDayMon: "الاثنين",
    weekDayTue: "الثلاثاء",
    weekDayWed: "الأربعاء",
    weekDayThu: "الخميس",
    weekDayFri: "الجمعة",
    weekDaySat: "السبت",
    optionsAria: "خيارات",
    searchPlaceholder: "بحث...",
    typeToSearchCalendar: "اكتب للبحث في التقويم",
    noSearchResults: "لم يتم العثور على نتائج",
    scopeMine: "الخاصة بي",
    all: "الكل",
    items: "عناصر",
    noItems: "لا توجد عناصر",
    noItemsOfKind: "لا توجد عناصر من هذا النوع",
    noItemsThisDay: "لا توجد عناصر في هذا اليوم",
    addToThisDay: "إضافة إلى هذا اليوم",
    addKindPrefix: "إضافة",
    viewDetails: "عرض التفاصيل",
    addEvent: "إضافة حدث",
  },
};

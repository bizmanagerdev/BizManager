import type { Dictionary } from "../types";

// Generic chrome reused across worker-facing pages (buttons, states, etc.).
// Domain pages should import from here for these; anything more specific
// belongs in the domain's own dictionary file.
export type CommonKey =
  | "save"
  | "cancel"
  | "delete"
  | "edit"
  | "close"
  | "confirm"
  | "add"
  | "search"
  | "loading"
  | "error"
  | "noResults"
  | "back"
  | "next"
  | "yes"
  | "no"
  | "today"
  | "viewMore"
  | "required";

export const commonDict: Dictionary<CommonKey> = {
  he: {
    save: "שמירה",
    cancel: "ביטול",
    delete: "מחיקה",
    edit: "עריכה",
    close: "סגירה",
    confirm: "אישור",
    add: "הוספה",
    search: "חיפוש",
    loading: "טוען…",
    error: "שגיאה",
    noResults: "אין תוצאות",
    back: "חזרה",
    next: "הבא",
    yes: "כן",
    no: "לא",
    today: "היום",
    viewMore: "הצג עוד",
    required: "שדה חובה",
  },
  ar: {
    save: "حفظ",
    cancel: "إلغاء",
    delete: "حذف",
    edit: "تعديل",
    close: "إغلاق",
    confirm: "تأكيد",
    add: "إضافة",
    search: "بحث",
    loading: "جارٍ التحميل…",
    error: "خطأ",
    noResults: "لا توجد نتائج",
    back: "رجوع",
    next: "التالي",
    yes: "نعم",
    no: "لا",
    today: "اليوم",
    viewMore: "عرض المزيد",
    required: "حقل مطلوب",
  },
};

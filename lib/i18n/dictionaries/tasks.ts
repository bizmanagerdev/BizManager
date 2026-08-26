import type { Dictionary } from "../types";

export type TasksKey =
  | "pageTitle"
  | "todoSuffix"
  | "markDoneAria"
  | "undoDoneAria"
  | "undoDoneTitle"
  | "markDoneTitleBoard"
  | "privateTaskCardTitle"
  | "attachmentOneTitle"
  | "attachmentCountSuffix"
  | "quickAddPlaceholder"
  | "addingEllipsis"
  | "addCountPrefix"
  | "dictateQuickAddTitle"
  | "linesCountMid"
  | "tasksWord"
  | "dragListAria"
  | "addCardLabel"
  | "emptyColumnText"
  | "updateStatusOfflineLabel"
  | "toastErrorUpdateStatus"
  | "taskFallbackWord"
  | "markedDoneSuffix"
  | "markedUndoneSuffix"
  | "deleteTaskLabel"
  | "toastErrorDeleteTask"
  | "toastTaskDeleted"
  | "newTaskLabel"
  | "toastTaskCreatedSingle"
  | "createdCountPrefix"
  | "tasksNotCreatedSuffix"
  | "toastErrorCreateTask"
  | "scopeLabel"
  | "scopeMine"
  | "allWord"
  | "priorityLabel"
  | "domainLabel"
  | "linkedProjectLabel"
  | "linkedPropertyLabel"
  | "allProjectsLabel"
  | "searchProjectPlaceholder"
  | "filterByPropertyAria"
  | "allPropertiesLabel"
  | "searchPropertyPlaceholder"
  | "searchPlaceholder"
  | "filtersLabel"
  | "recurringTasksLabel"
  | "hideFiltersAria"
  | "showFiltersAria"
  | "closeFiltersAria"
  | "overviewBackAria"
  | "overviewShowAllAria"
  | "moveToListLabel"
  | "openLabel"
  | "deleteTheTaskButtonLabel"
  | "moveToEllipsisLabel"
  | "taskWord"
  | "confirmDeleteTaskPrefix"
  | "confirmDeleteTaskSuffix"
  | "loadTaskErrorFallback"
  | "taskNotFoundError"
  | "updatePrivacyOfflineLabel"
  | "toastErrorUpdatePrivacy"
  | "toastPrivacyOn"
  | "toastPrivacyOff"
  | "tasksFailedRetrySuffix"
  | "filesNotAttachedManual"
  | "filesNotAttachedOffline"
  | "updateTaskOfflineLabel"
  | "toastErrorUpdateTask"
  | "toastTaskUpdated"
  | "addCommentOfflineLabel"
  | "toastErrorAddComment"
  | "addReminderOfflineLabel"
  | "toastErrorAddReminder"
  | "toastReminderAdded"
  | "updateReminderOfflineLabel"
  | "toastErrorUpdateReminder"
  | "toastReminderUpdated"
  | "markReminderDoneOfflineLabel"
  | "cancelReminderOfflineLabel"
  | "filesNotAttachedCard"
  | "fileUploadedSingle"
  | "filesUploadedCountSuffix"
  | "filesUploadedPlural"
  | "someFilesFailedUpload"
  | "toastErrorUploadFile"
  | "deleteFileOfflineLabel"
  | "toastErrorDeleteFile"
  | "toastFileDeleted"
  | "dialogTitleEdit"
  | "sectionDescription"
  | "sectionDomain"
  | "sectionDates"
  | "sectionPeople"
  | "sectionLabels"
  | "sectionLocation"
  | "sectionReminders"
  | "sectionFiles"
  | "sectionComments"
  | "sectionHistory"
  | "createdAtLabel"
  | "updatedAtLabel"
  | "subjectPlaceholder"
  | "dictateSubjectTitle"
  | "cancelPrivateAria"
  | "makePrivateAria"
  | "privateActiveTitle"
  | "privateInactiveTitle"
  | "privateStaticLabel"
  | "dialogDescriptionSr"
  | "loadingTaskData"
  | "nextButton"
  | "savingEllipsis"
  | "saveChangesButton"
  | "createButton"
  | "splitAskTitleSuffix"
  | "splitAskDescription"
  | "oneTaskButton"
  | "creatingEllipsis"
  | "createCountPrefix"
  | "splitAskFooterNote"
  | "confirmDeleteAttachmentPrefix"
  | "confirmDeleteAttachmentSuffix"
  | "discardTitle"
  | "discardDescription"
  | "discardConfirmLabel"
  | "discardCancelLabel"
  | "descriptionPlaceholder"
  | "businessDomainLabel"
  | "chooseProjectLabel"
  | "chooseProjectOption"
  | "choosePropertyLabel"
  | "choosePropertyOption"
  | "linkedCustomerLabel"
  | "noCustomerLabel"
  | "searchCustomerPlaceholder"
  | "noCustomersFoundLabel"
  | "dueDateLabel"
  | "timeLabel"
  | "assignedLabel"
  | "chooseUserOption"
  | "addSelfAsMemberLabel"
  | "additionalMembersLabel"
  | "removeMemberAriaPrefix"
  | "addMembersSummary"
  | "noUsersAvailable"
  | "cityLabel"
  | "chooseCityOption"
  | "cityFreeTextLabel"
  | "addressLabel"
  | "attachFileLabel"
  | "takePhotoLabel"
  | "filesCanAttachNowNote"
  | "removeFileAriaPrefix"
  | "filesWillUploadSuffix"
  | "noAttachmentsLabel"
  | "uploadingLabel"
  | "videoWord"
  | "fileWord"
  | "uploadedByPrefix"
  | "statusFieldLabel"
  | "reminderDeleteLabel"
  | "remindersCanAddNowNote"
  | "reminderTimeLabel"
  | "reminderNoteLabel"
  | "addReminderButton"
  | "noPendingRemindersLabel"
  | "editReminderLabel"
  | "reminderDoneButton"
  | "reminderCancelButton"
  | "cancelEditLabel"
  | "updateReminderButton"
  | "noCommentsLabel"
  | "unknownUserWord"
  | "commentPlaceholder"
  | "addCommentButton";

export const tasksDict: Dictionary<TasksKey> = {
  he: {
    pageTitle: "משימות",
    todoSuffix: "לביצוע",
    markDoneAria: "סימון כבוצע",
    undoDoneAria: "החזרה ללביצוע",
    undoDoneTitle: "החזרה ל'לביצוע'",
    markDoneTitleBoard: "סימון כבוצע — העברה ל'בוצע'",
    privateTaskCardTitle: "משימה פרטית — רק את/ה רואה אותה",
    attachmentOneTitle: "קובץ אחד מצורף",
    attachmentCountSuffix: "קבצים מצורפים",
    quickAddPlaceholder: "כותרת המשימה",
    addingEllipsis: "מוסיף...",
    addCountPrefix: "הוספת",
    dictateQuickAddTitle: "הכתבת כותרת — אפשר להקריא כמה משימות ברצף",
    linesCountMid: "שורות — ייווצרו",
    tasksWord: "משימות",
    dragListAria: "גרירת רשימה",
    addCardLabel: "הוספת כרטיס",
    emptyColumnText: "אין משימות ברשימה הזו.",
    updateStatusOfflineLabel: "עדכון סטטוס משימה",
    toastErrorUpdateStatus: "שגיאה בעדכון סטטוס",
    taskFallbackWord: "המשימה",
    markedDoneSuffix: "סומנה כבוצע",
    markedUndoneSuffix: "הוחזרה ללביצוע",
    deleteTaskLabel: "מחיקת משימה",
    toastErrorDeleteTask: "שגיאה במחיקת משימה",
    toastTaskDeleted: "המשימה נמחקה",
    newTaskLabel: "משימה חדשה",
    toastTaskCreatedSingle: "המשימה נוצרה",
    createdCountPrefix: "נוצרו",
    tasksNotCreatedSuffix: "משימות לא נוצרו",
    toastErrorCreateTask: "שגיאה ביצירת משימה",
    scopeLabel: "היקף",
    scopeMine: "שלי",
    allWord: "הכל",
    priorityLabel: "עדיפות",
    domainLabel: "דומיין",
    linkedProjectLabel: "פרויקט",
    linkedPropertyLabel: "נכס",
    allProjectsLabel: "כל הפרויקטים",
    searchProjectPlaceholder: "חיפוש פרויקט...",
    filterByPropertyAria: "סינון לפי נכס",
    allPropertiesLabel: "כל הנכסים",
    searchPropertyPlaceholder: "חיפוש נכס...",
    searchPlaceholder: "חיפוש...",
    filtersLabel: "מסננים",
    recurringTasksLabel: "משימות קבועות",
    hideFiltersAria: "הסתרת מסננים",
    showFiltersAria: "הצגת מסננים",
    closeFiltersAria: "סגירת מסננים",
    overviewBackAria: "חזרה לתצוגה רגילה",
    overviewShowAllAria: "הצגת כל הרשימה במסך אחד",
    moveToListLabel: "העברה לרשימה",
    openLabel: "פתיחה",
    deleteTheTaskButtonLabel: "מחיקת המשימה",
    moveToEllipsisLabel: "העברה ל…",
    taskWord: "משימה",
    confirmDeleteTaskPrefix: "למחוק את המשימה",
    confirmDeleteTaskSuffix: "? לא ניתן לשחזר משימה שנמחקה.",
    loadTaskErrorFallback: "טעינת המשימה נכשלה.",
    taskNotFoundError: "המשימה לא נמצאה.",
    updatePrivacyOfflineLabel: "עדכון פרטיות",
    toastErrorUpdatePrivacy: "שגיאה בעדכון פרטיות",
    toastPrivacyOn: "המשימה הפכה לפרטית",
    toastPrivacyOff: "המשימה אינה פרטית יותר",
    tasksFailedRetrySuffix: "משימות לא נוצרו — נסה שוב",
    filesNotAttachedManual: "הקבצים לא צורפו — אפשר לצרף אותם לכרטיס המתאים",
    filesNotAttachedOffline: "הקבצים לא צורפו — המשימה תיווצר כשהחיבור יחזור",
    updateTaskOfflineLabel: "עדכון משימה",
    toastErrorUpdateTask: "שגיאה בעדכון משימה",
    toastTaskUpdated: "המשימה עודכנה",
    addCommentOfflineLabel: "תגובה למשימה",
    toastErrorAddComment: "שגיאה בהוספת תגובה",
    addReminderOfflineLabel: "תזכורת למשימה",
    toastErrorAddReminder: "שגיאה בהוספת תזכורת",
    toastReminderAdded: "התזכורת נוספה",
    updateReminderOfflineLabel: "עדכון תזכורת",
    toastErrorUpdateReminder: "שגיאה בעדכון תזכורת",
    toastReminderUpdated: "התזכורת עודכנה",
    markReminderDoneOfflineLabel: "סימון תזכורת כבוצעה",
    cancelReminderOfflineLabel: "ביטול תזכורת",
    filesNotAttachedCard: "הקבצים לא צורפו — המשימה נוצרה, אפשר לצרף אותם מהכרטיס",
    fileUploadedSingle: "הקובץ הועלה",
    filesUploadedCountSuffix: "קבצים הועלו",
    filesUploadedPlural: "הקבצים הועלו",
    someFilesFailedUpload: "חלק מהקבצים לא הועלו",
    toastErrorUploadFile: "שגיאה בהעלאת קובץ",
    deleteFileOfflineLabel: "מחיקת קובץ",
    toastErrorDeleteFile: "שגיאה במחיקת קובץ",
    toastFileDeleted: "הקובץ נמחק",
    dialogTitleEdit: "כרטיס משימה",
    sectionDescription: "תיאור",
    sectionDomain: "תחום",
    sectionDates: "תאריך",
    sectionPeople: "אחראי וחברים",
    sectionLabels: "עדיפות וסטטוס",
    sectionLocation: "מיקום",
    sectionReminders: "תזכורות",
    sectionFiles: "קבצים ותמונות",
    sectionComments: "תגובות",
    subjectPlaceholder: "שם המשימה",
    dictateSubjectTitle: "הכתבת שם המשימה — אפשר להקריא כמה משימות ברצף",
    cancelPrivateAria: "ביטול משימה פרטית",
    makePrivateAria: "הפיכה למשימה פרטית",
    privateActiveTitle: "משימה פרטית — רק את/ה רואה אותה. לחצו כדי לבטל",
    privateInactiveTitle: "הפיכה לפרטית — רק את/ה תראו את המשימה",
    privateStaticLabel: "משימה פרטית",
    dialogDescriptionSr: "פרטי המשימה",
    loadingTaskData: "טוען נתוני משימה...",
    nextButton: "הבא ›",
    savingEllipsis: "שומר...",
    saveChangesButton: "שמירת שינויים",
    createButton: "יצירה",
    splitAskTitleSuffix: "שורות בשם המשימה",
    splitAskDescription: "ליצור משימה נפרדת לכל שורה, או משימה אחת?",
    oneTaskButton: "משימה אחת",
    creatingEllipsis: "יוצר…",
    createCountPrefix: "צור",
    splitAskFooterNote: "כל המשימות יקבלו את אותו אחראי, תאריך ושאר הפרטים שמילאת.",
    confirmDeleteAttachmentPrefix: "למחוק את הקובץ",
    confirmDeleteAttachmentSuffix: "? הקובץ יוסר לצמיתות.",
    discardTitle: "יציאה בלי לשמור",
    discardDescription: "המשימה עדיין לא נשמרה. לצאת בלי לשמור?",
    discardConfirmLabel: "יציאה בלי שמירה",
    discardCancelLabel: "חזרה לעריכה",
    descriptionPlaceholder: "הוסיפו תיאור מפורט...",
    businessDomainLabel: "תחום עסקי",
    chooseProjectLabel: "פרויקט *",
    chooseProjectOption: "בחר פרויקט...",
    choosePropertyLabel: "נכס *",
    choosePropertyOption: "בחר נכס...",
    linkedCustomerLabel: "לקוח מקושר",
    noCustomerLabel: "ללא לקוח",
    searchCustomerPlaceholder: "חיפוש לקוח...",
    noCustomersFoundLabel: "לא נמצאו לקוחות לחיפוש הזה.",
    dueDateLabel: "תאריך יעד",
    timeLabel: "שעה",
    assignedLabel: "אחראי",
    chooseUserOption: "בחר משתמש...",
    addSelfAsMemberLabel: "הוסף גם אותי כחבר במשימה",
    additionalMembersLabel: "חברים נוספים",
    removeMemberAriaPrefix: "הסר",
    addMembersSummary: "הוספת חברים",
    noUsersAvailable: "אין משתמשים זמינים.",
    cityLabel: "עיר",
    chooseCityOption: "בחר עיר...",
    cityFreeTextLabel: "עיר (הקלדה חופשית)",
    addressLabel: "כתובת",
    attachFileLabel: "צירוף קובץ",
    takePhotoLabel: "צילום",
    filesCanAttachNowNote: "אפשר לצרף קבצים כבר עכשיו — הם יועלו עם יצירת המשימה.",
    removeFileAriaPrefix: "הסרת",
    filesWillUploadSuffix: "קבצים יועלו עם השמירה",
    noAttachmentsLabel: "אין קבצים מצורפים.",
    uploadingLabel: "מעלה...",
    videoWord: "וידאו",
    fileWord: "קובץ",
    uploadedByPrefix: "הועלה ע\"י",
    statusFieldLabel: "סטטוס",
    reminderDeleteLabel: "הסרת תזכורת",
    remindersCanAddNowNote: "אפשר להוסיף תזכורות כבר עכשיו — הן ייווצרו עם המשימה.",
    reminderTimeLabel: "מועד התזכורת",
    reminderNoteLabel: "הערה (אופציונלי)",
    addReminderButton: "הוספת תזכורת",
    noPendingRemindersLabel: "אין תזכורות פעילות.",
    editReminderLabel: "עריכת תזכורת",
    reminderDoneButton: "בוצע",
    reminderCancelButton: "ביטול",
    cancelEditLabel: "ביטול עריכה",
    updateReminderButton: "עדכון תזכורת",
    noCommentsLabel: "אין תגובות עדיין.",
    unknownUserWord: "משתמש",
    commentPlaceholder: "כתבו תגובה...",
    addCommentButton: "הוספת תגובה",
    sectionHistory: "היסטוריה",
    createdAtLabel: "נוצר",
    updatedAtLabel: "עודכן",
  },
  ar: {
    pageTitle: "المهام",
    todoSuffix: "للتنفيذ",
    markDoneAria: "تحديد كمنجز",
    undoDoneAria: "إرجاع لقيد التنفيذ",
    undoDoneTitle: "إرجاع إلى 'للتنفيذ'",
    markDoneTitleBoard: "تحديد كمنجز — نقل إلى 'منجز'",
    privateTaskCardTitle: "مهمة خاصة — أنت فقط تراها",
    attachmentOneTitle: "ملف واحد مرفق",
    attachmentCountSuffix: "ملفات مرفقة",
    quickAddPlaceholder: "عنوان المهمة",
    addingEllipsis: "جارٍ الإضافة...",
    addCountPrefix: "إضافة",
    dictateQuickAddTitle: "إملاء عنوان — يمكن إملاء عدة مهام تباعاً",
    linesCountMid: "أسطر — سيتم إنشاء",
    tasksWord: "مهام",
    dragListAria: "سحب القائمة",
    addCardLabel: "إضافة بطاقة",
    emptyColumnText: "لا توجد مهام في هذه القائمة.",
    updateStatusOfflineLabel: "تحديث حالة المهمة",
    toastErrorUpdateStatus: "خطأ في تحديث الحالة",
    taskFallbackWord: "المهمة",
    markedDoneSuffix: "تم تحديدها كمنجزة",
    markedUndoneSuffix: "أعيدت إلى قيد التنفيذ",
    deleteTaskLabel: "حذف المهمة",
    toastErrorDeleteTask: "خطأ في حذف المهمة",
    toastTaskDeleted: "تم حذف المهمة",
    newTaskLabel: "مهمة جديدة",
    toastTaskCreatedSingle: "تم إنشاء المهمة",
    createdCountPrefix: "تم إنشاء",
    tasksNotCreatedSuffix: "مهام لم يتم إنشاؤها",
    toastErrorCreateTask: "خطأ في إنشاء المهمة",
    scopeLabel: "النطاق",
    scopeMine: "مهامي",
    allWord: "الكل",
    priorityLabel: "الأولوية",
    domainLabel: "المجال",
    linkedProjectLabel: "مشروع",
    linkedPropertyLabel: "عقار",
    allProjectsLabel: "كل المشاريع",
    searchProjectPlaceholder: "بحث عن مشروع...",
    filterByPropertyAria: "تصفية حسب العقار",
    allPropertiesLabel: "كل العقارات",
    searchPropertyPlaceholder: "بحث عن عقار...",
    searchPlaceholder: "بحث...",
    filtersLabel: "عوامل التصفية",
    recurringTasksLabel: "مهام دورية",
    hideFiltersAria: "إخفاء عوامل التصفية",
    showFiltersAria: "عرض عوامل التصفية",
    closeFiltersAria: "إغلاق عوامل التصفية",
    overviewBackAria: "العودة للعرض العادي",
    overviewShowAllAria: "عرض القائمة كاملة على الشاشة",
    moveToListLabel: "نقل إلى قائمة",
    openLabel: "فتح",
    deleteTheTaskButtonLabel: "حذف المهمة",
    moveToEllipsisLabel: "نقل إلى…",
    taskWord: "مهمة",
    confirmDeleteTaskPrefix: "هل تريد حذف المهمة",
    confirmDeleteTaskSuffix: "؟ لا يمكن استرجاع مهمة تم حذفها.",
    loadTaskErrorFallback: "فشل تحميل المهمة.",
    taskNotFoundError: "المهمة غير موجودة.",
    updatePrivacyOfflineLabel: "تحديث الخصوصية",
    toastErrorUpdatePrivacy: "خطأ في تحديث الخصوصية",
    toastPrivacyOn: "أصبحت المهمة خاصة",
    toastPrivacyOff: "لم تعد المهمة خاصة",
    tasksFailedRetrySuffix: "مهام لم يتم إنشاؤها — حاول مجدداً",
    filesNotAttachedManual: "لم يتم إرفاق الملفات — يمكن إرفاقها بالبطاقة المناسبة",
    filesNotAttachedOffline: "لم يتم إرفاق الملفات — ستُنشأ المهمة عند عودة الاتصال",
    updateTaskOfflineLabel: "تحديث المهمة",
    toastErrorUpdateTask: "خطأ في تحديث المهمة",
    toastTaskUpdated: "تم تحديث المهمة",
    addCommentOfflineLabel: "تعليق على المهمة",
    toastErrorAddComment: "خطأ في إضافة التعليق",
    addReminderOfflineLabel: "تذكير للمهمة",
    toastErrorAddReminder: "خطأ في إضافة التذكير",
    toastReminderAdded: "تمت إضافة التذكير",
    updateReminderOfflineLabel: "تحديث التذكير",
    toastErrorUpdateReminder: "خطأ في تحديث التذكير",
    toastReminderUpdated: "تم تحديث التذكير",
    markReminderDoneOfflineLabel: "تحديد التذكير كمنجز",
    cancelReminderOfflineLabel: "إلغاء التذكير",
    filesNotAttachedCard: "لم يتم إرفاق الملفات — تم إنشاء المهمة، يمكن إرفاقها من البطاقة",
    fileUploadedSingle: "تم رفع الملف",
    filesUploadedCountSuffix: "ملفات تم رفعها",
    filesUploadedPlural: "تم رفع الملفات",
    someFilesFailedUpload: "بعض الملفات لم يتم رفعها",
    toastErrorUploadFile: "خطأ في رفع الملف",
    deleteFileOfflineLabel: "حذف الملف",
    toastErrorDeleteFile: "خطأ في حذف الملف",
    toastFileDeleted: "تم حذف الملف",
    dialogTitleEdit: "بطاقة المهمة",
    sectionDescription: "الوصف",
    sectionDomain: "المجال",
    sectionDates: "التاريخ",
    sectionPeople: "المسؤول والأعضاء",
    sectionLabels: "الأولوية والحالة",
    sectionLocation: "الموقع",
    sectionReminders: "التذكيرات",
    sectionFiles: "الملفات والصور",
    sectionComments: "التعليقات",
    subjectPlaceholder: "اسم المهمة",
    dictateSubjectTitle: "إملاء اسم المهمة — يمكن إملاء عدة مهام تباعاً",
    cancelPrivateAria: "إلغاء الخصوصية",
    makePrivateAria: "تحويل إلى مهمة خاصة",
    privateActiveTitle: "مهمة خاصة — أنت فقط تراها. اضغط للإلغاء",
    privateInactiveTitle: "تحويل إلى خاصة — أنت فقط سترى المهمة",
    privateStaticLabel: "مهمة خاصة",
    dialogDescriptionSr: "تفاصيل المهمة",
    loadingTaskData: "جارٍ تحميل بيانات المهمة...",
    nextButton: "التالي ›",
    savingEllipsis: "جارٍ الحفظ...",
    saveChangesButton: "حفظ التغييرات",
    createButton: "إنشاء",
    splitAskTitleSuffix: "أسطر في اسم المهمة",
    splitAskDescription: "هل تريد إنشاء مهمة منفصلة لكل سطر، أم مهمة واحدة؟",
    oneTaskButton: "مهمة واحدة",
    creatingEllipsis: "جارٍ الإنشاء…",
    createCountPrefix: "إنشاء",
    splitAskFooterNote: "ستحصل جميع المهام على نفس المسؤول والتاريخ وباقي التفاصيل التي أدخلتها.",
    confirmDeleteAttachmentPrefix: "هل تريد حذف الملف",
    confirmDeleteAttachmentSuffix: "؟ سيُحذف الملف نهائياً.",
    discardTitle: "الخروج بدون حفظ",
    discardDescription: "لم يتم حفظ المهمة بعد. هل تريد الخروج بدون حفظ؟",
    discardConfirmLabel: "خروج بدون حفظ",
    discardCancelLabel: "العودة للتحرير",
    descriptionPlaceholder: "أضف وصفاً مفصلاً...",
    businessDomainLabel: "المجال التجاري",
    chooseProjectLabel: "مشروع *",
    chooseProjectOption: "اختر مشروعاً...",
    choosePropertyLabel: "عقار *",
    choosePropertyOption: "اختر عقاراً...",
    linkedCustomerLabel: "عميل مرتبط",
    noCustomerLabel: "بدون عميل",
    searchCustomerPlaceholder: "بحث عن عميل...",
    noCustomersFoundLabel: "لم يتم العثور على عملاء لهذا البحث.",
    dueDateLabel: "تاريخ الاستحقاق",
    timeLabel: "الوقت",
    assignedLabel: "المسؤول",
    chooseUserOption: "اختر مستخدماً...",
    addSelfAsMemberLabel: "أضفني أيضاً كعضو في المهمة",
    additionalMembersLabel: "أعضاء إضافيون",
    removeMemberAriaPrefix: "إزالة",
    addMembersSummary: "إضافة أعضاء",
    noUsersAvailable: "لا يوجد مستخدمون متاحون.",
    cityLabel: "المدينة",
    chooseCityOption: "اختر مدينة...",
    cityFreeTextLabel: "المدينة (إدخال حر)",
    addressLabel: "العنوان",
    attachFileLabel: "إرفاق ملف",
    takePhotoLabel: "تصوير",
    filesCanAttachNowNote: "يمكن إرفاق الملفات الآن — سيتم رفعها مع إنشاء المهمة.",
    removeFileAriaPrefix: "إزالة",
    filesWillUploadSuffix: "ملفات سيتم رفعها مع الحفظ",
    noAttachmentsLabel: "لا توجد ملفات مرفقة.",
    uploadingLabel: "جارٍ الرفع...",
    videoWord: "فيديو",
    fileWord: "ملف",
    uploadedByPrefix: "تم الرفع بواسطة",
    statusFieldLabel: "الحالة",
    reminderDeleteLabel: "إزالة التذكير",
    remindersCanAddNowNote: "يمكن إضافة تذكيرات الآن — ستُنشأ مع المهمة.",
    reminderTimeLabel: "موعد التذكير",
    reminderNoteLabel: "ملاحظة (اختياري)",
    addReminderButton: "إضافة تذكير",
    noPendingRemindersLabel: "لا توجد تذكيرات نشطة.",
    editReminderLabel: "تعديل التذكير",
    reminderDoneButton: "تم",
    reminderCancelButton: "إلغاء",
    cancelEditLabel: "إلغاء التعديل",
    updateReminderButton: "تحديث التذكير",
    noCommentsLabel: "لا توجد تعليقات بعد.",
    unknownUserWord: "مستخدم",
    commentPlaceholder: "اكتب تعليقاً...",
    addCommentButton: "إضافة تعليق",
    sectionHistory: "السجل",
    createdAtLabel: "أُنشئ",
    updatedAtLabel: "آخر تحديث",
  },
};

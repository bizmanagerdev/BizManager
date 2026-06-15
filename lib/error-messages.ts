// Translate common server / database / network error messages to Hebrew.
// Use anywhere a raw error from fetch / Supabase / thrown Error might be shown to the user.

const EXACT_MATCH: Record<string, string> = {
  "Unknown error": "אירעה שגיאה לא צפויה.",
  "Request failed.": "הבקשה נכשלה.",
  "Request failed": "הבקשה נכשלה.",
  "Failed to fetch": "אין חיבור לשרת. נסו שוב.",
  "Network request failed": "אין חיבור לשרת. נסו שוב.",
  "Load failed": "הטעינה נכשלה. נסו שוב.",
  "Upload failed": "העלאת הקובץ נכשלה.",
  "Missing id": "מזהה חסר.",
  "Missing category or amount": "יש להזין קטגוריה וסכום.",
  "Missing expense_date": "יש להזין תאריך.",
  "Missing or invalid business_domain": "יש לבחור תחום עסקי.",
  "Invalid business_domain for linked expense": "תחום עסקי לא תואם להוצאה המקושרת.",
  "Invalid project_id": "הפרויקט שנבחר לא קיים.",
  "Invalid order_id": "ההזמנה שנבחרה לא קיימת.",
  "Invalid property_id": "הנכס שנבחר לא קיים.",
  "Expense not found": "ההוצאה לא נמצאה.",
  "Expense not found for project": "ההוצאה לא משויכת לפרויקט שנבחר.",
  "Expense not found for order": "ההוצאה לא משויכת להזמנה שנבחרה.",
  "Expense not found for property": "ההוצאה לא משויכת לנכס שנבחר.",
  "Only one of project_id, order_id, or property_id can be provided":
    "ניתן לשייך הוצאה למקור אחד בלבד (פרויקט / הזמנה / נכס).",
  "Failed to create expense": "יצירת ההוצאה נכשלה.",
  "This worker type does not use sessions.": "סוג העובד הזה לא מתעד משמרות.",
  "Forbidden": "אין הרשאה לבצע פעולה זו.",
  "Unauthorized": "יש להתחבר מחדש.",
  "Not Found": "המשאב לא נמצא.",
  "Internal Server Error": "שגיאת שרת. נסו שוב מאוחר יותר.",
  "Bad Request": "הבקשה לא תקינה.",
  // Auth / access (requireRouteAccess)
  "No access": "אין לך הרשאת גישה.",
  "No user profile access": "אין הרשאת גישה למשתמש.",
  "Insufficient role": "אין לך הרשאה לפעולה זו.",
  // Common validation / lookup errors returned by API routes
  "Missing required fields": "יש למלא את כל שדות החובה.",
  "Missing order_id": "חסר מזהה הזמנה.",
  "Missing customer_id": "חסר מזהה לקוח.",
  "Missing full_name": "יש להזין שם מלא.",
  "Missing remind_at": "יש לבחור תאריך לתזכורת.",
  "Missing task_id or message": "חסר תוכן להוספה.",
  "Missing payment_date or payment_method": "יש להזין תאריך ואמצעי תשלום.",
  "Missing due_date for check payment": "יש להזין תאריך פירעון לצ'ק.",
  "Missing payment amount, date, or method": "יש להזין סכום, תאריך ואמצעי תשלום.",
  "Order not found": "ההזמנה לא נמצאה.",
  "Project not found": "הפרויקט לא נמצא.",
  "Property not found": "הנכס לא נמצא.",
  "Invalid customer_id": "הלקוח שנבחר אינו תקין.",
  "Invalid project_type": "סוג הפרויקט אינו תקין.",
  "Invalid prices": "המחירים שהוזנו אינם תקינים.",
  "Invalid linked target for selected business_domain":
    "השיוך אינו תואם לתחום העסקי שנבחר.",
  "Contact was not created": "יצירת איש הקשר נכשלה.",
  "Project was not created": "יצירת הפרויקט נכשלה.",
  "offline": "אין חיבור לאינטרנט. הפעולה תישלח כשיחזור החיבור.",
};

const PATTERN_RULES: Array<{ test: RegExp; hebrew: string }> = [
  {
    test: /duplicate key value violates unique constraint/i,
    hebrew: "הערך כבר קיים במערכת.",
  },
  {
    test: /violates foreign key constraint/i,
    hebrew: "לא ניתן לבצע את הפעולה — קיים קישור לרשומה אחרת.",
  },
  {
    test: /violates not-null constraint.*column "([^"]+)"/i,
    hebrew: "חסר שדה חובה.",
  },
  {
    test: /violates row-level security/i,
    hebrew: "אין הרשאה לבצע את הפעולה.",
  },
  {
    test: /permission denied/i,
    hebrew: "אין הרשאה לבצע את הפעולה.",
  },
  {
    test: /jwt|invalid token|session expired/i,
    hebrew: "פג תוקף החיבור. יש להתחבר מחדש.",
  },
  {
    test: /timeout|timed out/i,
    hebrew: "התשובה מהשרת איחרה. נסו שוב.",
  },
  {
    test: /network|networkerror|connection|econnrefused/i,
    hebrew: "אין חיבור לשרת. נסו שוב.",
  },
  {
    test: /invalid input syntax/i,
    hebrew: "אחד הערכים שהוזנו לא בפורמט תקין.",
  },
  {
    test: /value too long/i,
    hebrew: "אחד הערכים ארוך מדי.",
  },
  {
    test: /Missing or invalid/i,
    hebrew: "אחד השדות חסר או לא תקין.",
  },
  {
    test: /^Authentication error/i,
    hebrew: "שגיאת אימות. יש להתחבר מחדש.",
  },
  {
    test: /^Missing /i,
    hebrew: "חסר אחד משדות החובה.",
  },
  {
    test: /not found$/i,
    hebrew: "הפריט המבוקש לא נמצא.",
  },
  {
    test: /^Invalid /i,
    hebrew: "אחד הערכים שהוזנו אינו תקין.",
  },
];

function containsHebrew(text: string): boolean {
  return /[֐-׿]/.test(text);
}

export function toHebrewError(input: unknown, fallback = "אירעה שגיאה. נסו שוב."): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : input && typeof input === "object" && "error" in (input as Record<string, unknown>)
          ? String((input as Record<string, unknown>).error ?? "")
          : "";

  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  // Already in Hebrew — return as-is.
  if (containsHebrew(trimmed)) return trimmed;

  const exact = EXACT_MATCH[trimmed];
  if (exact) return exact;

  for (const rule of PATTERN_RULES) {
    if (rule.test.test(trimmed)) return rule.hebrew;
  }

  return fallback;
}

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
  "Contact was not updated": "עדכון איש הקשר נכשל.",
  "Contact not found": "איש הקשר לא נמצא.",
  "Contact name is required": "יש להזין שם איש קשר.",
  "Project was not created": "יצירת הפרויקט נכשלה.",
  "Project was not updated": "עדכון הפרויקט נכשל.",
  "Customer not found": "הלקוח לא נמצא.",
  "Customer name is required": "יש להזין שם לקוח.",
  "Customer was not updated": "עדכון פרטי הלקוח נכשל.",
  "offline": "אין חיבור לאינטרנט. הפעולה תישלח כשיחזור החיבור.",
  // Auth
  "Email and password are required.": "יש להזין דוא״ל וסיסמה.",
  "Invalid email or password.": "דוא״ל או סיסמה שגויים.",
  "User not found.": "המשתמש לא נמצא.",
  "User not found": "המשתמש לא נמצא.",
  "Role must be admin, office, worker or worker_no_access.": "התפקיד שנבחר אינו תקין.",
  "Full name is required.": "יש להזין שם מלא.",
  // Files / uploads
  "Empty file": "הקובץ ריק.",
  "Missing file": "יש לצרף קובץ.",
  "Unsupported business_domain": "תחום עסקי לא נתמך.",
  // Prices / validation
  "agreed_base_price must be >= 0": "מחיר הבסיס חייב להיות אפס או יותר.",
  "actual_price must be > 0": "המחיר בפועל חייב להיות גדול מאפס.",
  "Invalid date range": "טווח התאריכים אינו תקין.",
  "No fields to update": "אין שדות לעדכון.",
  "title required": "יש להזין כותרת.",
  "unknown type": "סוג לא ידוע.",
  "Unsupported action.": "פעולה לא נתמכת.",
  "Could not calculate split time": "לא ניתן לחשב את זמן הפיצול.",
  // Payments
  "Payment not found": "התשלום לא נמצא.",
  "Payment not found.": "התשלום לא נמצא.",
  "Payment not found for project": "התשלום לא נמצא עבור הפרויקט.",
  "Payment does not belong to this worker.": "התשלום אינו שייך לעובד זה.",
  "Valid amount is required.": "יש להזין סכום תקין.",
  "payment_date is required.": "יש להזין תאריך תשלום.",
  "payment_id is required.": "חסר מזהה תשלום.",
  "user_id is required.": "חסר מזהה משתמש.",
  "Failed to create payment.": "יצירת התשלום נכשלה.",
  "Failed to update payment.": "עדכון התשלום נכשל.",
  "Allocation total cannot exceed payment amount.": "סך ההקצאות לא יכול לעלות על סכום התשלום.",
  "Cannot allocate more than the remaining debt on an item.": "לא ניתן להקצות יותר מיתרת החוב של הפריט.",
  "One or more allocations do not belong to this worker.": "אחת ההקצאות אינה שייכת לעובד זה.",
  // Payroll – sessions
  "Worker not found.": "העובד לא נמצא.",
  "Worker not found": "העובד לא נמצא.",
  "Worker type does not use sessions.": "סוג העובד אינו מתעד משמרות.",
  "Session not found.": "המשמרת לא נמצאה.",
  "Saved session not found": "המשמרת שנשמרה לא נמצאה.",
  "Session is already closed.": "המשמרת כבר סגורה.",
  "Session is too short to split": "המשמרת קצרה מכדי לפצל אותה.",
  "This session belongs to a locked payroll period.": "המשמרת שייכת לתקופת שכר נעולה.",
  "This session overlaps another session.": "המשמרת חופפת למשמרת אחרת.",
  "Project is required for project work.": "יש לבחור פרויקט עבור עבודת פרויקט.",
  "Property is required for property work.": "יש לבחור נכס עבור עבודת נכס.",
  "Bill to customer amount is invalid.": "סכום החיוב ללקוח אינו תקין.",
  "Clock-out must be after clock-in.": "שעת הסיום חייבת להיות אחרי שעת ההתחלה.",
  "No active monthly-salary workers were found for this month.": "לא נמצאו עובדים במשכורת חודשית פעילים לחודש זה.",
  // Payroll – periods / payslips / agreements
  "Valid period_month is required.": "יש להזין חודש תקופה תקין.",
  "period_id is required.": "חסר מזהה תקופה.",
  "Payroll period not found.": "תקופת השכר לא נמצאה.",
  "Locked or paid periods cannot be regenerated.": "לא ניתן להפיק מחדש תקופות נעולות או ששולמו.",
  "Only open payroll periods can be edited.": "ניתן לערוך רק תקופות שכר פתוחות.",
  "payslip_id is required.": "חסר מזהה תלוש.",
  "payroll_period_id is required.": "חסר מזהה תקופת שכר.",
  "Payslip not found.": "תלוש השכר לא נמצא.",
  "Agreement and user are required.": "יש לבחור הסכם ומשתמש.",
  "User, salary type, and valid-from are required.": "יש להזין משתמש, סוג שכר ותאריך תחילה.",
  "Hourly rate is required for hourly agreements.": "יש להזין תעריף שעתי עבור הסכם שעתי.",
  "Monthly salary is required for monthly agreements.": "יש להזין שכר חודשי עבור הסכם חודשי.",
  "Standard daily hours are required.": "יש להזין שעות עבודה יומיות תקניות.",
  "Due day must be a whole number between 1 and 31.": "יום החיוב חייב להיות מספר שלם בין 1 ל-31.",
  "Salary agreement not found.": "הסכם השכר לא נמצא.",
  "Salary agreements cannot overlap for the same worker.": "לא ניתן ליצור הסכמי שכר חופפים לאותו עובד.",
  // Recurring templates
  "Failed to save recurring expense template": "שמירת תבנית ההוצאה הקבועה נכשלה.",
  "Failed to save recurring task template": "שמירת תבנית המשימה הקבועה נכשלה.",
  "Global search failed": "החיפוש נכשל.",
  "SUPABASE_SERVICE_ROLE_KEY not configured": "שירות המערכת אינו מוגדר. פנו למנהל המערכת.",
};

const PATTERN_RULES: Array<{ test: RegExp; hebrew: string }> = [
  // ── Supabase auth (password change / reset) ────────────────────────────────
  // These come back in English from GoTrue. Without a rule each one collapsed to
  // the generic fallback, so a user changing their password just saw "נכשל" with
  // no idea why — and neither did we.
  {
    test: /new password should be different|should be different from the old password/i,
    hebrew: "הסיסמה החדשה זהה לנוכחית. יש לבחור סיסמה אחרת.",
  },
  {
    test: /password should be at least (\d+)|password is too short/i,
    hebrew: "הסיסמה קצרה מדי — יש לבחור סיסמה ארוכה יותר.",
  },
  {
    test: /password is known to be weak|easy to guess|pwned/i,
    hebrew: "הסיסמה הזו נפוצה מדי וניתנת לניחוש. יש לבחור סיסמה חזקה יותר.",
  },
  {
    test: /reauthentication|for security purposes, you must reauthenticate|nonce/i,
    hebrew: "מטעמי אבטחה יש להתחבר מחדש לפני שינוי הסיסמה.",
  },
  {
    test: /auth session missing|session (not found|expired)|jwt expired/i,
    hebrew: "החיבור פג. יש להתחבר מחדש ולנסות שוב.",
  },
  {
    test: /for security purposes, you can only request this after (\d+) seconds?/i,
    hebrew: "בקשת יותר מדי פעמים. יש להמתין רגע ולנסות שוב.",
  },
  {
    test: /same_password/i,
    hebrew: "הסיסמה החדשה זהה לנוכחית. יש לבחור סיסמה אחרת.",
  },
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
    test: /Inventory cannot be negative/i,
    hebrew: "אין מספיק מלאי לאחד הפריטים. צמצמו את הכמות או עדכנו את המלאי ונסו שוב.",
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
    test: /not found\.?$/i,
    hebrew: "הפריט המבוקש לא נמצא.",
  },
  {
    test: /^Invalid /i,
    hebrew: "אחד הערכים שהוזנו אינו תקין.",
  },
  {
    test: /^Failed to /i,
    hebrew: "הפעולה נכשלה. נסו שוב.",
  },
  {
    test: /^Unsupported /i,
    hebrew: "הערך או הפעולה אינם נתמכים.",
  },
  {
    test: /is required\.?$/i,
    hebrew: "יש למלא את כל שדות החובה.",
  },
  {
    test: / must be /i,
    hebrew: "אחד הערכים אינו בטווח התקין.",
  },
  {
    test: /was not (created|updated|deleted|saved)/i,
    hebrew: "הפעולה לא הושלמה. נסו שוב.",
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

import { PRIVATE_TASK_LABEL, type AuditFeedItem } from "@/lib/audit";

// Each feed entry as one Hebrew sentence — "נרשם תשלום ₪1,500 מכהן בנייה" —
// instead of a row of columns (action / record / user).
//
// The verb comes first and agrees with the RECORD, not the person: the app
// doesn't know anyone's gender, so "רותי רשמה" could just as well come out
// "רותי רשם". The person is shown beside the sentence (avatar and name), the
// same way the alerts say "הוזנה ע״י דוד".

// `glue`: no space before it (a ":" after its word). Spaces live between the
// parts, never inside one — a space inside a name or an amount set apart from
// the right-to-left text lands on the wrong side of it.
export type SentencePart = { text: string; strong?: boolean; glue?: boolean };

const CREATE = new Set(["create", "INSERT"]);
const UPDATE = new Set(["update", "UPDATE", "status_changed", "priority_changed"]);
const DELETE = new Set(["delete", "DELETE"]);

export function isCreate(action: string) {
  return CREATE.has(action);
}
export function isUpdate(action: string) {
  return UPDATE.has(action);
}
export function isDelete(action: string) {
  return DELETE.has(action);
}

/** "₪1,500" — the same shape the details line already uses, so it can be told apart there. */
export function formatAmount(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  return `₪${amount.toLocaleString("he-IL")}`;
}

/**
 * A Hebrew one-letter preposition joined to a name: "מכהן", "לכהן". A name that
 * doesn't start with a Hebrew letter (an English name, a number) takes a
 * hyphen, as written: "מ-Apple".
 */
export function withPrefix(prefix: "מ" | "ל" | "ב", name: string): string {
  return /^[א-ת]/.test(name) ? `${prefix}${name}` : `${prefix}-${name}`;
}

// Feminine nouns among the record kinds, for the verb in the general sentence.
const FEMININE = new Set([
  "הוצאה", "הוצאה בפרויקט", "הזמנה", "משימה", "הקצאת תשלום", "תקופת שכר", "קטגוריית מוצר",
  "תנועת מלאי", "תגית", "פנייה", "הוצאה קבועה", "משימה קבועה", "הבטחת תשלום", "התאמת שכר שעתי",
  "תזכורת", "תגובה", "הלוואה", "העברה בין חשבונות", "הגדרת התראה", "תקשורת", "הוצאת נכס",
  "שעות עבודה", "קישור מסמך",
]);

function generalVerb(action: string, feminine: boolean): string | null {
  if (isCreate(action)) return feminine ? "נוצרה" : "נוצר";
  if (isUpdate(action)) return feminine ? "עודכנה" : "עודכן";
  if (isDelete(action)) return feminine ? "נמחקה" : "נמחק";
  return null;
}

// A user's own preferences (the dashboard's "what you missed" being read, the
// text size…) against what the owner grants them.
const SETTINGS_FIELDS = new Set([
  "digest_seen_at", "inbox_seen_at", "last_seen_at", "font_scale", "font_scale_mobile", "dashboard_prefs",
  "worklist_prefs", "ledger_prefs", "notification_prefs", "locale", "avatar_color",
]);
const PERMISSION_FIELDS = new Set(["role", "section_access", "system_access", "active"]);

const ORDER_STATUS_VERBS: Record<string, string> = {
  delivered: "נמסרה הזמנה",
  closed: "נסגרה הזמנה",
  cancelled: "בוטלה הזמנה",
  canceled: "בוטלה הזמנה",
  ready: "הוכנה הזמנה",
};

const TASK_STATUS_VERBS: Record<string, string> = {
  done: "בוצעה משימה",
  completed: "בוצעה משימה",
  in_progress: "התחיל טיפול במשימה",
  cancelled: "בוטלה משימה",
};

const REPORT_STATUS_VERBS: Record<string, string> = {
  approved: "אושר דיווח נוכחות",
  rejected: "נדחה דיווח נוכחות",
};

function sentence(...parts: (SentencePart | string | null | undefined | false)[]): SentencePart[] {
  const out: SentencePart[] = [];
  for (const part of parts) {
    if (!part) continue;
    out.push(typeof part === "string" ? { text: part } : part);
  }
  // A ":" sits right after the word before it.
  return out.map((p) => (p.text === ":" ? { ...p, glue: true } : p));
}

const strong = (text: string | null | undefined): SentencePart | null => (text ? { text, strong: true } : null);

/** The sentence for one feed entry, as parts (the names and amounts are the strong ones). */
export function activitySentence(item: AuditFeedItem): SentencePart[] {
  const { action, tableName, title } = item;
  const facts = item.facts;
  const amount = formatAmount(facts?.amount);
  const isPrivateTask = item.details === PRIVATE_TASK_LABEL && !title;

  switch (tableName) {
    case "auth":
      if (action === "login") return sentence("כניסה למערכת");
      if (action === "logout") return sentence("יציאה מהמערכת");
      break;
    case "system":
      return sentence("רענון תזכורות אוטומטי");
    case "payments":
      if (isCreate(action)) return sentence("נרשם תשלום", strong(amount), title && strong(withPrefix("מ", title)));
      if (isUpdate(action)) return sentence("עודכן תשלום", strong(amount), title && "של", strong(title));
      if (isDelete(action)) return sentence("נמחק תשלום", strong(amount), title && "של", strong(title));
      break;
    case "orders": {
      if (isCreate(action)) return sentence("נפתחה הזמנה", title && strong(withPrefix("ל", title)));
      if (isDelete(action)) return sentence("נמחקה הזמנה", title && "של", strong(title));
      const statusVerb = facts?.statusTo ? ORDER_STATUS_VERBS[facts.statusTo] : undefined;
      if (statusVerb) return sentence(statusVerb, title && strong(withPrefix("ל", title)));
      return sentence("עודכנה הזמנה", title && "של", strong(title));
    }
    case "tasks": {
      if (isPrivateTask) {
        const verb = generalVerb(action, true);
        return sentence(verb ? `${verb} משימה פרטית` : "משימה פרטית");
      }
      const subject = strong(title);
      if (isCreate(action)) return sentence("נוספה משימה", subject && { text: ":" }, subject);
      if (isDelete(action)) return sentence("נמחקה משימה", subject && { text: ":" }, subject);
      const from = facts?.statusFrom ?? null;
      const to = facts?.statusTo ?? null;
      if (to && (from === "done" || from === "completed") && to !== "done" && to !== "completed") {
        return sentence("נפתחה מחדש משימה", subject && { text: ":" }, subject);
      }
      const statusVerb = to ? TASK_STATUS_VERBS[to] : undefined;
      return sentence(statusVerb ?? "עודכנה משימה", subject && { text: ":" }, subject);
    }
    case "customers":
      if (isCreate(action)) return sentence("נוסף לקוח חדש", title && { text: ":" }, strong(title));
      if (isUpdate(action)) return sentence("עודכנו פרטי הלקוח", strong(title));
      if (isDelete(action)) return sentence("נמחק הלקוח", strong(title));
      break;
    case "projects":
      if (isCreate(action)) return sentence("נפתח פרויקט", title && { text: ":" }, strong(title));
      if (isUpdate(action)) return sentence("עודכן הפרויקט", strong(title));
      if (isDelete(action)) return sentence("נמחק הפרויקט", strong(title));
      break;
    case "expenses":
      if (isCreate(action)) return sentence("נרשמה הוצאה", strong(amount), title && strong(withPrefix("ב", title)));
      if (isUpdate(action)) return sentence("עודכנה הוצאה", strong(amount), title && strong(withPrefix("ב", title)));
      if (isDelete(action)) return sentence("נמחקה הוצאה", strong(amount), title && strong(withPrefix("ב", title)));
      break;
    case "documents":
      if (isCreate(action) || action === "upload") return sentence("הועלה מסמך", title && { text: ":" }, strong(title));
      if (isDelete(action)) return sentence("נמחק מסמך", title && { text: ":" }, strong(title));
      if (isUpdate(action)) return sentence("עודכן מסמך", title && { text: ":" }, strong(title));
      break;
    case "attendance_sessions":
      if (isCreate(action)) return sentence("נרשמה כניסה לעבודה", title && "של", strong(title));
      if (isDelete(action)) return sentence("נמחקה משמרת", title && "של", strong(title));
      if (facts?.clockedOut) return sentence("נרשמה יציאה מהעבודה", title && "של", strong(title));
      return sentence("עודכנו שעות העבודה", title && "של", strong(title));
    case "phone_attendance_reports": {
      if (isCreate(action)) return sentence(`התקבל ${item.entityLabel}`, title && strong(withPrefix("מ", title)));
      const statusVerb = facts?.statusTo ? REPORT_STATUS_VERBS[facts.statusTo] : undefined;
      if (statusVerb) return sentence(statusVerb, title && "של", strong(title));
      break;
    }
    case "worker_payments":
      if (isCreate(action)) return sentence("נרשם תשלום לעובד", strong(amount), title && strong(withPrefix("ל", title)));
      break;
    case "users": {
      if (isCreate(action)) return sentence("נוסף משתמש", title && { text: ":" }, strong(title));
      if (isDelete(action)) return sentence("נמחק המשתמש", strong(title));
      const fields = facts?.userFields ?? [];
      if (fields.some((f) => PERMISSION_FIELDS.has(f))) return sentence("עודכנו ההרשאות של", strong(title) ?? "משתמש");
      if (fields.length > 0 && fields.every((f) => SETTINGS_FIELDS.has(f))) {
        return sentence("עודכנו ההגדרות האישיות של", strong(title) ?? "משתמש");
      }
      return sentence("עודכנו פרטי המשתמש", strong(title));
    }
  }

  // Everything else: the verb for the action, agreeing with the record's kind.
  const verb = generalVerb(action, FEMININE.has(item.entityLabel));
  if (verb) return sentence(verb, item.entityLabel, strong(amount), title && { text: "·" }, strong(title));
  // A named event (Morning's) already reads as a sentence.
  return sentence(item.actionLabel === item.action ? item.entityLabel : item.actionLabel, title && { text: "·" }, strong(title));
}

/**
 * Whether the sentence already tells the status change ("נמסרה הזמנה", "בוצעה
 * משימה") — then a "סטטוס: חדש → נמסר" chip under it would say it twice.
 */
export function sentenceTellsStatus(item: AuditFeedItem): boolean {
  const to = item.facts?.statusTo;
  if (!to || !isUpdate(item.action)) return false;
  if (item.tableName === "orders") return to in ORDER_STATUS_VERBS;
  if (item.tableName === "tasks") return true;
  if (item.tableName === "phone_attendance_reports") return to in REPORT_STATUS_VERBS;
  return false;
}

export function sentenceText(parts: SentencePart[]): string {
  return parts.map((p, i) => (i === 0 || p.glue ? p.text : ` ${p.text}`)).join("");
}

/**
 * The quieter line under the sentence: the row's details, without what the
 * sentence already said (its amount, its name) — e.g. "צ׳ק · מקדמה".
 */
export function detailLine(item: AuditFeedItem, said: SentencePart[]): string {
  const saidText = sentenceText(said);
  const amount = formatAmount(item.facts?.amount);
  const parts = (item.baseDetails || "")
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== amount && p !== item.title && !(p.length > 1 && saidText.includes(p)));
  return parts.join(" · ");
}

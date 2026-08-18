const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateValue(value: string) {
  if (DATE_ONLY_PATTERN.test(value)) {
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

/**
 * "יום שני" — the full Hebrew weekday of a timestamp, in Israel time.
 *
 * Lives here rather than beside the attendance card that first needed it: a
 * "use client" module's exports can't be called from a server component (Next
 * throws "attempted to call X from the server but X is on the client"), and the
 * dashboard's server-rendered day headings need exactly this.
 */
export function hebrewWeekday(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

export function formatShortDate(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}`;
}

export function formatShortDateTime(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatShortDate(value, fallback)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Just the clock time ("08:30") — for rows that already say which day it was, so
 * the date isn't repeated on every line.
 */
export function formatTimeOnly(value: string | null | undefined, fallback = "-") {
  if (!value) return fallback;
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type DueUrgency = "overdue" | "due-soon" | "due-week" | "none";

/**
 * How close a due date is, for colour-coding:
 *  - "overdue"  : already past (and the task isn't done)
 *  - "due-soon" : within the next 3 days → red
 *  - "due-week" : within the next 7 days → yellow
 *  - "none"     : further out, missing, or the task is done
 */
export function getDueUrgency(
  value: string | null | undefined,
  options?: { done?: boolean; refDate?: string }
): DueUrgency {
  if (!value || options?.done) return "none";
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return "none";

  const today = options?.refDate ? parseDateValue(options.refDate) : new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((targetDay.getTime() - todayDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "due-soon";
  if (diffDays <= 7) return "due-week";
  return "none";
}

// Soft-outline chip classes (border + light tint + text) for a due-date urgency.
// Empty string for "none" so the date renders as plain text. Matches the app's
// soft-badge convention (no solid pills).
export function dueUrgencyChipClass(urgency: DueUrgency): string {
  switch (urgency) {
    case "overdue":
    case "due-soon":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "due-week":
      return "border-warning/40 bg-warning/15 text-warning-strong";
    default:
      return "";
  }
}

// Text-only colour for a due-date urgency (when a chip background isn't wanted).
export function dueUrgencyTextClass(urgency: DueUrgency): string {
  switch (urgency) {
    case "overdue":
    case "due-soon":
      return "text-destructive";
    case "due-week":
      return "text-warning-strong";
    default:
      return "";
  }
}

export function formatRelativeDateLabel(value: string | null | undefined, fallback = "-", refDate?: string) {
  if (!value) return fallback;
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const today = refDate ? parseDateValue(refDate) : new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((targetDay.getTime() - todayDay.getTime()) / (1000 * 60 * 60 * 24));
  const absDiffDays = Math.abs(diffDays);

  if (diffDays === 0) return "היום";
  if (diffDays === -1) return "אתמול";
  if (diffDays === 1) return "מחר";

  if (absDiffDays < 7) {
    return diffDays < 0 ? `לפני ${absDiffDays} ימים` : `בעוד ${absDiffDays} ימים`;
  }

  if (absDiffDays < 30) {
    const weeks = Math.round(absDiffDays / 7);
    return diffDays < 0 ? `לפני ${weeks} שבועות` : `בעוד ${weeks} שבועות`;
  }

  const months = Math.max(1, Math.round(absDiffDays / 30));
  return diffDays < 0 ? `לפני ${months} חודשים` : `בעוד ${months} חודשים`;
}

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

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

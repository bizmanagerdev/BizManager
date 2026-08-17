/**
 * בונוסים והיעדרויות — the two payroll records that aren't hours.
 *
 * A **bonus** is a רכיב שכר like any other: a row in `payslip_items` with
 * `item_type = 'bonus'`. What's new is that it carries a `user_id` and an
 * `item_date`, so it can exist BEFORE the month's payslip does — an hourly worker
 * records "₪300 for the ten-hour day" on the day, it sits unattached, and when the
 * payslip for that month is generated it's rolled in with everything else and
 * shows up in the ברוטו. There is no approval step: he writes it, it counts.
 *
 * An **absence** is a day a global (monthly) worker didn't work. It moves no money
 * — he's paid the full month either way — it exists so the exported hours sheet
 * leaves that day empty instead of printing the standard workday.
 */

export const PAYSLIP_ITEMS_TABLE = "payslip_items";
export const WORKER_ABSENCES_TABLE = "worker_absences";

export const BONUS_ITEM_TYPE = "bonus";

export type PayslipItemRow = {
  id: string;
  /** Null until the month's payslip is generated and rolls this item in. */
  payslip_id: string | null;
  user_id: string;
  item_type: string | null;
  amount: number | string | null;
  /** The day the item is FOR. Null on rows predating the column. */
  item_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
};

export const PAYSLIP_ITEM_COLUMNS =
  "id,payslip_id,user_id,item_type,amount,item_date,notes,created_by,created_at";

export function isBonusItem(item: { item_type: string | null }) {
  return item.item_type === BONUS_ITEM_TYPE;
}

/** `YYYY-MM` of the month an item belongs to, from its date. */
export function itemMonthKey(item: { item_date: string | null }) {
  return item.item_date ? item.item_date.slice(0, 7) : null;
}

export type WorkerAbsenceType = "day_off" | "vacation" | "sick" | "holiday" | "unpaid" | "other";

export type WorkerAbsenceRow = {
  id: string;
  user_id: string;
  absence_date: string;
  absence_type: WorkerAbsenceType | string | null;
  paid: boolean | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
};

export const WORKER_ABSENCE_COLUMNS =
  "id,user_id,absence_date,absence_type,paid,notes,created_by,created_at";

export const WORKER_ABSENCE_TYPES = [
  { value: "day_off", label: "יום חופש" },
  { value: "vacation", label: "חופשה" },
  { value: "sick", label: "מחלה" },
  { value: "holiday", label: "חג" },
  { value: "unpaid", label: "חופשה ללא תשלום" },
  { value: "other", label: "אחר" },
] as const;

export function isWorkerAbsenceType(value: unknown): value is WorkerAbsenceType {
  return WORKER_ABSENCE_TYPES.some((type) => type.value === value);
}

export function getWorkerAbsenceTypeLabel(value: string | null | undefined) {
  return WORKER_ABSENCE_TYPES.find((type) => type.value === value)?.label ?? "יום חופש";
}

/**
 * A bonus row's one-line label: the note if there is one, otherwise a generic
 * "בונוס". Used by the worker's card and the payslip breakdown so they can't drift.
 */
export function buildWorkerBonusLabel(notes: string | null | undefined) {
  const trimmed = notes?.trim();
  return trimmed ? `בונוס • ${trimmed}` : "בונוס";
}

/** `YYYY-MM-DD` as typed in a date input, or null when it isn't a real date. */
export function parseBonusDate(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

/**
 * How far back a WORKER may date a bonus he records for himself. Same spirit as
 * the shift-reporting window: a claim about two months ago is a conversation with
 * the boss, not a form — and a closed payroll month can't take it anyway. Admins
 * are not bounded; they enter history all the time.
 */
export const MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS = 31;

export function validateSelfReportedBonusDate(
  value: unknown,
  now: Date = new Date()
): { date: string } | { error: string } {
  const date = parseBonusDate(value);
  if (!date) return { error: "יש לבחור תאריך תקין." };

  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  if (date > todayIso) return { error: "לא ניתן לרשום בונוס בתאריך עתידי." };

  const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  earliest.setDate(earliest.getDate() - MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS);
  const earliestIso = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, "0")}-${String(
    earliest.getDate()
  ).padStart(2, "0")}`;
  if (date < earliestIso) {
    return { error: `לא ניתן לרשום בונוס יותר מ-${MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS} ימים אחורה.` };
  }

  return { date };
}

/** Positive money, rounded to agorot. Returns null for anything else. */
export function parseBonusAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

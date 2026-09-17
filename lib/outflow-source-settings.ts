import { subtractWorkingDays } from "@/lib/dashboard/week";

// Pure, client-safe half of "מקורות נוספים": the kinds, the settings shape, the
// defaults and the small helpers both the server loaders (lib/outflow-sources.ts)
// and the client (the payments board's alerts bar, the settings section) need.
// Nothing here touches Supabase.

export type OutflowSourceKind = "salary" | "loan" | "card";

export const OUTFLOW_SOURCE_KINDS: readonly OutflowSourceKind[] = ["salary", "loan", "card"];

/**
 * The INCOMING counterparts (lib/inflow-sources.ts). They share the row shape
 * and the one list, but they are NOT stored in `outflow_source_settings` — its
 * source_kind CHECK only knows the three above, and an incoming source has
 * nothing to configure yet. Rows carry `configurable: false` to say so.
 */
export type InflowSourceKind = "rent" | "loan_in" | "settlement";

export const INFLOW_SOURCE_KINDS: readonly InflowSourceKind[] = ["rent", "loan_in", "settlement"];

export type SourceKind = OutflowSourceKind | InflowSourceKind;

export const OUTFLOW_SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  salary: "משכורת",
  loan: "הלוואה",
  card: "כרטיס אשראי",
  rent: "שכר דירה",
  loan_in: "הלוואה שנתנה",
  settlement: "סליקת אשראי",
};

/**
 * Heads-up when nothing is stored: a card charge warns 3 work days ahead (the
 * user asked for that before per-source settings existed); salaries and loans
 * are opt-in like recurring bills.
 */
export const DEFAULT_REMINDER_WORK_DAYS: Record<OutflowSourceKind, number> = {
  salary: 0,
  loan: 0,
  card: 3,
};

export type OutflowSourceSetting = {
  reminderWorkDaysBefore: number | null;
  accountId: string | null;
  /** Off = not on the board, never alerts. The source itself is untouched. */
  isActive: boolean;
};

/** `${kind}:${key}` → the stored setting (a Map server-side, a plain record once serialized to the client). */
export type OutflowSourceSettings = Map<string, OutflowSourceSetting>;
export type OutflowSourceSettingsRecord = Record<string, OutflowSourceSetting>;

export function sourceSettingKey(kind: SourceKind, key: string) {
  return `${kind}:${key}`;
}

export function isOutflowSourceKind(value: unknown): value is OutflowSourceKind {
  return typeof value === "string" && (OUTFLOW_SOURCE_KINDS as readonly string[]).includes(value);
}

/** The kinds a setting can be saved for: the outgoing three, plus the Grow deposits' account. */
export function isSettableSourceKind(value: unknown): value is OutflowSourceKind | "settlement" {
  return isOutflowSourceKind(value) || value === "settlement";
}

/** Stored value wins; null (no row / never set) falls back to the kind's default. */
export function effectiveReminderWorkDays(kind: SourceKind, setting?: OutflowSourceSetting | null): number {
  const stored = setting?.reminderWorkDaysBefore;
  if (stored == null || !Number.isFinite(stored)) return DEFAULT_REMINDER_WORK_DAYS[kind as OutflowSourceKind] ?? 0;
  return Math.max(0, Math.floor(stored));
}

export type OutflowSourceRow = {
  kind: SourceKind;
  /** Which way this source moves money. Absent on older rows ⇒ outgoing. */
  direction?: "out" | "in";
  /**
   * False when there is nowhere to store settings for it (rent, loans given).
   * "account" when only its account can be set (the Grow deposits).
   */
  configurable?: boolean | "account";
  /**
   * The individual items behind a lump figure — today only the card
   * settlement, whose amount is the sum of the card payments due to land in it.
   */
  breakdown?: Array<{ id: string; date: string; amount: number; label: string }>;
  key: string;
  name: string;
  /** "10 לכל חודש" — how the timing reads; NOT a concrete date. */
  scheduleLabel: string;
  /** The next date money is expected to leave (ISO), or null when unknown. */
  nextDate: string | null;
  /** The calendar item id for that next date — `?focus=` lands on it. */
  focusId: string | null;
  /** Expected amount, or null when it is only known when it happens (a card). */
  amount: number | null;
  /** Where the source itself is managed (amount, schedule). */
  href: string;
  reminderWorkDaysBefore: number | null;
  effectiveReminderDays: number;
  accountId: string | null;
  isActive: boolean;
  /** The next occurrence is already covered (e.g. this month's salary was paid) — no alert. */
  settled: boolean;
  /**
   * True when this source really is a MONTHLY commitment: a salary always; a
   * loan only when its remaining plan is monthly instalments (a single bullet
   * repayment two years out is not a monthly expense); a card never (unknown).
   */
  monthly: boolean;
};

/**
 * Does a repayment plan read as "every month"? Two or more remaining dates,
 * each 27–32 days after the previous one.
 */
export function isMonthlyPlan(datesIso: string[]): boolean {
  if (datesIso.length < 2) return false;
  const times = datesIso.map((d) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    const days = Math.round((times[i] - times[i - 1]) / 86400000);
    if (days < 27 || days > 32) return false;
  }
  return true;
}

// ── Reminder windows (shared by the board's alerts bar and its tests) ────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Is `todayIso` inside the heads-up window of a payment due on `dateIso`?
 * The window runs from `workDays` WORK days before the date (Fri+Sat don't
 * count) up to the date itself; a date already passed is never "upcoming".
 */
export function isInsideReminderWindow(dateIso: string, todayIso: string, workDays: number): boolean {
  if (workDays <= 0) return false;
  const day = dateIso.slice(0, 10);
  if (day < todayIso) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const start = subtractWorkingDays(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), workDays);
  const startIso = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
  return todayIso >= startIso;
}

/** The subset of a calendar item the window logic needs. */
export type ReminderSubject = {
  id: string;
  workerUserId: string | null;
  sourceId: string | null;
  category: string | null;
  recurringTemplateId: string | null;
};

/**
 * How many WORK days before this board item its heads-up starts (0 = none):
 * a salary / loan instalment / card marker → the source's setting (or the
 * kind's default); a recurring bill's row or forecast → its template's
 * reminder. Anything else has no heads-up.
 */
export function reminderWorkDaysForItem(
  item: ReminderSubject,
  templateReminderDays: (templateId: string) => number | null | undefined,
  settings: OutflowSourceSettingsRecord
): number {
  if (item.id.startsWith("salary_proj:") && item.workerUserId) {
    return effectiveReminderWorkDays("salary", settings[sourceSettingKey("salary", item.workerUserId)]);
  }
  if (item.id.startsWith("loan_planned:") && item.sourceId) {
    return effectiveReminderWorkDays("loan", settings[sourceSettingKey("loan", item.sourceId)]);
  }
  if (item.id.startsWith("ccharge") && item.category) {
    return effectiveReminderWorkDays("card", settings[sourceSettingKey("card", item.category)]);
  }
  if (item.recurringTemplateId) {
    return Math.max(0, templateReminderDays(item.recurringTemplateId) ?? 0);
  }
  return 0;
}

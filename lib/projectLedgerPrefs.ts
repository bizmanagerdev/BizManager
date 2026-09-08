// Per-user "תנועות" ledger view preference — group-by / sort-by on the
// project money-movements table. Mirrors lib/dashboard/widgets.ts's
// dashboard_prefs pattern (a jsonb column + sanitizer), but always resolves to
// a concrete value rather than null: there's no "role-dependent catalog" to
// recompute here, just three small enums with well-defined defaults.

export type LedgerGroupBy = "none" | "employee" | "category" | "date";
export type LedgerSortBy = "date" | "amount" | "status";
export type LedgerSortDirection = "asc" | "desc";

export type LedgerPrefs = {
  groupBy: LedgerGroupBy;
  sortBy: LedgerSortBy;
  sortDirection: LedgerSortDirection;
};

const GROUP_BY_VALUES: readonly LedgerGroupBy[] = ["none", "employee", "category", "date"];
const SORT_BY_VALUES: readonly LedgerSortBy[] = ["date", "amount", "status"];
const SORT_DIRECTIONS: readonly LedgerSortDirection[] = ["asc", "desc"];

export const DEFAULT_LEDGER_PREFS: LedgerPrefs = {
  groupBy: "none",
  sortBy: "date",
  sortDirection: "desc",
};

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** Never returns null — an invalid/missing/pre-migration value just falls
 *  back to DEFAULT_LEDGER_PREFS field by field. */
export function sanitizeLedgerPrefs(value: unknown): LedgerPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    groupBy: isOneOf(raw.groupBy, GROUP_BY_VALUES) ? raw.groupBy : DEFAULT_LEDGER_PREFS.groupBy,
    sortBy: isOneOf(raw.sortBy, SORT_BY_VALUES) ? raw.sortBy : DEFAULT_LEDGER_PREFS.sortBy,
    sortDirection: isOneOf(raw.sortDirection, SORT_DIRECTIONS)
      ? raw.sortDirection
      : DEFAULT_LEDGER_PREFS.sortDirection,
  };
}

export const LEDGER_GROUP_BY_LABELS: Record<LedgerGroupBy, string> = {
  none: "ללא",
  employee: "עובד",
  category: "קטגוריה",
  date: "תאריך",
};

export const LEDGER_SORT_BY_LABELS: Record<LedgerSortBy, string> = {
  date: "תאריך",
  amount: "סכום",
  status: "סטטוס",
};

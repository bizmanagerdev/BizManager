export const EXPENSE_BUSINESS_DOMAINS = [
  "home",
  "charity",
  "general_business",
  "logistics_projects",
  "sales",
  "property_management",
  "spaceit",
] as const;

export type ExpenseBusinessDomain = (typeof EXPENSE_BUSINESS_DOMAINS)[number];

// Business domains selectable for work sessions. Charity is excluded — workers
// don't log paid hours against charity.
export const WORK_SESSION_BUSINESS_DOMAINS = EXPENSE_BUSINESS_DOMAINS.filter(
  (domain) => domain !== "charity",
);

export const EXPENSE_SOURCE_TYPES = ["project", "order", "property"] as const;

export type ExpenseSourceType = (typeof EXPENSE_SOURCE_TYPES)[number];

export function isExpenseBusinessDomain(value: string | null | undefined): value is ExpenseBusinessDomain {
  return typeof value === "string" && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(value);
}

export function isExpenseSourceType(value: string | null | undefined): value is ExpenseSourceType {
  return typeof value === "string" && (EXPENSE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function mapProjectTypeToExpenseDomain(value: string | null | undefined): ExpenseBusinessDomain {
  switch (value) {
    case "home":
    case "logistics":
    case "moving":
    case "renovation":
    case "construction":
    case "other":
      return "logistics_projects";
    case "sales":
      return "sales";
    case "property_management":
      return "property_management";
    case "charity":
      return "charity";
    default:
      return "logistics_projects";
  }
}

// ── Expense categories (single source of truth, shared by every expense form) ──
// "שכר עובד" is special: in forms that support worker sessions it turns the
// expense into a worker-session entry. "רכבים" reveals the vehicle link.
export const EXPENSE_WORKER_WAGE_CATEGORY = "שכר עובד";
export const EXPENSE_OTHER_CATEGORY = "אחר";
export const EXPENSE_CARS_CATEGORY = "רכבים";
// Tax / VAT remittance. Expenses in this category are the actual tax payments
// that drain the "tax to pay" bucket (see lib/financial/taxes.ts). Keep the value
// stable — the tax aggregator matches on it.
export const EXPENSE_TAX_CATEGORY = "מע״מ ומסים";
export const DEFAULT_EXPENSE_CATEGORY = "רכישה";
// Base picklist (no worker-wage entry — added only where sessions are supported).
export const EXPENSE_CATEGORY_OPTIONS = [
  DEFAULT_EXPENSE_CATEGORY,
  "תחבורה",
  "אוכל",
  EXPENSE_CARS_CATEGORY,
  "משאית",
  EXPENSE_TAX_CATEGORY,
  EXPENSE_OTHER_CATEGORY,
] as const;
// Full picklist including worker wage (dashboard / project forms).
export const EXPENSE_CATEGORY_OPTIONS_WITH_WAGE = [
  EXPENSE_WORKER_WAGE_CATEGORY,
  ...EXPENSE_CATEGORY_OPTIONS,
] as const;
// Property-management-specific expense categories, shown IN ADDITION TO the
// base list only when the expense's domain is property_management. Rent
// income is NOT here — it's income (a payment), never an expense category.
export const EXPENSE_PROPERTY_CATEGORIES = [
  "הוצאות לשיפוץ",
  "רכישת ציוד",
  "משכנתא",
  "מים",
  "חשמל",
  "גז",
  "ארנונה",
  "ועד בית",
] as const;

export function getBusinessDomainLabel(value: string | null | undefined) {
  if (value === "general_business") return "שוטף";
  if (value === "property_management") return "ניהול נכסים";
  if (value === "sales") return "מכירות";
  if (value === "logistics_projects") return "פרויקטים";
  if (value === "home") return "בית";
  if (value === "charity") return "צדקה";
  if (value === "spaceit") return "ספייסיט";
  return value || "שוטף";
}

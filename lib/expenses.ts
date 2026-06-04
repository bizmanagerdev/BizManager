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

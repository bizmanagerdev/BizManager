export const EXPENSE_BUSINESS_DOMAINS = [
  "home",
  "charity",
  "general",
  "logistics",
  "sales",
  "property_managment",
] as const;

export type ExpenseBusinessDomain = (typeof EXPENSE_BUSINESS_DOMAINS)[number];

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
      return "home";
    case "logistics":
      return "logistics";
    case "sales":
      return "sales";
    case "property_managment":
      return "property_managment";
    case "charity":
      return "charity";
    default:
      return "general";
  }
}

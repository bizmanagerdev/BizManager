// The customers list's four filters, read the same way everywhere they're read:
// the page (its address), the list (the selects, the summary line, the export
// link), the server actions and the export route. Plain functions only — the
// list's client code imports this, so nothing server-side belongs here.

export type CustomerFilterMode = "all" | "yes" | "no";

export type CustomersFilters = {
  withProjects: CustomerFilterMode;
  withOrders: CustomerFilterMode;
  withDebt: CustomerFilterMode;
  activeOnly: CustomerFilterMode;
};

export type CustomersFilterKey = keyof CustomersFilters;

export const NO_CUSTOMERS_FILTERS: CustomersFilters = {
  withProjects: "all",
  withOrders: "all",
  withDebt: "all",
  activeOnly: "all",
};

/** Each filter's address parameter, its label and its two choices — in the order the selects show them. */
export const CUSTOMERS_FILTER_FIELDS: ReadonlyArray<{
  key: CustomersFilterKey;
  param: string;
  label: string;
  yes: string;
  no: string;
}> = [
  { key: "withProjects", param: "with_projects", label: "פרויקטים", yes: "עם פרויקטים", no: "ללא פרויקטים" },
  { key: "withOrders", param: "with_orders", label: "הזמנות", yes: "עם הזמנות", no: "ללא הזמנות" },
  // The four sections' one name for what a customer still owes: "חוב פתוח".
  { key: "withDebt", param: "with_debt", label: "חוב פתוח", yes: "עם חוב פתוח", no: "ללא חוב פתוח" },
  { key: "activeOnly", param: "active_only", label: "סטטוס", yes: "פעילים", no: "לא פעילים" },
];

export function parseCustomerFilterMode(value: unknown): CustomerFilterMode {
  return value === "yes" || value === "no" ? value : "all";
}

/** The filters from an address (`get` reads one parameter). */
export function parseCustomersFilters(get: (param: string) => string | null | undefined): CustomersFilters {
  const filters = { ...NO_CUSTOMERS_FILTERS };
  for (const field of CUSTOMERS_FILTER_FIELDS) filters[field.key] = parseCustomerFilterMode(get(field.param));
  return filters;
}

/** Anything that isn't a filter (a hand-made server-action call) reads as "all". */
export function sanitizeCustomersFilters(value: unknown): CustomersFilters {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return parseCustomersFilters((param) => {
    const field = CUSTOMERS_FILTER_FIELDS.find((f) => f.param === param);
    const raw = field ? source[field.key] : null;
    return typeof raw === "string" ? raw : null;
  });
}

/** "with_projects=yes&…" — only the filters that are on, so "no filter" is a bare address. */
export function customersFiltersQuery(filters: CustomersFilters): string {
  const params = new URLSearchParams();
  for (const field of CUSTOMERS_FILTER_FIELDS) {
    if (filters[field.key] !== "all") params.set(field.param, filters[field.key]);
  }
  return params.toString();
}

export function hasCustomersFilter(filters: CustomersFilters): boolean {
  return CUSTOMERS_FILTER_FIELDS.some((field) => filters[field.key] !== "all");
}

/**
 * Filters a search can't apply from the search index alone — it carries a
 * customer's name, phones and "active", not their orders, projects or debt —
 * so the matches are checked on the server first.
 */
export function needsServerCustomersFilter(filters: CustomersFilters): boolean {
  return filters.withProjects !== "all" || filters.withOrders !== "all" || filters.withDebt !== "all";
}

/** "הזמנות: עם הזמנות • סטטוס: לא פעילים" — the closed filter panel's summary line. */
export function customersFilterSummary(filters: CustomersFilters): string {
  return CUSTOMERS_FILTER_FIELDS.filter((field) => filters[field.key] !== "all")
    .map((field) => `${field.label}: ${filters[field.key] === "yes" ? field.yes : field.no}`)
    .join(" • ");
}

type SortableRow = Record<string, unknown>;

function text(row: SortableRow, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/**
 * The list's order — by name, then by id so customers who share a name keep
 * one fixed order (the server sorts the same way: customer_name, customer_id).
 * Used to put a row that arrives on its own (a new customer) where it belongs.
 */
export function compareCustomerRows(a: SortableRow, b: SortableRow): number {
  const byName = text(a, "customer_name").localeCompare(text(b, "customer_name"), "he");
  if (byName !== 0) return byName;
  const idA = text(a, "customer_id");
  const idB = text(b, "customer_id");
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

import { describe, expect, it } from "vitest";
import {
  NO_CUSTOMERS_FILTERS,
  compareCustomerRows,
  customersFilterSummary,
  customersFiltersQuery,
  hasCustomersFilter,
  needsServerCustomersFilter,
  parseCustomersFilters,
  sanitizeCustomersFilters,
} from "@/app/(app)/customers/customersFilters";

// The customers list's filters, read the same way by the page, the list, the
// actions and the export.

describe("customers filters", () => {
  it("round-trip through the address, with only the ones that are on", () => {
    const filters = { ...NO_CUSTOMERS_FILTERS, withDebt: "yes" as const, activeOnly: "no" as const };
    const query = customersFiltersQuery(filters);
    expect(query).toBe("with_debt=yes&active_only=no");
    const params = new URLSearchParams(query);
    expect(parseCustomersFilters((p) => params.get(p))).toEqual(filters);
    expect(customersFiltersQuery(NO_CUSTOMERS_FILTERS)).toBe("");
  });

  it("read anything else as 'all'", () => {
    expect(parseCustomersFilters(() => "maybe")).toEqual(NO_CUSTOMERS_FILTERS);
    expect(sanitizeCustomersFilters(null)).toEqual(NO_CUSTOMERS_FILTERS);
    expect(sanitizeCustomersFilters({ withOrders: "no", junk: "yes" })).toEqual({ ...NO_CUSTOMERS_FILTERS, withOrders: "no" });
  });

  it("know which need the server in a search (the index has 'active' only)", () => {
    expect(needsServerCustomersFilter({ ...NO_CUSTOMERS_FILTERS, activeOnly: "yes" })).toBe(false);
    expect(needsServerCustomersFilter({ ...NO_CUSTOMERS_FILTERS, withProjects: "no" })).toBe(true);
    expect(hasCustomersFilter(NO_CUSTOMERS_FILTERS)).toBe(false);
    expect(hasCustomersFilter({ ...NO_CUSTOMERS_FILTERS, activeOnly: "yes" })).toBe(true);
  });

  it("summarise in the four sections' words for debt", () => {
    expect(customersFilterSummary({ ...NO_CUSTOMERS_FILTERS, withDebt: "no", withOrders: "yes" })).toBe(
      "הזמנות: עם הזמנות • חוב פתוח: ללא חוב פתוח"
    );
    expect(customersFilterSummary(NO_CUSTOMERS_FILTERS)).toBe("");
  });

  it("sort by name, then id — the server's order", () => {
    const rows = [
      { customer_id: "b", customer_name: "דנה" },
      { customer_id: "a", customer_name: "דנה" },
      { customer_id: "c", customer_name: "אבי" },
    ];
    expect([...rows].sort(compareCustomerRows).map((r) => r.customer_id)).toEqual(["c", "a", "b"]);
  });
});

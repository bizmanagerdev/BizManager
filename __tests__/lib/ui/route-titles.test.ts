import { describe, it, expect } from "vitest";
import { titleForPath } from "@/lib/ui/route-titles";

describe("titleForPath", () => {
  it("matches an exact top-level route", () => {
    expect(titleForPath("/dashboard")).toBe("דשבורד");
  });

  it("matches a sub-route by prefix", () => {
    expect(titleForPath("/sales/orders/abc-123")).toBe("הזמנות");
  });

  it("picks the LONGEST matching prefix, not the first one in the list", () => {
    // "/financial/reports" is listed after the bare "/financial" entry, so a
    // naive first-match scan would wrongly return "תזרים".
    expect(titleForPath("/financial/reports")).toBe("דוחות");
    expect(titleForPath("/financial/reports/monthly")).toBe("דוחות");
    expect(titleForPath("/financial")).toBe("תזרים");
  });

  it("a more specific nested route beats its own parent's title", () => {
    expect(titleForPath("/sales/orders/new")).toBe("הזמנה חדשה");
    expect(titleForPath("/tasks/recurring")).toBe("משימות קבועות");
    expect(titleForPath("/tasks")).toBe("משימות");
  });

  it("strips a query string before matching", () => {
    expect(titleForPath("/customers?focus=cust-1")).toBe("לקוחות");
  });

  it("strips a trailing slash before matching", () => {
    expect(titleForPath("/projects/")).toBe("פרויקטים");
  });

  it("does not prefix-match a route that merely starts with the same letters (/sales vs /salescampaign)", () => {
    expect(titleForPath("/salescampaign")).toBeNull();
  });

  it("null for an unrecognized route, or no path at all", () => {
    expect(titleForPath("/some/brand/new/route")).toBeNull();
    expect(titleForPath(null)).toBeNull();
    expect(titleForPath(undefined)).toBeNull();
    expect(titleForPath("")).toBeNull();
  });
});

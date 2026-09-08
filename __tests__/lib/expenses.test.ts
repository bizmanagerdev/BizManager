import { describe, it, expect } from "vitest";
import {
  isExpenseBusinessDomain,
  isExpenseSourceType,
  mapProjectTypeToExpenseDomain,
  getBusinessDomainLabel,
  WORK_SESSION_BUSINESS_DOMAINS,
} from "@/lib/expenses";

describe("isExpenseBusinessDomain / isExpenseSourceType", () => {
  it("accept a value from their own list", () => {
    expect(isExpenseBusinessDomain("sales")).toBe(true);
    expect(isExpenseSourceType("project")).toBe(true);
  });
  it("reject anything else, including null/undefined", () => {
    expect(isExpenseBusinessDomain("not_a_domain")).toBe(false);
    expect(isExpenseBusinessDomain(null)).toBe(false);
    expect(isExpenseSourceType("not_a_source")).toBe(false);
    expect(isExpenseSourceType(undefined)).toBe(false);
  });
});

describe("WORK_SESSION_BUSINESS_DOMAINS", () => {
  it("excludes charity — workers don't log paid hours against it", () => {
    expect(WORK_SESSION_BUSINESS_DOMAINS).not.toContain("charity");
    expect(WORK_SESSION_BUSINESS_DOMAINS.length).toBeGreaterThan(0);
  });
});

describe("mapProjectTypeToExpenseDomain", () => {
  it("maps every logistics-ish project type to logistics_projects", () => {
    for (const t of ["home", "logistics", "moving", "renovation", "construction", "other"]) {
      expect(mapProjectTypeToExpenseDomain(t)).toBe("logistics_projects");
    }
  });
  it("maps sales/property_management/charity to themselves", () => {
    expect(mapProjectTypeToExpenseDomain("sales")).toBe("sales");
    expect(mapProjectTypeToExpenseDomain("property_management")).toBe("property_management");
    expect(mapProjectTypeToExpenseDomain("charity")).toBe("charity");
  });
  it("an unrecognized/unset type defaults to logistics_projects", () => {
    expect(mapProjectTypeToExpenseDomain("something_new")).toBe("logistics_projects");
    expect(mapProjectTypeToExpenseDomain(null)).toBe("logistics_projects");
    expect(mapProjectTypeToExpenseDomain(undefined)).toBe("logistics_projects");
  });
});

describe("getBusinessDomainLabel", () => {
  it("labels every known domain", () => {
    expect(getBusinessDomainLabel("general_business")).toBe("שוטף");
    expect(getBusinessDomainLabel("property_management")).toBe("ניהול נכסים");
    expect(getBusinessDomainLabel("sales")).toBe("מכירות");
    expect(getBusinessDomainLabel("logistics_projects")).toBe("פרויקטים");
  });
  it("an unrecognized value passes through as-is; unset defaults to שוטף", () => {
    expect(getBusinessDomainLabel("custom_domain")).toBe("custom_domain");
    expect(getBusinessDomainLabel(null)).toBe("שוטף");
    expect(getBusinessDomainLabel(undefined)).toBe("שוטף");
  });
});

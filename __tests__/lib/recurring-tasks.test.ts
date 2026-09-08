import { describe, it, expect } from "vitest";
import { recurringTaskDomainLabel } from "@/lib/recurring-tasks";

describe("recurringTaskDomainLabel", () => {
  it("labels a known expense business domain in Hebrew", () => {
    expect(recurringTaskDomainLabel("sales")).toBe("מכירות");
  });
  it("passes an unrecognized value through as-is", () => {
    expect(recurringTaskDomainLabel("custom_domain")).toBe("custom_domain");
  });
  it("shows a dash for null/undefined/empty", () => {
    expect(recurringTaskDomainLabel(null)).toBe("—");
    expect(recurringTaskDomainLabel(undefined)).toBe("—");
    expect(recurringTaskDomainLabel("")).toBe("—");
  });
});

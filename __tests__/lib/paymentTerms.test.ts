import { describe, it, expect } from "vitest";
import { computeDueDate, normalizePaymentTerms, paymentTermsLabel } from "@/lib/paymentTerms";

describe("computeDueDate", () => {
  it("returns the reference date for immediate / null terms", () => {
    expect(computeDueDate("2026-05-12", "immediate")).toBe("2026-05-12");
    expect(computeDueDate("2026-05-12", null)).toBe("2026-05-12");
    expect(computeDueDate("2026-05-12", undefined)).toBe("2026-05-12");
  });

  it("returns end of month for שוטף (eom)", () => {
    expect(computeDueDate("2026-05-12", "eom")).toBe("2026-05-31");
    expect(computeDueDate("2026-02-03", "eom")).toBe("2026-02-28"); // non-leap
    expect(computeDueDate("2024-02-03", "eom")).toBe("2024-02-29"); // leap
  });

  it("adds N days past end of month for שוטף+N", () => {
    expect(computeDueDate("2026-05-12", "eom_30")).toBe("2026-06-30");
    expect(computeDueDate("2026-05-12", "eom_40")).toBe("2026-07-10");
    expect(computeDueDate("2026-05-12", "eom_60")).toBe("2026-07-30");
  });

  it("ignores the day-of-month — only the month matters for eom terms", () => {
    expect(computeDueDate("2026-05-01", "eom_30")).toBe("2026-06-30");
    expect(computeDueDate("2026-05-31", "eom_30")).toBe("2026-06-30");
  });

  it("handles a trailing time component on the reference date", () => {
    expect(computeDueDate("2026-05-12T09:30:00Z", "eom")).toBe("2026-05-31");
  });

  it("returns null when the reference date is missing", () => {
    expect(computeDueDate(null, "eom_30")).toBeNull();
    expect(computeDueDate("", "eom_30")).toBeNull();
  });
});

describe("normalizePaymentTerms", () => {
  it("keeps known terms and rejects unknown values", () => {
    expect(normalizePaymentTerms("eom_30")).toBe("eom_30");
    expect(normalizePaymentTerms("immediate")).toBe("immediate");
    expect(normalizePaymentTerms("garbage")).toBeNull();
    expect(normalizePaymentTerms(null)).toBeNull();
  });
});

describe("paymentTermsLabel", () => {
  it("labels terms in Hebrew, defaulting null to מיידי", () => {
    expect(paymentTermsLabel("eom_30")).toBe("שוטף+30");
    expect(paymentTermsLabel("eom")).toBe("שוטף");
    expect(paymentTermsLabel(null)).toBe("מיידי");
  });
});

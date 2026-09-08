import { describe, it, expect } from "vitest";
import {
  installmentsPaidSum,
  addMonthsIso,
  evenSplit,
  buildInstallmentRows,
  installmentsSum,
  validateInstallments,
  type InstallmentRow,
} from "@/components/expenses/InstallmentFields";

describe("addMonthsIso", () => {
  it("adds whole months, keeping the same day", () => {
    expect(addMonthsIso("2026-01-15", 1)).toBe("2026-02-15");
  });
  it("clamps into a shorter month", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("returns the input unchanged when it isn't a parseable ISO date", () => {
    expect(addMonthsIso("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("evenSplit", () => {
  it("splits evenly when it divides cleanly", () => {
    expect(evenSplit(300, 3)).toEqual([100, 100, 100]);
  });
  it("puts the rounding remainder on the FIRST row (cents-accurate)", () => {
    const parts = evenSplit(100, 3);
    expect(parts[0]).toBeCloseTo(33.34, 2);
    expect(parts[1]).toBeCloseTo(33.33, 2);
    expect(parts[2]).toBeCloseTo(33.33, 2);
    expect(parts.reduce((s, n) => s + n, 0)).toBeCloseTo(100, 2);
  });
  it("returns [] for a non-positive count", () => {
    expect(evenSplit(100, 0)).toEqual([]);
    expect(evenSplit(100, -1)).toEqual([]);
  });
});

describe("buildInstallmentRows", () => {
  it("builds one row per month, dated from startDate, summing to total", () => {
    const rows = buildInstallmentRows(300, "2026-01-01", 3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(installmentsSum(rows)).toBeCloseTo(300, 2);
  });
});

describe("installmentsSum / installmentsPaidSum", () => {
  const rows: InstallmentRow[] = [
    { date: "2026-01-01", amount: "100", paid: true },
    { date: "2026-02-01", amount: "150", paid: false },
    { date: "2026-03-01", amount: "50" }, // paid unset -> treated as unpaid
  ];
  it("installmentsSum totals every row regardless of paid status", () => {
    expect(installmentsSum(rows)).toBe(300);
  });
  it("installmentsPaidSum totals only the rows marked paid", () => {
    expect(installmentsPaidSum(rows)).toBe(100);
  });
  it("a non-numeric amount contributes 0 rather than NaN-poisoning the total", () => {
    expect(installmentsSum([{ date: "2026-01-01", amount: "oops" }])).toBe(0);
  });
});

describe("validateInstallments", () => {
  const valid: InstallmentRow[] = [
    { date: "2026-01-01", amount: "150" },
    { date: "2026-02-01", amount: "150" },
  ];

  it("accepts a valid 2+ row schedule with no total check", () => {
    expect(validateInstallments(valid)).toBeNull();
  });
  it("rejects fewer than 2 rows", () => {
    expect(validateInstallments([{ date: "2026-01-01", amount: "100" }])).toBe(
      "יש להזין לפחות שני תשלומים."
    );
  });
  it("rejects an invalid/missing date on any row", () => {
    expect(validateInstallments([{ date: "01/01/2026", amount: "100" }, { date: "2026-02-01", amount: "100" }])).toBe(
      "לכל תשלום יש להזין תאריך תקין."
    );
  });
  it("rejects a zero or non-numeric amount on any row", () => {
    expect(validateInstallments([{ date: "2026-01-01", amount: "0" }, { date: "2026-02-01", amount: "100" }])).toBe(
      "לכל תשלום יש להזין סכום גדול מאפס."
    );
  });
  it("when a total is given, rejects a schedule whose rows don't sum to it", () => {
    const error = validateInstallments(valid, 500);
    expect(error).toContain("אינו שווה לסכום הכולל");
  });
  it("accepts a schedule that matches the given total within rounding tolerance", () => {
    expect(validateInstallments(valid, 300)).toBeNull();
    expect(validateInstallments(valid, 300.009)).toBeNull(); // within the 0.01 tolerance
  });
});

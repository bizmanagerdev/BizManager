import { describe, it, expect } from "vitest";
import {
  MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS,
  buildWorkerBonusLabel,
  getWorkerAbsenceTypeLabel,
  itemMonthKey,
  parseBonusAmount,
  parseBonusDate,
  validateSelfReportedBonusDate,
} from "@/lib/payroll-bonuses";

const NOW = new Date(2026, 7, 16, 10, 0, 0); // 16 August 2026, local

describe("parseBonusAmount", () => {
  it("accepts positive money and rounds to agorot", () => {
    expect(parseBonusAmount(300)).toBe(300);
    expect(parseBonusAmount("250.559")).toBe(250.56);
    expect(parseBonusAmount(" 120 ")).toBe(120);
  });

  it("rejects zero, negatives and junk — a bonus is money ADDED", () => {
    expect(parseBonusAmount(0)).toBeNull();
    expect(parseBonusAmount(-50)).toBeNull();
    expect(parseBonusAmount("")).toBeNull();
    expect(parseBonusAmount(null)).toBeNull();
    expect(parseBonusAmount("שלוש מאות")).toBeNull();
  });
});

describe("parseBonusDate", () => {
  it("accepts a YYYY-MM-DD date input value", () => {
    expect(parseBonusDate("2026-08-16")).toBe("2026-08-16");
  });

  it("rejects anything that isn't one", () => {
    expect(parseBonusDate("16/08/2026")).toBeNull();
    expect(parseBonusDate("2026-13-40")).toBeNull();
    expect(parseBonusDate("")).toBeNull();
  });
});

describe("validateSelfReportedBonusDate", () => {
  it("accepts today and recent days", () => {
    expect(validateSelfReportedBonusDate("2026-08-16", NOW)).toEqual({ date: "2026-08-16" });
    expect(validateSelfReportedBonusDate("2026-08-01", NOW)).toEqual({ date: "2026-08-01" });
  });

  it("refuses a future date", () => {
    const result = validateSelfReportedBonusDate("2026-08-17", NOW);
    expect("error" in result).toBe(true);
  });

  it("refuses a claim older than the backdate window", () => {
    // The window is inclusive, so the boundary day itself is still fine.
    const boundary = new Date(NOW);
    boundary.setDate(boundary.getDate() - MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS);
    const boundaryIso = `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, "0")}-${String(
      boundary.getDate()
    ).padStart(2, "0")}`;
    expect(validateSelfReportedBonusDate(boundaryIso, NOW)).toEqual({ date: boundaryIso });

    const tooOld = new Date(NOW);
    tooOld.setDate(tooOld.getDate() - (MAX_SELF_REPORTED_BONUS_BACKDATE_DAYS + 1));
    const tooOldIso = `${tooOld.getFullYear()}-${String(tooOld.getMonth() + 1).padStart(2, "0")}-${String(
      tooOld.getDate()
    ).padStart(2, "0")}`;
    expect("error" in validateSelfReportedBonusDate(tooOldIso, NOW)).toBe(true);
  });
});

describe("labels", () => {
  it("groups an item into the month of its date", () => {
    // The month a bonus lands in — and therefore which payslip adopts it.
    expect(itemMonthKey({ item_date: "2026-08-16" })).toBe("2026-08");
    expect(itemMonthKey({ item_date: null })).toBeNull();
  });

  it("names a bonus by its note when there is one", () => {
    expect(buildWorkerBonusLabel("10 שעות")).toBe("בונוס • 10 שעות");
    expect(buildWorkerBonusLabel("   ")).toBe("בונוס");
    expect(buildWorkerBonusLabel(null)).toBe("בונוס");
  });

  it("falls back to יום חופש for an unknown absence type", () => {
    expect(getWorkerAbsenceTypeLabel("sick")).toBe("מחלה");
    expect(getWorkerAbsenceTypeLabel("nonsense")).toBe("יום חופש");
  });
});

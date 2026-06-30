import { describe, it, expect } from "vitest";
import {
  getString,
  getTodayDate,
  normalizeDateOnly,
  toIso,
  durationHours,
  formatIls,
  isImageAttachment,
} from "@/app/(app)/dashboard/DashboardActions.helpers";

// Characterization tests for the (previously untested) DashboardActions utilities
// that underpin the quick expense / income / session money flows.

describe("getString", () => {
  it("returns string values and '' for anything else", () => {
    expect(getString({ a: "x" }, "a")).toBe("x");
    expect(getString({ a: 5 }, "a")).toBe("");
    expect(getString({}, "missing")).toBe("");
  });
});

describe("getTodayDate", () => {
  it("produces a YYYY-MM-DD string", () => {
    expect(getTodayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("normalizeDateOnly", () => {
  it("keeps only the date part of a timestamp", () => {
    expect(normalizeDateOnly("2024-05-01T09:30")).toBe("2024-05-01");
    expect(normalizeDateOnly("2024-05-01")).toBe("2024-05-01");
    expect(normalizeDateOnly("")).toBe("");
    expect(normalizeDateOnly(null)).toBe("");
  });
});

describe("toIso", () => {
  it("returns an ISO string for valid input and '' for junk", () => {
    expect(toIso("2024-05-01T09:00:00Z")).toBe("2024-05-01T09:00:00.000Z");
    expect(toIso("not-a-date")).toBe("");
  });
});

describe("durationHours", () => {
  it("computes fractional and integer hour spans", () => {
    expect(durationHours("2024-05-01T09:00", "2024-05-01T11:30")).toBe("2.5");
    expect(durationHours("2024-05-01T09:00", "2024-05-01T12:00")).toBe("3");
  });
  it("returns '' when the range is empty or inverted", () => {
    expect(durationHours("2024-05-01T11:00", "2024-05-01T09:00")).toBe("");
    expect(durationHours("bad", "2024-05-01T09:00")).toBe("");
  });
});

describe("formatIls", () => {
  it("renders an em dash for null and a 0-decimal ILS amount otherwise", () => {
    expect(formatIls(null)).toBe("—");
    expect(formatIls(1500)).toContain("1,500");
  });
});

describe("isImageAttachment", () => {
  it("detects images by extension or a photo document_type", () => {
    expect(isImageAttachment({ file_name: "receipt.PNG", document_type: null })).toBe(true);
    // Non-image with no document_type: the optional-chain yields undefined (falsy).
    expect(isImageAttachment({ file_name: "invoice.pdf", document_type: null })).toBeFalsy();
    expect(isImageAttachment({ file_name: "scan", document_type: "receipt_photo" })).toBe(true);
  });
});

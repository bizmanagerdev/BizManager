import { describe, it, expect } from "vitest";
import {
  toNumber,
  normalizeDate,
  normalizePaymentMethod,
  normalizePaymentStatus,
  addDaysToIso,
  chunkStrings,
  uniqueStrings,
  monthKeyFromIso,
  nextMonthDueDate,
  recurringExpenseClampedDate,
} from "@/lib/financial/utils";

describe("toNumber", () => {
  it("passes through finite numbers unchanged", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-5.5)).toBe(-5.5);
  });

  it("parses valid number strings", () => {
    expect(toNumber("100")).toBe(100);
    expect(toNumber("3.14")).toBe(3.14);
    expect(toNumber("  50  ")).toBe(50);
    expect(toNumber("1,234.56")).toBe(1234.56);
  });

  it("returns 0 for null, undefined, empty string, NaN", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(NaN)).toBe(0);
    expect(toNumber(Infinity)).toBe(0);
  });
});

describe("normalizeDate", () => {
  it("passes through YYYY-MM-DD unchanged", () => {
    expect(normalizeDate("2024-03-15")).toBe("2024-03-15");
  });

  it("extracts date prefix from ISO datetime string", () => {
    expect(normalizeDate("2024-03-15T14:30:00Z")).toBe("2024-03-15");
    expect(normalizeDate("2024-03-15T00:00:00+03:00")).toBe("2024-03-15");
  });

  it("returns null for null, undefined, empty string, invalid format", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("15/03/2024")).toBeNull();
    expect(normalizeDate("March 15 2024")).toBeNull();
  });
});

describe("normalizePaymentMethod", () => {
  it("normalizes check variants to 'check'", () => {
    expect(normalizePaymentMethod("check")).toBe("check");
    expect(normalizePaymentMethod("cheque")).toBe("check");
    expect(normalizePaymentMethod("Check")).toBe("check");
    expect(normalizePaymentMethod("Cheque")).toBe("check");
    expect(normalizePaymentMethod("צ'ק")).toBe("check");
  });

  it("lowercases other methods", () => {
    expect(normalizePaymentMethod("Bank Transfer")).toBe("bank transfer");
    expect(normalizePaymentMethod("CASH")).toBe("cash");
    expect(normalizePaymentMethod("Credit")).toBe("credit");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(normalizePaymentMethod(null)).toBe("");
    expect(normalizePaymentMethod(undefined)).toBe("");
    expect(normalizePaymentMethod("")).toBe("");
  });
});

describe("normalizePaymentStatus", () => {
  it("lowercases and trims status", () => {
    expect(normalizePaymentStatus("Cleared")).toBe("cleared");
    expect(normalizePaymentStatus("  PENDING  ")).toBe("pending");
  });

  it("returns null for empty/null/undefined", () => {
    expect(normalizePaymentStatus(null)).toBeNull();
    expect(normalizePaymentStatus(undefined)).toBeNull();
    expect(normalizePaymentStatus("")).toBeNull();
  });
});

describe("addDaysToIso", () => {
  it("adds days to an ISO date", () => {
    expect(addDaysToIso("2024-01-01", 30)).toBe("2024-01-31");
    expect(addDaysToIso("2024-01-31", 1)).toBe("2024-02-01");
  });

  it("handles month/year boundaries", () => {
    expect(addDaysToIso("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDaysToIso("2024-02-28", 1)).toBe("2024-02-29"); // 2024 is a leap year
  });
});

describe("chunkStrings", () => {
  it("splits array into chunks of given size", () => {
    expect(chunkStrings(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunkStrings([], 3)).toEqual([]);
  });

  it("returns single chunk when array is smaller than chunk size", () => {
    expect(chunkStrings(["a", "b"], 10)).toEqual([["a", "b"]]);
  });
});

describe("uniqueStrings", () => {
  it("deduplicates and filters out null/undefined/empty", () => {
    expect(uniqueStrings(["a", "b", "a", null, undefined, "b"])).toEqual(["a", "b"]);
  });

  it("preserves non-empty strings in insertion order", () => {
    expect(uniqueStrings(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });
});

describe("monthKeyFromIso", () => {
  it("extracts YYYY-MM from a date", () => {
    expect(monthKeyFromIso("2024-03-15")).toBe("2024-03");
    expect(monthKeyFromIso("2024-03-15T10:00:00Z")).toBe("2024-03");
  });

  it("returns empty string for invalid input", () => {
    expect(monthKeyFromIso(null)).toBe("");
    expect(monthKeyFromIso(undefined)).toBe("");
  });
});

describe("nextMonthDueDate", () => {
  it("returns the 10th of the next month by default", () => {
    expect(nextMonthDueDate("2024-03-15", 10)).toBe("2024-04-10");
    expect(nextMonthDueDate("2024-12-01", 10)).toBe("2025-01-10");
  });

  it("clamps day to last day of month if needed", () => {
    expect(nextMonthDueDate("2024-01-15", 31)).toBe("2024-02-29"); // Feb 2024 has 29 days
    expect(nextMonthDueDate("2023-01-15", 31)).toBe("2023-02-28");
  });

  it("returns null for invalid input", () => {
    expect(nextMonthDueDate(null, 10)).toBeNull();
    expect(nextMonthDueDate("", 10)).toBeNull();
  });
});

describe("recurringExpenseClampedDate", () => {
  it("clamps the day to the last day of the month", () => {
    expect(recurringExpenseClampedDate(2024, 2, 31)).toBe("2024-02-29");
    expect(recurringExpenseClampedDate(2023, 2, 31)).toBe("2023-02-28");
    expect(recurringExpenseClampedDate(2024, 1, 31)).toBe("2024-01-31");
  });

  it("pads month and day with leading zeros", () => {
    expect(recurringExpenseClampedDate(2024, 3, 5)).toBe("2024-03-05");
  });
});

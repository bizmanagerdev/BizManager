import { describe, it, expect } from "vitest";
import { normalizeIsraeliPhone } from "@/lib/phone";

describe("normalizeIsraeliPhone", () => {
  it("folds a +972 prefix to the local leading 0", () => {
    expect(normalizeIsraeliPhone("+972521234567")).toBe("0521234567");
    expect(normalizeIsraeliPhone("+972 52 123 4567")).toBe("0521234567");
  });
  it("folds a bare 972 prefix (no +) to the local leading 0", () => {
    expect(normalizeIsraeliPhone("972521234567")).toBe("0521234567");
  });
  it("folds a 00972 international-prefix number to the local leading 0", () => {
    expect(normalizeIsraeliPhone("00972521234567")).toBe("0521234567");
  });
  it("folds an 8-digit landline number (972 + 8 digits) too", () => {
    expect(normalizeIsraeliPhone("+97221234567")).toBe("021234567");
  });
  it("leaves an already-local number untouched", () => {
    expect(normalizeIsraeliPhone("052-123-4567")).toBe("052-123-4567");
  });
  it("leaves a genuinely foreign number untouched", () => {
    expect(normalizeIsraeliPhone("+19792664888")).toBe("+19792664888");
    expect(normalizeIsraeliPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });
  it("does not mistake a US number sharing the 972 area code for an Israeli one", () => {
    // (972) 555-1234 is a real Dallas, TX number — only 10 digits, too short
    // to be a +972 Israeli number (which needs 11-12), so it must not fold.
    expect(normalizeIsraeliPhone("9725551234")).toBe("9725551234");
  });
  it("passes through null/undefined/empty unchanged", () => {
    expect(normalizeIsraeliPhone(null)).toBeNull();
    expect(normalizeIsraeliPhone(undefined)).toBeUndefined();
    expect(normalizeIsraeliPhone("")).toBe("");
  });
});

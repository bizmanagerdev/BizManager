import { describe, it, expect } from "vitest";
import { callerMatchesStored } from "@/lib/attendance/phone-match";

describe("callerMatchesStored", () => {
  it("matches identical local numbers", () => {
    expect(callerMatchesStored("0501234567", "0501234567")).toBe(true);
  });

  it("matches a caller without the leading 0 to a stored 0-prefixed number", () => {
    expect(callerMatchesStored("501234567", "0501234567")).toBe(true);
  });

  it("matches a +972 stored number to a local caller", () => {
    expect(callerMatchesStored("0501234567", "+972-50-123-4567")).toBe(true);
  });

  it("rejects different numbers", () => {
    expect(callerMatchesStored("0501234567", "0501111111")).toBe(false);
  });

  it("rejects when either side is empty", () => {
    expect(callerMatchesStored("", "0501234567")).toBe(false);
    expect(callerMatchesStored("0501234567", null)).toBe(false);
  });
});

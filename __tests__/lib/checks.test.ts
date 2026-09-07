import { describe, it, expect } from "vitest";
import { normalizeCheckStatus, checkStatusLabel, checkStatusClasses } from "@/lib/checks";

describe("normalizeCheckStatus", () => {
  it("maps every known 'cleared' synonym to cleared", () => {
    for (const raw of ["cleared", "paid", "collected", "completed", "CLEARED"]) {
      expect(normalizeCheckStatus(raw)).toBe("cleared");
    }
  });
  it("maps every known 'bounced' synonym to bounced", () => {
    for (const raw of ["bounced", "rejected", "returned", "failed"]) {
      expect(normalizeCheckStatus(raw)).toBe("bounced");
    }
  });
  it("defaults to pending for null/unknown values", () => {
    expect(normalizeCheckStatus(null)).toBe("pending");
    expect(normalizeCheckStatus("something_else")).toBe("pending");
  });
});

describe("checkStatusLabel", () => {
  it("labels each status in Hebrew", () => {
    expect(checkStatusLabel("cleared")).toBe("נפרע");
    expect(checkStatusLabel("bounced")).toBe("חזר");
    expect(checkStatusLabel("pending")).toBe("לפירעון");
  });
});

describe("checkStatusClasses", () => {
  it("returns non-empty, status-distinct class strings", () => {
    const cleared = checkStatusClasses("cleared");
    const bounced = checkStatusClasses("bounced");
    const pending = checkStatusClasses("pending");
    expect(cleared).toBeTruthy();
    expect(bounced).toBeTruthy();
    expect(pending).toBeTruthy();
    expect(new Set([cleared, bounced, pending]).size).toBe(3);
  });
});

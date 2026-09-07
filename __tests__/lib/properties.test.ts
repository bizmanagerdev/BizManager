import { describe, it, expect } from "vitest";
import {
  propertyDisplayName,
  leaseStatusLabel,
  depositTypeLabel,
  propertyTypeLabel,
  propertyHasRoomLayout,
  pickCurrentLease,
  type LeaseAgreement,
} from "@/lib/properties";

describe("propertyDisplayName", () => {
  it("prefers the name when set", () => {
    expect(propertyDisplayName({ name: "בית הלר", address: "הרצל 1" })).toBe("בית הלר");
  });
  it("falls back to the address when the name is empty/whitespace/unset", () => {
    expect(propertyDisplayName({ name: null, address: "הרצל 1" })).toBe("הרצל 1");
    expect(propertyDisplayName({ name: "   ", address: "הרצל 1" })).toBe("הרצל 1");
    expect(propertyDisplayName({ address: "הרצל 1" })).toBe("הרצל 1");
  });
});

describe("label helpers", () => {
  it("leaseStatusLabel covers every known status and echoes an unknown one", () => {
    expect(leaseStatusLabel("active")).toBe("פעיל");
    expect(leaseStatusLabel("ended")).toBe("הסתיים");
    expect(leaseStatusLabel("cancelled")).toBe("בוטל");
    expect(leaseStatusLabel("weird")).toBe("weird");
    expect(leaseStatusLabel(null)).toBe("—");
  });
  it("depositTypeLabel covers every known type", () => {
    expect(depositTypeLabel("cash")).toBe("פיקדון כספי");
    expect(depositTypeLabel("bank_guarantee")).toBe("ערבות בנקאית");
    expect(depositTypeLabel("security_check")).toBe("צ'ק ביטחון");
    expect(depositTypeLabel(null)).toBe("");
  });
  it("propertyTypeLabel covers every known type and blanks an unknown one", () => {
    expect(propertyTypeLabel("apartment")).toBe("דירה");
    expect(propertyTypeLabel("storage")).toBe("מחסן");
    expect(propertyTypeLabel("spaceship")).toBe("");
  });
});

describe("propertyHasRoomLayout", () => {
  it("is false only for storage — every other type (including unset) keeps room fields", () => {
    expect(propertyHasRoomLayout("storage")).toBe(false);
    expect(propertyHasRoomLayout("apartment")).toBe(true);
    expect(propertyHasRoomLayout(null)).toBe(true);
  });
});

function lease(overrides: Partial<LeaseAgreement>): LeaseAgreement {
  return {
    id: "lease-1",
    propertyId: "prop-1",
    customerId: "cust-1",
    customerName: "שוכר",
    startDate: "2024-01-01",
    endDate: null,
    monthlyRentAmount: 3000,
    documentId: null,
    documentFileName: null,
    documentUrl: null,
    status: "active",
    notes: null,
    depositType: null,
    depositAmount: null,
    depositReference: null,
    keysHandedOver: null,
    createdAt: null,
    ...overrides,
  };
}

describe("pickCurrentLease", () => {
  it("returns null for an empty list", () => {
    expect(pickCurrentLease([])).toBeNull();
  });

  it("prefers the active, open-ended lease over an older ended one", () => {
    const active = lease({ id: "active", status: "active", endDate: null, startDate: "2024-01-01" });
    const ended = lease({ id: "ended", status: "ended", endDate: "2023-12-31", startDate: "2020-01-01" });
    expect(pickCurrentLease([ended, active])?.id).toBe("active");
  });

  it("an active lease whose end date is still in the future counts as open", () => {
    const active = lease({ id: "active-future-end", status: "active", endDate: "2999-01-01" });
    expect(pickCurrentLease([active])?.id).toBe("active-future-end");
  });

  it("an active lease that already ended does NOT count as open", () => {
    const staleActive = lease({ id: "stale", status: "active", endDate: "2000-01-01", startDate: "1999-01-01" });
    const newerEnded = lease({ id: "newer-ended", status: "ended", endDate: "2020-01-01", startDate: "2010-01-01" });
    // Neither is "open", so it falls back to the most recently STARTED lease of any status.
    expect(pickCurrentLease([staleActive, newerEnded])?.id).toBe("newer-ended");
  });

  it("falls back to the most recently started lease when none is open", () => {
    const older = lease({ id: "older", status: "ended", startDate: "2020-01-01" });
    const newer = lease({ id: "newer", status: "ended", startDate: "2022-01-01" });
    expect(pickCurrentLease([older, newer])?.id).toBe("newer");
  });
});

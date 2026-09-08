import { describe, it, expect } from "vitest";
import {
  sanitizeSectionAccess,
  hasSectionAccess,
  hasDeliveriesAccess,
  firstAccessiblePrefix,
  DEFAULT_SECTION_ACCESS,
} from "@/lib/auth/sections";

describe("sanitizeSectionAccess", () => {
  it("passes through a fully-shaped, valid object unchanged", () => {
    const access = { dashboard: false, deliveries: true, tasks: false, calendar: true, vehicles: true };
    expect(sanitizeSectionAccess(access)).toEqual(access);
  });

  it("fills in missing keys from the default, per-key — not all-or-nothing", () => {
    // vehicles omitted: should default to false (its own default), not inherit
    // some other section's value or make the whole object fall back.
    const result = sanitizeSectionAccess({ dashboard: false });
    expect(result).toEqual({ ...DEFAULT_SECTION_ACCESS, dashboard: false });
  });

  it("ignores a non-boolean value for a key and falls back to its default", () => {
    const result = sanitizeSectionAccess({ deliveries: "yes" });
    expect(result.deliveries).toBe(DEFAULT_SECTION_ACCESS.deliveries);
  });

  it("null/undefined/non-object input safely returns all defaults", () => {
    expect(sanitizeSectionAccess(null)).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess(undefined)).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess("garbage")).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess(42)).toEqual(DEFAULT_SECTION_ACCESS);
  });

  it("vehicles defaults to OFF (new capability, not silently granted) while the other four default ON", () => {
    expect(DEFAULT_SECTION_ACCESS.vehicles).toBe(false);
    expect(DEFAULT_SECTION_ACCESS.dashboard).toBe(true);
    expect(DEFAULT_SECTION_ACCESS.deliveries).toBe(true);
    expect(DEFAULT_SECTION_ACCESS.tasks).toBe(true);
    expect(DEFAULT_SECTION_ACCESS.calendar).toBe(true);
  });
});

describe("hasSectionAccess — the actual security boundary", () => {
  const allOff = { dashboard: false, deliveries: false, tasks: false, calendar: false, vehicles: false };

  it("staff (admin/office) always has access, regardless of the flag", () => {
    expect(hasSectionAccess("admin", allOff, "vehicles")).toBe(true);
    expect(hasSectionAccess("office", allOff, "dashboard")).toBe(true);
  });
  it("a worker is gated strictly by their own section_access flag", () => {
    expect(hasSectionAccess("worker", allOff, "vehicles")).toBe(false);
    expect(hasSectionAccess("worker", { ...allOff, vehicles: true }, "vehicles")).toBe(true);
  });
});

describe("hasDeliveriesAccess", () => {
  it("is the deliveries slice of hasSectionAccess", () => {
    const access = { ...DEFAULT_SECTION_ACCESS, deliveries: false };
    expect(hasDeliveriesAccess("worker", access)).toBe(false);
    expect(hasDeliveriesAccess("admin", access)).toBe(true);
  });
});

describe("firstAccessiblePrefix", () => {
  it("returns the first section (in WORKER_SECTIONS order) the worker can reach", () => {
    expect(
      firstAccessiblePrefix({ dashboard: false, deliveries: false, tasks: true, calendar: true, vehicles: true })
    ).toBe("/tasks");
  });
  it("dashboard wins when accessible, since it's first in the priority order", () => {
    expect(firstAccessiblePrefix(DEFAULT_SECTION_ACCESS)).toBe("/dashboard");
  });
  it("null when every section is off — nowhere sane to send them", () => {
    expect(
      firstAccessiblePrefix({ dashboard: false, deliveries: false, tasks: false, calendar: false, vehicles: false })
    ).toBeNull();
  });
});

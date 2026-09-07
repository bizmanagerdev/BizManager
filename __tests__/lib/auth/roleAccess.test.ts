import { describe, it, expect } from "vitest";
import {
  DEFAULT_SECTION_ACCESS,
  WORKER_ALLOWED_PREFIXES,
  WORKER_SECTIONS,
  firstAccessiblePrefix,
  hasDeliveriesAccess,
  hasSectionAccess,
  isPathAllowedForRole,
  isStaffRole,
  sanitizeSectionAccess,
  type SectionAccess,
} from "@/lib/auth/roleAccess";

// The worker route allow-list is the one place that decides what a logged-in
// worker can reach. Both the navigation and the page guards read it, so a
// mistake here silently opens (or closes) a whole screen. These cases pin the
// two things that are easy to get wrong: prefix matching on SEGMENTS, and the
// fact that "not on the list" means denied rather than allowed.

const NONE_ENABLED: SectionAccess = {
  dashboard: false,
  deliveries: false,
  tasks: false,
  calendar: false,
  vehicles: false,
};

describe("isStaffRole", () => {
  it("is admin and office only", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("office")).toBe(true);
    expect(isStaffRole("worker")).toBe(false);
    expect(isStaffRole("worker_no_access")).toBe(false);
  });
});

describe("isPathAllowedForRole — staff", () => {
  it("lets staff anywhere, regardless of section access", () => {
    for (const path of ["/financial", "/payroll", "/settings", "/deliveries", "/my"]) {
      expect(isPathAllowedForRole("admin", path, NONE_ENABLED)).toBe(true);
      expect(isPathAllowedForRole("office", path, NONE_ENABLED)).toBe(true);
    }
  });
});

describe("isPathAllowedForRole — worker, infra prefixes", () => {
  it("allows every WORKER_ALLOWED_PREFIXES entry (and their children) even with every section off", () => {
    for (const prefix of WORKER_ALLOWED_PREFIXES) {
      expect(isPathAllowedForRole("worker", prefix, NONE_ENABLED)).toBe(true);
      expect(isPathAllowedForRole("worker", `${prefix}/123`, NONE_ENABLED)).toBe(true);
    }
  });

  it("blocks the staff screens", () => {
    const blocked = [
      "/financial",
      "/financial/reports",
      "/payroll",
      "/settings",
      "/customers",
      "/customers/abc",
      "/projects",
      "/sales",
      "/sales/orders/abc",
      "/inventory",
      "/documents",
      "/search",
      "/activity",
      "/collections",
    ];
    for (const path of blocked) {
      expect(isPathAllowedForRole("worker", path, DEFAULT_SECTION_ACCESS)).toBe(false);
    }
  });

  it("matches on path segments, so a lookalike prefix is not swallowed", () => {
    // Granting dashboard/tasks so a denial here can only mean the segment
    // match failed, not that the section itself was off.
    const access = { ...DEFAULT_SECTION_ACCESS, dashboard: true, tasks: true };
    expect(isPathAllowedForRole("worker", "/tasksecret", access)).toBe(false);
    expect(isPathAllowedForRole("worker", "/dashboard-admin", access)).toBe(false);
    expect(isPathAllowedForRole("worker", "/mystuff", access)).toBe(false);
  });

  it("ignores a trailing slash and a query string", () => {
    expect(isPathAllowedForRole("worker", "/tasks/", DEFAULT_SECTION_ACCESS)).toBe(true);
    expect(isPathAllowedForRole("worker", "/deliveries?region=מרכז", DEFAULT_SECTION_ACCESS)).toBe(true);
    expect(isPathAllowedForRole("worker", "/financial?tab=x", DEFAULT_SECTION_ACCESS)).toBe(false);
  });

  it("denies everything for a no-access worker, regardless of section access", () => {
    for (const prefix of WORKER_ALLOWED_PREFIXES) {
      expect(isPathAllowedForRole("worker_no_access", prefix, DEFAULT_SECTION_ACCESS)).toBe(false);
    }
  });
});

describe("isPathAllowedForRole — worker, WORKER_SECTIONS", () => {
  it("allows a section's prefix (and its children) only when granted", () => {
    for (const section of WORKER_SECTIONS) {
      const granted = { ...NONE_ENABLED, [section.id]: true };
      expect(isPathAllowedForRole("worker", section.prefix, granted)).toBe(true);
      expect(isPathAllowedForRole("worker", `${section.prefix}/123`, granted)).toBe(true);
      expect(isPathAllowedForRole("worker", section.prefix, NONE_ENABLED)).toBe(false);
    }
  });
});

describe("hasSectionAccess", () => {
  it("is the admin-set per-worker flag for a worker", () => {
    expect(hasSectionAccess("worker", { ...DEFAULT_SECTION_ACCESS, vehicles: true }, "vehicles")).toBe(true);
    expect(hasSectionAccess("worker", { ...DEFAULT_SECTION_ACCESS, vehicles: false }, "vehicles")).toBe(false);
  });

  it("staff always have every section, regardless of the map", () => {
    expect(hasSectionAccess("admin", NONE_ENABLED, "vehicles")).toBe(true);
    expect(hasSectionAccess("office", NONE_ENABLED, "dashboard")).toBe(true);
  });
});

describe("hasDeliveriesAccess", () => {
  it("is the admin-set per-worker flag for a worker", () => {
    expect(hasDeliveriesAccess("worker", { ...DEFAULT_SECTION_ACCESS, deliveries: true })).toBe(true);
    expect(hasDeliveriesAccess("worker", { ...DEFAULT_SECTION_ACCESS, deliveries: false })).toBe(false);
  });

  it("staff always have it, regardless of the flag", () => {
    expect(hasDeliveriesAccess("admin", NONE_ENABLED)).toBe(true);
    expect(hasDeliveriesAccess("office", NONE_ENABLED)).toBe(true);
  });
});

describe("sanitizeSectionAccess", () => {
  it("falls back to DEFAULT_SECTION_ACCESS for a missing/malformed value", () => {
    expect(sanitizeSectionAccess(null)).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess(undefined)).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess("not an object")).toEqual(DEFAULT_SECTION_ACCESS);
    expect(sanitizeSectionAccess({})).toEqual(DEFAULT_SECTION_ACCESS);
  });

  it("keeps only known boolean keys, defaulting the rest", () => {
    const result = sanitizeSectionAccess({ vehicles: true, deliveries: "yes", junk: true });
    expect(result.vehicles).toBe(true);
    // "yes" isn't a boolean — falls back to the default for that key.
    expect(result.deliveries).toBe(DEFAULT_SECTION_ACCESS.deliveries);
    expect(result).not.toHaveProperty("junk");
  });
});

describe("firstAccessiblePrefix", () => {
  it("returns the first enabled section's prefix, in WORKER_SECTIONS order", () => {
    expect(firstAccessiblePrefix({ ...NONE_ENABLED, calendar: true, vehicles: true })).toBe("/calendar");
  });

  it("returns null when nothing is enabled", () => {
    expect(firstAccessiblePrefix(NONE_ENABLED)).toBeNull();
  });
});

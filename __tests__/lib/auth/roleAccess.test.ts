import { describe, it, expect } from "vitest";
import {
  WORKER_ALLOWED_PREFIXES,
  hasDeliveriesAccess,
  isPathAllowedForRole,
  isStaffRole,
} from "@/lib/auth/roleAccess";

// The worker route allow-list is the one place that decides what a logged-in
// worker can reach. Both the navigation and the page guards read it, so a
// mistake here silently opens (or closes) a whole screen. These cases pin the
// two things that are easy to get wrong: prefix matching on SEGMENTS, and the
// fact that "not on the list" means denied rather than allowed.

describe("isStaffRole", () => {
  it("is admin and office only", () => {
    expect(isStaffRole("admin")).toBe(true);
    expect(isStaffRole("office")).toBe(true);
    expect(isStaffRole("worker")).toBe(false);
    expect(isStaffRole("worker_no_access")).toBe(false);
  });
});

describe("isPathAllowedForRole — staff", () => {
  it("lets staff anywhere", () => {
    for (const path of ["/financial", "/payroll", "/settings", "/deliveries", "/my"]) {
      expect(isPathAllowedForRole("admin", path)).toBe(true);
      expect(isPathAllowedForRole("office", path)).toBe(true);
    }
  });
});

describe("isPathAllowedForRole — worker", () => {
  it("allows every prefix on the list, and their children", () => {
    for (const prefix of WORKER_ALLOWED_PREFIXES) {
      expect(isPathAllowedForRole("worker", prefix)).toBe(true);
      expect(isPathAllowedForRole("worker", `${prefix}/123`)).toBe(true);
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
      expect(isPathAllowedForRole("worker", path)).toBe(false);
    }
  });

  it("matches on path segments, so a lookalike prefix is not swallowed", () => {
    // A bare startsWith would let these through.
    expect(isPathAllowedForRole("worker", "/tasksecret")).toBe(false);
    expect(isPathAllowedForRole("worker", "/dashboard-admin")).toBe(false);
    expect(isPathAllowedForRole("worker", "/mystuff")).toBe(false);
  });

  it("ignores a trailing slash and a query string", () => {
    expect(isPathAllowedForRole("worker", "/tasks/")).toBe(true);
    expect(isPathAllowedForRole("worker", "/deliveries?region=מרכז")).toBe(true);
    expect(isPathAllowedForRole("worker", "/financial?tab=x")).toBe(false);
  });

  it("denies everything for a no-access worker", () => {
    for (const prefix of WORKER_ALLOWED_PREFIXES) {
      expect(isPathAllowedForRole("worker_no_access", prefix)).toBe(false);
    }
  });
});

describe("hasDeliveriesAccess", () => {
  it("is the admin-set per-worker flag for a worker", () => {
    expect(hasDeliveriesAccess("worker", true)).toBe(true);
    expect(hasDeliveriesAccess("worker", false)).toBe(false);
  });

  it("staff always have it, regardless of the flag", () => {
    expect(hasDeliveriesAccess("admin", false)).toBe(true);
    expect(hasDeliveriesAccess("office", false)).toBe(true);
  });
});

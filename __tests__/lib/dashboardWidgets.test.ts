import { describe, it, expect } from "vitest";
import {
  resolveWidgets,
  orderedCatalog,
  sanitizePrefs,
  catalogForRole,
  type DashboardPrefs,
} from "@/lib/dashboard/widgets";

describe("resolveWidgets — role is the security boundary", () => {
  it("never surfaces office/admin widgets for a worker, even if prefs name them", () => {
    // A worker tries (via a tampered/stale pref) to show finance + workforce.
    const prefs: DashboardPrefs = {
      order: ["finance", "workforce", "myTasks", "alerts"],
      hidden: [],
    };
    const ids = resolveWidgets("worker", prefs).map((w) => w.id);
    expect(ids).not.toContain("finance");
    expect(ids).not.toContain("workforce");
    // Worker still sees only their allowed (personal) widgets.
    expect(ids.every((id) => catalogForRole("worker").some((w) => w.id === id))).toBe(true);
    expect(ids).toContain("myTasks");
  });

  it("office sees the sales/collections catalog but not admin-only widgets", () => {
    const ids = resolveWidgets("office", null).map((w) => w.id);
    expect(ids).toContain("finance");
    expect(ids).toContain("deliveries");
    expect(ids).not.toContain("activity"); // admin-only
  });
});

describe("resolveWidgets — order & visibility", () => {
  it("respects the user's saved order", () => {
    const prefs: DashboardPrefs = {
      order: ["myTasks", "alerts", "finance"],
      hidden: [],
    };
    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids.indexOf("myTasks")).toBeLessThan(ids.indexOf("alerts"));
    expect(ids.indexOf("alerts")).toBeLessThan(ids.indexOf("finance"));
  });

  it("drops hidden widgets but keeps them in the customizer catalog", () => {
    const prefs: DashboardPrefs = { order: [], hidden: ["inventory", "workforce"] };
    const rendered = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(rendered).not.toContain("inventory");
    expect(rendered).not.toContain("workforce");
    // orderedCatalog still lists them so they can be toggled back on.
    const catalog = orderedCatalog("admin", prefs).map((w) => w.id);
    expect(catalog).toContain("inventory");
    expect(catalog).toContain("workforce");
  });

  it("places unknown/new ids at their default position and tolerates junk", () => {
    // Only "finance" is explicitly ordered; everything else keeps default order
    // AFTER it. A future widget not present in saved order must still appear.
    const prefs = sanitizePrefs({
      order: ["finance", "not-a-widget", 42, "finance"],
      hidden: ["also-bogus"],
    });
    expect(prefs).toEqual({ order: ["finance"], hidden: [] });

    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids[0]).toBe("finance");
    // Default-order widgets (e.g. week, alerts, myTasks) still render.
    expect(ids).toContain("week");
    expect(ids).toContain("myTasks");
    expect(ids.length).toBe(catalogForRole("admin").length);
  });
});

describe("sanitizePrefs", () => {
  it("returns null for non-object input", () => {
    expect(sanitizePrefs(null)).toBeNull();
    expect(sanitizePrefs("nope")).toBeNull();
    expect(sanitizePrefs(123)).toBeNull();
  });

  it("de-dupes order and strips unknown ids", () => {
    expect(sanitizePrefs({ order: ["alerts", "alerts", "ghost"], hidden: ["finance", "finance"] })).toEqual({
      order: ["alerts"],
      hidden: ["finance"],
    });
  });
});

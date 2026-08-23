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
    // A worker tries (via a tampered/stale pref) to show the back-office cards.
    const prefs: DashboardPrefs = {
      order: ["domainChart", "attendanceQueue", "myTasks", "todaySchedule"],
      hidden: [],
    };
    const ids = resolveWidgets("worker", prefs).map((w) => w.id);
    expect(ids).not.toContain("domainChart");
    expect(ids).not.toContain("attendanceQueue");
    // Worker still sees only their allowed (personal) widgets.
    expect(ids.every((id) => catalogForRole("worker").some((w) => w.id === id))).toBe(true);
    expect(ids).toContain("myTasks");
  });

  it("office sees the sales/collections catalog, and only role-allowed widgets", () => {
    const ids = resolveWidgets("office", null).map((w) => w.id);
    expect(ids).toContain("domainChart");
    expect(ids).toContain("deliveries");
    expect(ids.every((id) => catalogForRole("office").some((w) => w.id === id))).toBe(true);
  });

  it("worker sees deliveries by default, but not when the admin-set toggle is off", () => {
    expect(resolveWidgets("worker", null).map((w) => w.id)).toContain("deliveries");
    expect(resolveWidgets("worker", null, true).map((w) => w.id)).toContain("deliveries");
    expect(resolveWidgets("worker", null, false).map((w) => w.id)).not.toContain("deliveries");
  });

  it("the per-worker deliveries toggle never affects office/admin", () => {
    expect(resolveWidgets("office", null, false).map((w) => w.id)).toContain("deliveries");
    expect(resolveWidgets("admin", null, false).map((w) => w.id)).toContain("deliveries");
  });
});

describe("resolveWidgets — order & visibility", () => {
  it("respects the user's saved order", () => {
    const prefs: DashboardPrefs = {
      order: ["myTasks", "todaySchedule", "deliveries"],
      hidden: [],
    };
    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids.indexOf("myTasks")).toBeLessThan(ids.indexOf("todaySchedule"));
    expect(ids.indexOf("todaySchedule")).toBeLessThan(ids.indexOf("deliveries"));
  });

  it("drops hidden widgets but keeps them in the customizer catalog", () => {
    const prefs: DashboardPrefs = { order: [], hidden: ["deliveries", "attendanceQueue"] };
    const rendered = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(rendered).not.toContain("deliveries");
    expect(rendered).not.toContain("attendanceQueue");
    // orderedCatalog still lists them so they can be toggled back on.
    const catalog = orderedCatalog("admin", prefs).map((w) => w.id);
    expect(catalog).toContain("deliveries");
    expect(catalog).toContain("attendanceQueue");
  });

  it("places unknown/new ids at their default position and tolerates junk", () => {
    // Only "deliveries" is explicitly ordered; everything else keeps default order
    // AFTER it. A future widget not present in saved order must still appear.
    const prefs = sanitizePrefs({
      order: ["deliveries", "not-a-widget", 42, "deliveries"],
      hidden: ["also-bogus"],
    });
    expect(prefs).toEqual({ order: ["deliveries"], hidden: [] });

    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids[0]).toBe("deliveries");
    // Default-order widgets (e.g. the היום cards, myTasks) still render.
    expect(ids).toContain("todaySchedule");
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
    expect(sanitizePrefs({ order: ["myTasks", "myTasks", "ghost"], hidden: ["deliveries", "deliveries"] })).toEqual({
      order: ["myTasks"],
      hidden: ["deliveries"],
    });
  });

  it("drops RETIRED widget ids from saved prefs without breaking the board", () => {
    // "alerts" + "reminders" merged into "today" (2026-07-16), and "week" — the
    // "מבט על היום" card — merged into it too (2026-08-16). Users still have all
    // three in their saved order/hidden; those must be ignored, not crash, and
    // above all not hide the cards that replaced them.
    const prefs = sanitizePrefs({
      order: ["alerts", "myTasks", "reminders", "week"],
      hidden: ["reminders", "week"],
    });
    expect(prefs).toEqual({ order: ["myTasks"], hidden: [] });

    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids).toContain("myTasks");
    expect(ids).not.toContain("alerts");
    expect(ids).not.toContain("reminders");
    expect(ids).not.toContain("week");
  });

  it("a user who had hidden 'week' still gets the היום cards", () => {
    // The trap this guards: `hidden: ["week"]` used to hide the schedule card.
    // "week" is no longer a widget id, so it must be dropped from `hidden` rather
    // than carried over onto the היום cards — otherwise the merge would silently
    // blank the dashboard for everyone who'd turned the old card off.
    const ids = resolveWidgets("admin", sanitizePrefs({ order: [], hidden: ["week"] })).map((w) => w.id);
    expect(ids).toContain("todaySchedule");
    expect(ids).toContain("todayAlerts");
  });
});

describe("sanitizePrefs — the 'today' → two-card split (2026-08-17)", () => {
  it("expands a saved 'today' into both cards, in its old slot", () => {
    const prefs = sanitizePrefs({ order: ["myTasks", "today", "deliveries"], hidden: [] });
    expect(prefs).toEqual({
      order: ["myTasks", "todaySchedule", "todayAlerts", "deliveries"],
      hidden: [],
    });

    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids.indexOf("myTasks")).toBeLessThan(ids.indexOf("todaySchedule"));
    expect(ids.indexOf("todayAlerts")).toBeLessThan(ids.indexOf("deliveries"));
  });

  it("carries a hidden 'today' onto BOTH new cards", () => {
    // Someone who had turned the old היום card off must not get half of it back.
    const prefs = sanitizePrefs({ order: [], hidden: ["today"] });
    expect(prefs?.hidden).toEqual(["todaySchedule", "todayAlerts"]);

    const ids = resolveWidgets("admin", prefs).map((w) => w.id);
    expect(ids).not.toContain("todaySchedule");
    expect(ids).not.toContain("todayAlerts");
  });

  it("does not duplicate when saved prefs name both the old and a new id", () => {
    const prefs = sanitizePrefs({ order: ["today", "todaySchedule"], hidden: [] });
    expect(prefs).toEqual({ order: ["todaySchedule", "todayAlerts"], hidden: [] });
  });
});

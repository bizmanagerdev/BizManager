import { describe, it, expect } from "vitest";
import {
  visibleAudienceRoles,
  sanitizeWorklistPrefs,
  orderedWorklistSections,
  WORKLIST_SECTIONS,
} from "@/lib/reminders/worklist";
import { reminderBucket } from "@/lib/notifications/categories";
import { digestTablesForRole } from "@/lib/audit";
import { getDunningStages } from "@/lib/notifications/alert-config";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("visibleAudienceRoles", () => {
  it("admin sees all buckets", () => {
    expect(visibleAudienceRoles("admin").sort()).toEqual(["admin", "all", "office"]);
  });
  it("office sees all + office but not admin", () => {
    const r = visibleAudienceRoles("office");
    expect(r).toContain("office");
    expect(r).toContain("all");
    expect(r).not.toContain("admin");
  });
  it("worker (and null) sees only 'all'", () => {
    expect(visibleAudienceRoles("worker")).toEqual(["all"]);
    expect(visibleAudienceRoles(null)).toEqual(["all"]);
  });
});

describe("sanitizeWorklistPrefs", () => {
  it("returns null for non-objects", () => {
    expect(sanitizeWorklistPrefs(null)).toBeNull();
    expect(sanitizeWorklistPrefs("x")).toBeNull();
  });
  it("keeps only known section ids and de-dupes order", () => {
    const p = sanitizeWorklistPrefs({ order: ["tasks", "tasks", "money", "bogus"], hidden: ["ops", "ops", "nope"] });
    expect(p?.order).toEqual(["tasks", "money"]);
    expect(p?.hidden).toEqual(["ops"]);
  });
});

describe("orderedWorklistSections", () => {
  it("defaults to the catalog order with no prefs", () => {
    expect(orderedWorklistSections(null).map((s) => s.id)).toEqual(WORKLIST_SECTIONS.map((s) => s.id));
  });
  it("puts saved-order sections first", () => {
    const ordered = orderedWorklistSections({ order: ["money", "tasks"], hidden: [] });
    expect(ordered[0].id).toBe("money");
    expect(ordered[1].id).toBe("tasks");
  });
});

describe("reminderBucket", () => {
  it("maps system rule keys to buckets", () => {
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "collection_overdue:order:1:7" })).toBe("money");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "check_deposit_due:1" })).toBe("money");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "task_overdue:1" })).toBe("tasks");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "stale_quote:1" })).toBe("projects");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "project_closed_unbilled:1" })).toBe("projects");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "wage_overdue:1" })).toBe("payroll");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "nightly_review:2026-07-03" })).toBe("nightly");
  });
  it("maps manual reminder categories", () => {
    expect(reminderBucket({ source: "manual", category: "task", dedupeKey: null })).toBe("tasks");
    expect(reminderBucket({ source: "manual", category: "collection", dedupeKey: null })).toBe("money");
    expect(reminderBucket({ source: "manual", category: "whatever", dedupeKey: null })).toBe("reminders");
  });
});

describe("digestTablesForRole", () => {
  it("admin sees the sensitive tables, office does not", () => {
    const admin = digestTablesForRole("admin");
    const office = digestTablesForRole("office");
    expect(admin).toContain("worker_payments");
    expect(admin).toContain("users");
    expect(office).toContain("orders");
    expect(office).not.toContain("worker_payments");
    expect(office).not.toContain("users");
  });
});

describe("getDunningStages", () => {
  it("falls back to the default ladder when the table is missing", async () => {
    const fake = {
      from: () => ({
        select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "no table" } }) }) }),
      }),
    } as unknown as SupabaseClient;
    const stages = await getDunningStages(fake);
    expect(stages.length).toBeGreaterThanOrEqual(4);
    expect(stages[0].offset).toBe(0);
    expect(stages.every((s) => ["info", "warning", "danger"].includes(s.severity))).toBe(true);
  });
});

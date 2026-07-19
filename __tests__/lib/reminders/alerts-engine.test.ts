import { describe, it, expect } from "vitest";
import { visibleAudienceRoles, ownAudienceRoles } from "@/lib/reminders/worklist";
import { sanitizeNotificationPrefs, shouldPushNow, DEFAULT_PREFS } from "@/lib/notifications/prefs";
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

describe("visibility vs delivery — must stay separate", () => {
  // These two were once conflated: the owner-first (delivery) rule was applied to
  // the read model, which silently hid ~12 of the 16 rules — project_closed_unbilled,
  // payment_due_today, collection_overdue, low_stock… — from every admin's inbox,
  // dashboard card AND nav badges, because those rules target 'office'.
  //
  // The contract: SEE broadly (visibleAudienceRoles), get INTERRUPTED narrowly
  // (ownAudienceRoles + subscribe). An admin must be able to see office findings.
  const OFFICE_TARGETED = "office";

  it("admin can SEE office-targeted findings (inbox/badges must not hide them)", () => {
    expect(visibleAudienceRoles("admin")).toContain(OFFICE_TARGETED);
  });

  it("admin is NOT pushed office-targeted findings by default", () => {
    expect(ownAudienceRoles("admin")).not.toContain(OFFICE_TARGETED);
  });

  it("visibility is a superset of delivery for every role", () => {
    for (const role of ["admin", "office", "worker", null]) {
      const seen = visibleAudienceRoles(role);
      for (const bucket of ownAudienceRoles(role)) {
        expect(seen).toContain(bucket);
      }
    }
  });
});

describe("ownAudienceRoles — owner-first delivery", () => {
  it("admin does NOT automatically receive the office bucket", () => {
    expect(ownAudienceRoles("admin")).not.toContain("office");
    expect(ownAudienceRoles("admin").sort()).toEqual(["admin", "all"]);
  });
  it("office still receives its own desk — their work must not go quiet", () => {
    expect(ownAudienceRoles("office")).toContain("office");
    expect(ownAudienceRoles("office")).not.toContain("admin");
  });
  it("worker (and null) only receives 'all'", () => {
    expect(ownAudienceRoles("worker")).toEqual(["all"]);
    expect(ownAudienceRoles(null)).toEqual(["all"]);
  });
  it("permission ceiling stays wider than the delivery default", () => {
    // admin CAN see office items (e.g. to act on them) but doesn't get them pushed.
    expect(visibleAudienceRoles("admin")).toContain("office");
    expect(ownAudienceRoles("admin")).not.toContain("office");
  });
});

describe("sanitizeNotificationPrefs", () => {
  it("defaults to summary @08:00 with no subscriptions", () => {
    expect(sanitizeNotificationPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizeNotificationPrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(sanitizeNotificationPrefs(undefined).delivery).toBe("summary");
  });
  it("upgrades a legacy { muted, push_paused } row without losing it", () => {
    const p = sanitizeNotificationPrefs({ muted: ["payroll"], push_paused: true });
    expect(p.muted).toEqual(["payroll"]);
    expect(p.push_paused).toBe(true);
    expect(p.delivery).toBe("summary");
    expect(p.summary_hour).toBe(8);
  });
  it("rejects junk: bad mode, out-of-range hour, unknown buckets", () => {
    const p = sanitizeNotificationPrefs({
      delivery: "hourly",
      summary_hour: 99,
      subscribe: ["money", "not-a-bucket"],
      muted: ["ghost"],
    });
    expect(p.delivery).toBe("summary");
    expect(p.summary_hour).toBe(8);
    expect(p.subscribe).toEqual(["money"]);
    expect(p.muted).toEqual([]);
  });
  it("accepts a valid custom hour (per-user summary time)", () => {
    expect(sanitizeNotificationPrefs({ summary_hour: 0 }).summary_hour).toBe(0);
    expect(sanitizeNotificationPrefs({ summary_hour: 23 }).summary_hour).toBe(23);
  });
});

describe("shouldPushNow — delivery modes govern AUTOMATIC alerts only", () => {
  const prefs = (over: Partial<typeof DEFAULT_PREFS>) => ({ ...DEFAULT_PREFS, ...over });

  it("summary: nothing automatic interrupts — it waits for the digest", () => {
    expect(shouldPushNow(prefs({ delivery: "summary" }), "danger")).toBe(false);
    expect(shouldPushNow(prefs({ delivery: "summary" }), "info")).toBe(false);
  });
  it("summary_urgent: only danger interrupts", () => {
    expect(shouldPushNow(prefs({ delivery: "summary_urgent" }), "danger")).toBe(true);
    expect(shouldPushNow(prefs({ delivery: "summary_urgent" }), "warning")).toBe(false);
  });
  it("all: everything interrupts", () => {
    expect(shouldPushNow(prefs({ delivery: "all" }), "info")).toBe(true);
  });
  it("push_paused beats every mode", () => {
    expect(shouldPushNow(prefs({ delivery: "all", push_paused: true }), "danger")).toBe(false);
  });
});

describe("reminderBucket", () => {
  it("maps system rule keys to buckets", () => {
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "collection_overdue:order:1:7" })).toBe("money");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "check_deposit_due:1" })).toBe("money");
    expect(reminderBucket({ source: "system", category: "system", dedupeKey: "payment_outflow_due:summary" })).toBe("money");
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

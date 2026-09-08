import { describe, it, expect } from "vitest";
import { reminderBucket } from "@/lib/notifications/categories";

describe("reminderBucket — routes a reminder to its mute bucket", () => {
  it("a manual reminder buckets by its own category (task/order/collection -> money, else reminders)", () => {
    expect(reminderBucket({ source: "manual", category: "task", dedupeKey: null })).toBe("tasks");
    expect(reminderBucket({ source: "manual", category: "order", dedupeKey: null })).toBe("money");
    expect(reminderBucket({ source: "manual", category: "collection", dedupeKey: null })).toBe("money");
    expect(reminderBucket({ source: "manual", category: "general", dedupeKey: null })).toBe("reminders");
    expect(reminderBucket({ source: null, category: "task", dedupeKey: null })).toBe("tasks"); // non-'system' source
  });

  it("a system reminder's dedupe_key rule prefix drives the bucket", () => {
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "collection_overdue:cust-1:0" })).toBe(
      "money"
    );
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "task_overdue:task-1" })).toBe("tasks");
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "project_deadline:proj-1" })).toBe(
      "projects"
    );
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "low_stock:prod-1" })).toBe("ops");
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "wage_overdue:user-1:2026-08" })).toBe(
      "payroll"
    );
  });

  it("nightly_review is its own bucket, not lumped into 'reminders'", () => {
    expect(reminderBucket({ source: "system", category: "nightly_review", dedupeKey: "nightly_review:2026-09-07" })).toBe(
      "nightly"
    );
  });

  it("an unrecognized system rule key falls back to 'reminders'", () => {
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: "some_future_rule:1" })).toBe("reminders");
  });

  it("a system reminder with no dedupe_key doesn't throw, falls back to 'reminders'", () => {
    expect(reminderBucket({ source: "system", category: "x", dedupeKey: null })).toBe("reminders");
  });
});

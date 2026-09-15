import { describe, it, expect } from "vitest";
import { isInsideReminderWindow, reminderWorkDaysForItem, sourceSettingKey } from "@/lib/outflow-source-settings";

// The heads-up window that the board's alerts bar and the push rules share:
// N WORK days before a date (Fri+Sat don't count) up to the date itself.

describe("isInsideReminderWindow", () => {
  // 2026-09-05 is a Saturday: 3 work days before it is Tue 01/09.
  it("opens N work days before and closes after the date", () => {
    expect(isInsideReminderWindow("2026-09-05", "2026-08-31", 3)).toBe(false);
    expect(isInsideReminderWindow("2026-09-05", "2026-09-01", 3)).toBe(true);
    expect(isInsideReminderWindow("2026-09-05", "2026-09-03", 3)).toBe(true);
    expect(isInsideReminderWindow("2026-09-05", "2026-09-05", 3)).toBe(true);
    expect(isInsideReminderWindow("2026-09-05", "2026-09-06", 3)).toBe(false);
  });

  it("is never inside with no reminder, and tolerates a timestamp", () => {
    expect(isInsideReminderWindow("2026-09-05", "2026-09-04", 0)).toBe(false);
    expect(isInsideReminderWindow("2026-09-05T00:00:00+00:00", "2026-09-04", 1)).toBe(true);
  });
});

describe("reminderWorkDaysForItem", () => {
  const settings = {
    [sourceSettingKey("salary", "u1")]: { reminderWorkDaysBefore: 2, accountId: null, isActive: true },
    [sourceSettingKey("card", "ויזה")]: { reminderWorkDaysBefore: 0, accountId: null, isActive: true },
  };
  const templateDays = (id: string) => (id === "tpl-1" ? 4 : null);
  const base = { workerUserId: null, sourceId: null, category: null, recurringTemplateId: null };

  it("reads the source's setting, or the kind's default when there is none", () => {
    expect(reminderWorkDaysForItem({ ...base, id: "salary_proj:u1:2026-10", workerUserId: "u1" }, templateDays, settings)).toBe(2);
    expect(reminderWorkDaysForItem({ ...base, id: "salary_proj:u9:2026-10", workerUserId: "u9" }, templateDays, settings)).toBe(0);
    expect(reminderWorkDaysForItem({ ...base, id: "ccharge_proj:מאסטר:2026-10", category: "מאסטר" }, templateDays, settings)).toBe(3);
    expect(reminderWorkDaysForItem({ ...base, id: "ccharge_proj:ויזה:2026-10", category: "ויזה" }, templateDays, settings)).toBe(0);
    expect(reminderWorkDaysForItem({ ...base, id: "loan_planned:r1", sourceId: "L1" }, templateDays, settings)).toBe(0);
  });

  it("reads a recurring bill's own reminder, and nothing for a plain expense", () => {
    expect(reminderWorkDaysForItem({ ...base, id: "recur_proj:tpl-1:2026-10", recurringTemplateId: "tpl-1" }, templateDays, settings)).toBe(4);
    expect(reminderWorkDaysForItem({ ...base, id: "expense:e1", recurringTemplateId: "tpl-2" }, templateDays, settings)).toBe(0);
    expect(reminderWorkDaysForItem({ ...base, id: "expense:e2" }, templateDays, settings)).toBe(0);
  });
});

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestReminder, deleteTestReminder, getAdminUserId, getReminderStatus } from "./db";

// TodayScheduleCard ("היום — יומן") is the board's hero — it absorbed the old
// alerts/reminders/week widgets and is a full day-panel now, not a preview.
// Its own resolveEntry() mark-done action is exercised here via a REMINDER
// (not a task — MyTasksPanel's own mark-done already covers that code path;
// this card's reminder branch is a distinct implementation, calling
// /api/reminders/action instead of /api/tasks/update-status). getOpenReminders
// (lib/communications.ts) scope "mine" matches assigned_to = viewer, so a
// reminder due today and assigned to the admin fixture is enough — no task/
// customer link needed. Same 10s undo window as MyTasksPanel (lib/undo-engine.ts).
test.describe("admin — dashboard today card", () => {
  test("admin can mark a reminder done from the today card", async ({ page }) => {
    test.setTimeout(60_000);
    const adminId = await getAdminUserId();
    const content = `E2E reminder ${Date.now()}`;
    const reminder = await createTestReminder({ assignedTo: adminId, remindAt: new Date().toISOString(), content });
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("listitem").filter({ hasText: content });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "סימון התזכורת כבוצעה" }).click();

      await expect(row).toBeHidden();
      await expect.poll(() => getReminderStatus(reminder.id), { timeout: 15_000 }).toBe("done");
    } finally {
      await deleteTestReminder(reminder.id);
    }
  });
});

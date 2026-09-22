import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestReminder, deleteTestReminder, getAdminUserId, getReminderSnoozedUntil } from "./db";

// /inbox (InboxClient.tsx) is the ONE list every reminder/alert routes
// through — the dashboard's todaySchedule/todayAlerts cards are just dated
// slices of the same feed, already covered elsewhere. Snooze is the one
// action unique to this page (dashboard cards only ever mark done): the
// clock icon reveals three presets (hour/tomorrow/week) that call
// /api/reminders/action with {action:"snooze", snooze_until}, through the
// same scheduleDeferredAction 10s-undo-window pattern used throughout this
// app. The row has no test id, so it's scoped by its own distinctive
// `rounded-2xl` card class (unique to Card's wrapper on this page) plus the
// reminder's own unique content text.
test.describe("admin — inbox", () => {
  test("admin can snooze a reminder until tomorrow", async ({ page }) => {
    test.setTimeout(60_000);
    const adminId = await getAdminUserId();
    const content = `E2E inbox reminder ${Date.now()}`;
    const reminder = await createTestReminder({ assignedTo: adminId, remindAt: new Date().toISOString(), content });
    try {
      await loginAs(page, "admin");
      await page.goto("/inbox");

      const row = page.locator(".rounded-2xl", { hasText: content });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "דחיית התראה" }).click();
      await row.getByRole("button", { name: "מחר" }).click();

      // Optimistic: the row leaves the list immediately (scheduleDeferredAction),
      // well before the 10s undo window's real write lands.
      await expect(row).toBeHidden();

      await expect
        .poll(() => getReminderSnoozedUntil(reminder.id), { timeout: 15_000 })
        .not.toBeNull();
    } finally {
      await deleteTestReminder(reminder.id);
    }
  });
});

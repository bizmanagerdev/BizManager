import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestReminder } from "./db";

// Right-clicking a day cell opens a root Sheet ("ראה פרטים" / "הוסף אירוע");
// picking "הוסף אירוע" swaps it for 4 kind buttons, and picking a kind fires a
// window "bizh:quick-create" event with { action, dueDate } (contextAdd() in
// CalendarView.tsx) rather than opening a dialog directly — the top-bar
// QuickCreateMenu instance is the one listening, and it opens the SAME
// ReminderFormDialog the regular quick-create tile uses.
//
// Because dueDate arrives pre-filled (defaultRemindAt), ReminderFormDialog
// skips its own "when" step and opens straight on "note" — see its own
// `setStepId(mode === "create" && defaultRemindAt ? "note" : "when")`.
test.describe("admin — calendar", () => {
  test("admin can add a reminder from a day's context menu", async ({ page }) => {
    let reminderId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/calendar");

      // Today's cell is the only one with this highlighted date badge.
      await page.locator("button:has(span.bg-primary)").click({ button: "right" });
      await page.getByRole("button", { name: "הוסף אירוע" }).click();
      await page.getByRole("button", { name: "תזכורת", exact: true }).click();

      // Lands on the "note" step (date already carried in from the day cell).
      await page.getByRole("textbox").fill("תזכורת בדיקה מהיומן");
      await page.getByRole("button", { name: "המשך" }).click(); // assignee step
      await page.getByRole("button", { name: "המשך" }).click(); // summary step

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/reminders/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "הוספת תזכורת" }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { id?: string | null };
      reminderId = body.id ?? null;
      expect(reminderId).toBeTruthy();
    } finally {
      if (reminderId) await deleteTestReminder(reminderId);
    }
  });
});

import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker, deleteTestReminder, getReminderAssignee } from "./db";

// The phone's centre "+" (components/layout/QuickCreateMenu.tsx, variant
// "fab", id bottomnav-quick-create-trigger) opens the quick-create panel;
// its "תזכורת" tile opens ReminderFormDialog as a full-screen step wizard.
// A worker gets no "מי אחראי?" step (canAssignOthers is false for workers),
// so the steps are: when → note → summary. Each step's heading is awaited
// before typing into it — OptionRow/step-wizard transitions can race (see
// admin-recurring-expense.spec.ts).
//
// The date-time field is a masked text input; a single .fill() needs the
// 4-digit year (see admin-collections.spec.ts).
test.describe("mobile — quick create", () => {
  test("a worker can add a reminder from the + on a phone", async ({ page }) => {
    test.setTimeout(60_000);
    const worker = await createTestWorker();
    const content = `E2E mobile reminder ${Date.now()}`;
    let reminderId: string | null = null;
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const tile = page.getByRole("button", { name: "תזכורת", exact: true }).last();
      await expect(async () => {
        await page.locator("#bottomnav-quick-create-trigger").tap();
        await expect(tile).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      await tile.tap();

      await expect(page.getByText("מתי להזכיר?")).toBeVisible();
      const tomorrow = new Date(Date.now() + 86_400_000);
      const dd = String(tomorrow.getDate()).padStart(2, "0");
      const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
      await page.getByPlaceholder("dd/mm/yy hh:mm").fill(`${dd}/${mm}/${tomorrow.getFullYear()} 09:00`);
      await page.getByRole("button", { name: "המשך" }).tap();

      await expect(page.getByText("על מה להזכיר?")).toBeVisible();
      await page.getByRole("dialog").getByRole("textbox").fill(content);
      await page.getByRole("button", { name: "המשך" }).tap();

      await expect(page.getByText("לאשר ולשמור?")).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/reminders/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "הוספת תזכורת" }).tap(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { id?: string | null };
      reminderId = body.id ?? null;
      expect(reminderId).toBeTruthy();

      expect(await getReminderAssignee(reminderId!)).toBe(worker.id);
    } finally {
      if (reminderId) await deleteTestReminder(reminderId);
      await deleteTestWorker(worker);
    }
  });
});

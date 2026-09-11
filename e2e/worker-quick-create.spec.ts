import { test, expect } from "@playwright/test";
import { loginWithCredentials } from "./fixtures";
import { createTestWorker, deleteTestWorker, getAdminUserId, getReminderAssignee, deleteTestReminder } from "./db";

// The "+" quick-create menu (components/layout/QuickCreateMenu.tsx) is the
// app's ONE quick-action surface — WORKER_ACTIONS there hardcodes exactly 3
// tiles for role=worker: task/reminder/attendance. Everything else (income,
// expense, transfer, project, order, customer, collect, workerPayment,
// manualSession) must never render for a worker, no matter section_access.
test.describe("worker role scoping — quick-create menu", () => {
  test("shows exactly the 3 worker tiles, never a staff-only one", async ({ page }) => {
    const worker = await createTestWorker();
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();

      await expect(page.getByRole("button", { name: "משימה" })).toBeVisible();
      await expect(page.getByRole("button", { name: "תזכורת" })).toBeVisible();
      await expect(page.getByRole("button", { name: "דיווח נוכחות" })).toBeVisible();

      await expect(page.getByRole("button", { name: "הכנסה" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "הוצאה" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "פרויקט" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "הזמנה" })).toHaveCount(0);
    } finally {
      await deleteTestWorker(worker);
    }
  });

  test("a worker's own created reminder is always self-assigned, even if a different assignee is requested", async ({
    page,
  }) => {
    const worker = await createTestWorker();
    const adminId = await getAdminUserId();
    let reminderId: string | null = null;
    try {
      await loginWithCredentials(page, worker.email, worker.password);
      await page.waitForURL("**/dashboard");

      const response = await page.request.post("/api/reminders/create", {
        data: {
          content: `E2E worker reminder ${Date.now()}`,
          assigned_to: adminId,
          remind_at: new Date().toISOString(),
        },
      });
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { id?: string };
      reminderId = body.id ?? null;
      expect(reminderId).toBeTruthy();

      const assignee = await getReminderAssignee(reminderId as string);
      expect(assignee).toBe(worker.id);
    } finally {
      if (reminderId) await deleteTestReminder(reminderId);
      await deleteTestWorker(worker);
    }
  });
});

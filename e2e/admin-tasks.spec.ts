import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestTask, deleteTestTask, getTaskStatus, deleteTestTaskByTitle, getAdminUserId } from "./db";

// /tasks itself has no create entry point (TasksPageClient.tsx's own
// comment: "a full new task comes from the app's one quick-create +").
// TaskUpsertDialog is a bespoke accordion, NOT step-wizard.tsx-based — its
// "הבא ›" button is fixed text (not the step-wizard default-label
// convention), and since only `subject` is required for a bare task, "יצירה"
// can be clicked directly without ever touching "הבא ›".
test.describe("admin — tasks board", () => {
  test("admin can create a task through the full dialog", async ({ page }) => {
    const subject = `E2E task ${Date.now()}`;
    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "משימה" }).click();

      await page.getByPlaceholder("שם המשימה").fill(subject);

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/tasks/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "יצירה" }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { task?: { id?: string; subject?: string } };
      expect(body.task?.subject).toBe(subject);

      await page.goto("/tasks");
      await expect(page.getByText(subject)).toBeVisible();
    } finally {
      await deleteTestTaskByTitle(subject);
    }
  });

  test("admin can move a task to a different column via the context menu", async ({ page }) => {
    // The board defaults to "mine" scope (assigned-to-me-or-member) for
    // everyone (TasksPageClient.tsx: "'mine' is the default for everyone") —
    // an unassigned task created directly via the DB helper would never show
    // up for the admin viewer without this.
    const task = await createTestTask({
      subject: `E2E move task ${Date.now()}`,
      status: "todo",
      assignedUserId: await getAdminUserId(),
    });
    try {
      await loginAs(page, "admin");
      await page.goto("/tasks");

      const card = page.getByText(task.subject);
      await expect(card).toBeVisible();
      await card.click({ button: "right" });

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/tasks/update-status") && r.request().method() === "POST"),
        page.getByRole("button", { name: "בתהליך", exact: true }).click(),
      ]);
      expect(response.ok()).toBe(true);
      await expect.poll(() => getTaskStatus(task.id)).toBe("in_progress");
    } finally {
      await deleteTestTask(task.id);
    }
  });

  test("admin can add a comment to a task", async ({ page }) => {
    // See the move-task test above — the board's default "mine" scope hides
    // an unassigned task from the admin viewer.
    const task = await createTestTask({
      subject: `E2E comment task ${Date.now()}`,
      assignedUserId: await getAdminUserId(),
    });
    try {
      await loginAs(page, "admin");
      await page.goto("/tasks");

      await page.getByText(task.subject).click();
      await page.getByRole("button", { name: "תגובות", exact: true }).click();

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/tasks/add-comment") && r.request().method() === "POST"),
        (async () => {
          await page.getByPlaceholder("כתבו תגובה...").fill("תגובת בדיקה");
          await page.getByRole("button", { name: "הוספת תגובה" }).click();
        })(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { ok?: boolean; comment?: { body?: string } };
      expect(body.ok).toBe(true);
      expect(body.comment?.body).toBe("תגובת בדיקה");
    } finally {
      await deleteTestTask(task.id);
    }
  });
});

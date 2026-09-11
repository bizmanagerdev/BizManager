import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestProject,
  deleteTestProject,
  getProjectStatus,
  getExpenseIdByDescription,
  deleteTestExpense,
} from "./db";

test.describe("admin — project creation, status change, and expenses", () => {
  test("admin can create a project through the wizard", async ({ page }) => {
    // See admin-orders.spec.ts's order-creation test for why: more wizard
    // steps than the 30s default comfortably covers, and a timed-out test
    // skips the rest of its finally block's cleanup.
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E project customer ${Date.now()}` });
    const projectName = `E2E project ${Date.now()}`;
    let projectId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "פרויקט" }).click();

      await page.getByRole("button", { name: "לקוח קיים" }).click();
      await page.locator('[aria-label="חיפוש לקוח"]').fill(customer.name);
      await page.getByText(customer.name, { exact: true }).first().click();
      await page.getByRole("button", { name: "המשך" }).click();

      // name (required, no default) — the only other step with mandatory
      // input; everything else (type/status/dates/manager/price/terms/...)
      // is pre-defaulted to a valid value.
      await page.getByRole("textbox").fill(projectName);

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/projects/create") && r.request().method() === "POST"),
        (async () => {
          for (let i = 0; i < 14; i++) {
            const createButton = page.getByRole("button", { name: "יצירת פרויקט" });
            if (await createButton.isVisible().catch(() => false)) {
              await createButton.click();
              return;
            }
            await page.getByRole("button", { name: "המשך" }).click();
          }
          throw new Error("Never reached the project-creation summary step");
        })(),
      ]);
      const body = (await response.json()) as { project?: { id?: string }; id?: string };
      projectId = body.project?.id ?? body.id ?? null;
      expect(projectId).toBeTruthy();
    } finally {
      if (projectId) await deleteTestProject(projectId);
      await deleteTestCustomer(customer.id);
    }
  });

  test("admin can change a project's status inline from the detail page", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E status customer ${Date.now()}` });
    const project = await createTestProject(customer.id);
    try {
      await loginAs(page, "admin");
      await page.goto(`/projects/${project.id}`);

      await page.locator('[aria-label="שינוי סטטוס הפרויקט"]').click();
      await page.getByRole("menuitem", { name: "הושלם" }).click();

      // ProjectStatusPicker commits via a direct Supabase client write
      // (createSupabaseBrowserClient().from("projects").update(...)), not a
      // Next.js API route, wrapped in the same scheduleDeferredAction 10s
      // undo window used elsewhere in this suite — poll, don't assert
      // immediately.
      await expect.poll(() => getProjectStatus(project.id), { timeout: 15_000 }).toBe("completed");
    } finally {
      await deleteTestProject(project.id);
      await deleteTestCustomer(customer.id);
    }
  });

  test("admin can add an expense to a project from its detail page", async ({ page }) => {
    // See admin-orders.spec.ts's order-creation test for why: more wizard
    // steps than the 30s default comfortably covers, and a timed-out test
    // skips the rest of its finally block's cleanup.
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E project expense customer ${Date.now()}` });
    const project = await createTestProject(customer.id);
    const description = `E2E project expense ${Date.now()}`;
    let expenseId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto(`/projects/${project.id}`);

      await page.getByRole("button", { name: "הוצאה" }).click();

      // ExpenseDialog runs in "express" mode here with domain/source locked
      // to this project (lockedProjectId) — no domain/source step shown.
      await page.getByRole("button", { name: "2", exact: true }).click();
      await page.getByRole("button", { name: "5", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "המשך" }).click();

      await page.getByRole("button", { name: "רכישה" }).click();

      await page.getByRole("textbox").fill(description);
      await page.getByRole("button", { name: "המשך" }).click();

      await page.getByRole("button", { name: "המשך" }).click(); // date: default
      await page.getByRole("button", { name: "תשלום אחד" }).click();
      await page.getByRole("button", { name: "שולם" }).click();
      await page.getByRole("button", { name: "מזומן" }).click();
      await page.getByRole("button", { name: "המשך" }).click(); // notes
      await page.getByRole("button", { name: "המשך" }).click(); // files
      await page.getByRole("button", { name: "שמור הוצאה" }).click();

      await expect.poll(() => getExpenseIdByDescription(description).catch(() => null)).not.toBeNull();
      expenseId = await getExpenseIdByDescription(description);
    } finally {
      if (expenseId) await deleteTestExpense(expenseId);
      await deleteTestProject(project.id);
      await deleteTestCustomer(customer.id);
    }
  });
});

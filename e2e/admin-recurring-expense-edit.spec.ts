import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestRecurringExpenseTemplate,
  getRecurringExpenseTemplate,
  deleteTestRecurringExpenseTemplate,
} from "./db";

// Editing an existing recurring template (קבועות tab → row's ⋯ menu →
// "עריכה") opens ExpenseDialog with editingRecurringTemplate set, which
// forces activeMode="form" (ExpenseDialog.tsx: "isEditing || isEditingTemplate
// ? 'form' : 'express'") — the plain single-page form, not the express
// step wizard, so none of the step-transition races admin-recurring-expense.
// spec.ts had to work around apply here. The row's own kebab-menu trigger
// carries `aria-label="פעולות — ${template_name}"`, which uniquely scopes the
// click straight to the seeded row without needing a table/card locator.
test.describe("admin — recurring expenses (edit)", () => {
  test("admin can edit an existing recurring expense template's name", async ({ page }) => {
    test.setTimeout(60_000);
    const newName = `E2E recurring edited ${Date.now()}`;
    const seed = await createTestRecurringExpenseTemplate();
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/payments-calendar?tab=recurring");

      await page.getByRole("button", { name: `פעולות — ${seed.template_name}` }).click();
      await page.getByRole("menuitem", { name: "עריכה" }).click();

      await expect(page.getByText("עריכת הוצאה קבועה")).toBeVisible();
      const nameInput = page.getByPlaceholder("למשל: שכירות משרד");
      await expect(nameInput).toHaveValue(seed.template_name);
      await nameInput.fill(newName);

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/recurring-expenses/save") && r.request().method() === "POST"),
        page.getByRole("button", { name: "שמירה" }).click(),
      ]);
      expect(response.ok()).toBe(true);

      const updated = await getRecurringExpenseTemplate(seed.id);
      expect(updated?.template_name).toBe(newName);

      await expect(page.getByText(newName)).toBeVisible();
    } finally {
      await deleteTestRecurringExpenseTemplate(seed.id);
    }
  });
});

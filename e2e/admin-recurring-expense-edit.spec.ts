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
// click straight to the seeded row without needing a table/card locator —
// but that kebab menu only exists in the list's desktop TABLE layout
// (RecurringExpensesManager.tsx's rowMenu()); its `@5xl:hidden` mobile CARD
// layout has a plain "עריכה" EditButton instead, with no per-row label at
// all. Tailwind's default `@5xl` container breakpoint is 1024px, and the
// default "Desktop Chrome" 1280px viewport, minus the sidebar and page
// padding, lands the content container just under that — so cards render
// by default and the kebab trigger silently never exists, no matter how
// long you wait for it (root-caused after two rounds that mistook this for
// a race/cold-load, same as admin-recurring-expense.spec.ts's own saga).
// Force a wide viewport so the table layout is what actually renders.
test.describe("admin — recurring expenses (edit)", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("admin can edit an existing recurring expense template's name", async ({ page }) => {
    test.setTimeout(60_000);
    const newName = `E2E recurring edited ${Date.now()}`;
    const seed = await createTestRecurringExpenseTemplate();
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/payments-calendar?tab=recurring");

      // Split "did the row render at all" (layout-agnostic — same generous
      // timeout as admin-payments-calendar.spec.ts's own first data-dependent
      // element, for the same server round-trip reason) from "is it the
      // table layout" (viewport-dependent), so a failure here points at the
      // right cause instead of another guess.
      await expect(page.getByText(seed.template_name).first()).toBeVisible({ timeout: 15_000 });
      const menuTrigger = page.getByRole("button", { name: `פעולות — ${seed.template_name}` });
      await expect(menuTrigger).toBeVisible({ timeout: 5_000 });
      await menuTrigger.click();
      const editItem = page.getByRole("menuitem", { name: "עריכה" });
      await expect(editItem).toBeVisible();
      await editItem.click();

      await expect(page.getByText("עריכת הוצאה קבועה")).toBeVisible();
      const nameInput = page.getByPlaceholder("למשל: שכירות משרד");
      await expect(nameInput).toBeVisible();
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

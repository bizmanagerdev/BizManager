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
//
// Both layouts render in the DOM AT ONCE — @5xl:hidden is a CSS class, not
// conditional JSX — so a plain text/role locator with no layout-specific
// element can match twice (once per layout, one of them CSS-hidden). A
// row's name renders via the same nameCell() either way, so getByText(name)
// matches both; .last() reliably picks the table's copy, since cards render
// first in RecurringExpensesManager.tsx's JSX and the table second. The
// kebab trigger itself needs no such care — rowMenu()'s aria-label only
// exists in the table layout at all, card mode's actionsCell() has a plain
// unlabeled "עריכה" EditButton instead.
test.describe("admin — recurring expenses (edit)", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("admin can edit an existing recurring expense template's name", async ({ page }) => {
    test.setTimeout(60_000);
    const newName = `E2E recurring edited ${Date.now()}`;
    const seed = await createTestRecurringExpenseTemplate();
    try {
      await loginAs(page, "admin");
      await page.goto("/financial/payments-calendar?tab=recurring");

      const menuTrigger = page.getByRole("button", { name: `פעולות — ${seed.template_name}` });
      await expect(menuTrigger).toBeVisible({ timeout: 15_000 });
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

      await expect(page.getByText(newName).last()).toBeVisible();
    } finally {
      await deleteTestRecurringExpenseTemplate(seed.id);
    }
  });
});

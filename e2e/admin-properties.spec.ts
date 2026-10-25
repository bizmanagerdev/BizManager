import { test, expect } from "@playwright/test";
import { loginAs, mockAddressSearch, pickAddress } from "./fixtures";
import {
  createTestProperty,
  deleteTestProperty,
  getExpenseIdByDescription,
  deleteTestExpense,
  getPropertyIdByName,
} from "./db";

// Property creation and the lease dialog are both Next.js Server Actions
// (app/(app)/properties/actions.ts), not /api/* routes — poll the DB rather
// than waiting on a network response, same as the loans/project-status
// tests elsewhere in this suite.
test.describe("admin — properties", () => {
  test("admin can create a property through the dialog", async ({ page }) => {
    test.setTimeout(60_000);
    const propertyName = `E2E property ${Date.now()}`;
    let propertyId: string | null = null;
    try {
      await mockAddressSearch(page);
      await loginAs(page, "admin");
      await page.goto("/properties");

      // The list lost its own add button with its heading (owner, 2026-10-21):
      // a property is added from the top bar's "+", whose "נכס" tile shows on
      // this list only — opened by hover, the tile portaled after the page's
      // own cards, as in admin-vehicle-create.spec.ts.
      const propertyTile = page.getByRole("button", { name: "נכס", exact: true }).last();
      const dialog = page.getByRole("dialog").filter({ hasText: "הוספת נכס" });
      await expect(async () => {
        await page.locator("#topbar-quick-create-trigger").hover();
        await expect(propertyTile).toBeVisible({ timeout: 2_000 });
        await propertyTile.click();
        await expect(dialog).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      // PropertyFormFields wraps each field in a real <label> (implicit
      // association, unlike most other forms in this app), so getByLabel
      // genuinely works here — except the address, picked from Google's list
      // since 2026-10-18 (fixtures.ts pickAddress).
      await dialog.getByLabel("שם הנכס *").fill(propertyName);
      await pickAddress(page, dialog);
      await dialog.getByRole("button", { name: "הוספה", exact: true }).click();

      await expect.poll(() => getPropertyIdByName(propertyName)).not.toBeNull();
      propertyId = await getPropertyIdByName(propertyName);
    } finally {
      if (propertyId) await deleteTestProperty(propertyId);
    }
  });

  test("admin can add an expense to a property from its detail page", async ({ page }) => {
    // Multi-step ExpenseDialog wizard — see admin-orders.spec.ts's
    // order-creation test comment for why the 30s default is too tight.
    test.setTimeout(60_000);
    const property = await createTestProperty({ address: `E2E property expense ${Date.now()}` });
    const description = `E2E property expense desc ${Date.now()}`;
    let expenseId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto(`/properties/${property.id}`);

      // Not exact: true previously, but the page now also has a "הוצאה קבועה"
      // (recurring expense) button whose name contains this as a substring.
      await page.getByRole("button", { name: "הוצאה", exact: true }).click();

      // ExpenseDialog is a StepWizard here with an explicit nextLabel="המשך"
      // for every non-final step (locked to this property, so no domain/
      // source step is shown) — see ExpenseDialog.tsx:2478.
      await page.getByRole("button", { name: "2", exact: true }).click();
      await page.getByRole("button", { name: "5", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "המשך" }).click();

      // A property's expense takes only a property's categories since
      // 2026-10-22 (lib/expenses.ts EXPENSE_PROPERTY_CATEGORIES) — the general
      // "רכישה" isn't one.
      await page.getByRole("button", { name: "תיקונים" }).click();

      await page.getByRole("textbox").fill(description);
      await page.getByRole("button", { name: "המשך" }).click();

      // recurrence: one-time — canRecur (!isEditing && !isWorkerPayment) is
      // true regardless of the property lock, so this step always appears.
      await page.getByRole("button", { name: "חד-פעמי" }).click();
      await page.getByRole("button", { name: "המשך" }).click(); // date: default
      await page.getByRole("button", { name: "תשלום אחד" }).click();
      // status: paid in full — see admin-expenses.spec.ts's own comment for
      // why this can't be a role/name match against "שולם" (OptionRow's
      // label+sub+badge all contribute to the accessible name).
      await page.locator("button[data-exp-option]", { hasText: "ההוצאה שולמה במלואה" }).click();
      await page.getByRole("button", { name: "מזומן" }).click();
      // account: shown whenever paid/partial — see admin-expenses.spec.ts's
      // own comment for why this extra "המשך" is needed.
      await page.getByRole("button", { name: "המשך" }).click(); // account
      await page.getByRole("button", { name: "המשך" }).click(); // notes
      await page.getByRole("button", { name: "המשך" }).click(); // files
      await page.getByRole("button", { name: "שמור הוצאה" }).click();

      await expect.poll(() => getExpenseIdByDescription(description).catch(() => null)).not.toBeNull();
      expenseId = await getExpenseIdByDescription(description);
    } finally {
      if (expenseId) await deleteTestExpense(expenseId);
      await deleteTestProperty(property.id);
    }
  });
});

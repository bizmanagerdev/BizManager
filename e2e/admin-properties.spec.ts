import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
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
    const propertyName = `E2E property ${Date.now()}`;
    let propertyId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/properties");

      await page.getByRole("button", { name: "הוספת נכס" }).click();
      // PropertyFormFields wraps each field in a real <label> (implicit
      // association, unlike most other forms in this app), so getByLabel
      // genuinely works here.
      await page.getByLabel("שם הנכס *").fill(propertyName);
      await page.getByLabel("כתובת *").fill("רחוב הבדיקה 1, תל אביב");
      await page.getByRole("button", { name: "הוספה" }).click();

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

      await page.getByRole("button", { name: "הוצאה" }).click();

      // ExpenseDialog is a StepWizard here with an explicit nextLabel="המשך"
      // for every non-final step (locked to this property, so no domain/
      // source step is shown) — see ExpenseDialog.tsx:2478.
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
      await deleteTestProperty(property.id);
    }
  });
});

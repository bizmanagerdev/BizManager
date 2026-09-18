import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { deleteTestAccountByName } from "./db";

// Accounts (settings -> "כספים" -> AccountsCard.tsx) are a cross-cutting
// concern — every payment/expense/income records account_id, and several
// wizard steps this session confirmed are gated on `accountsList.length`
// (e.g. ExpenseDialog's/IncomeDialog's own "account" step) — yet account
// creation itself had no E2E coverage, and no local e2e stack has ever had
// one seeded. Unlike VatRateCard's scheduleDeferredAction (optimistic now,
// real write ~10s later), a NEW account's own save path is a direct,
// un-deferred await (registerReversibleAction only registers the undo
// option AFTER the real write already resolved) — so no extended poll is
// needed here, just waiting for the dialog to close and the row to render.
test.describe("admin — accounts", () => {
  test("admin can create a bank account", async ({ page }) => {
    const name = `E2E account ${Date.now()}`;
    try {
      await loginAs(page, "admin");
      await page.goto("/settings");
      await page.getByRole("button", { name: "כספים" }).click();

      await page.getByRole("button", { name: "הוספת חשבון" }).click();

      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").first().fill(name);
      // kind defaults to "בנק" (bank) — no need to touch the selector.

      // opening balance (CurrencyInput) and opening date (DateInput) are the
      // only other two inputs on this form.
      const openingBalanceInput = dialog.locator(
        'xpath=//label[contains(text(),"יתרת פתיחה")]/following-sibling::div//input'
      );
      await openingBalanceInput.fill("1000");

      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const yyyy = today.getFullYear();
      await dialog.getByPlaceholder("dd/mm/yy").fill(`${dd}/${mm}/${yyyy}`);

      await dialog.getByRole("button", { name: "שמירה" }).click();

      await expect(dialog).toBeHidden();
      // Scope to the account's own <li> row (AccountsCard.tsx) so the
      // opening-balance check can't accidentally match some other
      // "1,000"-shaped text elsewhere on the page — and avoid asserting the
      // exact currency-symbol placement/spacing Intl.NumberFormat produces,
      // which isn't this test's concern.
      const row = page.locator("li", { has: page.getByText(name) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("1,000");
    } finally {
      await deleteTestAccountByName(name);
    }
  });
});

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestExpense, deleteTestExpense } from "./db";

// UpcomingPayments ("תשלומים קרובים") mirrors UpcomingDeliveries' own pattern:
// each row is an overlay Link, never a button — for an expense-origin entry,
// expenseSourceHref() (lib/payables.ts) sends it to /financial?focus=<entryId>
// rather than a dedicated payment screen. buildExpenseFlowMeta (lib/financial/
// entries.ts) puts a not_paid expense straight into the card's TODAY bucket
// whenever its expense_date (which defaults to now()) is today — no lead-time
// "alert window" math to replicate, unlike the card's "upcoming" bucket.
test.describe("admin — dashboard payments card", () => {
  test("clicking today's payment row opens /financial focused on that entry", async ({ page }) => {
    const description = `E2E payable ${Date.now()}`;
    const expense = await createTestExpense({ amount: 640, description, paymentStatus: "not_paid" });
    const entryId = `expense:${expense.id}`;
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("link", { name: description, exact: true });
      await expect(row).toBeVisible();
      await row.click();

      await page.waitForURL((url) => url.pathname === "/financial" && url.searchParams.get("focus") === entryId);
      await expect(page.locator(`[data-focus-id="${entryId}"]:visible`).first()).toBeVisible();
    } finally {
      await deleteTestExpense(expense.id);
    }
  });
});

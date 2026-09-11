import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { getExpenseIdByDescription, deleteTestExpense } from "./db";

// ExpenseDialog is an "atomic step wizard" (see OptionRow's own comment):
// every domain/category/recurrence/installments/status/method step is a
// tap-to-advance OptionRow button that calls expressAdvance() directly on
// click — no separate "המשך" needed for those. Only the free-input steps
// (amount's keypad, description, date, notes) use the dialog's one pinned
// "המשך" nav button (ExpenseDialog.tsx:2478).
test.describe("admin — expense recording", () => {
  test("admin can record a one-time paid cash expense and it shows on /financial", async ({ page }) => {
    // See admin-orders.spec.ts's order-creation test for why: more wizard
    // steps than the 30s default comfortably covers, and a timed-out test
    // skips the rest of its finally block's cleanup.
    test.setTimeout(60_000);
    const description = `E2E expense ${Date.now()}`;
    let expenseId: string | null = null;
    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "הוספה מהירה" }).click();
      await page.getByRole("button", { name: "הוצאה" }).click();

      // amount: 250, via the numeric keypad (no direct text input on this step).
      await page.getByRole("button", { name: "2", exact: true }).click();
      await page.getByRole("button", { name: "5", exact: true }).click();
      await page.getByRole("button", { name: "0", exact: true }).click();
      await page.getByRole("button", { name: "המשך" }).click();

      // domain: "שוטף" (general_business) — cheapest path, skips the
      // project/property/vehicle source picker entirely.
      await page.getByRole("button", { name: "שוטף" }).click();

      // category: "רכישה" (DEFAULT_EXPENSE_CATEGORY) — avoids the extra
      // otherCategory/tags/worker-session branches "אחר" would add.
      await page.getByRole("button", { name: "רכישה" }).click();

      // description: a plain, unlabeled <Input> (ExpenseDialog.tsx:2070) —
      // the wizard renders one step at a time, so it's the only textbox
      // visible here. A real value (not a suggestion chip) is needed since
      // the chips are generic category phrases, not unique per test run.
      await page.getByRole("textbox").fill(description);
      await page.getByRole("button", { name: "המשך" }).click();

      // recurrence: one-time.
      await page.getByRole("button", { name: "חד-פעמי" }).click();

      // date: leave at its default (today), just advance.
      await page.getByRole("button", { name: "המשך" }).click();

      // installments: single payment.
      await page.getByRole("button", { name: "תשלום אחד" }).click();

      // status: paid in full.
      await page.getByRole("button", { name: "שולם" }).click();

      // method: cash — no account step follows (no accounts seeded locally).
      await page.getByRole("button", { name: "מזומן" }).click();

      // notes (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();
      // files (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      await page.getByRole("button", { name: "שמור הוצאה" }).click();

      await expect.poll(() => getExpenseIdByDescription(description).catch(() => null)).not.toBeNull();
      expenseId = await getExpenseIdByDescription(description);

      await page.goto("/financial");
      const row = page.locator(`tr[data-focus-id="expense:${expenseId}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("250");
    } finally {
      if (expenseId) await deleteTestExpense(expenseId);
    }
  });
});

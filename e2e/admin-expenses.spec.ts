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

      // status: paid in full. Not a role/name match — OptionRow (which
      // ExpenseDialog.tsx's expCard delegates to) renders the option's
      // label, sub-text, AND a numbered badge as separate spans inside the
      // SAME button, so the real accessible name is a concatenation of all
      // three (confirmed the hard way: two different exact-string guesses
      // both missed the trailing badge number). Filtering by the sub-text
      // alone sidesteps guessing the exact concatenation — "ההוצאה שולמה
      // במלואה" is unique to this one option among the three status cards.
      await page.locator("button[data-exp-option]", { hasText: "ההוצאה שולמה במלואה" }).click();

      // method: cash.
      await page.getByRole("button", { name: "מזומן" }).click();

      // account: shown whenever the expense is paid/partial (ExpenseDialog.tsx's
      // step builder pushes "method","account" together) — with no accounts
      // seeded locally it's just an "אפשר להמשיך בלי שיוך" notice and the
      // shared footer's "המשך" (stepNavConfig has no "account" case, so it's
      // never disabled) advances past it same as notes/files below.
      await page.getByRole("button", { name: "המשך" }).click();

      // notes (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();
      // files (optional) — advance past it.
      await page.getByRole("button", { name: "המשך" }).click();

      // review — final submit.
      await page.getByRole("button", { name: "שמור הוצאה" }).click();

      await expect.poll(() => getExpenseIdByDescription(description).catch(() => null)).not.toBeNull();
      expenseId = await getExpenseIdByDescription(description);

      await page.goto("/financial");
      // /financial keeps both the "היסטוריה" and "יומן מלא" tab panels mounted
      // (fast switching, no refetch), each rendering its own row for this
      // entry with the SAME data-focus-id — so an unqualified match is
      // ambiguous even though only one tab is actually visible right now.
      const row = page.locator(`tr[data-focus-id="expense:${expenseId}"]:visible`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("250");
    } finally {
      if (expenseId) await deleteTestExpense(expenseId);
    }
  });
});

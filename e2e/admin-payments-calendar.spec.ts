import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestExpense, deleteTestExpense, getExpensePaymentStatus } from "./db";

// /financial/payments-calendar (לוח תזרים) had no dedicated E2E coverage
// despite being one of the app's most complex money surfaces. "סמן כשולם"
// (MarkPaidDialog) is its one real, everyday action: confirming an unpaid
// bill was actually paid, via /api/expenses/mark-paid. A plain not_paid
// expense (createTestExpense's own default expense_date = today) is enough
// — no recurring template needed, since that path (item.recurringTemplateId
// set, no expenseId yet — a materialize-then-pay call) is a different,
// heavier code path already exercised by the recurring-expenses generator's
// own tests.
//
// ?focus=<item id> (FocusHighlighter's convention, read directly by
// PaymentsCalendar.tsx) both selects the right day AND opens its panel in
// one navigation — the same deep link the dashboard's own payments card
// uses. The entry id for a plain expense is `expense:<id>` (lib/financial/
// entries.ts's buildExpenseEntries).
//
// No account is seeded on purpose: AccountSelect renders nothing at all
// when zero accounts exist (account assignment is opt-in), which sidesteps
// having to drive a SearchableSelect (a Radix Popper-family control this
// suite already treats as flaky to interact with) — and account_id is
// genuinely optional server-side (see the route itself), so the dialog's
// own "accountsList.length > 0 && !accountId" check never fires when the
// list is empty.
test.describe("admin — payments calendar", () => {
  test("admin can mark an unpaid expense as paid from the calendar", async ({ page }) => {
    test.setTimeout(60_000);
    const description = `E2E mark paid ${Date.now()}`;
    const expense = await createTestExpense({ amount: 250, description, paymentStatus: "not_paid" });
    const entryId = `expense:${expense.id}`;
    try {
      await loginAs(page, "admin");
      await page.goto(`/financial/payments-calendar?focus=${encodeURIComponent(entryId)}`);

      const card = page.locator(`[data-focus-id="${entryId}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.getByRole("button", { name: "סמן כשולם" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/expenses/mark-paid") && r.request().method() === "POST"),
        dialog.getByRole("button", { name: "סמן כשולם" }).click(),
      ]);
      expect(response.ok()).toBe(true);

      await expect.poll(() => getExpensePaymentStatus(expense.id)).toBe("paid");
    } finally {
      await deleteTestExpense(expense.id);
    }
  });
});

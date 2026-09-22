import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestExpense, deleteTestExpense } from "./db";

// DomainChartCard ("הכנסות והוצאות") is the one dashboard widget with no row-
// level action at all — its only interactive control is the month picker,
// which round-trips to loadDomainChartMonth (a server action, re-checking the
// viewer's role) rather than re-deriving anything client-side. That round
// trip — not the recharts rendering itself, which is a heavy, lazily-loaded
// dependency not worth asserting on pixel-by-pixel — is what's worth proving:
// switching months must not error, and the picker must land on the month it
// was asked for.
//
// The card's own empty state ("אין תנועת מזומן") is NOT reachable on initial
// load: DomainChartSlowCell (app/(app)/dashboard/DashboardSections.tsx) —
// the wrapper around DomainChartCard, not the component itself — returns
// null outright when the current month has zero bars, so with no financial
// activity in the current month the card doesn't render AT ALL (confirmed
// via a direct diagnostic: loadDomainCashBreakdown legitimately returned []
// depending on what other tests happened to leave behind, and the card's
// title was then genuinely absent from the DOM, not just its data empty).
// A same-month expense guarantees the card actually mounts.
test.describe("admin — dashboard domain chart card", () => {
  test("switching the chart's month picker loads without error", async ({ page }) => {
    test.setTimeout(60_000);
    const expense = await createTestExpense({ amount: 42, description: `E2E domain chart ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      await expect(page.getByText("הכנסות והוצאות")).toBeVisible({ timeout: 15_000 });

      const select = page.getByRole("combobox", { name: "בחירת חודש" });
      await expect(select).toBeVisible({ timeout: 15_000 });

      const options = await select.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
      const currentValue = await select.inputValue();
      const otherOption = await select.locator("option").nth(1);
      const otherValue = await otherOption.getAttribute("value");
      expect(otherValue).not.toBe(currentValue);

      await select.selectOption(otherValue!);

      // pickMonth sets the select's value OPTIMISTICALLY before the round trip
      // even starts, then disables it for the duration (disabled={pending}) — a
      // failed round trip reverts the value once it resolves. Waiting for the
      // select to re-enable, THEN checking its value, is what actually proves
      // the round trip succeeded rather than catching the optimistic moment
      // before a later revert.
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue(otherValue!);
    } finally {
      await deleteTestExpense(expense.id);
    }
  });
});

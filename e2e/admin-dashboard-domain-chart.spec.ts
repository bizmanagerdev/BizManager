import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestExpense, deleteTestExpense } from "./db";

// DomainChartCard ("הכנסות והוצאות") is the one dashboard widget with no row-
// level action at all — its only interactive control is the month picker,
// which round-trips to loadDomainChartMonth (a server action, re-checking the
// viewer's role) rather than re-deriving anything client-side.
//
// Was skipped: CI reported the title as present in the DOM yet stably
// "hidden". At xl and up the dashboard is a FIXED-height grid
// (DASHBOARD_BOARD_CLASS: xl:h-[calc(100dvh-61px-3rem)]) whose rows are minmax(0,…fr),
// and Playwright's default 1280x720 viewport sits exactly on the xl
// breakpoint — with every widget populated, the chart's row can collapse to
// zero height, which Playwright counts as hidden. Below xl the board is a
// plain stack and this card gets a fixed 16rem (see the card's own comment),
// so the test runs at a narrower viewport.
test.describe("admin — dashboard domain chart card", () => {
  test.use({ viewport: { width: 1100, height: 900 } });

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

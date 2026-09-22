import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestPayment, deleteTestPayment } from "./db";

// TodayAlertsCard ("התראות") is deliberately narrow: todaySlice (lib/reminders/
// worklist.ts) only folds THREE system rule keys onto it — check_deposit_due,
// payment_due_today, payment_outflow_due — a human-set reminder never lands
// here (that's TodayScheduleCard's job, already covered separately). No
// per-row action either, just a card-wide link to /inbox and a per-line link
// to the rule's own page — so this is a navigation test.
// checkDepositDueRule (lib/reminders/system-rules.ts) fires on any
// payments row with payment_method='check', payment_status='pending' and a
// due_date that has arrived — createTestPayment's own defaults are exactly
// that shape (business_domain='general_business', no order needed), so only
// dueDate needs overriding to today.
test.describe("admin — dashboard alerts card", () => {
  test("a check due for deposit shows as a today alert and links to the checks page", async ({ page }) => {
    test.setTimeout(60_000);
    const todayIso = new Date().toISOString().slice(0, 10);
    const payment = await createTestPayment({ dueDate: todayIso, amount: 777 });
    try {
      await loginAs(page, "admin");

      // The alerts card's own data comes through a heavier multi-rule
      // worklist evaluation (getInboxView) than most other dashboard cards —
      // give it more room than the default 5s under CI's slower conditions.
      const alertLine = page.getByRole("link", { name: /צ׳קים להפקדה/ });
      await expect(alertLine).toBeVisible({ timeout: 15_000 });
      await alertLine.click();

      await page.waitForURL("**/checks");
    } finally {
      await deleteTestPayment(payment.id);
    }
  });
});

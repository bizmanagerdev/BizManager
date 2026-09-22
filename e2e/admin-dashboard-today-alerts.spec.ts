import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestPayment, deleteTestPayment } from "./db";

// TodayAlertsCard ("התראות") is deliberately narrow: todaySlice (lib/reminders/
// worklist.ts) only folds THREE system rule keys onto it — check_deposit_due,
// payment_due_today, payment_outflow_due — a human-set reminder never lands
// here (that's TodayScheduleCard's job, already covered separately). No
// per-row action either, just a card-wide link to /inbox and a per-line link
// to the rule's own page — so this is a navigation test.
//
// getInboxView/getWorklist (lib/reminders/worklist.ts) only ever READ the
// `reminders` TABLE — a system rule like checkDepositDueRule
// (lib/reminders/system-rules.ts) never runs live per dashboard request.
// Rows only land in `reminders` via syncSystemReminders, normally fired by
// the hourly cron (app/api/cron/reminders-sync) — a freshly-seeded check
// payment genuinely would NOT show up on a real user's dashboard until the
// next sync, by design. /api/reminders/sync-now (admin/office-only) runs
// that same sync on demand — the app's own real mechanism for "populate the
// worklist now instead of waiting" — so the test calls it explicitly rather
// than waiting on wall-clock time. Calling it again after deleting the
// payment lets the rule reconcile away the now-stale reminder row, the same
// way toggling a rule off in settings auto-closes its existing items.
test.describe("admin — dashboard alerts card", () => {
  test("a check due for deposit shows as a today alert and links to the checks page", async ({ page }) => {
    test.setTimeout(60_000);
    const todayIso = new Date().toISOString().slice(0, 10);
    const payment = await createTestPayment({ dueDate: todayIso, amount: 777 });
    try {
      await loginAs(page, "admin");
      const syncRes = await page.request.post("/api/reminders/sync-now");
      expect(syncRes.ok()).toBe(true);
      await page.reload();

      const alertLine = page.getByRole("link", { name: /צ׳קים להפקדה/ });
      await expect(alertLine).toBeVisible({ timeout: 15_000 });
      await alertLine.click();

      await page.waitForURL("**/checks");
    } finally {
      await deleteTestPayment(payment.id);
      await page.request.post("/api/reminders/sync-now").catch(() => null);
    }
  });
});

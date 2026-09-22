import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, createTestOrder, deleteTestOrder, createTestOrderItem, createTestPayment } from "./db";

// CollectionsCard ("גבייה") is the mirror of UpcomingPayments, same shape —
// a debtor row links straight to the customer (/customers/<id>), no focus
// deep link needed since there's no list to scroll to on that page.
//
// admin-collections.spec.ts's own seed (a draft order with one unpaid item,
// no payment row) is NOT enough here — confirmed via a direct diagnostic
// query against collections_view: outstanding_amount was correctly 350, but
// BOTH overdue_amount and pending_amount were 0. order_financials_view
// derives those two columns entirely from actual `payments` rows
// (payment_totals CTE, GROUP BY order_id) — an order with no payment record
// at all has money owed but is neither "pending" (scheduled) nor "overdue"
// (a late payment attempt), it's collection_status='unpaid'. The
// /collections PAGE shows any outstanding_amount > 0 regardless of that
// split (which is why the reused seed passes there), but getCollectionsSummary
// (lib/collections.ts) only ever looks at late (overdue_amount) and upcoming
// (pending_amount) — a bare unpaid order never reaches either bucket. A
// pending payment row tied to the order is what actually gets it there.
//
// due_date is YESTERDAY, not today: getPaymentsDueToday (lib/collections.ts)
// exact-matches due_date = today for the card's separate "TODAY" collect
// list (its own "נגבה" row, unrelated to this test) — a due_date of today
// made the debtor's aria-label show up TWICE (once there, once in the late/
// upcoming list below), a strict-mode violation. order_financials_view's
// overdue_pending_amount only needs due_date <= today, so yesterday still
// lands the row in "late" while staying out of the today list.
test.describe("admin — dashboard collections card", () => {
  test("clicking a debtor row on the dashboard opens their customer page", async ({ page }) => {
    test.setTimeout(60_000);
    const customer = await createTestCustomer({ name: `E2E debtor dash ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    await createTestOrderItem(order.id, { unitPrice: 350, quantityOrdered: 1 });
    const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await createTestPayment({ orderId: order.id, paymentStatus: "pending", dueDate: yesterdayIso, amount: 350 });
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("link", { name: customer.name, exact: true });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();

      await page.waitForURL(`**/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
    } finally {
      // deleteTestOrder already deletes payments where order_id = id first
      // (payments_sales_requires_order_chk), so the seeded payment above
      // doesn't need its own delete call.
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });
});

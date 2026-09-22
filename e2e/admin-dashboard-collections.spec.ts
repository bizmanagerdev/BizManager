import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, createTestOrder, deleteTestOrder, createTestOrderItem } from "./db";

// CollectionsCard ("גבייה") is the mirror of UpcomingPayments, same shape —
// a debtor row links straight to the customer (/customers/<id>), no focus
// deep link needed since there's no list to scroll to on that page. Reuses
// admin-collections.spec.ts's own proven seed: a draft order with one unpaid
// item is enough for collections_view to surface a debtor with
// outstanding_amount > 0 — no payment or due date needed.
// getCollectionsSummary (lib/collections.ts) buckets by overdue_amount vs
// pending_amount into "late"/"upcoming", and the card's default-open tab is
// whichever bucket actually has something (see its own useState initializer)
// — with exactly one seeded debtor, that default tab is always the right one,
// so no tab click is needed here.
test.describe("admin — dashboard collections card", () => {
  test("clicking a debtor row on the dashboard opens their customer page", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E debtor dash ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    await createTestOrderItem(order.id, { unitPrice: 350, quantityOrdered: 1 });
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("link", { name: customer.name, exact: true });
      await expect(row).toBeVisible();
      await row.click();

      await page.waitForURL(`**/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });
});

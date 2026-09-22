import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer, createTestOrder, deleteTestOrder } from "./db";

// UpcomingDeliveries (components/dashboard/UpcomingDeliveries.tsx), the
// dashboard's "משלוחים קרובים" card, is deliberately never a stat tile —
// its own top comment says the row "jumps to the delivery queue focused on
// that one delivery ... not the order screen". That row → focus=<id> deep
// link (FocusHighlighter, mounted once in AppShell) is the distinctive,
// untested behavior here — not delivery confirmation itself, which
// worker-deliveries.spec.ts already covers thoroughly from the queue page.
// loadDeliveriesPage (app/(app)/sales/loadDeliveries.ts) includes any order
// whose status isn't in CLOSED_ORDER_STATUSES, so a bare "draft" order
// (createTestOrder's default) is enough — no order_items needed since the
// card only ever prints the customer's name/city/phone.
test.describe("admin — dashboard deliveries card", () => {
  test("clicking a delivery row on the dashboard opens the queue focused on that order", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E delivery customer ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    try {
      await loginAs(page, "admin");

      const row = page.getByRole("link", { name: `פרטי המשלוח — ${customer.name}`, exact: true });
      await expect(row).toBeVisible();
      await row.getByText(customer.name).click();

      await page.waitForURL((url) => url.pathname === "/sales" && url.searchParams.get("focus") === order.id);
      await expect(page.locator(`[data-focus-id="${order.id}"]:visible`).first()).toBeVisible();
    } finally {
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });
});

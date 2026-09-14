import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import {
  createTestCustomer,
  deleteTestCustomer,
  createTestOrder,
  deleteTestOrder,
  createTestOrderItem,
  deleteTestReminder,
} from "./db";

// collections_view (see supabase/migrations baseline) surfaces any non-cancelled
// order/project with outstanding_amount > 0 as a debtor row — a draft order with
// one unpaid item qualifies, no payment step needed. Rows carry
// data-focus-id={customer_id} (CollectionsClient.ui.tsx), the same scoping
// convention admin-payroll-approval.spec.ts uses for its cards.
//
// DateTimeInput (components/ui/date-input.tsx) is a masked text field: its
// onChange re-derives digits greedily against segment lengths [2,2,4,2,2]
// (day, month, YEAR, hour, minute). A 2-digit year only round-trips correctly
// when typed key-by-key; a single Playwright .fill() needs the full 4-digit
// year so the greedy slice lands on the right segments.
test.describe("admin — collections", () => {
  test("admin can add a collection reminder for a debtor", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E debtor ${Date.now()}` });
    const order = await createTestOrder(customer.id);
    await createTestOrderItem(order.id, { unitPrice: 500, quantityOrdered: 1 });
    let reminderId: string | null = null;
    try {
      await loginAs(page, "admin");
      await page.goto("/collections");

      // Both a mobile card and a desktop table row carry the same
      // data-focus-id — only one is actually visible at the test's (desktop)
      // viewport, so scope to :visible rather than .first().
      const row = page.locator(`[data-focus-id="${customer.id}"]:visible`);
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "מעקב" }).click();

      const tomorrow = new Date(Date.now() + 86_400_000);
      const dd = String(tomorrow.getDate()).padStart(2, "0");
      const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
      const yyyy = tomorrow.getFullYear();
      const dateTimeValue = `${dd}/${mm}/${yyyy} 09:00`;

      await page.getByPlaceholder("dd/mm/yy hh:mm").fill(dateTimeValue);

      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/reminders/create") && r.request().method() === "POST"),
        page.getByRole("button", { name: "הוספת תזכורת" }).click(),
      ]);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as { ok?: boolean; id?: string | null };
      expect(body.ok).toBe(true);
      reminderId = body.id ?? null;
      expect(reminderId).toBeTruthy();
    } finally {
      if (reminderId) await deleteTestReminder(reminderId);
      await deleteTestOrder(order.id);
      await deleteTestCustomer(customer.id);
    }
  });
});

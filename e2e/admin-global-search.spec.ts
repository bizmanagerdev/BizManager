import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer } from "./db";

// GlobalSearch (components/layout/GlobalSearch.tsx) is the top bar's search
// — a superset over every entity's own search (customers, projects, tasks,
// orders, products, documents, inventory, financials), found by
// public.global_search. On a computer (lg and up) it is an open box in the
// middle of the top bar since 2026-10-22 (owner: "I really want it to move
// into the top bar and be in the middle"), its results in a list under it;
// the magnifier that opens the full-screen dialog is the phone's (TopBar.tsx).
// Debounced 250ms then queries /api/search/global?mode=quick; results render
// as real <Link>s.
test.describe("admin — global search", () => {
  test("admin can find a customer via global search and open it", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E search customer ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      await page.getByRole("textbox", { name: "חיפוש בכל המערכת" }).fill(customer.name);

      const result = page.getByRole("link", { name: new RegExp(customer.name) });
      await expect(result).toBeVisible();
      await result.click();

      await page.waitForURL(`**/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });
});

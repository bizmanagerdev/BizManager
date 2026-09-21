import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer } from "./db";

// GlobalSearch (components/layout/GlobalSearch.tsx) is the top bar's search
// box — a superset over every entity's own search (customers, projects,
// tasks, orders, products, documents, inventory, financials — see its own
// "חפשו..." placeholder text). Debounced 250ms then queries
// /api/search/global?mode=quick; results render in a dropdown as real
// <Link>s, not a picker that needs a separate "open" step. Desktop-only
// input targeted (Playwright's default viewport is desktop-sized, so the
// mobile trigger button + full-screen ViewDialog variant never renders).
test.describe("admin — global search", () => {
  test("admin can find a customer via global search and open it", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E search customer ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      const searchInput = page.getByPlaceholder("חיפוש בכל המערכת...").first();
      await searchInput.click();
      await searchInput.fill(customer.name);

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

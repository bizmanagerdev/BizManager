import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";
import { createTestCustomer, deleteTestCustomer } from "./db";

// GlobalSearch (components/layout/GlobalSearch.tsx) is the top bar's search
// box — a superset over every entity's own search (customers, projects,
// tasks, orders, products, documents, inventory, financials). TopBar.tsx
// mounts it as <GlobalSearch mobileOnly iconOnly /> UNCONDITIONALLY (see
// topbar-layout memory: "search is a glyph") — there is no full-width
// desktop input variant at all anymore, only the icon-only trigger that
// opens the same full-screen ViewDialog at every viewport (confirmed by
// reading TopBar.tsx's own mount site, not assumed from the component's
// own desktop-input branch). Debounced 250ms then queries
// /api/search/global?mode=quick; results render as real <Link>s.
test.describe("admin — global search", () => {
  test("admin can find a customer via global search and open it", async ({ page }) => {
    const customer = await createTestCustomer({ name: `E2E search customer ${Date.now()}` });
    try {
      await loginAs(page, "admin");

      await page.getByRole("button", { name: "חיפוש" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox").fill(customer.name);

      const result = dialog.getByRole("link", { name: new RegExp(customer.name) });
      await expect(result).toBeVisible();
      await result.click();

      await page.waitForURL(`**/customers/${customer.id}`);
      await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
    } finally {
      await deleteTestCustomer(customer.id);
    }
  });
});

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";

// /financial is admin-only (app/(app)/financial/page.tsx redirects anyone
// else to /no-access) — a real access-control boundary, not just a nav item
// being hidden, so this is worth an end-to-end check with a real browser
// session rather than only a unit test of the redirect logic in isolation.
test.describe("role-based access", () => {
  test("admin can open /financial", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/financial");
    await expect(page).toHaveURL(/\/financial/);
    await expect(page).not.toHaveURL(/\/no-access/);
  });

  test("a worker hitting /financial directly is redirected to /no-access", async ({ page }) => {
    await loginAs(page, "worker");
    await page.goto("/financial");
    await expect(page).toHaveURL(/\/no-access/);
  });

  test("a worker's dashboard nav doesn't offer the financial section at all", async ({ page }) => {
    await loginAs(page, "worker");
    await expect(page.getByRole("link", { name: "תזרים" })).toHaveCount(0);
  });
});

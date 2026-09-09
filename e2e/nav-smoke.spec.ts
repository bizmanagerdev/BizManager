import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures";

// Broad, cheap coverage across every main admin-visible route (see
// components/layout/nav-items.tsx for the source list) — no test data
// needed, so this catches a real runtime crash (falls into
// app/(app)/error.tsx's boundary) or a gross auth/routing regression
// (unexpectedly bounced to /login or /no-access) on ANY of them, in CI,
// before a real user does. Detail "card" pages (customer/project/etc,
// which need an existing record to open) are covered separately in
// e2e/detail-pages.spec.ts.
const ERROR_BOUNDARY_TEXT = "אירעה תקלה בטעינת הדף";

const ADMIN_ROUTES = [
  "/dashboard",
  "/calendar",
  "/projects",
  "/tasks",
  "/sales",
  "/customers",
  "/communications",
  "/properties",
  "/vehicles",
  "/financial",
  "/collections",
  "/financial/payments-calendar",
  "/financial/reports",
  "/financial/bank",
  "/financial/taxes",
  "/checks",
  "/financial/loans",
  "/financial/statements",
  "/payroll",
  "/payroll/attendance",
  "/documents",
  "/activity",
  "/settings",
] as const;

test.describe("navigation smoke test", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  for (const path of ADMIN_ROUTES) {
    test(`${path} loads without crashing`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("load");
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).not.toHaveURL(/\/no-access/);
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    });
  }
});

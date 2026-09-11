import { test, expect } from "@playwright/test";
import { E2E_USERS } from "./fixtures";

test.describe("login", () => {
  test("signs in and lands on the dashboard, greeted by name", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill(E2E_USERS.admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();

    await page.waitForURL("**/dashboard");
    // The dashboard greeting shows the viewer's FIRST name only (see
    // firstNameOf() in lib/dashboard/greeting.ts) - "E2E Admin" the full name
    // never appears as visible text on first load, only inside the closed
    // account panel (components/layout/TopBar.tsx).
    //
    // Matched as ", E2E" (with the leading comma the greeting renders as
    // "<greeting>, E2E", DashboardGreetingTitle.tsx), not a bare "E2E" - a
    // bare match is ambiguous against the topbar's own "החשבון שלי — E2E
    // Admin" account button, and (if another test's cleanup didn't finish in
    // time) against any stray "E2E ..." customer/order left over elsewhere
    // on the page from a different spec entirely.
    await expect(page.getByText(", E2E", { exact: false })).toBeVisible();
  });

  test("a wrong password shows a Hebrew error and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill("definitely-wrong");
    await page.getByRole("button", { name: "התחברות" }).click();

    // toHebrewError maps the API's "Invalid email or password." to this exact
    // Hebrew string (lib/error-messages.ts's EXACT_MATCH table).
    await expect(page.getByText("דוא״ל או סיסמה שגויים.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

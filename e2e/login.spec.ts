import { test, expect } from "@playwright/test";
import { E2E_USERS } from "./fixtures";

test.describe("login", () => {
  test("signs in and lands on the dashboard, greeted by name", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill(E2E_USERS.admin.password);
    await page.getByRole("button", { name: "התחברות" }).click();

    await page.waitForURL("**/dashboard");
    await expect(page.getByText("E2E Admin")).toBeVisible();
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

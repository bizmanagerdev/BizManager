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

  test("the form is in the HTML: typed before any JS runs, it still signs in", async ({ page }) => {
    // /login is statically prerendered WITH its form. Using useSearchParams()
    // in LoginClient made Next bail the page out to client rendering — empty
    // HTML, blank until all its JS loaded (~1.4 s on a mid-range phone). Hold
    // every script back, so this only passes if the form came in the HTML and
    // React keeps what was typed into it before hydration.
    let release!: () => void;
    const scriptsHeld = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/_next/static/**", async (route) => {
      if (route.request().resourceType() === "script") await scriptsHeld;
      await route.continue();
    });

    await page.goto("/login", { waitUntil: "commit" });
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await page.locator('input[type="email"]').fill(E2E_USERS.admin.email);
    await page.locator('input[type="password"]').fill(E2E_USERS.admin.password);
    release();

    // Hydrated = React has attached to the field; only then does submit work.
    await page.waitForFunction(() => {
      const el = document.querySelector('input[type="email"]');
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
    });
    await page.getByRole("button", { name: "התחברות" }).click();
    await page.waitForURL("**/dashboard");
  });

  test("?email= prefills the email field", async ({ page }) => {
    await page.goto(`/login?email=${encodeURIComponent(E2E_USERS.admin.email)}`);
    await expect(page.locator('input[type="email"]')).toHaveValue(E2E_USERS.admin.email);
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

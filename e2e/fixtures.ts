import { expect, type Locator, type Page } from "@playwright/test";

// Matches supabase/seed.sql — three logins, one per role, all sharing this
// password. See e2e/README.md.
export const E2E_USERS = {
  admin: { email: "e2e-admin@bizh.test", password: "e2e-test-password-123" },
  office: { email: "e2e-office@bizh.test", password: "e2e-test-password-123" },
  worker: { email: "e2e-worker@bizh.test", password: "e2e-test-password-123" },
} as const;

export type E2ERole = keyof typeof E2E_USERS;

/** Fills and submits the login form, and waits for the post-login redirect. */
export async function loginAs(page: Page, role: E2ERole) {
  const { email, password } = E2E_USERS[role];
  await page.goto("/login");
  // The form's <label>s aren't programmatically associated with their inputs
  // (no htmlFor/id), so getByLabel can't find them — target by input type
  // instead (the password field's type toggles on a show/hide click, but
  // starts as "password", so this is safe before any such interaction).
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "התחברות" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Like loginAs, but for a dynamically-created test account (e.g.
 * db.ts's createTestWorker) rather than a fixed E2E_USERS role, and
 * deliberately does NOT wait for /dashboard — a worker with
 * section_access.dashboard off (or role=worker_no_access) lands somewhere
 * else entirely (see lib/auth/sections.ts's firstAccessiblePrefix / the
 * dashboard page's own redirect). Caller waits for whatever URL fits the
 * scenario being tested.
 */
export async function loginWithCredentials(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "התחברות" }).click();
}

/** The one address the stand-in Google below knows: a full one, so no house-number step and no warning. */
export const E2E_ADDRESS = {
  city: "תל אביב",
  street: "הרצל",
  houseNumber: "1",
  unit: "",
  lat: 32.0627,
  lng: 34.7708,
  placeId: "e2e-place-herzl-1-tel-aviv",
  formatted: "הרצל 1, תל אביב",
};

/**
 * Every address field (components/ui/address-picker.tsx, since 2026-10-18)
 * asks Google through /api/places/* and saves only an address picked from its
 * list. The local stack has no Google key, so this answers both calls in the
 * browser with E2E_ADDRESS. No save asks Google again on the server, so what's
 * picked here is what gets saved. Call it before the form opens.
 */
export async function mockAddressSearch(page: Page) {
  await page.route("**/api/places/autocomplete", (route) =>
    route.fulfill({
      json: {
        suggestions: [{ placeId: E2E_ADDRESS.placeId, main: "הרצל 1", secondary: "תל אביב, ישראל", kind: "address" }],
      },
    })
  );
  await page.route("**/api/places/details", (route) => route.fulfill({ json: { address: E2E_ADDRESS } }));
}

/**
 * Types into the address field inside `scope` and picks the suggestion
 * (needs mockAddressSearch). The list opens in a portal, outside a dialog, so
 * it's looked for on the whole page.
 */
export async function pickAddress(page: Page, scope: Page | Locator = page, options: { timeout?: number } = {}) {
  await scope.getByRole("combobox", { name: "כתובת", exact: true }).fill("הרצל 1", options);
  await page.getByRole("option", { name: /הרצל 1/ }).click(options);
  // Picked: the field turns into the address with its "שינוי" and clear buttons.
  await expect(scope.getByRole("button", { name: "ניקוי הכתובת" })).toBeVisible(options);
}
